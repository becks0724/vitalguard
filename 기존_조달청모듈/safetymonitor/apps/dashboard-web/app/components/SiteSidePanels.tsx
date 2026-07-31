// 좌측 사이드 패널 — 좌측 손잡이를 눌러 각각 따로 열고 닫는다(호버가 아니라 클릭 — 사용자 요청).
// 손잡이는 서로 독립이고 한 번에 하나만 열린다. 레이아웃은 세로 리스트다.
// 어떤 손잡이를 띄울지는 `panels` 로 탭마다 고른다(관제 탭은 현장 환경만 — 사용자 요청).
"use client";

import { useMemo, useState } from "react";

import { HospitalPanel } from "./HospitalPanel";
import { RadarRealtime } from "./RadarRealtime";
import { SafetySignalBoard, type WorkerSignal } from "./SafetySignalBoard";
import { TyphoonTrack } from "./TyphoonTrack";
import { WarningVideoPanel } from "./WarningVideoPanel";
import { WeatherStrip } from "./WeatherStrip";

export type PanelKey = "env" | "signal" | "radar" | "typhoon" | "video" | "hospital";

export const ALL_PANELS: readonly PanelKey[] = [
  "env",
  "signal",
  "radar",
  "typhoon",
  "video",
  "hospital",
];

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
function RadarIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12 19 6" />
    </svg>
  );
}

function TyphoonIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 12a4 4 0 1 0-3.2-6.4" />
      <path d="M12 12a4 4 0 1 1 3.2 6.4" />
      <path d="M20 8c-2.5-3-6-4.5-9.5-3.5" />
      <path d="M4 16c2.5 3 6 4.5 9.5 3.5" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2.5" y="5" width="14" height="14" rx="2.5" />
      <path d="m16.5 10 5-3v10l-5-3" />
    </svg>
  );
}

function HospitalIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 21V8l8-5 8 5v13" />
      <path d="M12 10v6M9 13h6" />
    </svg>
  );
}

// 손잡이 정의 — 순서가 곧 화면 위→아래 순서다. 표시 여부는 `panels` 가 고른다.
const HANDLES: readonly { key: PanelKey; label: string; Icon: () => React.ReactElement }[] = [
  { key: "env", label: "현장 환경", Icon: EnvIcon },
  { key: "signal", label: "안전 신호등", Icon: SignalIcon },
  { key: "radar", label: "실시간 레이더", Icon: RadarIcon },
  { key: "typhoon", label: "태풍 진로", Icon: TyphoonIcon },
  { key: "video", label: "특보 영상", Icon: VideoIcon },
  { key: "hospital", label: "인근 병원", Icon: HospitalIcon },
];

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

// 레이더·태풍·영상·병원은 원래 420px 폭 캐러셀 콘텐츠다. 폭만 296px 로 줄이면 지도·영상이 뭉개지므로
// 네이티브 크기(420×360)로 렌더한 뒤 transform: scale 로 비율 그대로 축소해 좌측 여백 안에 넣는다
// (현장 환경·안전 신호등과 같은 296px 경계를 넘지 않게 — 사용자 요청).
const PANEL_W = 296;
// 네이티브 폭을 420 → 340 으로 줄였다. 두 가지를 동시에 해결한다 —
//  ① 레이더는 정사각(min(가로,세로))으로 맞춰지므로 폭이 넓을수록 좌우 여백만 커진다.
//  ② 축소율이 0.705 → 0.87 로 완화돼 글자가 그만큼 커진다(가독성).
const NATIVE_W = 340;
const NATIVE_H = 360;
const SCALE = PANEL_W / NATIVE_W;

// 캐러셀 밖에서 쓰려면 외곽 박스가 필요하다(WidgetCarousel 이 하던 역할).
// title 은 자체 제목이 없는 컴포넌트에만 준다 — 태풍 진로·인근 병원은 본문에 제목이 있어 넣으면 중복된다.
function Framed({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ width: PANEL_W, height: NATIVE_H * SCALE }} className="overflow-hidden">
      <div
        style={{
          width: NATIVE_W,
          height: NATIVE_H,
          transform: `scale(${SCALE})`,
          transformOrigin: "top left",
        }}
      >
        <FramedInner title={title}>{children}</FramedInner>
      </div>
    </div>
  );
}

