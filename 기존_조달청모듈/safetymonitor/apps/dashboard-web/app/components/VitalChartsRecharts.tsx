// Recharts 기반 생체 추세 차트 — 기존 수작업 SVG(LineChart/BarChart)의 드롭인 대체(A/B 비교용)
"use client";

import {
  Area,
  Bar,
  BarChart as ReBarChart,
  Cell,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatTimeTick, hasFullTimestamps, withTimeGaps } from "../../lib/chart-gaps";
import type { Status } from "../../lib/severity";

type ChartPoint = { date: string; label?: string; value: number; tsMs?: number };
type ReferenceLineSpec = { value: number; label: string; color?: string };

type Props = {
  points: ChartPoint[];
  color: string;
  unit: string;
  decimals: number;
  referenceLines?: ReferenceLineSpec[];
  pointSeverity?: (value: number) => Status;
  hoverExtra?: (value: number) => string;
  /** 조회 창 [from, to] (epoch ms). 주면 시간축을 쓰고, 없으면 카테고리 축으로 떨어진다. */
  domain?: [number, number];
};

// 시간축을 쓸 수 있는 조건 — 창이 주어졌고 모든 점에 측정 시각이 있을 때.
// 모의 경로(낙상)는 tsMs 가 없어 여기서 자동으로 카테고리 축으로 떨어진다.
function timeAxisProps(points: ChartPoint[], domain: [number, number] | undefined) {
  if (!domain || !hasFullTimestamps(points)) return null;
  const spanMs = domain[1] - domain[0];
  return {
    data: withTimeGaps(points),
    axis: {
      dataKey: "tsMs" as const,
      type: "number" as const,
      domain,
      scale: "time" as const,
      tickFormatter: (v: number) => formatTimeTick(v, spanMs),
    },
  };
}

// 이상치(주의/위험)만 강조색, 그 외는 메트릭 기본색.
function sevColor(sev: Status | undefined, fallback: string): string {
  if (sev === "danger") return "#ef4444";
  if (sev === "caution") return "#f59e0b";
  return fallback;
}

// 임계선 값까지 포함해 Y축 범위를 잡고 위아래 15% 여유를 둔다(기존 useChartScale 정합).
function yDomain(points: ChartPoint[], decimals: number, extra: number[]): [number, number] {
  if (points.length === 0) return [0, 1];
  const values = [...points.map((p) => p.value), ...extra.filter((v) => Number.isFinite(v))];
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = Math.max(rawMax - rawMin, decimals === 0 ? 4 : 0.4);
  return [rawMin - span * 0.15, rawMax + span * 0.15];
}

function xTickLabel(p: ChartPoint): string {
  return p.label ?? p.date.slice(5);
}

