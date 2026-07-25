// 생체 시계열 (VitalStream) — Watch → 폰 → IoT → DDB 단일 샘플
import { z } from "zod";

export const VitalSampleSchema = z.object({
  workerId: z.string().min(1),
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
// 2026-07-25 — 이벤트 플래그(manualSos/fallDetected) 샘플 한정에서 **전 샘플**로 확대.
// 사유: 워치가 활동량(steps/activeEnergyKcal)을 하루 누적으로 보내 오후에 스키마 상한을 넘기면,
// 비-이벤트 샘플이 strict 로 거부되면서 심박·SpO₂·체온까지 함께 폐기됐다(감사 BND-LOSS-01).
// 가용성(모니터링 지속) > 엄격성으로 판단을 뒤집는다. 대신 스트립은 반드시 관측 가능해야 한다 —
// onStrip 으로 호출부가 로그를 남기지 않으면 이 파서 자체가 새로운 침묵이 된다.
//
// 스트립 판별은 하드코딩 bounds 가 아니라 ZodError issues(too_small/too_big) + 스키마 shape
// (optional 숫자 필드)가 진실 소스 — workerId/ts 같은 필수 필드·형식 오류는 스트립 불가라 throw.
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
