// 현장 통합 안전 신호등 — 현장기상·작업자·가스 감지기·AED 4개 카테고리 severity 를 한 보드에 표출.
// 각 행은 2줄(요약 + 핵심 영향/골든타임)이며 클릭 시 상세 안내 팝업을 연다.
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { aedDetail, gasDetail, type LampDetail } from "./SiteSafetyTables";
import { getSessionToken } from "./LoginGate";

function formatTodayBoardDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][now.getDay()];
  return `${y}.${m}.${d} (${weekday})`;
}

// 통합 안전 신호등 카테고리 아이콘 — 이모지 대체 모노톤 라인 SVG(관제 BIZ 톤). currentColor 상속, 의존성 0.
// weather=cloud-sun · worker=hard-hat(안전모) · gas=wind(가스 확산) · aed=heart-pulse(AED).
function BoardIcon({ name, className = "h-[18px] w-[18px]" }: { name: string; className?: string }) {
  const paths: Record<string, ReactNode> = {
    weather: (
      <>
        <path d="M12 2v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="M20 12h2" />
        <path d="m19.07 4.93-1.41 1.41" />
        <path d="M15.947 12.65a4 4 0 0 0-5.925-4.128" />
        <path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" />
      </>
    ),
    worker: (
      <>
        <path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1z" />
        <path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5" />
        <path d="M4 15v-3a6 6 0 0 1 6-6" />
        <path d="M14 6a6 6 0 0 1 6 6v3" />
      </>
    ),
    gas: (
      <>
        <path d="M12.8 19.6A2 2 0 1 0 14 16H2" />
        <path d="M17.5 8a2.5 2.5 0 1 1 2 4H2" />
        <path d="M9.8 4.4A2 2 0 1 1 11 8H2" />
      </>
    ),
    aed: (
      <>
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.49 4.04 3 5.5l7 7Z" />
        <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[name] ?? null}
    </svg>
  );
}

// 4상태 램프: 위험 > 주의 > 정상 > 대기(데이터 없음).
type LampSev = "danger" | "caution" | "normal" | "idle";

export type WorkerSignal = { sev: LampSev; summary: string; short: string; detail: LampDetail };

type KmaWarning = {
  severity: "normal" | "caution" | "danger";
  sido: string;
  summary: string;
  source: "live" | "mock";
};

const STYLE: Record<LampSev, { dot: string; text: string; blink: string; label: string }> = {
  danger: { dot: "bg-semantic-down", text: "text-semantic-down", blink: "vital-blink-danger", label: "위험" },
  caution: { dot: "bg-amber-400", text: "text-amber-600 dark:text-amber-300", blink: "vital-blink-caution", label: "주의" },
  normal: { dot: "bg-semantic-up", text: "text-semantic-up", blink: "", label: "정상" },
  idle: { dot: "bg-muted/40 dark:bg-white/15", text: "text-muted dark:text-on-dark-soft/60", blink: "", label: "대기" },
};

const RANK: Record<LampSev, number> = { idle: 0, normal: 1, caution: 2, danger: 3 };

function worst(sevs: LampSev[]): LampSev {
  return sevs.reduce<LampSev>((a, s) => (RANK[s] > RANK[a] ? s : a), "idle");
}

// 특보 종류별 작업자 영향 · KOSHA 작업중지 기준(참고).
function weatherGuidance(summary: string): { short: string; effect: string; action: string } {
  if (summary.includes("강풍") || summary.includes("태풍")) {
    return {
      short: "고소·크레인 작업 위험 — 풍속 확인",
      effect: "비계·고소작업·타워크레인·자재 비산 위험. 추락·전도 사고 증가.",
      action: "순간풍속 10m/s↑ 타워크레인 작업 중지, 15m/s↑ 외부작업 전면 중지 (KOSHA 참고).",
    };
  }
  if (summary.includes("폭염")) {
    return {
      short: "열사병 위험 — 그늘·휴식·수분",
      effect: "고온 노출로 열사병·열탈진 위험. 체온 상승·의식저하.",
      action: "체감 31/33/35℃ 단계별 휴식. 증상 시 즉시 냉각 후 119 (열사병 골든타임 약 30분).",
    };
  }
  if (summary.includes("호우") || summary.includes("대설")) {
    return {
      short: "감전·붕괴·미끄럼 위험",
      effect: "침수·감전·토사 붕괴·미끄럼 추락 위험.",
      action: "굴착·전기작업 중지, 배수·낙하물 점검, 저지대 대피.",
    };
  }
  if (summary.includes("한파")) {
    return {
      short: "저체온·동상 위험 — 보온·휴식",
      effect: "저체온증·동상, 결빙 미끄럼 위험.",
      action: "체감 -12/-15/-18℃ 단계별 휴식·보온, 결빙 구간 통제.",
    };
  }
  return { short: "발효 특보 — 현장 영향 점검", effect: "발효 특보에 따른 현장 위험 점검 필요.", action: "특보 종류별 작업 안전 조치 시행." };
}

