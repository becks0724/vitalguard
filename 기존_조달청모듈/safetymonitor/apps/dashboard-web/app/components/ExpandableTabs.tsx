// 헤더 액션 버튼용 확장 탭 바 — 아이콘만 보이다가 호버/포커스 시 라벨이 펼쳐지는 알약 그룹.
// 레퍼런스(ExpandableTabs)의 룩을 신규 의존성 없이 CSS 트랜지션으로 구현.
// 헤더는 '액션 버튼'(클릭=모달/토글/로그아웃)이라, 레퍼런스의 클릭-선택 대신 호버-확장 채택
// (클릭-선택은 클릭 시 모달이 열려 선택 상태가 유지되지 않아 확장이 사라지는 충돌이 있음).
// 활성(확장) 색/배경은 인라인 스타일(CSS 변수)로 — button preflight(color:inherit) 간섭 우회.
"use client";

import { useState, type ReactNode } from "react";

export type ExpandableTabItem = {
  title: string; // 펼쳐질 때 보이는 라벨
  icon: ReactNode; // 16px 라인 SVG (currentColor)
  onSelect?: () => void; // 클릭 시 실행할 액션
  tooltip?: string; // title 속성(없으면 title 사용)
  dim?: boolean; // 비활성 톤(예: 사이렌 꺼짐)
  ariaPressed?: boolean; // 토글 버튼 상태
};

export function ExpandableTabs({
  tabs,
  className,
}: {
  tabs: ExpandableTabItem[];
  className?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-2xl border border-hairline bg-canvas p-1 shadow-sm dark:border-white/10 dark:bg-surface-dark-elevated ${className ?? ""}`}
    >
      {tabs.map((tab, i) => {
        const isOpen = open === i;
        return (
          <button
            key={tab.title}
            type="button"
            title={tab.tooltip ?? tab.title}
            aria-pressed={tab.ariaPressed}
            onMouseEnter={() => setOpen(i)}
            onMouseLeave={() => setOpen(null)}
            onFocus={() => setOpen(i)}
            onBlur={() => setOpen(null)}
            onClick={() => tab.onSelect?.()}
            className={[
              "relative flex items-center rounded-xl py-1.5 text-body transition-all duration-300 ease-out dark:text-on-dark-soft",
              isOpen ? "gap-2 px-3" : "gap-0 px-2",
              tab.dim ? "opacity-50" : "",
            ].join(" ")}
            style={
              isOpen
                ? { backgroundColor: "rgba(0,82,255,0.12)", color: "var(--color-primary)" }
                : undefined
            }
          >
            <span className="grid h-4 w-4 shrink-0 place-items-center">
              {tab.icon}
            </span>
            {/* 라벨 — 인라인 스타일로 폭/투명도 전환(JIT 타이밍·preflight 간섭 회피). transition-all 이 부드럽게 애니메이션. */}
            <span
              className="overflow-hidden whitespace-nowrap text-sm font-medium transition-all duration-300 ease-out"
              style={{ maxWidth: isOpen ? 120 : 0, opacity: isOpen ? 1 : 0 }}
            >
              {tab.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}
