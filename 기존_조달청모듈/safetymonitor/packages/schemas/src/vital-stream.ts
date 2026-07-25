// 생체 시계열 (VitalStream) — Watch → 폰 → IoT → DDB 단일 샘플
import { z } from "zod";

export const VitalSampleSchema = z.object({
  // 길이·문자셋 제한 — workerId 는 서버 로그(`[vital] … workerId=…`)와 버킷 키에 그대로 들어간다.
  // 무제한이면 개행을 넣어 로그 라인을 위조하거나 100KB 문자열로 로그를 부풀릴 수 있다(감사 DLT-SCHEMA).
  workerId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._:-]+$/, "workerId 는 영숫자와 . _ : - 만 허용"),
  ts: z.string().datetime(),
  workerName: z.string().min(1).max(40).optional(),
  employeeId: z.string().min(1).max(40).optional(),
  jobTitle: z.string().min(1).max(40).optional(), // 직급/직책 — 폰 ⚙️ 발신값(관제 웹 입력은 worker_profile 오버라이드)

  heartRate: z.number().min(20).max(250).optional(),
  spo2: z.number().min(50).max(100).optional(),
  accelMagnitudeG: z.number().min(0).max(20).optional(),
  motionStillSec: z.number().min(0).optional(),
  skinTempC: z.number().min(20).max(45).optional(),
  ambientTempC: z.number().min(-30).max(60).optional(),
  manualSos: z.boolean().optional(),
  fallDetected: z.boolean().optional(),
  // 낙상 ML 데이터 수집(fall-ml) — 낙상 디텍터 후보 샘플의 활성화 요소. 음성(거부) 샘플도 수집해
  // 임계 최적화 학습에 쓴다. fallCandidate=true 면 양성/음성 공통, fallDetected 는 양성만 동봉.
  fallCandidate: z.boolean().optional(),
  fallCandidateId: z.string().uuid().optional(),
  fallDecision: z
    .enum(["fall", "rejected_no_corroboration", "rejected_timeout"])
    .optional(),
  fallUpdatePhase: z
    .enum(["candidate", "post_impact_followup", "prompt_result"])
    .optional(),
  fallPromptOutcome: z
    // moved_cancelled: 프롬프트 20초 동안 착용자 움직임 감지 → 자동 취소(멀쩡). 무동작 게이트 결과.
    .enum(["pending", "dismissed", "manual_sos", "auto_escalated", "moved_cancelled"])
    .optional(),
  fallPromptResponseSec: z.number().min(0).max(600).optional(),
  freefallPreceded: z.boolean().optional(),
  peakRotationRadS: z.number().min(0).max(50).optional(),
  hrPreMean10s: z.number().min(20).max(250).optional(),
  hrAtImpact: z.number().min(20).max(250).optional(),
  hrPostMean30s: z.number().min(20).max(250).optional(),
  hrPostPeak30s: z.number().min(20).max(250).optional(),
  hrDeltaMean: z.number().min(-100).max(100).optional(),
  hrDeltaPeak: z.number().min(-100).max(100).optional(),
  guardianName: z.string().min(1).max(40).optional(),
  guardianPhone: z.string().min(1).max(40).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  batteryPct: z.number().min(0).max(100).optional(),
  // 스트레스 알고리즘 입력 (P0 데이터 수집). 60초 sub-cadence 로만 채워지는 sparse 필드.
  // 활동에너지/걸음/계단은 직전 수집 이후 구간 합. 분석은 packages/analyzers 가 수행.
  hrvSdnnMs: z.number().min(0).max(500).optional(),
  restingHeartRate: z.number().min(20).max(150).optional(),
  activeEnergyKcal: z.number().min(0).max(200).optional(),
  steps: z.number().min(0).max(5000).optional(),
  walkingHeartRate: z.number().min(40).max(250).optional(),
  flightsClimbed: z.number().min(0).max(500).optional(),
  respiratoryRate: z.number().min(4).max(60).optional(),

  // 상시 모션 스냅샷 (워치 VitalTransmitter 의 정기 전송 경로) — 낙상 후보의 충격 피크와는
  // 의미가 다르다. accelMagnitudeG/peakRotationRadS 는 "충격 순간의 피크"이고 아래 둘은
  // "지금 이 순간의 값"이다. 이름이 스키마에 없어 그동안 100% 무음 strip 됐다(감사 BND-CONTRACT-01).
  // 별칭으로 피크 필드에 합치지 않는다 — 상시값이 충격 피크로 오인되면 낙상 분석이 오염된다.
  accelerationMagnitudeG: z.number().min(0).max(20).optional(),
  rotationRateRadS: z.number().min(0).max(50).optional(),

  // 낙상 ML 텔레메트리 (감사 BND-CONTRACT-02) — 워치가 후보마다 실어 보내지만 스키마에 없어
  // 전량 무음 폐기됐다. ML 판정 근거가 저장되지 않아 임계 재학습·오탐 사후분석이 불가능했다.
  fallRuleIsFall: z.boolean().optional(),
  mlWorkVetoProb: z.number().min(0).max(1).optional(),
  mlImpactProb: z.number().min(0).max(1).optional(),
  mlShouldAlert: z.boolean().optional(),
  mlVetoedByML: z.boolean().optional(),
  mlRejectedByImpactML: z.boolean().optional(),
  mlRescuedByML: z.boolean().optional(),
});