// 호버 툴팁 — 라벨 / 값+단위 / 보조값(추정 체온) 한 줄.
function ChartTooltip({
  active,
  payload,
  color,
  unit,
  decimals,
  hoverExtra,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
  color: string;
  unit: string;
  decimals: number;
  hoverExtra?: (value: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const extra = hoverExtra ? hoverExtra(p.value) : null;
  return (
    <div className="rounded-md bg-slate-900/95 px-2.5 py-1.5 text-xs shadow-lg">
      <div className="text-slate-300">{p.label ?? p.date}</div>
      <div className="font-semibold" style={{ color }}>
        {p.value.toFixed(decimals)} {unit}
      </div>
      {extra && <div className="font-semibold text-amber-300">{extra}</div>}
    </div>
  );
}

// 공통 축/격자/임계선 렌더 조각.
const AXIS_TICK = { fontSize: 10, fill: "currentColor" as const };

function renderReferenceLines(refs: ReferenceLineSpec[]) {
  return refs.map((rl, i) => (
    <ReferenceLine
      key={`ref-${i}`}
      y={rl.value}
      stroke={rl.color ?? "#ef4444"}
      strokeDasharray="5 3"
      strokeWidth={1.2}
      ifOverflow="extendDomain"
      label={{
        value: rl.label,
        position: "insideTopRight",
        fontSize: 10,
        fontWeight: 600,
        fill: rl.color ?? "#ef4444",
      }}
    />
  ));
}

export function RechartsLineChart({
  points,
  color,
  unit,
  decimals,
  referenceLines,
  pointSeverity,
  hoverExtra,
  domain,
}: Props) {
  const refs = referenceLines ?? [];
  if (points.length === 0) {
    return <p className="text-xs text-zinc-400">데이터 없음</p>;
  }
  const yDom = yDomain(points, decimals, refs.map((r) => r.value));
  const gid = `rc-line-${color.replace(/[^a-z0-9]/gi, "")}`;
  const dense = points.length > 30;
  // 시간축이 가능하면 결측을 끊은 데이터로 그린다(withTimeGaps + connectNulls={false}).
  const t = timeAxisProps(points, domain);

  return (
    <div className="h-[220px] w-full text-zinc-500 dark:text-zinc-400">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={t ? t.data : points} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            {...(t ? t.axis : { dataKey: xTickLabel })}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "currentColor", strokeOpacity: 0.25 }}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            domain={yDom}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v: number) => v.toFixed(decimals)}
          />
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: color, strokeOpacity: 0.4, strokeDasharray: "3 3" }}
            content={
              <ChartTooltip color={color} unit={unit} decimals={decimals} hoverExtra={hoverExtra} />
            }
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2.6}
            fill={`url(#${gid})`}
            isAnimationActive={false}
            // 결측 자리에 끼운 null 점에서 선을 끊는다 — 이 값이 true 면 공백을 가로지르는
            // 직선이 그려져 시간축으로 바꾼 의미가 사라진다.
            connectNulls={false}
            dot={(dotProps: {
              cx?: number;
              cy?: number;
              index?: number;
              payload?: { value: number | null };
            }) => {
              const { cx, cy, index, payload } = dotProps;
              // payload.value 가 null 인 자리는 '데이터 없음' 표식이라 점을 찍지 않는다.
              if (cx == null || cy == null || !payload || payload.value == null) {
                return <g key={`dot-empty-${index ?? 0}`} />;
              }
              const sev = pointSeverity?.(payload.value);
              const abn = sev === "danger" || sev === "caution";
              const fill = sevColor(sev, color);
              const r = dense ? (abn ? 3.4 : 2) : abn ? 4.2 : 3.4;
              return (
                <circle
                  key={`dot-${index ?? 0}`}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={fill}
                  stroke="#ffffff"
                  strokeOpacity={abn ? 0.95 : 0.65}
                  strokeWidth={abn ? 1.5 : 1}
                />
              );
            }}
            activeDot={{ r: 5, stroke: "#ffffff", strokeWidth: 1.5 }}
          />
          {renderReferenceLines(refs)}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RechartsBarChart({
  points,
  color,
  unit,
  decimals,
  referenceLines,
  pointSeverity,
  hoverExtra,
}: Props) {
  const refs = referenceLines ?? [];
  if (points.length === 0) {
    return <p className="text-xs text-zinc-400">데이터 없음</p>;
  }
  const domain = yDomain(points, decimals, refs.map((r) => r.value));

  return (
    <div className="h-[220px] w-full text-zinc-500 dark:text-zinc-400">
      <ResponsiveContainer width="100%" height="100%">
        <ReBarChart data={points} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
          <XAxis
            dataKey={xTickLabel}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "currentColor", strokeOpacity: 0.25 }}
            interval="preserveStartEnd"
            minTickGap={20}
          />
          <YAxis
            domain={domain}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v: number) => v.toFixed(decimals)}
          />
          <Tooltip
            isAnimationActive={false}
            cursor={{ fill: color, fillOpacity: 0.08 }}
            content={
              <ChartTooltip color={color} unit={unit} decimals={decimals} hoverExtra={hoverExtra} />
            }
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={28}>
            {points.map((p, i) => (
              <Cell key={`cell-${i}`} fill={sevColor(pointSeverity?.(p.value), color)} />
            ))}
          </Bar>
          {renderReferenceLines(refs)}
        </ReBarChart>
      </ResponsiveContainer>
    </div>
  );
}

// 시간축 점 차트 — 기회 측정(SpO₂ 등)의 24시간 뷰 전용. 점을 균등 간격이 아니라
// **실제 측정 시각 위치**에 찍는다(2026-08-12 사용자 요청). 측정 없는 시간대는 빈 공간으로
// 남는 것이 정직한 표현이다(균등 간격은 세 측정이 하루에 고르게 있었던 것처럼 오독된다).
type TimeChartPoint = ChartPoint & { tsMs: number };

function kstHm(ms: number): string {
  const k = new Date(ms + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

export function RechartsTimeDotChart({
  points,
  color,
  unit,
  decimals,
  referenceLines,
  pointSeverity,
  hoverExtra,
  domain,
}: Props & { points: TimeChartPoint[]; domain: [number, number] }) {
  const refs = referenceLines ?? [];
  if (points.length === 0) {
    return <p className="text-xs text-zinc-400">데이터 없음</p>;
  }
  const yd = yDomain(points, decimals, refs.map((r) => r.value));
  // 시간축 눈금 — 도메인을 6등분(24시간 뷰면 4시간 간격).
  const ticks = Array.from({ length: 7 }, (_, i) =>
    Math.round(domain[0] + ((domain[1] - domain[0]) * i) / 6),
  );

  return (
    <div className="h-[220px] w-full text-zinc-500 dark:text-zinc-400">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
          <XAxis
            dataKey="tsMs"
            type="number"
            domain={domain}
            ticks={ticks}
            tickFormatter={(v: number) => kstHm(v)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "currentColor", strokeOpacity: 0.25 }}
          />
          <YAxis
            domain={yd}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v: number) => v.toFixed(decimals)}
          />
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: color, strokeOpacity: 0.4, strokeDasharray: "3 3" }}
            content={
              <ChartTooltip color={color} unit={unit} decimals={decimals} hoverExtra={hoverExtra} />
            }
          />
          <Scatter
            dataKey="value"
            isAnimationActive={false}
            shape={(sp: { cx?: number; cy?: number; payload?: TimeChartPoint }) => {
              const { cx, cy, payload } = sp;
              if (cx == null || cy == null || !payload) return <g />;
              const sev = pointSeverity?.(payload.value);
              const abn = sev === "danger" || sev === "caution";
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={abn ? 6 : 5}
                  fill={sevColor(sev, color)}
                  stroke="#ffffff"
                  strokeOpacity={abn ? 0.95 : 0.7}
                  strokeWidth={1.5}
                />
              );
            }}
          />
          {renderReferenceLines(refs)}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
