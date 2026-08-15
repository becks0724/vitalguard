// Recharts 기반 생체 추세 차트 — 기존 수작업 SVG(LineChart/BarChart)의 드롭인 대체(A/B 비교용)
"use client";

import {
  Area,
  Bar,
  BarChart as ReBarChart,
  Cell,
  ComposedChart,
  Customized,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatTimeTick, hasFullTimestamps, withTimeGaps, type TimedPoint } from "../../lib/chart-gaps";
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
// 선·막대가 공유한다 — 한쪽만 시간축이면 라인↔막대 토글에서 같은 데이터가 다른 간격으로 보인다.
function timeAxis(points: ChartPoint[], domain: [number, number] | undefined) {
  if (!domain || !hasFullTimestamps(points)) return null;
  const spanMs = domain[1] - domain[0];
  return {
    dataKey: "tsMs" as const,
    type: "number" as const,
    domain,
    scale: "time" as const,
    tickFormatter: (v: number) => formatTimeTick(v, spanMs),
  };
}

// 선 차트용 — 축에 더해 **결측 끊기**(공백에 null 점 삽입)까지 얹는다.
// ⚠ 막대는 이걸 쓰지 않는다. 없는 버킷은 빈 공간으로 이미 정직하고,
//    null 점을 넣으면 그리지도 않을 막대가 데이터에 섞여 폭 자동계산만 흐트러진다.
function timeAxisProps(points: ChartPoint[], domain: [number, number] | undefined) {
  const axis = timeAxis(points, domain);
  // ⚠ 중복처럼 보이지만 지우지 말 것 — `hasFullTimestamps` 는 타입 가드라 `timeAxis` 안에서
  //    좁힌 타입이 여기로 전파되지 않는다(tsc 가 잡는다). `withTimeGaps` 는 TimedPoint[] 를 받는다.
  if (!axis || !hasFullTimestamps(points)) return null;
  return { data: withTimeGaps(points), axis };
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
  domain: timeDomain,
}: Props) {
  const refs = referenceLines ?? [];
  if (points.length === 0) {
    return <p className="text-xs text-zinc-400">데이터 없음</p>;
  }
  const domain = yDomain(points, decimals, refs.map((r) => r.value));
  // ★ 막대도 시간축을 쓴다(2026-08-14). 종전엔 카테고리 축이라 SpO₂ 1주일·`막대` 토글에서
  //   16시간 공백이 2시간 간격과 같은 폭으로 그려졌고, 같은 데이터가 라인↔막대 토글에서
  //   다른 간격으로 보였다. 선 차트는 08-13 에 고쳤는데 막대만 남아 있었다.
  // ★ `<Bar>` 는 시간축에서 정상 렌더된다 — SSR 실측(recharts 2.15.4) x=[60,73,85,199,211,590]
  //   로 실제 시간 간격을 반영하고, 폭도 maxBarSize 안에서 점 수에 따라 자동(3점 28px → 400점 1px).
  //   활동 복합 차트가 `Customized` 로 직접 rect 를 그리는 것은 **시리즈별 `data`**(<Bar data=…>)
  //   조합에서만 좌표 계산이 깨지기 때문이고, 여기는 차트 레벨 data 라 그 함정에 해당하지 않는다.
  const tAxis = timeAxis(points, timeDomain);

  return (
    <div className="h-[220px] w-full text-zinc-500 dark:text-zinc-400">
      <ResponsiveContainer width="100%" height="100%">
        <ReBarChart data={points} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
          <XAxis
            {...(tAxis ?? { dataKey: xTickLabel })}
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

// 활동(부하)+심박(반응) 복합 차트 — 작업 강도 판독용(2026-08-13 사용자 승인).
// 활동 = 왼쪽 축 막대(kcal 구간 합·실측), 심박 = 오른쪽 축 선(bpm 버킷 평균·실측).
// "막대는 낮은데 선이 높은 구간" = 저활동·고심박(온열 전조)이 육안으로 잡히는 것이 목적.
// 두 시리즈 모두 시간축(tsMs) 필수 — 한쪽만 카테고리로 떨어지면 시간이 어긋나 바로 오독이다.
export function RechartsActivityComboChart({
  activity,
  heartRate,
  domain,
}: {
  activity: TimedPoint[];
  /** ≤7일 뷰에서만 전달 — 장기 뷰의 심박 일평균은 착용 시간의 함수라 오버레이하지 않는다. */
  heartRate?: TimedPoint[] | null;
  domain: [number, number];
}) {
  if (activity.length === 0) {
    return <p className="text-xs text-zinc-400">데이터 없음</p>;
  }
  const spanMs = domain[1] - domain[0];
  const ACT_COLOR = "#fb923c";
  const HR_COLOR = "#f87171";
  // 심박 선만 결측을 끊는다 — 막대는 없는 버킷 자체가 빈 공간이라 이미 정직하다.
  const hrData = heartRate && heartRate.length > 0 ? withTimeGaps(heartRate) : null;
  const actMax = Math.max(...activity.map((p) => p.value));
  // ★ 시간축(type=number) 위의 Bar 는 recharts 가 밴드 폭을 계산하지 못해 명시하지 않으면
  //   0px 로 그려진다(라이브 실측 2026-08-13 — 막대가 통째로 안 보였다). 점 수로 폭을 잡는다.
  const barSize = activity.length > 200 ? 2 : activity.length > 90 ? 3 : activity.length > 40 ? 6 : 12;

  return (
    <div className="h-[220px] w-full text-zinc-500 dark:text-zinc-400">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart margin={{ top: 12, right: 4, bottom: 4, left: 0 }}>
          <XAxis
            dataKey="tsMs"
            type="number"
            domain={domain}
            scale="time"
            tickFormatter={(v: number) => formatTimeTick(v, spanMs)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "currentColor", strokeOpacity: 0.25 }}
            interval="preserveStartEnd"
            minTickGap={28}
            allowDuplicatedCategory={false}
          />
          {/* 단위는 축 라벨 대신 범례에 싣는다 — insideTop 계열 라벨이 첫 눈금 숫자와 겹쳤다(라이브 실측). */}
          <YAxis
            yAxisId="act"
            domain={[0, Math.max(actMax * 1.2, 0.5)]}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v: number) => v.toFixed(actMax < 5 ? 1 : 0)}
          />
          {hrData && (
            <YAxis
              yAxisId="hr"
              orientation="right"
              domain={["dataMin - 10", "dataMax + 10"]}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={36}
              tickFormatter={(v: number) => String(Math.round(v))}
            />
          )}
          <Tooltip
            isAnimationActive={false}
            labelFormatter={(v) => formatTimeTick(Number(v), spanMs)}
            formatter={(value, name) => [
              typeof value === "number"
                ? (String(name).startsWith("활동") ? `${value.toFixed(2)} kcal` : `${Math.round(value)} bpm`)
                : "—",
              String(name),
            ]}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {/* ★ 시간축(type=number) + 시리즈별 data 조합에서 recharts <Bar> 는 도형 좌표를 만들지
              못한다(빈 <g> — barSize·custom shape 로도 불가, 2026-08-13 dev 실측 2회).
              그래서 역할을 나눈다 — <Bar> 는 범례·툴팁 항목 담당(도형은 안 그려짐),
              시각은 아래 <Customized> 가 x·y 스케일에서 직접 rect 를 그린다(공식 탈출구). */}
          <Bar
            yAxisId="act"
            name="활동 (kcal)"
            data={activity}
            dataKey="value"
            fill={ACT_COLOR}
            isAnimationActive={false}
          />
          <Customized
            component={(props: unknown) => {
              const { xAxisMap, yAxisMap } = props as {
                xAxisMap?: Record<string, { scale: (v: number) => number }>;
                yAxisMap?: Record<string, { scale: (v: number) => number }>;
              };
              const xScale = xAxisMap ? Object.values(xAxisMap)[0]?.scale : undefined;
              const yScale = yAxisMap?.["act"]?.scale;
              if (!xScale || !yScale) return <g />;
              const y0 = yScale(0);
              return (
                <g>
                  {activity.map((p, i) => {
                    const xx = xScale(p.tsMs);
                    const yy = yScale(p.value);
                    if (!Number.isFinite(xx) || !Number.isFinite(yy) || !Number.isFinite(y0)) return null;
                    const h = y0 - yy;
                    if (h <= 0) return null;
                    return (
                      <rect
                        key={`act-${i}`}
                        x={xx - barSize / 2}
                        y={yy}
                        width={barSize}
                        height={h}
                        rx={1}
                        fill={ACT_COLOR}
                        fillOpacity={0.85}
                      />
                    );
                  })}
                </g>
              );
            }}
          />
          {hrData && (
            <Line
              yAxisId="hr"
              name="심박 (bpm)"
              data={hrData}
              dataKey="value"
              stroke={HR_COLOR}
              strokeWidth={1.8}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// 시간축 점 차트 — 기회 측정(SpO₂ 등)의 24시간 뷰 전용. 점을 균등 간격이 아니라
// **실제 측정 시각 위치**에 찍는다(2026-08-12 사용자 요청). 측정 없는 시간대는 빈 공간으로
// 남는 것이 정직한 표현이다(균등 간격은 세 측정이 하루에 고르게 있었던 것처럼 오독된다).
type TimeChartPoint = ChartPoint & { tsMs: number };


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
  const spanMs = domain[1] - domain[0];
  // 시간축 눈금 — 도메인을 6등분.
  // ★ 라벨은 기간에 맞춰 날짜를 붙인다(formatTimeTick). 종전 `kstHm` 은 시:분 고정이라
  //   하루 뷰 전용이었는데, 7일 뷰에서는 눈금 간격이 28시간이고 **24로 나눈 나머지가 4시간**이라
  //   15:05·19:05·23:05·03:05… 로 찍혀 **7일치가 하루처럼 보였다**(2026-08-15 라이브 실측).
  //   값도 점 위치도 정확한데 축만 거짓말하는 형태라 더 설득력 있게 틀린다.
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
            tickFormatter={(v: number) => formatTimeTick(v, spanMs)}
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
