// 작업자 (Worker) 도메인 스키마 — 작업자 1명의 식별·소속 정보
// ⚠️ 미연결 스캐폴딩 — 발표 후 백엔드(Cognito/멀티테넌트/IoT ingest) 트랙용. 현재 프로토타입에선
// 외부 소비처 없음(대시보드/분석기는 VitalSample 만 사용). 백엔드 구현 시 연결 예정.
import { z } from "zod";

export const WorkerSchema = z.object({
  workerId: z.string().min(1),
  orgId: z.string().min(1).default("demo-org"),
  name: z.string().min(1),
  role: z.enum(["worker", "supervisor"]).default("worker"),
  deviceId: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
});

export type Worker = z.infer<typeof WorkerSchema>;
