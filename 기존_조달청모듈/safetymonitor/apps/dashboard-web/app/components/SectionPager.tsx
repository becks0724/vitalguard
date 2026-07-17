// 상단 섹션 페이저 — 현황 요약 캐러셀과 동일한 리퀴드글래스 탭 메뉴(GlassTabBar)로 전체 폭 페이지를 좌우 슬라이드 전환.
// WidgetCarousel 과 달리 고정 높이가 아니라 활성 페이지 높이에 맞춰 뷰포트 높이를 동기화하므로 전체 페이지 콘텐츠에 적합.
// 모든 페이지를 마운트 유지 → 페이지를 넘겨도 라이브 데이터·내부 캐러셀 위치·상태가 보존됨.
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { GlassTabBar } from "./GlassTabBar";

export type PagerPage = { title: string; content: ReactNode };

export function SectionPager({
  pages,
  homeSignal,
  onPageChange,
}: {
  pages: PagerPage[];
  homeSignal?: number;
  onPageChange?: (idx: number) => void; // 활성 페이지 변경 통지(부모가 페이지별 부속 UI를 제어할 때).
}) {
  const [idx, setIdx] = useState(0);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const n = pages.length;

  // 헤더 로고 클릭 등 외부 신호로 첫 페이지(홈)로 복귀 — 값이 증가할 때마다 1회 동작. 부모에도 통지.
  useEffect(() => {
    if (homeSignal) {
      setIdx(0);
      onPageChange?.(0);
    }
  }, [homeSignal, onPageChange]);

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

  const cur = pages[idx];
  if (!cur) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* 컨트롤 바 — 현황 요약 캐러셀과 동일한 리퀴드글래스 탭 메뉴(GlassTabBar) */}
      <div className="flex items-center gap-1.5 rounded-xl border border-hairline-strong bg-canvas px-1.5 py-1 dark:border-white/10 dark:bg-surface-dark">
        <GlassTabBar
          tabs={pages.map((p) => p.title)}
          active={idx}
          onSelect={(i) => {
            setIdx(i);
            onPageChange?.(i);
          }}
          className="flex-1"
        />
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
