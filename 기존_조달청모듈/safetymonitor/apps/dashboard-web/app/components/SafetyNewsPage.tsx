// 안전뉴스 탭 — 재난문자·산업재해 속보·국내 재해사례·산업 안전뉴스를 한 화면에.
// 배치는 2×2 — 위 = 지금 벌어지는 일(경보), 아래 = 참고 자료(사례·기사).
// 박스·제목·출처 배지는 여기서 제공한다 → 기존 카드 컴포넌트는 리스트만 렌더(무수정 재사용).
"use client";

import { useCallback, useState, type ReactNode } from "react";

import { DisasterMsgCard } from "./DisasterMsgCard";
import { KoshaAccidentCaseCard } from "./KoshaAccidentCaseCard";
import { KoshaFatalAccidentList } from "./KoshaFatalAccidentList";
import { NewsPanel } from "./NewsPanel";

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={spinning ? "animate-spin" : undefined}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function Panel({
  title,
  badge,
  onRefresh,
  children,
}: {
  title: string;
  badge?: ReactNode;
  onRefresh?: () => void;
  children: ReactNode;
}) {
  // 회전은 클릭 피드백용 고정 시간(700ms)이다 — 자식이 로딩 종료를 알려주지 않으므로
  // 진행률이 아니라 "눌렸다"는 신호로만 쓴다. 서버 캐시가 살아 있으면 값이 그대로일 수 있다.
  const [spinning, setSpinning] = useState(false);
  const handleRefresh = () => {
    setSpinning(true);
    onRefresh?.();
    window.setTimeout(() => setSpinning(false), 700);
  };
  // 네 패널의 프레임을 동일하게 유지한다(사용자 요청 2026-07-31).
  // 이전엔 경보 성격 패널에 border-semantic-down/30 을 줬는데 그 클래스가 생성되지 않아
  // 기본 gray-200 으로 떨어졌고, 다크모드에서만 밝게 튀어 위아래 프레임이 갈려 보였다.
  // 위계는 테두리 대신 배지 색과 카드 안의 붉은 점이 담당한다.
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-hairline-strong bg-canvas dark:border-white/10 dark:bg-surface-dark">
      <div className="flex items-center gap-2 px-3 pb-1.5 pt-2.5">
        {/* 패널 제목 — 기존 text-xs(12px) 대비 20% 확대(14.4px). 배지는 원래 크기를 유지한다. */}
        <h3 className="text-[14.4px] font-bold leading-tight text-ink dark:text-on-dark">{title}</h3>
        {badge}
        {onRefresh && (
          <button
            type="button"
            onClick={handleRefresh}
            aria-label={`${title} 새로고침`}
            title="새로고침"
            // -my-1 = 클릭 영역(21px)은 유지하면서 헤더 행 높이는 키우지 않는다.
            //         이게 없으면 패널마다 몇 px 씩 늘어 "한 화면" 목표가 깨진다.
            className="-my-1 ml-auto shrink-0 rounded-md p-1 text-muted transition hover:bg-surface-strong hover:text-ink dark:text-on-dark-soft dark:hover:bg-white/10 dark:hover:text-on-dark"
          >
            <RefreshIcon spinning={spinning} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function SourceBadge({ source }: { source: "live" | "mock" | null }) {
  if (!source) return null;
  return (
    <span className="rounded-pill bg-surface-strong px-2 py-0.5 text-[10px] font-semibold text-body dark:bg-white/10 dark:text-on-dark-soft">
      {source === "live" ? "실시간" : "샘플"}
    </span>
  );
}

export function SafetyNewsPage({ lat, lon }: { lat?: number; lon?: number }) {
  const [disasterSource, setDisasterSource] = useState<"live" | "mock" | null>(null);
  const [fatalSource, setFatalSource] = useState<"live" | "mock" | null>(null);
  const [koshaSource, setKoshaSource] = useState<"live" | "mock" | null>(null);

  // 자식 useEffect 의 의존성이라 매 렌더 새 함수를 넘기면 폴링이 재설정된다.
  const onDisaster = useCallback((s: "live" | "mock" | null) => setDisasterSource(s), []);
  const onFatal = useCallback((s: "live" | "mock") => setFatalSource(s), []);
  const onKosha = useCallback((s: "live" | "mock" | null) => setKoshaSource(s), []);

  // 패널별 새로고침 — 값이 오르면 해당 자식이 다시 조회한다.
  // 우리 API 를 다시 부르는 것이지 상류(KOSHA·네이버·재난문자) 캐시를 뚫지는 않는다 —
  // 뚫게 만들면 일일 호출 예산(재난문자 1000건)을 사용자가 버튼으로 태울 수 있다.
  const [reload, setReload] = useState({ fatal: 0, disaster: 0, news: 0, kosha: 0 });
  const bump = useCallback(
    (k: "fatal" | "disaster" | "news" | "kosha") => () =>
      setReload((prev) => ({ ...prev, [k]: prev[k] + 1 })),
    [],
  );

  // 전체 폭 4단 스택 — 가로 슬라이딩(속보·재해사례)은 폭이 넓을수록 유리하고,
  // 목록(재난문자)·섬네일 카드(뉴스)는 한 줄에 더 많이 담긴다(사용자 레이아웃 결정 2026-07-31).
  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="산업재해 속보"
        onRefresh={bump("fatal")}
        badge={
          <span className="rounded-pill bg-surface-strong px-2 py-0.5 text-[10px] font-semibold text-semantic-down dark:bg-white/10">
            {fatalSource === "live" ? "KOSHA 실시간" : fatalSource === "mock" ? "샘플" : "…"}
          </span>
        }
      >
        <KoshaFatalAccidentList onSourceChange={onFatal} reloadKey={reload.fatal} />
      </Panel>

      {/* 높이 150px = 요약줄 + 발령 2건(행당 50px). 그 이상은 스크롤 — 화면을 덜 차지하게(사용자 요청). */}
      <Panel title="행정안전부 긴급재난문자" onRefresh={bump("disaster")} badge={<SourceBadge source={disasterSource} />}>
        <div className="h-[150px]">
          <DisasterMsgCard lat={lat} lon={lon} onSourceChange={onDisaster} reloadKey={reload.disaster} />
        </div>
      </Panel>

      <Panel title="산업 안전뉴스" onRefresh={bump("news")}>
        <NewsPanel reloadKey={reload.news} />
      </Panel>

      <Panel title="국내 재해사례" onRefresh={bump("kosha")} badge={<SourceBadge source={koshaSource} />}>
        <KoshaAccidentCaseCard onSourceChange={onKosha} reloadKey={reload.kosha} />
      </Panel>
    </div>
  );
}
