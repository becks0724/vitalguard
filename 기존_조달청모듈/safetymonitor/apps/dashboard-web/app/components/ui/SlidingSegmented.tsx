// 슬라이딩 세그먼트 컨트롤 — 활성 표시를 칸마다 켜고 끄지 않고 **하나만** 두고 옮긴다.
// 켜고 끄면 전환이 '점멸'로 보인다. GlassTabBar(탭바)와 같은 결이되, 이쪽은 트랙 모양이
// 자리마다 달라(간격 있는 그리드 · 줄바꿈 · 불균등 폭) 좌표를 **실측**해서 옮긴다.
//
// ★ 폭이 같다는 보장이 없으므로 x 를 %로 밀지 않는다 — 간격(gap)이 있으면 이동거리가
//   칸 폭과 달라져 100% 로는 어긋난다. top/height 도 함께 옮기므로 flex-wrap 으로 줄이
//   바뀌어도 따라간다.
// ⚠ 색·질감은 호출부가 정한다(자리마다 톤이 다르다). 이 컴포넌트는 기하만 책임진다.
"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

type Box = { left: number; top: number; width: number; height: number };

export type SegmentItem<T extends string> = {
  value: T;
  label: React.ReactNode;
  title?: string;
};

export function SlidingSegmented<T extends string>({
  items,
  value,
  onChange,
  className,
  indicatorClassName,
  itemClassName,
  followHover = false,
}: {
  items: readonly SegmentItem<T>[];
  /** 현재 값. 어느 칸과도 안 맞으면(예: 사용자 지정 기간) 표시자를 숨긴다. */
  value: T | null | undefined;
  onChange: (v: T) => void;
  /** 트랙(컨테이너) 클래스. `relative` 는 이 컴포넌트가 붙인다. */
  className?: string;
  /** 움직이는 표시자 클래스(배경·테두리·그림자). */
  indicatorClassName?: string;
  /** 칸 클래스 — 활성 여부를 받아 글자색만 바꾸는 용도. 배경은 표시자가 그린다. */
  itemClassName: (active: boolean) => string;
  /** 마우스를 올린 칸으로 표시자를 미리 보낼지(탭 성격이면 true, 폼 선택이면 false). */
  followHover?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // null = 아직 못 쟀다 → 숨긴다. 0,0 으로 그리면 첫 프레임에 좌상단에서 날아온다.
  const [box, setBox] = useState<Box | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  // -1 = 활성 칸 없음(사용자 지정 기간 등) → 표시자를 숨긴다. 0 으로 접으면 첫 칸이 선택된 것처럼 보인다.
  const activeIdx = items.findIndex((it) => it.value === value);
  const target = followHover && hover !== null ? hover : activeIdx;
  const visible = target >= 0;

  const measure = useCallback(() => {
    if (target < 0) return; // 숨김 상태 — 마지막 좌표를 그대로 둔다(다시 켜질 때 그 자리에서 나타난다)
    const el = btnRefs.current[target];
    if (!el) return;
    // offsetLeft/Top 은 트랙(position:relative) 기준이라 스크롤·리사이즈에 어긋나지 않는다.
    setBox({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
  }, [target]);

  useEffect(() => {
    measure();
  }, [measure, items.length]);

  // 글꼴 로드·컨테이너 폭 변화(줄바꿈 포함)로 칸 기하가 바뀌면 다시 잰다.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(track);
    for (const b of btnRefs.current) if (b) ro.observe(b);
    return () => ro.disconnect();
  }, [measure, items.length]);

  return (
    <div
      ref={trackRef}
      className={`relative ${className ?? ""}`}
      onMouseLeave={followHover ? () => setHover(null) : undefined}
    >
      <motion.span
        aria-hidden="true"
        className={`pointer-events-none absolute z-0 ${indicatorClassName ?? ""}`}
        initial={false}
        animate={{
          left: box?.left ?? 0,
          top: box?.top ?? 0,
          width: box?.width ?? 0,
          height: box?.height ?? 0,
          opacity: box && visible ? 1 : 0,
        }}
        transition={{ type: "spring", stiffness: 380, damping: 34, mass: 0.7 }}
      />
      {items.map((it, i) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            onClick={() => onChange(it.value)}
            onMouseEnter={followHover ? () => setHover(i) : undefined}
            onFocus={followHover ? () => setHover(i) : undefined}
            onBlur={followHover ? () => setHover(null) : undefined}
            aria-pressed={active}
            title={it.title}
            className={`relative z-10 ${itemClassName(active)}`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
