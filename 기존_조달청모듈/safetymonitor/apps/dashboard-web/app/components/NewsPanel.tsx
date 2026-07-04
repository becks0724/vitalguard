"use client";
// 산업 안전뉴스 패널 — 산업현장·산업재해·산업안전 법규 관련 실시간 기사(네이버 뉴스검색).
// 현장정보·국내 재해사례와 같은 좌측 캐러셀(h-140)에 들어가므로 국내 재해사례와 동형:
//   외곽 박스·제목은 WidgetCarousel 헤더가 제공 → 내부 헤더 없이 리스트만(세로 자동 스크롤·호버 정지).
// /api/news 프록시에서 조회(서버 15분 캐시) + 10분 폴링. 키 미설정·무결과는 graceful 안내.

import { useEffect, useState } from "react";

import { useMarqueeScroll } from "../hooks/useMarqueeScroll";
import { formatRelativeTime, type NewsResult } from "../lib/news";

export function NewsPanel() {
  const [data, setData] = useState<NewsResult | null>(null);
  const [error, setError] = useState(false);
  // 세로 자동 스크롤(느리게). 호버/터치 시 정지 → 수동 스크롤·클릭 우선(국내 재해사례와 동일).
  const scrollRef = useMarqueeScroll<HTMLDivElement>(0.3, "y");

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/news")
        .then((r) => {
          // HTTP 오류(500 등)의 에러 JSON 을 정상 데이터로 커밋하지 않도록 catch 로 던짐
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((j: NewsResult) => {
          if (alive) {
            setData(j);
            setError(false);
          }
        })
        .catch(() => {
          if (alive) setError(true);
        });
    load();
    // 10분마다 조용히 재조회(서버 15분 캐시라 대부분 캐시 반환·저비용). 탭 숨김 시 스킵.
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, 10 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const items = data?.items ?? [];
  const nowMs = Date.now();

  // 상태별 안내(키 미설정 / 인증 실패 / 오류 / 무결과 / 로딩)는 중앙 정렬 한 줄.
  // 오류는 첫 로드 실패(데이터 없음) 때만 — 이후 폴링 실패는 기존 목록 유지(깜빡임 방지).
  const notice =
    data && !data.configured
      ? "네이버 검색 API 키 미설정 — 발급 후 실시간 뉴스가 표시됩니다."
      : data?.authError
        ? "네이버 인증 실패 — 검색 API Client ID/Secret 확인."
        : !data && error
          ? "뉴스를 불러오지 못했습니다."
          : !data
            ? "불러오는 중…"
            : items.length === 0
              ? "표시할 뉴스가 없습니다."
              : null;

  return (
    <div className="flex h-full flex-col px-3 pb-3 pt-1.5">
      <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {notice ? (
          <p className="px-2 py-2 text-center text-xs text-muted dark:text-on-dark-soft">
            {notice}
          </p>
        ) : (
          // 2벌 복제 seamless 세로 스크롤(국내 재해사례와 동일). 복제본은 aria-hidden·클릭 비활성.
          [0, 1].map((copy) => (
            <div key={copy} className="flex flex-col" aria-hidden={copy === 1}>
              {items.map((it, i) => (
                <a
                  key={`${copy}-${it.link}-${i}`}
                  href={it.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  tabIndex={copy === 1 ? -1 : undefined}
                  title={it.title}
                  className="group mb-1 block rounded-lg bg-canvas px-2.5 py-1 transition hover:ring-1 hover:ring-primary/40 dark:bg-surface-dark"
                >
                  <div className="truncate text-xs font-semibold text-ink group-hover:text-primary dark:text-on-dark">
                    {it.title}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted dark:text-on-dark-soft">
                    {it.source && (
                      <span className="truncate rounded bg-surface-card px-1 py-0.5 font-medium text-body dark:bg-white/10 dark:text-on-dark-soft">
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
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
