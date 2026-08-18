"use client";
// 수집 커버리지 히트맵 — 칸 하나 = 하루, 색 = 그날 수집된 분. 배치·판정은 lib/coverage-heatmap.ts.
//
// ★★ 이 화면의 핵심은 **빈칸이 두 가지라는 것**이다. "운영 이전"과 "미수신"을 같은 회색으로
// 그리면 미수신이 활동 없음으로 읽힌다(이 레포가 반복해 고쳐 온 false-OK). 색만으로는 못 가르므로
// 미수신에 **빗금 무늬**를 준다 — 색각 이상·직사광선에서도 남는 구분이고, 범례·툴팁이 뒷받침한다.
import { useRef, useState, type MouseEvent } from "react";
import {
  buildCoverageCells,
  formatCoverage,
  monthLabels,
  summarizeCoverage,
  toWeekGrid,
  type CoverageCell,
} from "../../lib/coverage-heatmap";

/** 수집됨 5단계. 0 은 쓰지 않는다(수집된 칸은 반드시 1 이상). */
const LEVEL_CLASS: Record<number, string> = {
  1: "bg-cyan-500/20 dark:bg-cyan-400/20",
  2: "bg-cyan-500/40 dark:bg-cyan-400/35",
  3: "bg-cyan-500/60 dark:bg-cyan-400/55",
  4: "bg-cyan-500/80 dark:bg-cyan-400/75",
  5: "bg-cyan-600 dark:bg-cyan-400",
};

const WEEKDAY = ["월", "", "수", "", "금", "", ""];
/** 툴팁용 전체 요일. 격자가 월요일 시작이라 행 번호가 곧 요일이다(날짜 재파싱 불필요). */
const WEEKDAY_FULL = ["월", "화", "수", "목", "금", "토", "일"];

/** 미수신 빗금 — 색이 아니라 무늬라 색각 이상·저대비 환경에서도 남는다. */
const MISSING_STRIPE =
  "repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 4px)";

/**
 * 최소 폭 — 이 아래로는 가로 스크롤한다.
 * 요일열 24 + 간격 3 + (53주 × 최소 11) + (52 × 간격 3) = 766.
 * 이 폭을 넘으면 칸이 `1fr` 로 늘어 컨테이너를 꽉 채운다(우측 여백 없음).
 */
const MIN_GRID_W = 766;

function cellLabel(c: CoverageCell): string {
  if (c.state === "before") return "운영 이전(수집 시작 전)";
  if (c.state === "missing") return "미수신 — 그날 수집된 데이터가 없다";
  return `${formatCoverage(c.minutes)} 수집`;
}

type Hover = { cell: CoverageCell; day: number; x: number; y: number; wrapW: number };

