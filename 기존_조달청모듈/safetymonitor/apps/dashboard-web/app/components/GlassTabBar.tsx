// 리퀴드글래스(프로스티드) 탭 바 — 반투명 유리 필 컨테이너 + 슬라이딩 유리 커서 + 튜브라이트 발광.
// WidgetCarousel(캐러셀)·SectionPager(상단 페이저)·AdminExportModal(관리자 메뉴) 공용.
//
// ★ 유리 필은 활성 버튼 안이 아니라 **컨테이너에 하나만** 두고 좌표를 옮긴다(슬라이딩 커서).
//   버튼마다 그리면 탭이 바뀔 때 한쪽이 사라지고 다른 쪽이 나타나 '점멸'로 보인다.
//   호버하면 커서가 그 탭으로 미리 따라가고, 마우스가 나가면 활성 탭으로 되돌아온다.
//
// 애니메이션은 framer-motion(`motion.span` + spring). 색·질감은 기존 리퀴드글래스를 그대로 둔다 —
// 원본 레퍼런스의 `border-2 border-black` + `mix-blend-difference` 는 이 대시보드 톤과 맞지 않는다.
// ⚠ `transform` 이 아니라 left/width 를 보간한다 — 탭마다 글자 폭이 달라 scaleX 로는 글자가 늘어나 보인다.
"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

type Rect = { left: number; width: number };

export function GlassTabBar({
  tabs,
  active,
  onSelect,
  className,
  badges,
}: {
  tabs: string[];
  active: number;
  onSelect: (i: number) => void;
  // 탭별 미확인 개수(선택). 0·undefined 면 안 그린다 — 0 을 그리면 "0건이 있다"로 읽힌다.
  // 길이가 tabs 와 달라도 안전하다(없는 인덱스는 undefined).
  badges?: (number | undefined)[];
  // 컨테이너 추가 클래스(예: 캐러셀 헤더의 flex-1).
  className?: string;
}) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  // null = 아직 못 쟀다 → 커서를 숨긴다. 0,0 으로 그리면 첫 프레임에 왼쪽 끝에서 날아온다.
  const [rect, setRect] = useState<Rect | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  // 커서가 가리킬 탭 — 호버 중이면 그쪽, 아니면 활성 탭.
  const target = hover ?? active;

  const measure = useCallback(() => {
    const el = btnRefs.current[target];
    if (!el) return;
    // offsetLeft 는 컨테이너(position:relative) 기준이라 가로 스크롤에도 어긋나지 않는다
    // — 커서가 같은 스크롤 박스 안에 있어 콘텐츠와 함께 움직인다(스크롤 리스너 불필요 · L-51).
    setRect({ left: el.offsetLeft, width: el.offsetWidth });
  }, [target]);

  useEffect(() => {
    measure();
  }, [measure, tabs.length]);

  // 글꼴 로드·배지 증감·컨테이너 폭 변화로 탭 폭이 바뀌면 다시 잰다.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(list);
    for (const b of btnRefs.current) if (b) ro.observe(b);
    return () => ro.disconnect();
  }, [measure, tabs.length]);

  return (
    <div
      ref={listRef}
      role="tablist"
      onMouseLeave={() => setHover(null)}
      className={`no-scrollbar relative flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-pill border border-black/5 bg-white/50 px-1 py-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md dark:border-white/10 dark:bg-white/[0.06] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${className ?? ""}`}
    >
      {/* 슬라이딩 유리 커서 — 컨테이너에 단 하나. 글자 아래(z-0)에 깔린다.
          spring 은 낮은 stiffness + 높은 damping 으로 오버슈트 없이 붙게 한다(탭은 정보 이동이라
          튕기면 산만하다). height 는 컨테이너 높이에서 상하 패딩(py-0.5 = 2px씩)을 뺀 값. */}
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 z-0 rounded-pill border border-white/70 bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_1px_2px_rgba(2,6,23,0.08)] dark:border-white/20 dark:bg-white/15 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
        style={{ height: "calc(100% - 4px)", y: "-50%" }}
        initial={false}
        animate={{ left: rect?.left ?? 0, width: rect?.width ?? 0, opacity: rect ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.7 }}
      >
        {/* 튜브라이트 램프 — 하단 중앙 발광 바 + 블러 글로우(유리 위 스페큘러 악센트) */}
        <span className="absolute bottom-0 left-1/2 h-[3px] w-5 -translate-x-1/2 rounded-full bg-primary" />
        <span className="absolute bottom-0 left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-full bg-primary opacity-70 blur-[4px]" />
      </motion.span>

      {tabs.map((t, i) => {
        const isActive = i === active;
        return (
          <button
            key={i}
            type="button"
            role="tab"
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            aria-selected={isActive}
            aria-label={badges?.[i] ? `${t} — 미확인 ${badges[i]}건` : t}
            onClick={() => onSelect(i)}
            onMouseEnter={() => setHover(i)}
            // 키보드 이동에도 커서가 따라오게 — 마우스가 없는 사용자에게도 같은 신호를 준다.
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            className={`relative z-10 shrink-0 rounded-pill px-2.5 py-1 text-xs font-semibold transition-colors ${
              isActive ? "text-primary" : "text-muted hover:text-ink dark:text-on-dark-soft dark:hover:text-on-dark"
            }`}
          >
            <span className="relative">{t}</span>
            {/* 미확인 배지 — 헤더 아이콘을 걷어내며 여기로 옮겼다(2026-08-20).
                아이콘만 지우고 배지를 안 옮기면 미확인 개수가 화면 어디에도 안 남는다. */}
            {/* ⚠ 높이 없이 leading 으로 원을 만들면 숫자가 베이스라인을 타고 위로 뜬다(2026-08-26 실측)
                — 고정 높이 + 그리드 중앙 배치 + leading-none 이 이 코드베이스의 배지 관례다(ExpandableTabs).
                단 inline-grid 여야 한다 — grid 는 블록 레벨이라 배지가 라벨 아래 줄로 떨어진다. */}
            {!!badges?.[i] && (
              <span className="relative ml-1 inline-grid h-[1.05rem] min-w-[1.05rem] place-items-center rounded-full bg-semantic-down px-1 text-[9px] font-bold leading-none tabular-nums text-white">
                {badges[i]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
