// 안전뉴스 탭 — 재난문자·산업재해 속보·국내 재해사례·산업 안전뉴스를 한 화면에.
// 배치는 2×2 — 위 = 지금 벌어지는 일(경보), 아래 = 참고 자료(사례·기사).
// 박스·제목·출처 배지는 여기서 제공한다 → 기존 카드 컴포넌트는 리스트만 렌더(무수정 재사용).
"use client";

import { useCallback, useState, type ReactNode } from "react";

import { DisasterMsgCard } from "./DisasterMsgCard";
import { KoshaAccidentCaseCard } from "./KoshaAccidentCaseCard";
import { KoshaFatalAccidentList } from "./KoshaFatalAccidentList";
import { NewsPanel } from "./NewsPanel";

function Panel({
  title,
  accent,
  badge,
  children,
}: {
  title: string;
  accent?: boolean; // 경보 성격(재난문자·사망 속보) — 테두리로 위계를 준다
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className={[
        "flex h-[280px] min-w-0 flex-col overflow-hidden rounded-xl border bg-canvas dark:bg-surface-dark",
        accent
          ? "border-semantic-down/30 dark:border-semantic-down/30"
          : "border-hairline-strong dark:border-white/10",
      ].join(" ")}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2.5">
        {/* 패널 제목 — 기존 text-xs(12px) 대비 20% 확대(14.4px). 배지는 원래 크기를 유지한다. */}
        <h3 className="text-[14.4px] font-bold leading-tight text-ink dark:text-on-dark">{title}</h3>
        {badge}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
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

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* 위 — 지금 벌어지는 일 */}
      <Panel title="긴급재난문자" accent badge={<SourceBadge source={disasterSource} />}>
        <DisasterMsgCard lat={lat} lon={lon} onSourceChange={onDisaster} />
      </Panel>
      <Panel
        title="산업재해 속보"
        accent
        badge={
          <span className="rounded-pill bg-semantic-down/10 px-2 py-0.5 text-[10px] font-semibold text-semantic-down">
            {fatalSource === "live" ? "KOSHA 실시간" : fatalSource === "mock" ? "샘플" : "…"}
          </span>
        }
      >
        <KoshaFatalAccidentList onSourceChange={onFatal} />
      </Panel>

      {/* 아래 — 참고 자료 */}
      <Panel title="국내 재해사례" badge={<SourceBadge source={koshaSource} />}>
        <KoshaAccidentCaseCard onSourceChange={onKosha} />
      </Panel>
      <Panel title="산업 안전뉴스">
        <NewsPanel />
      </Panel>
    </div>
  );
}