export function CoverageHeatmap({
  points,
  firstDataDate,
  endDay,
  days,
}: {
  points: { date: string; value: number }[];
  firstDataDate: string | null;
  /** `YYYY-MM-DD` — 격자의 마지막 날(보통 오늘 KST). */
  endDay: string;
  days: number;
}) {
  const cells = buildCoverageCells(points, firstDataDate, endDay, days);
  const weeks = toWeekGrid(cells);
  const months = monthLabels(weeks);
  const s = summarizeCoverage(cells);

  const [hover, setHover] = useState<Hover | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  /** 칸의 화면 좌표를 래퍼 기준으로 환산한다 — 가로 스크롤 상태와 무관하게 맞는다. */
  const showTip = (e: MouseEvent<HTMLElement>, cell: CoverageCell, day: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = e.currentTarget.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    setHover({ cell, day, x: r.left - w.left + r.width / 2, y: r.top - w.top, wrapW: w.width });
  };

  /** 요일열 + 주 단위 열. `minmax(0,1fr)` 이라 월 라벨이 넘쳐도 열이 벌어지지 않는다. */
  const columns = `1.5rem repeat(${weeks.length}, minmax(0, 1fr))`;

  return (
    <div className="space-y-3">
      {/* 수치를 먼저 적는다 — 색만으로 읽게 두지 않는다. */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        <span>
          수집 <strong className="text-zinc-900 dark:text-zinc-100">{s.coveredDays}일</strong>
        </span>
        <span>
          미수신 <strong className="text-zinc-900 dark:text-zinc-100">{s.missingDays}일</strong>
        </span>
        <span>운영 이전 {s.beforeDays}일</span>
        <span>
          누적 {Math.round(s.totalMinutes / 60).toLocaleString()}시간
        </span>
        {/* 운영 기간이 0이면 `--`. 0% 로 적으면 "한 번도 못 받았다"로 읽힌다. */}
        <span>
          운영 기간 수집률{" "}
          <strong className="text-zinc-900 dark:text-zinc-100">
            {s.rate === null ? "--" : `${Math.round(s.rate * 100)}%`}
          </strong>
        </span>
      </div>

      {/* 툴팁 기준면. 스크롤러 바깥이라 툴팁이 잘리지 않는다. */}
      <div ref={wrapRef} className="relative">
        {/* 53주는 좁은 화면에서 넘친다 — 페이지가 아니라 이 안에서 가로 스크롤한다. */}
        <div className="overflow-x-auto" onScroll={() => setHover(null)}>
          <div style={{ minWidth: MIN_GRID_W }}>
            <div className="grid gap-[3px]" style={{ gridTemplateColumns: columns }}>
              <div />
              {months.map((m, i) => (
                // 열 폭보다 라벨이 넓다. 옆 칸은 빈 문자열이라 넘쳐도 겹치지 않고,
                // nowrap 이 없으면 `8월` 이 좁은 열에서 두 줄로 접힌다(dev 실측).
                <div
                  key={i}
                  className="whitespace-nowrap text-[10px] leading-4 text-zinc-500"
                >
                  {m}
                </div>
              ))}
            </div>
            {/* 열 방향으로 채운다 — 첫 열이 요일 라벨, 이후 한 열이 한 주다. */}
            <div
              className="grid gap-[3px]"
              style={{
                gridTemplateColumns: columns,
                gridTemplateRows: "repeat(7, auto)",
                gridAutoFlow: "column",
              }}
              onMouseLeave={() => setHover(null)}
            >
              {WEEKDAY.map((d, i) => (
                <div
                  key={i}
                  className="flex items-center justify-end pr-1 text-[10px] leading-none text-zinc-500"
                >
                  {d}
                </div>
              ))}
              {weeks.flatMap((week, wi) =>
                week.map((c, di) => {
                  const key = `${wi}-${di}`;
                  // 칸은 `aspect-square` — 열 폭이 곧 칸 크기라 컨테이너에 맞춰 커진다.
                  if (!c) return <div key={key} className="aspect-square" />;
                  if (c.state === "before") {
                    return (
                      <div
                        key={key}
                        aria-label={`${c.date} · ${cellLabel(c)}`}
                        onMouseEnter={(e) => showTip(e, c, di)}
                        className="aspect-square rounded-[2px] bg-zinc-200/50 dark:bg-white/[0.04]"
                      />
                    );
                  }
                  if (c.state === "missing") {
                    return (
                      <div
                        key={key}
                        aria-label={`${c.date} · ${cellLabel(c)}`}
                        onMouseEnter={(e) => showTip(e, c, di)}
                        style={{ backgroundImage: MISSING_STRIPE }}
                        className="aspect-square rounded-[2px] border border-dashed border-zinc-400/50 text-zinc-400/60 dark:border-white/20 dark:text-white/25"
                      />
                    );
                  }
                  return (
                    <div
                      key={key}
                      aria-label={`${c.date} · ${cellLabel(c)}`}
                      onMouseEnter={(e) => showTip(e, c, di)}
                      className={`aspect-square rounded-[2px] ${LEVEL_CLASS[c.level] ?? ""}`}
                    />
                  );
                }),
              )}
            </div>
          </div>
        </div>

        {hover && (
          // 좌우 끝에서는 래퍼 안으로 당긴다 — 안 그러면 패널 밖으로 잘린다.
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] leading-snug shadow-lg dark:border-white/10 dark:bg-zinc-900"
            style={{
              left: Math.min(Math.max(hover.x, 84), Math.max(hover.wrapW - 84, 84)),
              top: hover.y - 6,
            }}
          >
            <div className="whitespace-nowrap font-medium text-zinc-900 dark:text-zinc-100">
              {hover.cell.date} ({WEEKDAY_FULL[hover.day] ?? ""})
            </div>
            <div className="whitespace-nowrap text-zinc-600 dark:text-zinc-400">
              {cellLabel(hover.cell)}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-zinc-600 dark:text-zinc-400">
        <span className="flex items-center gap-1">
          <span className="h-[11px] w-[11px] rounded-[2px] bg-zinc-200/50 dark:bg-white/[0.04]" />
          운영 이전
        </span>
        <span className="flex items-center gap-1">
          <span
            style={{ backgroundImage: MISSING_STRIPE }}
            className="h-[11px] w-[11px] rounded-[2px] border border-dashed border-zinc-400/50 text-zinc-400/60 dark:border-white/20 dark:text-white/25"
          />
          미수신
        </span>
        <span className="flex items-center gap-1">
          적음
          {[1, 2, 3, 4, 5].map((l) => (
            <span key={l} className={`h-[11px] w-[11px] rounded-[2px] ${LEVEL_CLASS[l]}`} />
          ))}
          많음
        </span>
        <span className="text-zinc-500">단계 = 1시간 · 4시간 · 8시간(교대 1회) · 12시간 기준</span>
      </div>

      <p className="text-[11px] text-zinc-500">
        칸 하나가 하루이고 색은 <strong>그날 수집된 시간</strong>이다 — 작업자의 상태가 아니라{" "}
        <strong>감시가 얼마나 됐는지</strong>를 나타낸다. 칸에 마우스를 올리면 그날의 값이 뜬다.
        표시 전용이라 알림으로 올라가지 않는다.
      </p>
    </div>
  );
}
