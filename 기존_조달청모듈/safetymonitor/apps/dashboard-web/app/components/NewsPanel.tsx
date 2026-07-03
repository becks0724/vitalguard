"use client";
// 산업 안전뉴스 패널 — 산업현장·산업재해·산업안전 법규 관련 실시간 기사(네이버 뉴스검색).
// /api/news 프록시에서 조회(서버 15분 캐시). 10분 폴링 + 수동 새로고침. 키 미설정·무결과는 graceful 안내.

import { useCallback, useEffect, useState } from "react";

import { formatRelativeTime, type NewsResult } from "../lib/news";

function useNews(nonce: number) {
  const [data, setData] = useState<NewsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    fetch("/api/news", { signal: ctrl.signal })
      .then((r) => r.json())
      .then((json: NewsResult) => {
        if (alive) setData(json);
      })
      .catch((e) => {
        if (e?.name !== "AbortError" && alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [nonce]);

  return { data, loading, error };
}

export function NewsPanel() {
  const [nonce, setNonce] = useState(0);
  const { data, loading, error } = useNews(nonce);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // 10분마다 조용히 재조회(서버 15분 캐시라 대부분 캐시 반환·저비용). 탭 숨김 시 스킵.
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) setNonce((n) => n + 1);
    }, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const items = data?.items ?? [];
  const nowMs = Date.now();

  return (
    <div className="flex h-full flex-col p-2">
      <div className="flex items-center justify-between border-b border-hairline pb-1.5 dark:border-white/10">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-ink dark:text-on-dark">
            산업 안전뉴스
          </span>
          <span className="rounded-pill bg-surface-strong px-2 py-0.5 text-[11px] font-medium text-body dark:bg-white/10 dark:text-on-dark-soft">
            산업재해·안전법규
          </span>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="grid h-6 w-6 place-items-center rounded-md text-muted transition hover:bg-surface-strong disabled:opacity-40 dark:hover:bg-white/10"
          aria-label="뉴스 새로고침"
          title="새로고침"
        >
          <svg
            className={loading ? "animate-spin" : ""}
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      </div>

      <div className="mt-1.5 flex-1 overflow-y-auto pr-0.5">
        {data && !data.configured ? (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-muted dark:text-on-dark-soft">
            네이버 검색 API 키(NAVER_SEARCH_CLIENT_ID/SECRET) 미설정 — 발급 후 실시간 뉴스가 표시됩니다.
          </div>
        ) : data?.authError ? (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-semantic-down">
            네이버 인증 실패 — 검색 API Client ID/Secret 을 확인하세요.
          </div>
        ) : loading && !data ? (
          <div className="grid h-full place-items-center text-xs text-muted dark:text-on-dark-soft">
            불러오는 중…
          </div>
        ) : error ? (
          <div className="grid h-full place-items-center text-xs text-semantic-down">
            뉴스를 불러오지 못했습니다.
          </div>
        ) : items.length === 0 ? (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-muted dark:text-on-dark-soft">
            표시할 뉴스가 없습니다.
          </div>
        ) : (
          <ul className="flex flex-col">
            {items.map((it, i) => (
              <li
                key={`${it.link}-${i}`}
                className="border-b border-hairline py-1.5 last:border-0 dark:border-white/10"
              >
                <a
                  href={it.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block rounded-md px-1 py-0.5 transition hover:bg-surface-strong dark:hover:bg-white/5"
                >
                  <div className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink group-hover:text-primary dark:text-on-dark">
                    {it.title}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted dark:text-on-dark-soft">
                    {it.source && (
                      <span className="truncate rounded bg-surface-card px-1.5 py-0.5 font-medium text-body dark:bg-white/10 dark:text-on-dark-soft">
                        {it.source}
                      </span>
                    )}
                    {it.pubDateMs !== undefined && (
                      <span className="shrink-0 tabular-nums">
                        {formatRelativeTime(it.pubDateMs, nowMs)}
                      </span>
                    )}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
