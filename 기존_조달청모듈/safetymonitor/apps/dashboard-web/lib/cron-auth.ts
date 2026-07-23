// Cloud Scheduler 크론 엔드포인트 게이트 판정 — 순수 함수. CRON_SECRET 미설정=503, 헤더 불일치=401.
export type CronAuthResult = "ok" | "notConfigured" | "unauthorized";

export function cronAuth(headerKey: string | null, secret: string | undefined): CronAuthResult {
  if (!secret) return "notConfigured";
  if (!headerKey || headerKey !== secret) return "unauthorized";
  return "ok";
}
