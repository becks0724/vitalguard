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
    .enum(["pending", "dismissed", "manual_sos", "auto_escalated"])
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
});

export type VitalSample = z.infer<typeof VitalSampleSchema>;
