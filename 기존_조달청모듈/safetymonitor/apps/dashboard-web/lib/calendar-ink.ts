/** 최신 annotation id별 JSON/진행 중 요청 캐시. 재열기에도 재사용하되 세션이 바뀌면 비운다. */
export function createCalendarInkLoader(fetcher: typeof fetch = fetch) {
  let cacheToken: string | null | undefined;
  const cache = new Map<string, Promise<unknown>>();
  return (annotationId: string, token: string | null): Promise<unknown> => {
    if (cacheToken !== token) {
      cache.clear();
      cacheToken = token;
    }
    const cached = cache.get(annotationId);
    if (cached) return cached;
    const request = (async () => {
      const response = await fetcher(`/api/calendar/media/download-url?id=${encodeURIComponent(annotationId)}`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("표시 파일 주소를 가져오지 못했습니다.");
      const link = await response.json() as { ok?: boolean; url?: unknown };
      if (link?.ok !== true || typeof link.url !== "string" || !link.url) {
        throw new Error("표시 파일 주소가 없습니다.");
      }
      // 프리사인 URL 자체로 인증한다. 대시보드 Bearer/쿠키를 스토리지로 보내지 않는다.
      const file = await fetcher(link.url, {
        cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(15_000),
      });
      if (!file.ok) throw new Error("표시 파일을 가져오지 못했습니다.");
      return file.json() as Promise<unknown>;
    })();
    cache.set(annotationId, request);
    void request.catch(() => {
      // 실패는 다음 클릭에서 재시도한다. 옛 세션의 실패가 새 캐시를 지우면 안 된다.
      if (cache.get(annotationId) === request) cache.delete(annotationId);
    });
    return request;
  };
}

export const loadCalendarInk = createCalendarInkLoader();
