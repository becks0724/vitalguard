// 긴급재난문자 카드 — 작업자 GPS 평균 좌표(시·도)에 발령된 재난문자를 표시.
// 데이터·판정은 서버(/api/disaster-msg)가 수행. 여기서는 표시만 한다.
"use client";

import { useEffect, useState } from "react";

import { shortRegionLabel } from "../lib/disaster-msg";

type MsgView = {
  sn: number;
  type: string;
  step: "긴급재난" | "안전안내";
  atMs: number;
  regions: string[];
  sidos: string[];
  message: string;
};
type Payload = {
  ok: boolean;
  source: "live" | "mock";
  sido: string;
  severity: "normal" | "caution" | "danger";
  summary: string;
  site: MsgView[];
  nearby: MsgView[];
};

const DOT: Record<Payload["severity"], string> = {
  normal: "bg-muted",
  caution: "bg-amber-500",
  danger: "bg-semantic-down",
};

function hm(ms: number): string {
  return new Date(ms).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function DisasterMsgCard({
  lat,
  lon,
  onSourceChange,
  reloadKey = 0,
}: {
  lat?: number;
  lon?: number;
  onSourceChange?: (source: "live" | "mock" | null) => void;
  reloadKey?: number; // 값이 바뀌면 다시 조회(패널 헤더 새로고침 버튼)
}) {
  const [data, setData] = useState<Payload | null>(null);
  // 좌표가 있는데도 조회에 실패한 상태 — "발령 없음"과 반드시 구분한다(false-OK 방지).
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (typeof lat !== "number" || typeof lon !== "number") {
      onSourceChange?.(null);
      return;
    }
    let alive = true;
    const load = () =>
      fetch(`/api/disaster-msg?lat=${lat}&lon=${lon}`, { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((j: Payload) => {
          if (!alive) return;
          setData(j);
          setFailed(false);
          onSourceChange?.(j.source);
        })
        .catch(() => {
          if (!alive) return;
          setFailed(true);
          onSourceChange?.(null);
        });
    load();
    // 서버 캐시가 5분이라 그보다 촘촘히 부를 이유가 없다(호출 예산 — disaster-msg D-12).
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [lat, lon, onSourceChange, reloadKey]);

  // 좌표 없음·조회 실패는 회색 "수신 대기" — 0 으로 채워 "발령 없음"처럼 보이면 false-OK 다.
  if (typeof lat !== "number" || typeof lon !== "number" || failed || !data) {
    const label =
      typeof lat !== "number" || typeof lon !== "number"
        ? "현장 좌표 대기"
        : failed
          ? "연결 끊김"
          : "수신 대기";
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-3 pb-3 pt-1.5">
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-muted" />
        <p className="text-xs text-muted dark:text-on-dark-soft">{label}</p>
      </div>
    );
  }

  // 인근 상태는 현장과 같은 잣대로 계산한다(긴급재난 → danger / 그 외 발령 → caution).
  const nearbySeverity: Payload["severity"] =
    data.nearby.length === 0
      ? "normal"
      : data.nearby.some((m) => m.step === "긴급재난")
        ? "danger"
        : "caution";
  const nearbyTypes = [...new Set(data.nearby.map((m) => m.type))];
  const nearbySidos = [...new Set(data.nearby.flatMap((m) => m.sidos))];

  // 신호등 칩 — 발령이 있는 시·군을 이름+색점으로 나열해 인근 상태를 한눈에 본다.
  // 같은 지역이 여러 문자에 걸리면 가장 높은 단계를 쓰고, 현장(site)이 인근보다 앞선다.
  const RANK = { caution: 1, danger: 2 } as const;
  const chipMap = new Map<string, { name: string; severity: "caution" | "danger"; site: boolean }>();
  for (const [isSite, list] of [
    [true, data.site],
    [false, data.nearby],
  ] as const) {
    for (const m of list) {
      const sev = m.step === "긴급재난" ? "danger" : "caution";
      for (const r of m.regions) {
        const name = shortRegionLabel(r);
        const prev = chipMap.get(name);
        if (!prev) chipMap.set(name, { name, severity: sev, site: isSite });
        else {
          if (RANK[sev] > RANK[prev.severity]) prev.severity = sev;
          if (isSite) prev.site = true;
        }
      }
    }
  }
  const chips = [...chipMap.values()].sort((a, b) => Number(b.site) - Number(a.site));
  const CHIP_MAX = 12;

  return (
    <div className="no-scrollbar flex h-full flex-col gap-2 overflow-y-auto px-3 pb-3 pt-1.5">
      {/* 현장과 인근을 같은 형식(점·유형·지역)으로 나란히 — 인근도 지역명까지 보여준다.
          인근은 알림 대상이 아니지만(D-05) 상태는 같은 잣대로 읽히게 한다. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[data.severity]}`} />
          <span className="text-xs font-semibold text-ink dark:text-on-dark">{data.summary}</span>
          <span className="text-[10px] text-muted dark:text-on-dark-soft">{data.sido}</span>
        </span>
        {/* 지역별 신호등 — 현장·인근을 가리지 않고 발령이 있는 시·군을 색점+이름으로 나열 */}
        {chips.length > 0 && (
          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {chips.slice(0, CHIP_MAX).map((c) => (
              <span
                key={c.name}
                title={c.site ? "현장 시·도 발령" : "인근 시·도 발령(참고)"}
                className={[
                  "inline-flex shrink-0 items-center gap-1 rounded-pill border px-1.5 py-0.5 text-[10px]",
                  c.site
                    ? "border-hairline-strong bg-surface-soft font-semibold text-ink dark:border-white/15 dark:bg-white/5 dark:text-on-dark"
                    : "border-hairline text-body dark:border-white/10 dark:text-on-dark-soft",
                ].join(" ")}
              >
                <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[c.severity]}`} />
                {c.name}
              </span>
            ))}
            {chips.length > CHIP_MAX && (
              <span className="shrink-0 text-[10px] text-muted dark:text-on-dark-soft">
                +{chips.length - CHIP_MAX}
              </span>
            )}
          </span>
        )}
        {data.nearby.length > 0 && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[nearbySeverity]}`} />
            <span className="text-xs font-semibold text-body dark:text-on-dark-soft">
              {nearbyTypes.join(" · ")}
            </span>
            <span className="text-[10px] text-muted dark:text-on-dark-soft">
              인근 {nearbySidos.join("·")}
            </span>
            <span className="shrink-0 rounded-pill bg-surface-strong px-2 py-0.5 text-[10px] font-semibold text-body dark:bg-white/10 dark:text-on-dark-soft">
              {data.nearby.length}건 참고
            </span>
          </span>
        )}
      </div>

      {data.site.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted dark:text-on-dark-soft">
          현장 시·도에 발령된 재난문자가 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {data.site.map((m) => (
            <li
              key={m.sn}
              className={[
                "rounded-lg px-2.5 py-1.5",
                // 긴급재난 강조는 아래 유형 배지(붉은 바탕)가 담당한다.
                // bg-semantic-down/5 는 이 프로젝트의 색 정의(var(hex))에서 클래스가 생성되지 않아
                // 배경이 투명해지고 테두리만 기본 회색으로 남아 프레임이 어긋나 보였다.
                "bg-canvas dark:bg-surface-dark",
              ].join(" ")}
            >
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="font-mono tabular-nums text-muted dark:text-on-dark-soft">{hm(m.atMs)}</span>
                <span
                  className={[
                    "shrink-0 rounded px-1.5 py-0.5 font-semibold",
                    m.step === "긴급재난"
                      ? "bg-semantic-down text-white"
                      : "bg-surface-card text-ink dark:bg-white/10 dark:text-on-dark",
                  ].join(" ")}
                >
                  {m.type}
                </span>
                <span className="truncate text-body dark:text-on-dark-soft">{m.regions.join(", ")}</span>
              </div>
              <p className="mt-0.5 text-xs leading-snug text-ink dark:text-on-dark">{m.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
