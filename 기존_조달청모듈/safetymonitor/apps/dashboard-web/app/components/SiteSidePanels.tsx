// 좌측 사이드 패널 — 좌측 손잡이를 눌러 각각 따로 열고 닫는다(호버가 아니라 클릭 — 사용자 요청).
// 손잡이는 서로 독립이고 한 번에 하나만 열린다. 레이아웃은 세로 리스트다.
// `pinned` 를 주면 그 패널 하나만 손잡이로 두고 늘 펼쳐 둔다(관제 탭의 현장 환경 — 사용자 요청).
"use client";

import { useEffect, useState } from "react";

import FitToViewport from "./FitToViewport";
import { HospitalPanel } from "./HospitalPanel";
import { RadarRealtime } from "./RadarRealtime";
import { SafetySignalBoard, type WorkerSignal } from "./SafetySignalBoard";
import { TyphoonTrack } from "./TyphoonTrack";
import { WarningVideoPanel } from "./WarningVideoPanel";
import { WeatherStrip } from "./WeatherStrip";

type PanelKey = "env" | "signal" | "radar" | "typhoon" | "video" | "hospital";

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
// 레이더 픽토그램 — 위쪽에 틈이 난 동심 호 2개 + 중심점 + 위로 뻗는 스캔 라인.
// 이전 아이콘은 닫힌 원 두 개라 과녁처럼 보였다(레이더로 안 읽힘).
function RadarIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 3A9 9 0 1 0 18.36 5.64" />
      <path d="M12 6.5A5.5 5.5 0 1 0 15.89 8.11" />
      <path d="M12 12V3" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

// 회오리(토네이도) 픽토그램 — 위가 넓고 아래로 좁아지는 소용돌이 3단 + 바닥으로 흘러내리는 꼬리.
// 이전 아이콘은 원호 4개가 흩어져 작은 크기에서 태풍으로 안 읽혔다.
function TyphoonIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M17.09 6.34A7.2 1.9 0 1 1 17.09 3.66" />
      <path d="M15.96 11.14A5.6 1.75 0 1 1 15.96 8.66" />
      <path d="M14.83 15.53A4 1.6 0 1 1 14.83 13.27" />
      <path d="M11.4 16.1c.8 1.3.3 2.4-.9 2.9-1 .4-2 0-2.4-.7" />
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

// 병원 픽토그램 — 둥근 사각 테두리 안에 의료 십자. 우하단이 살짝 열려 카드/표식 느낌을 준다.
// 이전 아이콘은 건물 두 채에 창문까지 그려 20px 에서 뭉갰다.
function HospitalIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M20 14.5V19a2 2 0 0 1-2 2h-4M20 14.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h8" />
      <path d="M13.6 7.6h-3.2v2.8H7.6v3.2h2.8v2.8h3.2v-2.8h2.8v-3.2h-2.8z" />
    </svg>
  );
}

// 손잡이 정의 — 순서가 곧 화면 위→아래 순서다. 표시 여부는 `pinned` 가 고른다.
const HANDLES: readonly { key: PanelKey; label: string; Icon: () => React.ReactElement }[] = [
  { key: "env", label: "현장 환경", Icon: EnvIcon },
  { key: "signal", label: "안전 신호등", Icon: SignalIcon },
  { key: "radar", label: "실시간 레이더", Icon: RadarIcon },
  { key: "typhoon", label: "태풍 진로", Icon: TyphoonIcon },
  { key: "video", label: "특보 영상", Icon: VideoIcon },
  { key: "hospital", label: "인근 병원", Icon: HospitalIcon },
];

// 색은 챗봇 버튼과 같은 blue 계열 — text-muted 는 라이트모드 흰 배경에서 거의 안 보인다.
const HANDLE_BASE =
  "flex w-8 shrink-0 flex-col items-center rounded-r-lg border border-l-0 py-2.5 shadow-sm backdrop-blur transition-all duration-300 ease-out";
const HANDLE_ON = "border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-600";
const HANDLE_OFF =
  "border-hairline bg-canvas/95 text-blue-600 hover:text-blue-700 dark:border-white/10 dark:bg-surface-dark/95 dark:text-blue-400 dark:hover:text-blue-300";

