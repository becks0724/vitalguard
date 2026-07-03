// 리퀴드글래스(프로스티드) 탭 바 — 반투명 유리 필 컨테이너 + 활성 탭 raised 유리 필 + 튜브라이트 발광.
// WidgetCarousel(캐러셀)·AdminExportModal(관리자 메뉴) 공용. 무의존성(Tailwind white/black 알파).
"use client";

export function GlassTabBar({
  tabs,
  active,
  onSelect,
  className,
}: {
  tabs: string[];
  active: number;
  onSelect: (i: number) => void;
  // 컨테이너 추가 클래스(예: 캐러셀 헤더의 flex-1).
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`no-scrollbar flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-pill border border-black/5 bg-white/50 px-1 py-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md dark:border-white/10 dark:bg-white/[0.06] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${className ?? ""}`}
    >
      {tabs.map((t, i) => {
        const isActive = i === active;
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={t}
            onClick={() => onSelect(i)}
            className={`relative shrink-0 rounded-pill px-2.5 py-1 text-xs font-semibold transition-colors ${
              isActive
                ? "text-primary"
                : "text-muted hover:bg-white/40 hover:text-ink dark:text-on-dark-soft dark:hover:bg-white/10 dark:hover:text-on-dark"
            }`}
          >
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-pill border border-white/70 bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_1px_2px_rgba(2,6,23,0.08)] dark:border-white/20 dark:bg-white/15 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
              >
                {/* 튜브라이트 램프 — 하단 중앙 발광 바 + 블러 글로우(유리 위 스페큘러 악센트) */}
                <span className="absolute bottom-0 left-1/2 h-[3px] w-5 -translate-x-1/2 rounded-full bg-primary" />
                <span className="absolute bottom-0 left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-full bg-primary opacity-70 blur-[4px]" />
              </span>
            )}
            <span className="relative">{t}</span>
          </button>
        );
      })}
    </div>
  );
}
