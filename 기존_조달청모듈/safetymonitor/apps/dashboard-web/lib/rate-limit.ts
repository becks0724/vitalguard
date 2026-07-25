// 요청 빈도 제한 — 토큰버킷(인스턴스 로컬). 무인증 수집·로그인 무제한 시도를 막는다(감사 BE-RATE-01).
//
// 한계를 명시한다. 상태가 인스턴스 로컬이므로 Cloud Run 이 스케일아웃(maxScale=4)하면
// 실효 한도는 최대 4배가 된다. 정확한 전역 제한이 필요해지면 Redis 등 공유 저장소가 필요하다.
// 그럼에도 "무제한"과 "인스턴스당 N" 사이의 차이가 크므로 1차 방어로 둔다.

type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();
// 메모리 무한 증식 방지 — 키가 이 수를 넘으면 가장 오래된 것부터 정리한다.
const MAX_KEYS = 10_000;

// 클라이언트 IP 추정. Cloud Run 은 X-Forwarded-For 뒤에 자신의 홉을 덧붙이므로,
// 클라이언트가 스스로 XFF 를 보내면 그 위조값이 **최좌측**에 온다. 최좌측을 그대로 키로 쓰면
// 헤더 한 줄로 제한을 우회할 수 있다(감사 BE-AUTHZ-07). 프록시가 덧붙인 뒤쪽 값을 신뢰한다.
export function clientIpForRateLimit(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (hops.length >= 2) return hops[hops.length - 2] ?? hops[hops.length - 1] ?? "unknown";
    if (hops.length === 1) return hops[0] ?? "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * 토큰버킷 소비. 허용되면 true.
 * @param key   버킷 식별자(라우트명 + 클라이언트 IP 조합을 권장)
 * @param limit 윈도당 허용 요청 수
 * @param windowMs 윈도 길이(ms)
 */
export function consumeToken(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
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
  const refill = ((now - bucket.updatedAt) / windowMs) * limit;
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
