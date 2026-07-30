import {
  type VitalDataOrigin,
  VitalSample,
  VitalSampleSchema,
  parseResilientVitalSample,
} from "@safetymonitor/schemas";

import {
  persistSample,
  persistDataMockup,
  updateFallCandidateState,
  totalPersisted as dbTotalPersisted,
  totalDataMockupPersisted as dbTotalDataMockupPersisted,
  recentDataMockupSamples,
  listAllWorkers,
  getWorkerProfiles,
  getWorkerAliasMap,
  recordAlert,
} from "../../../lib/db";
import { heartRateStatus, spo2Status, coreTempStatus } from "../../../lib/severity";

type Store = {
  samples: VitalSample[];
};

const globalForMockStore = globalThis as typeof globalThis & {
  __safetyMonitorMockStore?: Store;
};

export const mockStore =
  globalForMockStore.__safetyMonitorMockStore ??
  (globalForMockStore.__safetyMonitorMockStore = { samples: [] });

// 진단 smoke test 용 ID 는 store/대시보드에 노출되지 않도록 차단.
const RESERVED_TEST_IDS = new Set(["infra_check", "warmup", "netcheck"]);
const RESERVED_PREFIX_RE = /^(test_|smoke_|infra_|reserved_)/i;

export function isReservedTestWorker(workerId: string) {
  return RESERVED_TEST_IDS.has(workerId) || RESERVED_PREFIX_RE.test(workerId);
}

// 단말 source 는 앱이 보낸 식별자이고, DB 표기값은 이 서버 매핑으로만 확정한다.
// 알 수 없는 source 는 실데이터·목업 어느 쪽에도 저장하지 않아 원본 오염을 차단한다.
export function classifyVitalDataOrigin(source: string | undefined): VitalDataOrigin | null {
  switch (source) {
    case "VitAlGuard-iPhone":
      return "ios_data_vitalguard";
    case "VitAlGuard-WatchVitals":
    case "VitAlGuard-Watch-background":
      return "watchos_data_vitalguard";
    case "VitAlGuard-Mock-iPhone":
    case "VitAlGuard-Mock-iOS":
    case "mockup_ios_data_vitalguard":
      return "mockup_ios_data_vitalguard";
    case "VitAlGuard-Mock-Watch":
    case "VitAlGuard-Mock-watchOS":
    case "mockup_watchos_data_vitalguard":
      return "mockup_watchos_data_vitalguard";
    default:
      return null;
  }
}

function isDataMockupOrigin(origin: VitalDataOrigin): boolean {
  return origin === "mockup_ios_data_vitalguard" || origin === "mockup_watchos_data_vitalguard";
}

// 메트릭별 생체 위험 판정 — alerts "vital" 전이 감지용(hr/spo2/temp 독립 추적).
// 알림 이력(감사)은 안정 임계로 판정한다(활동 게이트 미적용) → 작업 중이라도 위험이
// 활동 메트릭 유무로 가려지지 않음(false-negative 0). 카드·신호등 표시의 활동 완화와는 분리.
export type VitalDangerMetric = "hr" | "spo2" | "temp";

export function dangerMetrics(s: VitalSample | undefined): VitalDangerMetric[] {
  if (!s) return [];
  const out: VitalDangerMetric[] = [];
  if (heartRateStatus(s.heartRate) === "danger") out.push("hr");
  if (spo2Status(s.spo2) === "danger") out.push("spo2");
  if (coreTempStatus(s.skinTempC) === "danger") out.push("temp");
  return out;
}

// 생체 위험(심박/SpO₂/체온 중 하나라도 danger) 여부 — dangerMetrics 단일 source 위임.
export function vitalDanger(s: VitalSample | undefined): boolean {
  return dangerMetrics(s).length > 0;
}

// 신규 danger 진입 메트릭 존재 여부 — prev 에 없던 danger 메트릭이 cur 에 하나라도 있으면 true.
// 이진 vitalDanger 전이(정상→위험)만 보면 HR danger 지속 중 SpO₂ 가 새로 danger 로
// 진입하는 두 번째 별개 응급이 prev/cur 모두 danger 라 삼켜진다 → 메트릭별 독립 전이로 감지.
export function hasNewDangerMetric(
  prev: VitalSample | undefined,
  cur: VitalSample | undefined,
): boolean {
  const prevSet = new Set(dangerMetrics(prev));
  return dangerMetrics(cur).some((m) => !prevSet.has(m));
}

