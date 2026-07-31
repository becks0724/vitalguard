// 좌측 사이드 패널 — 관제 탭 밖(안전뉴스·안전관리비 검증·ERP)에서는 현장 환경·안전 신호등이
// 화면에 없으므로, 좌측 손잡이를 눌러 각각 따로 열고 닫는다(호버가 아니라 클릭 — 사용자 요청).
// 두 손잡이는 독립이고 한 번에 하나만 열린다. 레이아웃은 세로 리스트다.
"use client";

import { useState } from "react";

import { SafetySignalBoard, type WorkerSignal } from "./SafetySignalBoard";
import { WeatherStrip } from "./WeatherStrip";

type PanelKey = "env" | "signal";

// 헤더 우측 아이콘들과 같은 규격 — viewBox 24 · fill none · stroke currentColor · strokeWidth 2 · round cap.
// 크기만 헤더(16px)보다 20% 큰 20px 로 둔다(손잡이가 좁고 세로라 눈에 덜 띈다 — 사용자 요청).
const ICON_PROPS = {
  viewBox: "0 0 24 24",
  width: 20,
  height: 20,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function EnvIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m10-10 1.4-1.4" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

// 신호등 — 이전 rect 는 폭 8 에 굵은 선이라 작은 크기에서 속이 메워져 파란 덩어리로 보였다.
// 하우징을 넓히고(폭 10) 선을 얇게 해 램프 3개가 구분되게 한다.
function SignalIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="7" y="2.5" width="10" height="19" rx="5" />
      <circle cx="12" cy="7.5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="16.5" r="1.7" />
    </svg>
  );
}

// 헤더의 ExpandableTabs 와 같은 방식 — 평시엔 아이콘만, 마우스가 닿으면 라벨이 펼쳐진다.
// 라벨이 세로쓰기라 헤더의 maxWidth 대신 maxHeight 로 전환한다(인라인 스타일 = JIT 타이밍 회피, 헤더와 동일).
function Handle({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={() => setExpanded(false)}
      aria-expanded={active}
      aria-label={`${label} ${active ? "닫기" : "열기"}`}
      title={`${label} ${active ? "닫기" : "열기"}`}
      // 색은 챗봇 버튼과 같은 blue 계열 — text-muted 는 라이트모드 흰 배경에서 거의 안 보인다.
      className={[
        "flex w-8 shrink-0 flex-col items-center rounded-r-lg border border-l-0 py-2.5 shadow-sm backdrop-blur transition-all duration-300 ease-out",
        expanded ? "gap-1.5" : "gap-0",
        active
          ? "border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-600"
          : "border-hairline bg-canvas/95 text-blue-600 hover:text-blue-700 dark:border-white/10 dark:bg-surface-dark/95 dark:text-blue-400 dark:hover:text-blue-300",
      ].join(" ")}
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center">{children}</span>
      <span
        className="overflow-hidden whitespace-nowrap text-[12px] font-semibold leading-tight transition-all duration-300 ease-out [writing-mode:vertical-rl]"
        style={{ maxHeight: expanded ? 120 : 0, opacity: expanded ? 1 : 0 }}
      >
        {label}
      </span>
    </button>
  );
}

export function SiteSidePanels({
  lat,
  lon,
  workerCount,
  coordSource,
  refreshNonce,
  worker,
}: {
  lat?: number;
  lon?: number;
  workerCount: number;
  coordSource?: "live" | "cached" | "none";
  refreshNonce?: number;
  worker: WorkerSignal;
}) {
  const [open, setOpen] = useState<PanelKey | null>(null);
  const toggle = (key: PanelKey) => () => setOpen((prev) => (prev === key ? null : key));

  return (
    // top-44 = 상단 헤더+탭바 아래. 이보다 위면 패널이 탭 바를 덮어 탭 클릭을 막는다.
    <div className="fixed left-0 top-44 z-40 hidden items-start lg:flex">
      <div className="flex shrink-0 flex-col gap-2">
        <Handle label="현장 환경" active={open === "env"} onClick={toggle("env")}>
          <EnvIcon />
        </Handle>
        <Handle label="안전 신호등" active={open === "signal"} onClick={toggle("signal")}>
          <SignalIcon />
        </Handle>
      </div>

      {open && (
        <div className="relative ml-1 w-[296px]">
          {/* 닫기 — 패널 자체 헤더(우측 배지·상태 표시)와 겹치지 않게 모서리 바깥으로 살짝 뺀다. */}
          <button
            type="button"
            onClick={() => setOpen(null)}
            aria-label="패널 닫기"
            title="닫기"
            className="absolute -right-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-hairline bg-canvas text-body shadow-md transition-colors hover:bg-surface-strong hover:text-ink dark:border-white/15 dark:bg-surface-dark dark:text-on-dark-soft dark:hover:bg-white/10 dark:hover:text-on-dark"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          {open === "env" ? (
            <WeatherStrip
              lat={lat}
              lon={lon}
              workerCount={workerCount}
              coordSource={coordSource}
              refreshNonce={refreshNonce}
              layout="list"
            />
          ) : (
            <SafetySignalBoard lat={lat} lon={lon} worker={worker} />
          )}
        </div>
      )}
    </div>
  );
}
