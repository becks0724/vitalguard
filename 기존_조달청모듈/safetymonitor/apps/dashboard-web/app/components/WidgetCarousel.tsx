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

  const cur = pages[idx];
  if (!cur) return null;

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
      {/* 탭 바 — 리퀴드글래스: 프로스티드 유리 필 컨테이너 + 활성 탭 raised 유리 필 + 튜브라이트 발광(무의존성 CSS) */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-hairline px-1.5 py-1 dark:border-white/10">
        {cur.headerAccessory && <div className="shrink-0">{cur.headerAccessory}</div>}
        {/* 프로스티드 유리 필 — 반투명 + backdrop-blur + 상단 스페큘러 하이라이트(inset shadow). 평면 배경 위라 은은. */}
        <div
          role="tablist"
          className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-pill border border-black/5 bg-white/50 px-1 py-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md dark:border-white/10 dark:bg-white/[0.06] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
        >
          {pages.map((p, i) => {
            const active = i === idx;
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={p.title}
                onClick={() => setIdx(i)}
                className={`relative shrink-0 rounded-pill px-2.5 py-1 text-xs font-semibold transition-colors ${
                  active
                    ? "text-primary"
                    : "text-muted hover:bg-white/40 hover:text-ink dark:text-on-dark-soft dark:hover:bg-white/10 dark:hover:text-on-dark"
                }`}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-pill border border-white/70 bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_1px_2px_rgba(2,6,23,0.08)] dark:border-white/20 dark:bg-white/15 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
                  >
                    {/* 튜브라이트 램프 — 하단 중앙 발광 바 + 블러 글로우(유리 위 스페큘러 악센트) */}
                    <span className="absolute bottom-0 left-1/2 h-[3px] w-5 -translate-x-1/2 rounded-full bg-primary" />
                    <span className="absolute bottom-0 left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-full bg-primary opacity-70 blur-[4px]" />
                  </span>
                )}
                <span className="relative">{p.title}</span>
              </button>
            );
          })}
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