// 빈 샘플 판별 — 이 샘플이 모니터링 가치가 있는 실측 신호를 하나라도 담고 있는가.
// 실측 생체(심박/SpO₂/손목·환경온도)·모션(가속/정지)·스트레스 입력·낙상 후보·이벤트(SOS/낙상=true) 중
// 하나라도 있으면 true. 메타데이터(이름·사번·직급)·보호자·위치·배터리·이벤트 false 만 있으면 false(빈 샘플).
// 이벤트 플래그는 false 로 실려올 수 있어 present 가 아니라 === true 로만 신호로 인정한다.
export function hasMonitorableSignal(s: VitalSample): boolean {
  return (
    s.heartRate !== undefined ||
    s.spo2 !== undefined ||
    s.skinTempC !== undefined ||
    s.ambientTempC !== undefined ||
    s.accelMagnitudeG !== undefined ||
    s.motionStillSec !== undefined ||
    s.hrvSdnnMs !== undefined ||
    s.restingHeartRate !== undefined ||
    s.activeEnergyKcal !== undefined ||
    s.steps !== undefined ||
    s.walkingHeartRate !== undefined ||
    s.flightsClimbed !== undefined ||
    s.respiratoryRate !== undefined ||
    s.manualSos === true ||
    s.fallDetected === true ||
    s.fallCandidate === true
  );
}

// 작업자 ID 병합 별칭 캐시(secondary → primary) — 수신마다 DB 조회 회피(15s TTL).
// owner 가 별칭 등록/해제하면 최대 15s 내 자동 반영. DB 실패 시 원본 ID 사용(폴백).
let _aliasCache: { map: Record<string, string>; at: number } | null = null;
const ALIAS_TTL_MS = 15000;
async function resolvePrimaryWorkerId(workerId: string): Promise<string> {
  const now = Date.now();
  if (!_aliasCache || now - _aliasCache.at > ALIAS_TTL_MS) {
    try {
      _aliasCache = { map: await getWorkerAliasMap(), at: now };
    } catch {
      if (!_aliasCache) return workerId;
    }
  }
  return _aliasCache.map[workerId] ?? workerId;
}

// 스키마에 없는 필드는 zod 가 조용히 버린다. 그 침묵이 같은 사고를 네 번 냈다 —
// accelerationMagnitudeG(감사 BND-CONTRACT-01) · mlFallPipelineActive(2026-07-27) ·
// heartbeat·locationTimestamp·watchDeviceModel(2026-07-30). 매번 "앱은 보내는데 서버엔 없다"였고,
// raw_json 도 파싱 **이후** 값이라 사후 복구조차 안 됐다.
// 값을 받아주지는 않되(스키마 변경 없이 임의 필드 저장은 위험), 버리고 있다는 사실은 남긴다.
// 이름당 1회만 경고 — 5초 주기 전송이라 매 건 찍으면 로그가 덮인다.
const KNOWN_SAMPLE_FIELDS = new Set([...Object.keys(VitalSampleSchema.shape), "hr"]);
const warnedUnknownFields = new Set<string>();

function warnUnknownFields(input: unknown): void {
  if (typeof input !== "object" || input === null) return;
  const unknown = Object.keys(input).filter(
    (k) => !KNOWN_SAMPLE_FIELDS.has(k) && !warnedUnknownFields.has(k),
  );
  if (unknown.length === 0) return;
  for (const k of unknown) warnedUnknownFields.add(k);
  console.warn(
    `[vital] 스키마에 없는 필드 수신 — 저장되지 않고 버려집니다: ${unknown.join(", ")}`,
  );
}