function FramedInner({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-xl border border-hairline-strong bg-canvas dark:border-white/10 dark:bg-surface-dark-elevated">
      {title && (
        <div className="shrink-0 border-b border-hairline px-3 py-2 dark:border-white/10">
          <h3 className="text-[14.4px] font-bold leading-tight text-ink dark:text-on-dark">{title}</h3>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

export function SiteSidePanels({
  lat,
  lon,
  workerCount,
  coordSource,
  refreshNonce,
  worker,
  region,
  panels = ALL_PANELS,
}: {
  lat?: number;
  lon?: number;
  workerCount: number;
  coordSource?: "live" | "cached" | "none";
  refreshNonce?: number;
  worker: WorkerSignal;
  region: string; // 인근 병원 지역 검색 키워드(예: "광주 동구") — HospitalPanel 이 필수로 받는다
  panels?: readonly PanelKey[]; // 띄울 손잡이(기본 6종 전부)
}) {
  const [openKey, setOpenKey] = useState<PanelKey | null>(null);
  const shown = useMemo(() => HANDLES.filter((h) => panels.includes(h.key)), [panels]);
  // 탭을 옮겨 손잡이 목록이 줄면 열려 있던 패널이 손잡이 없이 남는다 — 목록에 없으면 닫힌 것으로 본다.
  const open = openKey !== null && panels.includes(openKey) ? openKey : null;
  const toggle = (key: PanelKey) => () => setOpenKey((prev) => (prev === key ? null : key));

  return (
    // top-44 = 상단 헤더+탭바 아래. 이보다 위면 패널이 탭 바를 덮어 탭 클릭을 막는다.
    <div className="fixed left-0 top-44 z-40 hidden items-start lg:flex">
      <div className="flex shrink-0 flex-col gap-2">
        {shown.map(({ key, label, Icon }) => (
          <Handle key={key} label={label} active={open === key} onClick={toggle(key)}>
            <Icon />
          </Handle>
        ))}
      </div>

      {open && (
        <div className="relative ml-1 w-[296px]">
          {/* 닫기 — 패널 자체 헤더(우측 배지·상태 표시)와 겹치지 않게 모서리 바깥으로 살짝 뺀다. */}
          <button
            type="button"
            onClick={() => setOpenKey(null)}
            aria-label="패널 닫기"
            title="닫기"
            className="absolute -right-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-hairline bg-canvas text-body shadow-md transition-colors hover:bg-surface-strong hover:text-ink dark:border-white/15 dark:bg-surface-dark dark:text-on-dark-soft dark:hover:bg-white/10 dark:hover:text-on-dark"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          {open === "env" && (
            <WeatherStrip
              lat={lat}
              lon={lon}
              workerCount={workerCount}
              coordSource={coordSource}
              refreshNonce={refreshNonce}
              layout="list"
            />
          )}
          {open === "signal" && <SafetySignalBoard lat={lat} lon={lon} worker={worker} />}
          {/* 아래 넷은 캐러셀 헤더가 제목을 주던 컴포넌트라 여기서 박스·제목을 씌운다. */}
          {open === "radar" && (
            <Framed title="실시간 레이더">
              <RadarRealtime />
            </Framed>
          )}
          {open === "typhoon" && (
            <Framed>
              <TyphoonTrack lat={lat} lon={lon} />
            </Framed>
          )}
          {open === "video" && (
            <Framed title="특보 영상">
              <WarningVideoPanel lat={lat} lon={lon} />
            </Framed>
          )}
          {open === "hospital" && (
            <Framed>
              <HospitalPanel lat={lat} lon={lon} region={region} />
            </Framed>
          )}
        </div>
      )}
    </div>
  );
}
