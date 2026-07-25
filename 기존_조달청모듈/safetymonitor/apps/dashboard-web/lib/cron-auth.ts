import { timingSafeEqual } from "node:crypto";

// Cloud Scheduler 크론 엔드포인트 게이트 판정 — 순수 함수. CRON_SECRET 미설정=503, 헤더 불일치=401.
export type CronAuthResult = "ok" | "notConfigured" | "unauthorized";

// 상수시간 비교 — admin-auth.ts 의 safeEqual 과 같은 규율(감사 DLT-FE-5).
// 길이가 다르면 timingSafeEqual 이 throw 하므로 먼저 거른다.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function cronAuth(headerKey: string | null, secret: string | undefined): CronAuthResult {
  if (!secret) return "notConfigured";
  if (!headerKey || !safeEqual(headerKey, secret)) return "unauthorized";
  return "ok";
}