export async function addSample(input: unknown): Promise<VitalSample | null> {
  warnUnknownFields(input);
  const normalized =
    typeof input === "object" && input !== null && "hr" in input
      ? {
          ...input,
          heartRate: (input as { hr?: unknown }).hr,
        }
      : input;

  // 리질리언트 파서 — 범위 밖 vital 만 필드 단위로 스트립하고 나머지는 수용해, 한 필드 때문에
  // 샘플 전체(심박·SpO₂·체온 포함)가 조용히 폐기되는 것을 막는다.
  // 스트립은 반드시 로그로 드러낸다 — 조용히 버리면 "데이터가 왜 없는지" 아무도 모르게 된다.
  const parsed = parseResilientVitalSample(normalized, (keys, sample) => {
    console.warn(
      `[vital] 범위 밖 필드 스트립 — workerId=${sample.workerId} fields=${keys.join(",")}`,
    );
  });
  // 작업자 ID 병합 — 별칭(secondary)을 주 ID(primary)로 정규화해 같은 사람을 1카드로 합친다.
  const resolved = { ...parsed, workerId: await resolvePrimaryWorkerId(parsed.workerId) };
  if (isReservedTestWorker(resolved.workerId)) {
    return null;
  }
  const dataOrigin = classifyVitalDataOrigin(resolved.source);
  if (!dataOrigin) {
    console.warn(`[vital] 미분류 source 차단 — workerId=${resolved.workerId}`);
    return null;
  }
  const sample = { ...resolved, dataOrigin };
  // 빈 샘플 미영속 — 실측 신호가 하나도 없는 샘플(화면 "—")은 수신하지 않는다.
  if (!hasMonitorableSignal(sample)) {
    return null;
  }
  // 목업은 낙상 후보 후속 갱신·알림 이력보다 먼저 분리한다. 그래야 목업이 vital_samples 행을 갱신할 수 없다.
  if (isDataMockupOrigin(dataOrigin)) {
    try {
      await persistDataMockup(sample);
    } catch (error) {
      console.error("[store] data_mockup persist failed:", error);
    }
    return sample;
  }
  // 낙상 후보 후속 업데이트(HR 추적/확인 프롬프트 결과) — 기존 candidate 행만 보강하고, 실제 경보
  // 플래그가 없는 메타데이터 샘플은 실시간 ring/알림에 넣지 않는다. 경보(sample.fallDetected/manualSos)는
  // 별도 이벤트 행으로 남겨 관제 웹 알림 이력을 유지한다.
  if (
    sample.fallCandidateId &&
    (sample.fallUpdatePhase === "post_impact_followup" ||
      sample.fallUpdatePhase === "prompt_result")
  ) {
    await updateFallCandidateState(sample);
    if (!sample.fallDetected && !sample.manualSos) return sample;
  }
  // 생체 위험 전이 감지용 — 추가 전 이 워커의 병합(sticky) 상태.
  // 같은 워커 샘플은 ring 에서 한 번만 필터해 prev/cur 두 병합에 재사용(중복 filter 제거).
  const prevWorkerSamples = mockStore.samples.filter(
    (s) => s.workerId === sample.workerId,
  );
  const prevMerged = mergeLatestByWorker(prevWorkerSamples)[0];
  // 화면 갱신용 in-memory ring (최근 500). DB 는 무한 축적 (산업재해 자료 대비).
  mockStore.samples = [...mockStore.samples, sample].slice(-500);
  // 영속과 경보 기록을 분리 — 종전엔 한 try 라서 persistSample 실패(풀 고갈·비번 사고)가 SOS·낙상
  // 경보 기록·텔레그램까지 삼켰다(감사 DB-POOL-02, 2026-06-30 실발생). 샘플 저장은 잃어도 경보는 간다.
  try {
    await persistSample(sample);
  } catch (error) {
    console.error("[store] DB persist failed:", error);
  }
  try {
    // SOS/낙상 이벤트는 알림 이력에 기록(중복은 DB UNIQUE 로 무시) — AF4.
    if (sample.manualSos) {
      await recordAlert({
        workerId: sample.workerId,
        workerName: sample.workerName ?? null,
        type: "sos",
        ts: sample.ts,
      });
    }
    if (sample.fallDetected) {
      await recordAlert({
        workerId: sample.workerId,
        workerName: sample.workerName ?? null,
        type: "fall",
        ts: sample.ts,
      });
    }
    // 생체 위험(심박/SpO₂/체온 danger) 메트릭별 신규 진입 시 1건 기록(메트릭 진입당 1건) —
    // HR danger 지속 중 SpO₂ 크래시 같은 두 번째 별개 응급도 감지. 병합 기준이라 잠금 null
    // 깜빡임엔 안 흔들리고, SOS/낙상 동반 샘플은 위에서 기록되므로 제외. 같은 ts 중복은 DB UNIQUE dedup.
    if (!sample.manualSos && !sample.fallDetected) {
      // 추가 후 상태 = 추가 전 워커 샘플 + 이번 sample (ring 재필터 없이 재사용).
      const curMerged = mergeLatestByWorker([...prevWorkerSamples, sample])[0];
      if (hasNewDangerMetric(prevMerged, curMerged)) {
        await recordAlert({
          workerId: sample.workerId,
          workerName: sample.workerName ?? null,
          type: "vital",
          ts: curMerged?.ts ?? sample.ts,
        });
      }
    }
  } catch (error) {
    console.error("[store] 경보 기록 실패:", error);
  }
  return sample;
}

