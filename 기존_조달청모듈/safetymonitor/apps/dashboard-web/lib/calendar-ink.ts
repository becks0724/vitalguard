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
      // 같은 오리진 라우트가 스토리지에서 읽어 내려준다. 프리사인 URL 을 브라우저가 직접 읽으면
      // 응답에 Access-Control-Allow-Origin 이 없어 막힌다(2026-09-21 실측 — 서버는 200,
      // 브라우저 fetch 는 Failed to fetch / XHR status 0).
      const response = await fetcher(`/api/calendar/media/ink?id=${encodeURIComponent(annotationId)}`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("표시 파일을 가져오지 못했습니다.");
      return response.json() as Promise<unknown>;
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
