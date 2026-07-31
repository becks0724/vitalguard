"use client";
// 산업 안전뉴스 패널 — 산업현장·산업재해·산업안전 법규 관련 실시간 기사(네이버 뉴스검색).
// 안전뉴스 탭의 전체 폭 섬네일 카드 가로 나열(수동 좌우 스크롤).
// ★ 섬네일은 서버가 og:image 로 추출해 내려준다(app/lib/og-image.ts) — 네이버 뉴스검색 API
//   자체는 이미지를 주지 않는다. 추출 실패·핫링크 차단분은 매체 이니셜 블록으로 폴백한다.
// /api/news 프록시에서 조회(서버 15분 캐시) + 10분 폴링. 키 미설정·무결과는 graceful 안내.

import { useEffect, useState } from "react";

import { formatRelativeTime, type NewsResult } from "../lib/news";
import { getSessionToken } from "./LoginGate";

// 매체 도메인 → 안정적인 색상(해시). 섬네일이 없어도 카드가 비어 보이지 않게 한다.
const FALLBACK_TONES = [
  "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
];
function toneOf(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return FALLBACK_TONES[h % FALLBACK_TONES.length] as string;
}

export function NewsPanel() {
  const [data, setData] = useState<NewsResult | null>(null);
  const [error, setError] = useState(false);
  // og:image 가 있어도 매체가 핫링크를 막으면 로드에 실패한다 → 그 카드만 폴백으로 전환.
  const [broken, setBroken] = useState<Record<string, true>>({});

  useEffect(() => {
    let alive = true;
    const load = () =>
      // 토큰 동봉 — 서버가 인증된 호출만 네이버 검색 쿼터를 쓰게 한다(감사 BE-AUTHZ-08).
      fetch("/api/news", {
        headers: (() => {
          const t = getSessionToken();
          return t ? { Authorization: `Bearer ${t}` } : undefined;
        })(),
      })
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

  if (notice) {
    return (
      <p className="px-3 py-10 text-center text-xs text-muted dark:text-on-dark-soft">{notice}</p>
    );
  }

  return (
    <div className="no-scrollbar overflow-x-auto overflow-y-hidden px-3 pb-3">
      <div className="flex w-max gap-2.5">
        {items.map((it) => {
          const showImg = it.image && !broken[it.link];
          return (
            <a
              key={it.link}
              href={it.link}
              target="_blank"
              rel="noopener noreferrer"
              title={it.title}
              className="group flex w-[230px] shrink-0 flex-col overflow-hidden rounded-lg border border-hairline bg-canvas transition hover:ring-1 hover:ring-primary-ring dark:border-white/10 dark:bg-surface-dark"
            >
              <div className="h-[124px] w-full overflow-hidden bg-surface-card dark:bg-surface-dark-elevated">
                {showImg ? (
                  // 외부 CDN 이미지 — 도메인이 매체마다 달라 next/image(remotePatterns) 대신 img.
                  // referrerPolicy=no-referrer 로 Referer 검사식 핫링크 차단을 최대한 피한다.
                  <img
                    src={it.image}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() => setBroken((prev) => ({ ...prev, [it.link]: true }))}
                    className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                  />
                ) : (
                  <div
                    className={`flex h-full w-full items-center justify-center text-sm font-bold ${toneOf(it.source || it.title)}`}
                  >
                    {(it.source || "NEWS").slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 px-2.5 py-2">
                <p className="line-clamp-2 text-xs font-semibold leading-snug text-ink group-hover:text-primary dark:text-on-dark">
                  {it.title}
                </p>
                <div className="mt-auto flex items-center gap-1.5 text-[10px] text-muted dark:text-on-dark-soft">
                  {it.source && <span className="truncate">{it.source}</span>}
                  {it.pubDateMs !== undefined && (
                    <span className="shrink-0 tabular-nums">
                      {formatRelativeTime(it.pubDateMs, nowMs)}
                    </span>
                  )}
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
