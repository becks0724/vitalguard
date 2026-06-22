// 대상 미특정 위험 이벤트(ZoneHazardEvent) — 영상만으로 감지된 "구역에 누군가 쓰러짐".
// 기존 HazardEvent 는 workerId 가 필수(z.string().min(1))라 worker 를 특정 못 하는 영상 단독
// 낙상을 표현할 수 없다. 그 자리를 메우는 형제 타입(workerId 없음, cameraId/zone 보유).
// 임의 worker 귀속 금지 — 같은 zone 타인 오귀속 방지(fusion-design §4.3).
import { z } from "zod";
import { SeveritySchema } from "./hazard-event.js";

export const ZoneHazardEventSchema = z.object({
  eventId: z.string().min(1),
  cameraId: z.string().min(1),
  zone: z.string().optional(),
  type: z.literal("fall"),
  severity: SeveritySchema, // 기존 Severity(caution|warning|danger) 재사용
  ts: z.string().datetime(),
  // detail.status 가 required 이므로 .default({}) 를 쓰지 않는다 — 쓰면 status 누락 객체가
  // 통과해 런타임에서 깨진다(기존 HazardEvent.detail 은 내부가 전부 optional이라 default 가능).
  detail: z.object({
    status: z.enum(["lying", "fallen"]),
    fallenCount: z.number().int().optional(),
    message: z.string().optional(),
  }),
});
export type ZoneHazardEvent = z.infer<typeof ZoneHazardEventSchema>;
