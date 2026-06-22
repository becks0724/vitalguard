// 상단 섹션 페이저 — ‹ 제목 N/M › 헤더로 전체 폭 페이지를 좌우 슬라이드 전환(작업자 모니터링 캐러셀과 동일한 조작감).
// WidgetCarousel 과 달리 고정 높이가 아니라 활성 페이지 높이에 맞춰 뷰포트 높이를 동기화하므로 전체 페이지 콘텐츠에 적합.
// 모든 페이지를 마운트 유지 → 페이지를 넘겨도 라이브 데이터·내부 캐러셀 위치·상태가 보존됨.
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type PagerPage = { title: string; content: ReactNode };

export function SectionPager({ pages }: { pages: PagerPage[] }) {
  const [idx, setIdx] = useState(0);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const n = pages.length;

  // 활성 페이지 높이에 뷰포트 높이를 맞춤 — 짧은 페이지의 빈 공간 방지 + 페이지 간 높이 전환 애니메이션.
  // 콘텐츠가 늘어나면(작업자 등록·날씨 로드 등) ResizeObserver 로 추적.
  useEffect(() => {
    const el = slideRefs.current[idx];
    if (!el) return;
    const update = () => setHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [idx, n]);

  const go = (dir: 1 | -1) => setIdx((i) => (i + dir + n) % n);
  const cur = pages[idx];
  if (!cur) return null;

  const arrowClass =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-surface-strong text-base leading-none text-ink active:scale-90 disabled:opacity-30 dark:bg-surface-dark dark:text-on-dark";

  return (
    <div className="flex flex-col gap-4">
      {/* 컨트롤 바 — ‹ 제목 N/M › (대시보드 바 스타일과 통일) */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-hairline bg-canvas px-4 py-2 dark:border-white/10 dark:bg-surface-dark">
        <button type="button" onClick={() => go(-1)} aria-label="이전 페이지" disabled={n <= 1} className={arrowClass}>
          ‹
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-ink dark:text-on-dark">
          {cur.title}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted dark:text-on-dark-soft">
            {idx + 1}/{n}
          </span>
          <button type="button" onClick={() => go(1)} aria-label="다음 페이지" disabled={n <= 1} className={arrowClass}>
            ›
          </button>
        </div>
      </div>
      {/* 뷰포트 — 활성 페이지 높이로 클립, 트랙을 translateX 로 슬라이드 */}
      <div className="overflow-hidden transition-[height] duration-300 ease-out" style={{ height }}>
        <div
          className="flex items-start transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${idx * 100}%)` }}
        >
          {pages.map((p, i) => (
            <div
              key={i}
              ref={(el) => {
                slideRefs.current[i] = el;
              }}
              className="w-full shrink-0 self-start"
              aria-hidden={i !== idx}
            >
              {p.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
