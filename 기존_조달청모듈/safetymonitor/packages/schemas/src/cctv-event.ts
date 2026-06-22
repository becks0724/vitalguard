// 영상(CCTV YOLOv8-pose) 낙상 이벤트 — 폴링 어댑터/푸시가 보내는 존 단위 관측.
// 워치(VitalSample)와 별개 경로. worker_id 없음(카메라/존 단위)이 핵심 — fusion 의 영상 입력.
import { z } from "zod";

// 영상 자세 상태 — CctvQuadView FallDetectionStrip 의 byStatus.status 도메인과 동일.
export const CctvFallStatusSchema = z.enum(["standing", "unstable", "lying", "fallen"]);
export type CctvFallStatus = z.infer<typeof CctvFallStatusSchema>;

export const CctvFallEventSchema = z.object({
  cameraId: z.string().min(1),
  zone: z.string().min(1).max(60).optional(), // "지하 기계실" 등 라벨(있으면)
  ts: z.string().datetime(), // 프레임/폴 관측 시각(ISO8601 UTC)
  status: CctvFallStatusSchema,
  fallenCount: z.number().int().min(0).default(0), // byStatus 의 fallen count
  total: z.number().int().min(0).optional(),
  confidence: z.number().min(0).max(1).optional(), // 모델 신뢰도(통계에 있으면)
  source: z.enum(["poller", "push"]).default("poller"),
});
export type CctvFallEvent = z.infer<typeof CctvFallEventSchema>;