type LampRow = { icon: string; label: string; sev: LampSev; summary: string; short: string; detail: LampDetail };

export function SafetySignalBoard({
  lat,
  lon,
  worker,
}: {
  lat?: number;
  lon?: number;
  worker: WorkerSignal;
}) {
  const [weather, setWeather] = useState<KmaWarning | null>(null);
  const [openRow, setOpenRow] = useState<LampRow | null>(null);

  useEffect(() => {
    if (typeof lat !== "number" || typeof lon !== "number") {
      setWeather(null);
      return;
    }
    let alive = true;
    const load = () =>
      // 토큰 동봉 — 서버가 세션·크론키가 있을 때만 특보 알림을 발사한다(감사 DLT-FE-2 전수 재조사).
      fetch(`/api/kma-warning?lat=${lat}&lon=${lon}`, {
        headers: (() => {
          const t = getSessionToken();
          return t ? { Authorization: `Bearer ${t}` } : undefined;
        })(),
      })
        .then((r) => r.json())
        .then((j: KmaWarning) => {
          if (alive) setWeather(j);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 10 * 60 * 1000); // 특보 갱신 주기
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [lat, lon]);

  const hasCoords = typeof lat === "number" && typeof lon === "number";
  // /api/kma-warning JSON 은 런타임 검증 없이 단언만 하므로, severity 가 STYLE 키에 없으면 "idle" 로 폴백.
  const weatherSev: LampSev = !hasCoords ? "idle" : weather && weather.severity in STYLE ? weather.severity : "idle";
  const wg = weather ? weatherGuidance(weather.summary) : null;
  const weatherRow: LampRow = {
    icon: "weather",
    label: "현장 기상",
    sev: weatherSev,
    summary: !hasCoords ? "현장 GPS 대기" : weather ? `${weather.summary}${weather.sido ? ` · ${weather.sido}` : ""}` : "특보 조회 중…",
    short: !hasCoords ? "작업자 GPS 수신 시 자동 평가" : wg ? wg.short : "특보 조회 중…",
    detail: {
      title: !hasCoords ? "현장 기상 — GPS 대기" : `현장 기상 ${STYLE[weatherSev].label} — ${weather?.summary ?? ""}`,
      location: hasCoords && weather?.sido ? `${weather.sido} (현장 GPS)` : "현장 GPS 미수신",
      lines: !hasCoords
        ? [{ label: "안내", text: "등록 작업자의 GPS 좌표 수신 시 기상청 특보로 자동 평가됩니다." }]
        : wg
          ? [
              { label: "발효 특보", text: weather?.summary ?? "-" },
              { label: "작업자 영향", text: wg.effect },
              { label: "권장 대응", text: wg.action },
            ]
          : [{ label: "안내", text: "특보 조회 중" }],
      note: hasCoords ? "기상청 특보 기준 · 작업중지 수치는 KOSHA 참고값" : undefined,
    },
  };

  const workerRow: LampRow = {
    icon: "worker",
    label: "작업자",
    sev: worker.sev,
    summary: worker.summary,
    short: worker.short,
    detail: worker.detail,
  };

  // 가스/AED 상세는 AED 점검 모듈 캐시(60초 폴링)·시간 기반 D-day 에 의존 — 빈 deps 메모이즈는 마운트 시점 값으로 동결.
  // 점검 폴링 주기와 동형의 60초 tick 을 deps 에 넣어 배터리 위험 전이·D-day·NFC 점검 복구가 램프에 반영되게 한다.
  const [lampTick, setLampTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setLampTick((t) => t + 1), 60000); // AED 점검 폴링(60초)과 동형
    return () => clearInterval(id);
  }, []);

  const gas = useMemo(() => gasDetail(), [lampTick]);
  const gasRow: LampRow = { icon: "gas", label: "가스 감지", sev: gas.sev, summary: gas.summary, short: gas.short, detail: gas.detail };

  const aed = useMemo(() => aedDetail(), [lampTick]);
  const aedRow: LampRow = { icon: "aed", label: "AED", sev: aed.sev, summary: aed.summary, short: aed.short, detail: aed.detail };

  const rows: LampRow[] = [weatherRow, workerRow, gasRow, aedRow];
  const overall = worst(rows.map((r) => r.sev));
  const o = STYLE[overall];

  return (
    <div className="flex h-full flex-col rounded-xl border border-hairline bg-surface-soft px-3 py-2 dark:border-white/10 dark:bg-surface-dark-elevated">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-body dark:text-on-dark-soft">
          현장 통합 안전 신호등 — {formatTodayBoardDate()}
        </span>
        <span className="flex items-center gap-1">
          <span className="text-[10px] text-muted dark:text-on-dark-soft">종합</span>
          <span className={`inline-block h-2 w-2 rounded-full ring-1 ring-hairline dark:ring-white/20 ${o.dot} ${o.blink}`} />
          <span className={`text-[10px] font-semibold ${o.text}`}>{o.label}</span>
        </span>
      </div>
      <div className="flex flex-1 flex-col justify-between gap-1">
        {rows.map((r) => {
          const s = STYLE[r.sev];
          return (
            <button
              key={r.label}
              type="button"
              onClick={() => setOpenRow(r)}
              title={`${r.summary} · ${r.short} — 클릭 시 상세`}
              className="flex w-full items-center gap-2 rounded-lg bg-canvas px-2 py-1.5 text-left transition hover:ring-1 hover:ring-ink/15 dark:bg-surface-dark"
            >
              <BoardIcon name={r.icon} className="h-[18px] w-[18px] shrink-0 text-body dark:text-on-dark-soft" />
              <span className="w-14 shrink-0 text-[11px] font-semibold text-ink dark:text-on-dark">{r.label}</span>
              <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-hairline dark:ring-white/20 ${s.dot} ${s.blink}`} />
              <span className={`shrink-0 text-[11px] font-semibold ${s.text}`}>{s.label}</span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-body dark:text-on-dark-soft">
                {r.summary} · {r.short}
              </span>
            </button>
          );
        })}
      </div>

      {openRow &&
        typeof document !== "undefined" &&
        createPortal(<SignalDetailModal row={openRow} onClose={() => setOpenRow(null)} />, document.body)}
    </div>
  );
}

// 상세 안내 팝업 — 영향/기준/골든타임/위치. ESC·배경 클릭 닫기.
function SignalDetailModal({ row, onClose }: { row: LampRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const s = STYLE[row.sev];
  const accent =
    row.sev === "danger"
      ? "border-semantic-down"
      : row.sev === "caution"
        ? "border-amber-400"
        : row.sev === "normal"
          ? "border-semantic-up"
          : "border-hairline dark:border-white/15";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true">
      {/* 낮은 화면에서 하단 내용이 잘려 도달 불가였다 — 바깥 p-4(상하 2rem)를 뺀 높이로 상한 + 스크롤. */}
      <div
        className={`max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border-2 ${accent} bg-canvas dark:bg-surface-dark`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3" style={{ background: "color-mix(in srgb, currentColor 10%, transparent)" }}>
          <BoardIcon name={row.icon} className="h-5 w-5 shrink-0 text-body dark:text-on-dark-soft" />
          <span className={`inline-block h-3 w-3 shrink-0 rounded-full ${s.dot} ${s.blink}`} />
          <span className={`text-sm font-bold ${s.text}`}>{row.detail.title}</span>
        </div>
        <div className="space-y-2 px-5 py-4 text-sm text-ink dark:text-on-dark">
          {row.detail.lines.map((ln, i) => (
            <div key={i} className="grid grid-cols-[5.5rem_1fr] items-start gap-2">
              {/* 괄호 부속어((골든타임)/(추정))는 좁은 라벨 컬럼에서 단어 중간 깨짐 방지 위해 다음 줄로 */}
              <span className="whitespace-pre-line text-xs font-semibold leading-snug text-muted dark:text-on-dark-soft">
                {ln.label.replace("(", "\n(")}
              </span>
              <span className="text-xs leading-relaxed">{ln.text}</span>
            </div>
          ))}
          <div className="grid grid-cols-[5.5rem_1fr] gap-2 border-t border-hairline pt-2 dark:border-white/10">
            <span className="text-xs font-semibold text-muted dark:text-on-dark-soft">위치</span>
            <span className="text-xs leading-relaxed">{row.detail.location}</span>
          </div>
          {row.detail.note && <p className="pt-1 text-[10px] text-muted dark:text-on-dark-soft">※ {row.detail.note}</p>}
        </div>
        <div className="flex justify-end border-t border-hairline px-5 py-3 dark:border-white/10">
          <button type="button" onClick={onClose} className="rounded-lg bg-surface-strong px-4 py-1.5 text-sm font-semibold text-body hover:opacity-90 dark:bg-white/10 dark:text-on-dark">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