// DB 에 누적된 총 sample 건수 — UI 라벨 "DB 영속 N건 누적" 표시용
export async function totalPersisted(): Promise<number> {
  return dbTotalPersisted();
}

export async function totalDataMockupPersisted(): Promise<number> {
  return dbTotalDataMockupPersisted();
}

export async function dataMockupSamples(): Promise<VitalSample[]> {
  return recentDataMockupSamples();
}

// 워커별 DB 누적 건수 — 각 작업자 카드의 "실시간 수집 DB 누적 N건" 표시용.
// 기존 관리자용 GROUP BY 집계(listAllWorkers)를 재사용한다.
export async function countsByWorker(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const w of await listAllWorkers()) {
    if (isReservedTestWorker(w.worker_id)) continue;
    out[w.worker_id] = w.sample_count;
  }
  return out;
}

// 직급/직책 관제 웹 오버라이드 맵(workerId → 직급) — 대시보드가 폰 발신값보다 우선 적용.
// 예약 워커는 대시보드에 안 뜨므로 함께 제외.
export async function workerProfiles(): Promise<Record<string, string>> {
  const all = await getWorkerProfiles();
  const out: Record<string, string> = {};
  for (const [id, title] of Object.entries(all)) {
    if (isReservedTestWorker(id)) continue;
    out[id] = title;
  }
  return out;
}

export function recentSamples(limit = 80) {
  return mockStore.samples
    .filter((s) => !isReservedTestWorker(s.workerId))
    .slice(-limit)
    .reverse();
}

export function latestByWorker(aliasMap?: Record<string, string>) {
  return mergeLatestByWorker(mockStore.samples, aliasMap);
}

// 활동 분류 필드 신선도 TTL — 활동 전송(60초 sub-cadence)이 끊기면 마지막 'heavy' 활동이
// 무기한 sticky 로 남아 소비처(classifyActivity)가 심박 완화 밴드(135/155)를 계속 적용,
// 안정 상태 HR 145 가 caution 에 머물러 위험 팝업이 안 뜬다 → 병합 결과 ts 기준으로
// 활동 관측이 90초를 초과해 오래됐으면 활동 3필드를 만료(undefined)해 안정 임계로 폴백.
const ACTIVITY_TTL_MS = 90_000;

function hasActivityFields(s: VitalSample): boolean {
  return s.activeEnergyKcal != null || s.steps != null || s.flightsClimbed != null;
}

// SpO₂ 신선도 TTL — 활동 3필드와 달리 SpO₂ 는 '누락'으로 오래됨을 알 수 없다. 워치가 마지막
// 스팟 측정값을 매 심박 전송에 계속 얹어 보내 필드가 항상 present 이기 때문이다. 애플워치 SpO₂ 는
// 연속 측정이 아니라 손목이 정지했을 때만 걸리는 간헐 스팟 측정이라(실측 하루 ~15회, 며칠 0회도
// 발생), 게이트가 없으면 며칠 전 값이 계속 '정상' 으로 표시되고 신호등·텔레그램 알림·위험 판정까지
// 그 위에서 이뤄진다(없는 위험을 알리는 낙상 오탐과 반대로, 있는 위험을 놓치는 방향).
// → 값이 바뀐 적 없는 연속 구간의 시작 ts 로 나이의 하한을 잡고, 30분 초과면 만료(undefined).
//   spo2Status 가 idle 로 떨어져 "--" 표시 + 모든 판정에서 제외된다(소비처 수정 불필요).
// 한계: 나이는 하한만 알 수 있다(측정 시각을 워치가 보내주지 않음 — 워치 앱은 팀원 소유라 별도 조율).
//   서로 다른 두 측정이 우연히 같은 값이면 실제보다 오래된 것으로 본다(안전한 방향의 오차).
const SPO2_TTL_MS = 30 * 60_000;

