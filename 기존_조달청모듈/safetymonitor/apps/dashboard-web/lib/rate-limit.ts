// 요청 빈도 제한 — 토큰버킷(인스턴스 로컬). 무인증 수집·로그인 무제한 시도를 막는다(감사 BE-RATE-01).
//
// 한계를 명시한다. 상태가 인스턴스 로컬이므로 Cloud Run 이 스케일아웃(maxScale=4)하면
// 실효 한도는 최대 4배가 된다. 정확한 전역 제한이 필요해지면 Redis 등 공유 저장소가 필요하다.
// 그럼에도 "무제한"과 "인스턴스당 N" 사이의 차이가 크므로 1차 방어로 둔다.

type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();
// 메모리 무한 증식 방지 — 키가 이 수를 넘으면 가장 오래된 것부터 정리한다.
const MAX_KEYS = 10_000;

/**
 * 토큰버킷 소비. 허용되면 true.
 * @param key   버킷 식별자(라우트명 + 클라이언트 IP 조합을 권장)
 * @param limit 윈도당 허용 요청 수
 * @param windowMs 윈도 길이(ms)
 * @param nowMs 현재 시각(ms). 테스트에서 시계 역행을 재현하기 위한 주입점 — 운영은 기본값 사용.
 */
export function consumeToken(
  key: string,
  limit: number,
  windowMs: number,
  nowMs: number = Date.now(),
): boolean {
  // 인자 방어 — 값이 env·설정에서 오면 오타 하나로 리미터가 조용히 꺼진다(감사 DLT-LIB-007).
  // windowMs 가 0/NaN 이면 회복량이 Infinity/NaN 이 되어 전 요청이 통과했다. fail-closed 로 막는다.
  if (!Number.isFinite(limit) || limit < 1) return false;
  if (!Number.isFinite(windowMs) || windowMs <= 0) return false;

  const now = nowMs;
  const bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_KEYS) {
      const oldest = [...buckets.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      for (const [k] of oldest.slice(0, Math.floor(MAX_KEYS / 10))) buckets.delete(k);
    }
    buckets.set(key, { tokens: limit - 1, updatedAt: now });
    return true;
  }
  // 경과 시간에 비례해 토큰을 회복시킨다(윈도 전체가 지나면 가득 참).
  // 경과를 0 으로 하한한다 — 시계가 뒤로 가면(NTP 보정·수동 변경) 회복량이 음수가 되어
  // 토큰이 거꾸로 깎이고, 역행 폭만큼의 시간 동안 정상 트래픽이 전면 429 로 막힌다.
  // 워치·폰은 429 를 재전송하지 않으므로 그대로 무음 유실이 된다(감사 DLT-LIB-006).
  const elapsed = Math.max(0, now - bucket.updatedAt);
  const refill = (elapsed / windowMs) * limit;
  const tokens = Math.min(limit, bucket.tokens + refill);
  bucket.updatedAt = now;
  if (tokens < 1) {
    bucket.tokens = tokens;
    return false;
  }
  bucket.tokens = tokens - 1;
  return true;
}

// 테스트·운영 점검용 — 버킷 전체 초기화.
export function resetRateLimits(): void {
  buckets.clear();
}
