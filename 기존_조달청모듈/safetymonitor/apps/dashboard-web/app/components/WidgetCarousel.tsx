// 좌우 화살표 가로 캐러셀 — 고정 높이 박스에서 ‹ › 버튼으로 페이지 전환(제목 + N/M 카운터).
// 같은 자리에 여러 위젯(현장정보·국내재해사례 등)을 두고 수동 전환을 쉽게(자동순환은 호버 시 정지).
"use client";

import { createContext, useEffect, useRef, useState, type ReactNode } from "react";

import { GlassTabBar } from "./GlassTabBar";

// 캐러셀에서 현재 보이는 페이지인지 알려주는 신호 — 숨은 페이지의 스트림 상시 연결(CCTV 등) 중단용.
// 캐러셀 밖 소비처는 Provider 가 없어 기본값 true = 기존 동작 유지(하위호환).
export const CarouselPageVisibleContext = createContext(true);

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
        {/* 프로스티드 유리 필 탭 — 좌측 정렬(기본). flex-1 이라 headerAccessory 배지는 우측 끝 고정(위치 불변). */}
        <GlassTabBar
          tabs={pages.map((p) => p.title)}
          active={idx}
          onSelect={setIdx}
          className="flex-1"
        />
        {/* KOSHA 실시간 등 부가요소 — 탭 우측 끝에 배치(왼쪽이면 탭 위치가 통째로 밀림). */}
        {cur.headerAccessory && <div className="shrink-0">{cur.headerAccessory}</div>}
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
            <CarouselPageVisibleContext.Provider value={i === idx}>
              {p.content}
            </CarouselPageVisibleContext.Provider>
          </div>
        ))}
      </div>
    </div>
  );
}
