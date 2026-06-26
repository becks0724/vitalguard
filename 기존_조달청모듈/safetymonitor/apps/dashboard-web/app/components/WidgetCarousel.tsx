// 좌우 화살표 가로 캐러셀 — 고정 높이 박스에서 ‹ › 버튼으로 페이지 전환(제목 + N/M 카운터).
// 같은 자리에 여러 위젯(현장정보·국내재해사례 등)을 두고 수동 전환을 쉽게(자동순환은 호버 시 정지).
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// headerAccessory — 컨트롤 바의 좌측 화살표 우측에 표시할 부가 요소(예: 데이터 출처 배지). 현재 페이지 것만 노출.
export type CarouselPage = { title: string; content: ReactNode; headerAccessory?: ReactNode };

export function WidgetCarousel({
  pages,
  intervalMs = 9000,
  className,
  autoRotate = true,
}: {
  pages: CarouselPage[];
  intervalMs?: number;
  className?: string;
  // false 면 자동 회전 없이 ‹ › 수동 전환만.
  autoRotate?: boolean;
}) {
  const [idx, setIdx] = useState(0);
  const hovered = useRef(false);
  const n = pages.length;

  // 자동 순환 — 호버 중 정지(수동 우선). autoRotate=false 면 비활성(수동 전환만).
  useEffect(() => {
    if (n <= 1 || !autoRotate) return;
    const t = window.setInterval(() => {
      if (!hovered.current) setIdx((i) => (i + 1) % n);
    }, intervalMs);
    return () => window.clearInterval(t);
  }, [n, intervalMs, autoRotate]);

  const go = (dir: 1 | -1) => setIdx((i) => (i + dir + n) % n);
  const cur = pages[idx];
  if (!cur) return null;

  const arrowClass =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-surface-strong text-sm leading-none text-ink active:scale-90 disabled:opacity-30 dark:bg-surface-dark dark:text-on-dark";

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border border-hairline-strong bg-surface-card dark:border-white/10 dark:bg-surface-dark-elevated ${className ?? ""}`}
      onMouseEnter={() => {
        hovered.current = true;
      }}
      onMouseLeave={() => {
        hovered.current = false;
      }}
    >
      {/* 컨트롤 바 — ‹ 제목 N/M › */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline px-2 py-1 dark:border-white/10">
        <button type="button" onClick={() => go(-1)} aria-label="이전 위젯" disabled={n <= 1} className={arrowClass}>
          ‹
        </button>
        {cur.headerAccessory && <div className="shrink-0">{cur.headerAccessory}</div>}
        <span className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-ink dark:text-on-dark">
          {cur.title}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted dark:text-on-dark-soft">
            {idx + 1}/{n}
          </span>
          <button type="button" onClick={() => go(1)} aria-label="다음 위젯" disabled={n <= 1} className={arrowClass}>
            ›
          </button>
        </div>
      </div>
      {/* 본문 — 좌우 슬라이드 전환 */}
      <div className="relative flex-1 overflow-hidden">
        {pages.map((p, i) => (
          <div
            key={i}
            className={`absolute inset-0 transition-transform duration-300 ease-out ${
              i === idx ? "" : "pointer-events-none"
            }`}
            style={{ transform: `translateX(${(i - idx) * 100}%)` }}
            aria-hidden={i !== idx}
          >
            {p.content}
          </div>
        ))}
      </div>
    </div>
  );
}