export type VitalSample = z.infer<typeof VitalSampleSchema>;

// 리질리언트 파서 — 범위 밖 "선택적 숫자" vital 만 필드 단위로 제거(strip = undefined)한 뒤
// 재검증해, 한 필드 때문에 샘플 전체가 폐기되지 않게 한다.
// 심정지(HR<20)·모션아티팩트 SpO₂(<50)·강한 낙상충격(>20G)처럼 이 시스템이 잡아야 할 응급의 vital 이
// 스키마 범위를 벗어나도 플래그·나머지 유효 필드는 살아남아 경보(recordAlert)가 발화한다.
// 값을 경계로 조작(clamp)하지 않는다 — 조작된 vital 을 기록하느니 비워두고 플래그로 경보를 살린다.
//
// 2026-07-25 — 이벤트 플래그 샘플 한정에서 전 샘플로 확대했다가, 2026-07-26 **부분 철회**.
// 확대 사유였던 것: 워치가 활동량(steps/activeEnergyKcal)을 하루 누적으로 보내 오후에 상한을
// 넘기면 비-이벤트 샘플이 strict 로 거부되면서 심박·SpO₂·체온까지 함께 폐기됐다(감사 BND-LOSS-01).
//
// 철회 사유(2차 감사에서 3개 에이전트가 독립 확인, 1건은 파서 실행으로 실측):
// 전 샘플 확대는 **생체값에 대해 더 위험한 결과**를 낳았다. 비-이벤트 샘플의 범위 밖 spo2(<50)·
// heartRate(<20)가 조용히 스트립되면 샘플은 저장되어 ts 가 전진하고, store.ts 의 sticky 병합이
// 그 자리를 직전 정상값으로 채운다 → 화면에 "정상·연결됨"으로 표시되고 경보도 발화하지 않는다.
// 확대 전에는 샘플이 통째 거부되어 ts 가 늙었고 신선도 게이트가 "연결끊김"으로 드러냈다.
// 위 주석의 "플래그와 나머지 필드가 살아남아 경보가 발화한다"는 논리는 **이벤트 샘플에만 성립**한다 —
// 비-이벤트 샘플에는 발화시킬 플래그가 없다. 확대 시 이 전제를 검토하지 않은 것이 원인이다.
//
// 그래서 스트립 범위를 **위험 신호가 아닌 필드로 한정**한다(아래 허용목록).
//  - 활동량(steps/activeEnergyKcal/flightsClimbed) = 창(window) 정의 불일치로 상한을 넘는 것이라
//    버려도 안전하다. 이 필드가 없다고 사람이 위험해지지 않는다.
//  - 생체값 = 범위 이탈 자체가 응급 신호일 수 있다. 조용히 지우면 안 된다.
//    이벤트 샘플(manualSos/fallDetected)에서는 종전대로 스트립한다 — 플래그가 경보를 살리므로.
//
// 스트립은 반드시 관측 가능해야 한다 — onStrip 으로 호출부가 로그를 남기지 않으면
// 이 파서 자체가 새로운 침묵이 된다.
//
// 스트립 판별은 하드코딩 bounds 가 아니라 ZodError issues(too_small/too_big) + 스키마 shape
// (optional 숫자 필드)가 진실 소스 — workerId/ts 같은 필수 필드·형식 오류는 스트립 불가라 throw.

