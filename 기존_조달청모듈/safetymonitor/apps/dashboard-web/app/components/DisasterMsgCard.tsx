// 긴급재난문자 카드 — 작업자 GPS 평균 좌표(시·도)에 발령된 재난문자를 표시.
// 데이터·판정은 서버(/api/disaster-msg)가 수행. 여기서는 표시만 한다.
"use client";

import { useEffect, useState } from "react";

type MsgView = {
  sn: number;
  type: string;
  step: "긴급재난" | "안전안내";
  atMs: number;
  regions: string[];
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
}: {
  lat?: number;
  lon?: number;
  onSourceChange?: (source: "live" | "mock" | null) => void;
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
  }, [lat, lon, onSourceChange]);

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

  return (
    <div className="no-scrollbar flex h-full flex-col gap-2 overflow-y-auto px-3 pb-3 pt-1.5">
      <div className="flex items-center gap-1.5">
        <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[data.severity]}`} />
        <span className="text-xs font-semibold text-ink dark:text-on-dark">{data.summary}</span>
        <span className="text-[10px] text-muted dark:text-on-dark-soft">{data.sido}</span>
        {data.nearby.length > 0 && (
          <span className="ml-auto shrink-0 rounded-pill bg-surface-strong px-2 py-0.5 text-[10px] font-semibold text-body dark:bg-white/10 dark:text-on-dark-soft">
            인근 {data.nearby.length}건 참고
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
                m.step === "긴급재난"
                  ? "bg-semantic-down/5 dark:bg-semantic-down/10"
                  : "bg-canvas dark:bg-surface-dark",
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
