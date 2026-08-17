"use client";
// 수집 커버리지 히트맵 — 칸 하나 = 하루, 색 = 그날 수집된 분. 배치·판정은 lib/coverage-heatmap.ts.
//
// ★★ 이 화면의 핵심은 **빈칸이 두 가지라는 것**이다. "운영 이전"과 "미수신"을 같은 회색으로
// 그리면 미수신이 활동 없음으로 읽힌다(이 레포가 반복해 고쳐 온 false-OK). 색만으로는 못 가르므로
// 미수신에 **빗금 무늬**를 준다 — 색각 이상·직사광선에서도 남는 구분이고, 범례·툴팁이 뒷받침한다.
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

/** 미수신 빗금 — 색이 아니라 무늬라 색각 이상·저대비 환경에서도 남는다. */
const MISSING_STRIPE =
  "repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 4px)";

function cellTitle(c: CoverageCell): string {
  if (c.state === "before") return `${c.date} · 운영 이전(수집 시작 전)`;
  if (c.state === "missing") return `${c.date} · 미수신 — 그날 수집된 데이터가 없다`;
  return `${c.date} · ${formatCoverage(c.minutes)} 수집`;
}

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

      {/* 53주는 좁은 화면에서 넘친다 — 페이지가 아니라 이 안에서 가로 스크롤한다. */}
      <div className="overflow-x-auto">
        <div className="inline-block min-w-max">
          <div className="flex gap-[3px] pl-6">
            {months.map((m, i) => (
              // 칸 폭(11px)에 맞춘 자리표시자 위에 라벨을 흘린다. nowrap 이 없으면 `8월` 이
              // 11px 안에서 두 줄로 접힌다(dev 실측). 옆 칸은 빈 문자열이라 넘쳐도 겹치지 않는다.
              <div
                key={i}
                className="w-[11px] shrink-0 overflow-visible whitespace-nowrap text-[10px] leading-4 text-zinc-500"
              >
                {m}
              </div>
            ))}
          </div>
          <div className="flex gap-[3px]">
            <div className="flex w-6 flex-col gap-[3px] pr-1 text-right">
              {WEEKDAY.map((d, i) => (
                <div key={i} className="h-[11px] text-[10px] leading-[11px] text-zinc-500">
                  {d}
                </div>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map((c, di) => {
                  if (!c) return <div key={di} className="h-[11px] w-[11px]" />;
                  if (c.state === "before") {
                    return (
                      <div
                        key={di}
                        title={cellTitle(c)}
                        className="h-[11px] w-[11px] rounded-[2px] bg-zinc-200/50 dark:bg-white/[0.04]"
                      />
                    );
                  }
                  if (c.state === "missing") {
                    return (
                      <div
                        key={di}
                        title={cellTitle(c)}
                        style={{ backgroundImage: MISSING_STRIPE }}
                        className="h-[11px] w-[11px] rounded-[2px] border border-dashed border-zinc-400/50 text-zinc-400/60 dark:border-white/20 dark:text-white/25"
                      />
                    );
                  }
                  return (
                    <div
                      key={di}
                      title={cellTitle(c)}
                      className={`h-[11px] w-[11px] rounded-[2px] ${LEVEL_CLASS[c.level]}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
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
        <strong>감시가 얼마나 됐는지</strong>를 나타낸다. 표시 전용이라 알림으로 올라가지 않는다.
      </p>
    </div>
  );
}