// 어떤 샘플에서도 스트립을 허용하는 필드 = **범위를 벗어나도 그 자체가 위험 신호가 아닌 것**.
// 판정 기준 — "이 값이 없다고 사람이 위험해지는가". 아니면 스트립, 맞으면 거부(샘플 전체를 살리지 않는다).
//  - 활동량 3종: 수집 창 정의 불일치(하루 누적 vs 60초 합)로 상한을 넘는다. 없어도 안전.
//  - ML 확률 2종: 진단용 텔레메트리. 확률 하나가 망가졌다고 낙상 후보 전체를 버리면 손해가 더 크다.
// 심박·SpO₂·체온·가속도 등 생체값은 **의도적으로 제외** — 범위 이탈 자체가 응급일 수 있다.
// 새 필드를 추가할 때 여기 넣지 않으면 기본값은 "거부"다(안전한 실패 방향).
const NON_SAFETY_STRIPPABLE_KEYS = new Set([
  "steps",
  "activeEnergyKcal",
  "flightsClimbed",
  "mlWorkVetoProb",
  "mlImpactProb",
]);

export function parseResilientVitalSample(
  input: unknown,
  onStrip?: (strippedKeys: string[], sample: VitalSample) => void,
): VitalSample {
  const first = VitalSampleSchema.safeParse(input);
  if (first.success) return first.data;

  const raw =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : null;
  if (raw === null) throw first.error;

  // 이벤트 샘플은 플래그가 경보를 살리므로 생체값까지 스트립해 샘플을 구제한다.
  // 비-이벤트 샘플은 활동량만 스트립한다 — 생체값을 지우면 위험이 정상으로 보인다.
  const isEventSample = raw.manualSos === true || raw.fallDetected === true;

  const shape: Record<string, z.ZodTypeAny> = VitalSampleSchema.shape;
  const candidate: Record<string, unknown> = { ...raw };
  const strippedKeys: string[] = [];
  let lastError = first.error;
  // 재-safeParse 반복(최대 4회) — 이슈는 보통 한 pass 에 전부 보고되므로 1~2회면 수렴한다.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let stripped = false;
    for (const issue of lastError.issues) {
      if (issue.code !== "too_small" && issue.code !== "too_big") continue;
      if (issue.path.length !== 1) continue;
      const key = issue.path[0];
      if (typeof key !== "string") continue;
      // 비-이벤트 샘플에서 생체값은 스트립하지 않는다 → 샘플 전체가 거부되어 ts 가 늙고
      // 신선도 게이트가 "연결끊김"으로 드러낸다(조용한 정상 표시보다 안전한 실패).
      if (!isEventSample && !NON_SAFETY_STRIPPABLE_KEYS.has(key)) continue;
      const field = shape[key];
      if (!(field instanceof z.ZodOptional)) continue;
      if (!(field.unwrap() instanceof z.ZodNumber)) continue;
      if (candidate[key] === undefined) continue;
      delete candidate[key];
      strippedKeys.push(key);
      stripped = true;
    }
    if (!stripped) throw lastError;
    const retry = VitalSampleSchema.safeParse(candidate);
    if (retry.success) {
      onStrip?.(strippedKeys, retry.data);
      return retry.data;
    }
    lastError = retry.error;
  }
  throw lastError;
}
