import { VitalSample, VitalSampleSchema } from "@safetymonitor/schemas";

import {
  persistSample,
  updateFallCandidateState,
  totalPersisted as dbTotalPersisted,
  listAllWorkers,
  getWorkerProfiles,
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

// 생체 위험(심박/SpO₂/체온 중 하나라도 danger) 여부 — alerts "vital" 전이 감지용.
// 알림 이력(감사)은 안정 임계로 판정한다(활동 게이트 미적용) → 작업 중이라도 위험이
// 활동 메트릭 유무로 가려지지 않음(false-negative 0). 카드·신호등 표시의 활동 완화와는 분리.
export function vitalDanger(s: VitalSample | undefined): boolean {
  if (!s) return false;
  return (
    heartRateStatus(s.heartRate) === "danger" ||
    spo2Status(s.spo2) === "danger" ||
    coreTempStatus(s.skinTempC) === "danger"
  );
}

export async function addSample(input: unknown): Promise<VitalSample | null> {
  const normalized =
    typeof input === "object" && input !== null && "hr" in input
      ? {
          ...input,
          heartRate: (input as { hr?: unknown }).hr,
        }
      : input;

  const sample = VitalSampleSchema.parse(normalized);
  if (isReservedTestWorker(sample.workerId)) {
    return null;
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
  try {
    await persistSample(sample);
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
    // 생체 위험(심박/SpO₂/체온 danger) 정상→위험 전이 시 1건 기록(진입당 1건).
    // 병합 기준이라 잠금 null 깜빡임엔 안 흔들리고, SOS/낙상 동반 샘플은 위에서 기록되므로 제외.
    if (!sample.manualSos && !sample.fallDetected) {
      // 추가 후 상태 = 추가 전 워커 샘플 + 이번 sample (ring 재필터 없이 재사용).
      const curMerged = mergeLatestByWorker([...prevWorkerSamples, sample])[0];
      if (!vitalDanger(prevMerged) && vitalDanger(curMerged)) {
        await recordAlert({
          workerId: sample.workerId,
          workerName: sample.workerName ?? null,
          type: "vital",
          ts: curMerged?.ts ?? sample.ts,
        });
      }
    }
  } catch (error) {
    console.error("[store] DB persist failed:", error);
  }
  return sample;
}

// DB 에 누적된 총 sample 건수 — UI 라벨 "DB 영속 N건 누적" 표시용
export async function totalPersisted(): Promise<number> {
  return dbTotalPersisted();
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

export function latestByWorker() {
  return mergeLatestByWorker(mockStore.samples);
}

// 순수 함수(I/O 없음) — 워커별 최신 샘플 병합. 단위 테스트 가능하도록 분리.
// 수집시각(ts) 기준 최신 우선 + null 메트릭 sticky carry-forward + 이벤트 플래그 비-sticky.
export function mergeLatestByWorker(samples: VitalSample[]): VitalSample[] {
  const latest = new Map<string, VitalSample>();

  for (const sample of samples) {
    if (isReservedTestWorker(sample.workerId)) continue;
    const previous = latest.get(sample.workerId);

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
    latest.set(sample.workerId, {
      ...older,
      ...newer,
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
    });
  }

  return Array.from(latest.values()).sort((a, b) =>
    a.workerId.localeCompare(b.workerId),
  );
}