type Spo2Obs = { tsMs: number; spo2: number };

// 현재 값이 연속으로 관측되기 시작한 ts — 나이 하한의 기준점.
// 현재 값과 다른 마지막 관측(lastDiff) 이후로 같은 값만 이어진 구간의 시작점을 찾는다.
// 관측이 전부 현재 값이면 가장 오래된 관측 ts 가 하한이 된다(그 이전은 ring 밖이라 알 수 없음).
function spo2RunStartMs(obs: Spo2Obs[], current: number): number | null {
  let lastDiff = -Infinity;
  for (const o of obs) {
    if (o.spo2 !== current && o.tsMs > lastDiff) lastDiff = o.tsMs;
  }
  let start = Infinity;
  for (const o of obs) {
    if (o.spo2 === current && o.tsMs > lastDiff && o.tsMs < start) start = o.tsMs;
  }
  return Number.isFinite(start) ? start : null;
}

// 순수 함수(I/O 없음) — 워커별 최신 샘플 병합. 단위 테스트 가능하도록 분리.
// 수집시각(ts) 기준 최신 우선 + null 메트릭 sticky carry-forward + 이벤트 플래그 비-sticky.
// aliasMap(secondary→primary) 가 있으면 표시 시점에 별칭을 주 ID로 접어 같은 사람을 한 카드로 병합한다
// (인스턴스·캐시 타이밍 무관 — 매 GET 마다 DB 별칭으로 ring 을 재키잉).
export function mergeLatestByWorker(
  samples: VitalSample[],
  aliasMap?: Record<string, string>,
): VitalSample[] {
  const latest = new Map<string, VitalSample>();
  // 워커별 활동 분류 필드가 실제 존재했던 최대 샘플 ts(ms) — TTL 판정 기준(Date.now() 미사용 = 순수 유지).
  const activityTsMs = new Map<string, number>();
  // 워커별 SpO₂ 관측(ts, 값) — 값 변화 시점으로 나이를 산출하기 위해 모은다.
  const spo2Obs = new Map<string, Spo2Obs[]>();

  for (const sample of samples) {
    if (isReservedTestWorker(sample.workerId)) continue;
    const wid = aliasMap?.[sample.workerId] ?? sample.workerId;
    const previous = latest.get(wid);

    if (hasActivityFields(sample)) {
      const t = Date.parse(sample.ts);
      if (Number.isFinite(t)) {
        const prevT = activityTsMs.get(wid);
        if (prevT === undefined || t > prevT) activityTsMs.set(wid, t);
      }
    }

    if (sample.spo2 != null) {
      const t = Date.parse(sample.ts);
      if (Number.isFinite(t)) {
        const obs = spo2Obs.get(wid);
        if (obs) obs.push({ tsMs: t, spo2: sample.spo2 });
        else spo2Obs.set(wid, [{ tsMs: t, spo2: sample.spo2 }]);
      }
    }

    // 삽입 순서가 아닌 수집시각(ts) 기준으로 최신을 판정 — 워치는 오프라인 backlog 를 fresh 배치
    // 성공 후 별도 POST 로 보내므로 더 오래된 샘플이 더 나중에 삽입될 수 있다. 이때 그냥 last-writer 로
    // 덮으면 ts 가 역행하고 신선도 바가 stale 로 표시된다 → ts 가 더 큰 쪽을 newer 로 고정.
    const isNewer = !previous || sample.ts >= previous.ts;
    const newer = isNewer ? sample : previous;
    const older = isNewer ? previous : sample;

    // 생체값 sticky — 잠금 상태에선 iOS 가 HealthKit 읽기를 막아 폰이 null 을 보내므로,
    // 직전에 받은 마지막 실측값을 유지해 관제 화면 모니터링 연속성을 보장한다(잠금 중에도
    // 카드가 마지막 실측값으로 살아있음). SOS/낙상 이벤트 샘플(생체 미동봉)도 동일하게 직전값 유지.
    // 센서가 아예 없는 메트릭(예: Apple Watch SE 의 SpO₂·손목온도)은 실측을 받은 적이 없어
    // older 도 undefined → "--" 유지(시연용 조작값은 폰 fallback 제거로 더 이상 안 들어옴).
    const merged: VitalSample = {
      ...older,
      ...newer,
      workerId: wid,
      workerName: newer.workerName ?? older?.workerName,
      employeeId: newer.employeeId ?? older?.employeeId,
      guardianName: newer.guardianName ?? older?.guardianName,
      guardianPhone: newer.guardianPhone ?? older?.guardianPhone,
      heartRate: newer.heartRate ?? older?.heartRate,
      spo2: newer.spo2 ?? older?.spo2,
      skinTempC: newer.skinTempC ?? older?.skinTempC,
      ambientTempC: newer.ambientTempC ?? older?.ambientTempC,
      batteryPct: newer.batteryPct ?? older?.batteryPct,
      // 스트레스 입력은 60초 sub-cadence 라 대부분의 5초 폴 샘플엔 없음 → sticky 로
      // 직전 값 유지(빠른 vital 과 달리 느린 메트릭이라 carry-forward 가 정상).
      hrvSdnnMs: newer.hrvSdnnMs ?? older?.hrvSdnnMs,
      restingHeartRate: newer.restingHeartRate ?? older?.restingHeartRate,
      activeEnergyKcal: newer.activeEnergyKcal ?? older?.activeEnergyKcal,
      steps: newer.steps ?? older?.steps,
      walkingHeartRate: newer.walkingHeartRate ?? older?.walkingHeartRate,
      flightsClimbed: newer.flightsClimbed ?? older?.flightsClimbed,
      respiratoryRate: newer.respiratoryRate ?? older?.respiratoryRate,
      // 이벤트 플래그는 sticky 금지 — 최신(newer) sample 의 자기 값만 사용 (없으면 undef).
      // 이벤트 자체의 시각 영속성은 dashboard 쪽 lastSosTs/lastFallTs 로 별도 관리.
      manualSos: newer.manualSos,
      fallDetected: newer.fallDetected,
      ts: newer.ts,
    };

    // 활동 분류 필드 TTL — 최신 샘플 ts 가 마지막 활동 관측 ts 보다 90초 넘게 지났으면 만료.
    // 90초 이내(신선)면 기존 sticky 와 완전 동일. 스트레스 입력은 활동 게이트와 무관하므로 유지.
    const actTs = activityTsMs.get(wid);
    const mergedTsMs = Date.parse(merged.ts);
    if (actTs !== undefined && Number.isFinite(mergedTsMs) && mergedTsMs - actTs > ACTIVITY_TTL_MS) {
      merged.activeEnergyKcal = undefined;
      merged.steps = undefined;
      merged.flightsClimbed = undefined;
    }

    latest.set(wid, merged);
  }

  // SpO₂ TTL — 같은 값이 30분 넘게 이어졌으면 그 사이 새 측정이 없었다는 뜻이므로 만료한다.
  for (const merged of latest.values()) {
    if (merged.spo2 == null) continue;
    const obs = spo2Obs.get(merged.workerId);
    const mergedTsMs = Date.parse(merged.ts);
    if (obs === undefined || !Number.isFinite(mergedTsMs)) continue;
    const startMs = spo2RunStartMs(obs, merged.spo2);
    if (startMs !== null && mergedTsMs - startMs > SPO2_TTL_MS) {
      merged.spo2 = undefined;
    }
  }

  return Array.from(latest.values()).sort((a, b) =>
    a.workerId.localeCompare(b.workerId),
  );
}

// 별칭 맵(secondary→primary) — GET 핸들러가 표시 폴딩용으로 로드. DB 실패 시 빈 맵.
export async function workerAliases(): Promise<Record<string, string>> {
  try {
    return await getWorkerAliasMap();
  } catch {
    return {};
  }
}
