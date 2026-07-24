// 위험 이벤트 (HazardEvent) — 분석기가 생성하는 위험 알림 단위
import { z } from "zod";

export const HazardTypeSchema = z.enum([
  "fall",
  "collapse", // 무충격 붕괴(실신·서서히 주저앉음) — 충격 없이 장시간 무동작. 낙상 게이트 사각 보완.
  "hr_abnormal",
  "manual_sos",
  "spo2_low",
  "hyperthermia",
]);
export type HazardType = z.infer<typeof HazardTypeSchema>;

export const SeveritySchema = z.enum(["caution", "warning", "danger"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const HazardEventSchema = z.object({
  eventId: z.string().min(1),
  workerId: z.string().min(1),
  type: HazardTypeSchema,
  severity: SeveritySchema,
  ts: z.string().datetime(),
  detail: z
    .object({
      heartRate: z.number().optional(),
      accelMagnitudeG: z.number().optional(),
      motionStillSec: z.number().optional(),
      spo2: z.number().optional(),
      skinTempC: z.number().optional(),
      estimatedCoreTempC: z.number().optional(),
      ambientTempC: z.number().optional(),
      message: z.string().optional(),
    })
    .default({}),
});

export type HazardEvent = z.infer<typeof HazardEventSchema>;