// onClick 이 없으면 고정 패널의 손잡이다 — 누를 것이 없으므로 버튼이 아니라 아이콘 표식으로 둔다
// (제목은 바로 옆 패널 헤더가 이미 보여준다).
function Handle({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!onClick) {
    return (
      <div className={`${HANDLE_BASE} ${HANDLE_ON}`} title={label}>
        <span className="grid h-5 w-5 shrink-0 place-items-center">{children}</span>
      </div>
    );
  }

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
      className={[HANDLE_BASE, expanded ? "gap-1.5" : "gap-0", active ? HANDLE_ON : HANDLE_OFF].join(
        " ",
      )}
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
// 고정 패널은 top-44(176px)에서 시작하고 아래 32px 를 비운다 — 쓸 수 있는 높이 = 100vh − 208px.
// ⚠ 이 값을 두 곳이 함께 쓴다(넘침 한계 · 오토리사이징 기준). 손으로 두 번 적으면 반드시 갈리고,
//   갈리면 축소가 덜 되거나(스크롤 잔존) 과해진다(공백 낭비). 그래서 한 곳에서 낸다.
const PANEL_TOP_PX = 176; // = top-44
const PANEL_BOTTOM_GAP_PX = 32;
const PANEL_GUTTER_PX = PANEL_TOP_PX + PANEL_BOTTOM_GAP_PX;

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

// 고정 패널은 fixed 라 폭을 차지하지 않는다 — 본문이 가운데 정렬이므로 좌측 여백이
// 손잡이+패널 폭(332px)보다 좁으면 본문을 덮는다. 실측 본문 폭 1231px 기준
// 여백 332px 를 확보하는 최소 뷰포트 = 1231 + 332×2 = 1895px. 그보다 좁으면 접어서
// 손잡이만 두고 다른 탭과 같은 클릭 토글로 돌린다(사용자 결정 — 넓은 화면 배치는 불변).
const PINNED_MIN_WIDTH = 1895;

function useWideEnoughToPin(): boolean {
  // SSR·첫 렌더는 좁은 쪽으로 본다 — 덮는 것보다 접혀 있는 편이 안전하다.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${PINNED_MIN_WIDTH}px)`);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return wide;
}

export function SiteSidePanels({
  lat,
  lon,
  workerCount,
  coordSource,
  refreshNonce,
  worker,
  region,
  pinned,
  onRefresh,
  refreshing,
}: {
  lat?: number;
  lon?: number;
  workerCount: number;
  coordSource?: "live" | "cached" | "none";
  refreshNonce?: number;
  worker: WorkerSignal;
  region: string; // 인근 병원 지역 검색 키워드(예: "광주 동구") — HospitalPanel 이 필수로 받는다
  pinned?: PanelKey; // 주면 그 패널만 손잡이로 두고 늘 펼쳐 둔다(닫기 없음)
  onRefresh?: () => void; // 현장 환경 수동 새로고침(좌표 재캡처) — 고정 패널이 스트립을 대신할 때 필요
  refreshing?: boolean;
}) {
  const [openKey, setOpenKey] = useState<PanelKey | null>(null);
  // 좁은 화면에서는 고정을 풀고 접는다(본문을 덮지 않게).
  const wideEnough = useWideEnoughToPin();
  const isPinned = pinned !== undefined && wideEnough;
  const shown = pinned ? HANDLES.filter((h) => h.key === pinned) : HANDLES;
  // 고정 탭에서는 그 패널만 다룬다 — 다른 탭에서 열어둔 키가 남아 손잡이 없는 패널이 뜨지 않게.
  const open = pinned ? (isPinned || openKey === pinned ? pinned : null) : openKey;

  return (
    // top-44 = 상단 헤더+탭바 아래. 이보다 위면 패널이 탭 바를 덮어 탭 클릭을 막는다.
    <div className="fixed left-0 top-44 z-40 hidden items-start lg:flex">
      <div className="flex shrink-0 flex-col gap-2">
        {shown.map(({ key, label, Icon }) => (
          <Handle
            key={key}
            label={label}
            active={open === key}
            onClick={isPinned ? undefined : () => setOpenKey((prev) => (prev === key ? null : key))}
          >
            <Icon />
          </Handle>
        ))}
      </div>

      {open && (
        <div className="relative ml-1 w-[296px]">
          {/* 닫기 — 패널 자체 헤더(우측 배지·상태 표시)와 겹치지 않게 모서리 바깥으로 살짝 뺀다.
              고정 패널은 닫을 수 없으므로 띄우지 않는다. */}
          {!isPinned && (
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
          )}
          {/* 화면이 낮으면 패널 아래쪽이 잘려 손댈 수 없다(실내 현장 환경이 붙으며 실제로 발생).
              top-44(176px) + 아래 여백 32px 를 뺀 높이로 제한한다.
              ★ 현장 환경은 여기서 한 겹 더 — 넘치면 스크롤 대신 zoom 으로 축소해 한 화면에 담는다
                (FitToViewport). 축소가 끝까지 못 가는 극단(아주 낮은 창)에서만 이 스크롤이 남으므로
                최악이어도 종전 동작이고, 위 주석이 적은 '잘림'으로는 되돌아가지 않는다.
              닫기 버튼은 이 박스 밖에 둔다 — 안에 넣으면 overflow 가 모서리 밖 위치를 잘라낸다. */}
          <div style={{ maxHeight: `calc(100vh - ${PANEL_GUTTER_PX}px)` }} className="overflow-y-auto">
          {/* 오토리사이징은 현장 환경에만 건다. 레이더·태풍·영상·병원은 Framed 가 높이를 313px 로
              못박아 넘칠 수 없고, 안전 신호등은 별도 판단 대상이다(지금 동작 그대로 = 스크롤). */}
          {open === "env" && (
            <FitToViewport gutterPx={PANEL_GUTTER_PX}>
            <WeatherStrip
              lat={lat}
              lon={lon}
              workerCount={workerCount}
              coordSource={coordSource}
              refreshNonce={refreshNonce}
              onRefresh={onRefresh}
              refreshing={refreshing}
              // 고정 탭에서는 화면에 뜬 현장 환경이 이것뿐이라 경보 팝업 주체가 된다(스트립을 대신).
              // isPinned 가 아니라 pinned 로 판정한다 — 좁은 화면에서 접혔다가 열어도 주체는 그대로다.
              showAlertToast={pinned === "env"}
              layout="list"
            />
            </FitToViewport>
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
        </div>
      )}
    </div>
  );
}
