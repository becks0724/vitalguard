// 현장 환경 좌측 호버 패널 — 관제 탭 밖(안전뉴스·안전관리비 검증·ERP)에서는 현장 환경 스트립이
// 화면에 없으므로, 좌측 여백의 손잡이에 마우스를 올리면 같은 정보를 세로 목록으로 펼친다.
// 레이아웃은 가로 오토슬라이딩이 아니라 리스트다(사용자 요청 2026-07-31).
"use client";

import { WeatherStrip } from "./WeatherStrip";

export function SiteEnvHoverPanel({
  lat,
  lon,
  workerCount,
  coordSource,
  refreshNonce,
}: {
  lat?: number;
  lon?: number;
  workerCount: number;
  coordSource?: "live" | "cached" | "none";
  refreshNonce?: number;
}) {
  return (
    // 좌측 여백에 고정. 넓은 화면에서만 — 좁은 화면엔 띄울 여백이 없다.
    // top-44 = 상단 헤더+탭바 아래. 이보다 위면 패널이 탭 바를 덮어 탭 클릭을 막는다.
    <div className="group fixed left-0 top-44 z-40 hidden lg:flex lg:items-start">
      {/* 손잡이 — 항상 보이는 얇은 탭. 마우스를 올리면 옆으로 패널이 열린다. */}
      <div className="flex w-7 shrink-0 cursor-default flex-col items-center gap-1.5 rounded-r-lg border border-l-0 border-hairline bg-canvas/95 py-4 text-muted shadow-sm backdrop-blur transition-colors group-hover:text-ink dark:border-white/10 dark:bg-surface-dark/95 dark:text-on-dark-soft dark:group-hover:text-on-dark">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m10-10 1.4-1.4" />
          <circle cx="12" cy="12" r="3.5" />
        </svg>
        <span className="text-[10px] font-semibold leading-tight [writing-mode:vertical-rl]">
          현장 환경
        </span>
      </div>
      {/* 패널 — 기본은 닫힘(폭 0). 호버 시에만 열리고 클릭도 그때만 받는다. */}
      <div className="pointer-events-none w-0 overflow-hidden opacity-0 transition-all duration-200 ease-out group-hover:pointer-events-auto group-hover:w-[340px] group-hover:opacity-100">
        <div className="ml-1 w-[336px]">
          <WeatherStrip
            lat={lat}
            lon={lon}
            workerCount={workerCount}
            coordSource={coordSource}
            refreshNonce={refreshNonce}
            layout="list"
          />
        </div>
      </div>
    </div>
  );
}
