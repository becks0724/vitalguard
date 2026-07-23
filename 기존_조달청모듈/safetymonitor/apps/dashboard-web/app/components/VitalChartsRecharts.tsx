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
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { Status } from "../../lib/severity";

type ChartPoint = { date: string; label?: string; value: number };
type ReferenceLineSpec = { value: number; label: string; color?: string };

type Props = {
  points: ChartPoint[];
  color: string;
  unit: string;
  decimals: number;
  referenceLines?: ReferenceLineSpec[];
  pointSeverity?: (value: number) => Status;
  hoverExtra?: (value: number) => string;
};

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
}: Props) {
  const refs = referenceLines ?? [];
  if (points.length === 0) {
    return <p className="text-xs text-zinc-400">데이터 없음</p>;
  }
  const domain = yDomain(points, decimals, refs.map((r) => r.value));
  const gid = `rc-line-${color.replace(/[^a-z0-9]/gi, "")}`;
  const dense = points.length > 30;

  return (
    <div className="h-[220px] w-full text-zinc-500 dark:text-zinc-400">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey={xTickLabel}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "currentColor", strokeOpacity: 0.25 }}
            interval="preserveStartEnd"
            minTickGap={28}
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
            dot={(dotProps: { cx?: number; cy?: number; index?: number; payload?: ChartPoint }) => {
              const { cx, cy, index, payload } = dotProps;
              if (cx == null || cy == null || !payload) {
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
