// 작업자 + 메트릭 선택 시 24시간 / 1주일 / 30일 / 60일 누적 시계열을 SVG 라인/막대 차트로 표시
"use client";

import { useEffect, useState, type MouseEvent } from "react";

import { THRESHOLDS, estimateCoreTempC } from "@safetymonitor/analyzers";

import {
  spo2Status,
  coreTempStatus,
  workHeartRateStatus,
  WORK_HR,
  type Status,
} from "../../lib/severity";

type Metric = "heartRate" | "spo2" | "skinTempC" | "fall";
type Range = 1 | 7 | 30 | 60 | 365;
type ChartType = "line" | "bar";

type Selection = {
  workerId: string;
  metric: Metric;
};

type HistoryResponse = {
  workerId: string;
  metric: Metric;
  range: Range;
  points: { date: string; label?: string; value: number }[];
  summary: { min: number; max: number; avg: number };
};

const METRIC_LABEL: Record<Metric, { name: string; unit: string; color: string; decimals: number }> = {
  heartRate: { name: "심박", unit: "bpm", color: "#f87171", decimals: 0 },
  spo2: { name: "산소포화도", unit: "%", color: "#22d3ee", decimals: 0 },
  skinTempC: { name: "손목 온도", unit: "℃", color: "#34d399", decimals: 1 },
  fall: { name: "낙상", unit: "회", color: "#facc15", decimals: 0 },
};

const METRICS: Metric[] = ["heartRate", "spo2", "skinTempC", "fall"];

const RANGES: { value: Range; label: string }[] = [
  { value: 1, label: "24시간" },
  { value: 7, label: "1주일" },
  { value: 30, label: "30일" },
  { value: 60, label: "60일" },
  { value: 365, label: "1년" },
];

const CHART_TYPES: { value: ChartType; label: string; icon: string }[] = [
  { value: "line", label: "라인", icon: "📈" },
  { value: "bar", label: "막대", icon: "📊" },
];

export function VitalHistoryPanel({
  selection,
  workerName,
  employeeId,
  hasLiveData,
  liveValue,
  onMetricChange,
  onClose,
}: {
  selection: Selection;
  workerName?: string;
  employeeId?: string;
  hasLiveData: boolean;
  liveValue?: number | null; // 선택 작업자·메트릭의 현재 라이브 값(대시보드가 2초마다 갱신). 24시간 뷰 마지막 점에 반영.
  onMetricChange?: (metric: Metric) => void;
  onClose: () => void;
}) {
  const [range, setRange] = useState<Range>(7);
  const [chartType, setChartType] = useState<ChartType>("line");
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 실측 데이터가 없는 메트릭은 fetch 건너뛰고 placeholder 표시.
    // 자체 웨어러블 디바이스 연동 시 모든 메트릭 추세를 실시간 수집한다는 부각 효과.
    if (!hasLiveData) {
      setData(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    // 선택(작업자/메트릭/기간) 변경 시 이전 데이터를 비워 새 라벨·임계선으로 오표시되지 않게 한다.
    setData(null);

    const params = new URLSearchParams({
      workerId: selection.workerId,
      metric: selection.metric,
      days: String(range),
    });
    // 요청 시점 선택을 캡처 — 지연 응답이 새 선택 위에 덮이지 않게 커밋 전 대조한다.
    const requested = { workerId: selection.workerId, metric: selection.metric, range };

    fetch(`/api/mock/history?${params.toString()}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: HistoryResponse | null) => {
        if (active) {
          const matchesRequest =
            json !== null &&
            json.workerId === requested.workerId &&
            json.metric === requested.metric &&
            json.range === requested.range;
          setData(matchesRequest ? json : null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setData(null);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selection.workerId, selection.metric, range, hasLiveData]);

  const meta = METRIC_LABEL[selection.metric];

  // 체온(손목온도)일 때만 추정 체온(손목 + 0.5℃)을 요약·호버에 병기. 다른 메트릭은 미표시.
  const isTemp = selection.metric === "skinTempC";
  const coreSub = (v: number) => (isTemp ? `추정 ${estimateCoreTempC(v).toFixed(1)}℃` : undefined);
  const coreHover = isTemp ? (v: number) => `추정 ${estimateCoreTempC(v).toFixed(1)}℃` : undefined;

  // 24시간(range=1) 실시간 뷰 — 마지막 버킷(현재 시각)을 라이브 값으로 덮어 실시간 반영.
  // 대시보드가 2초마다 새 liveValue 로 리렌더 → 그래프 tip 이 실시간 표와 동기화. 일/월 집계·낙상은 원본 유지.
  const liveOverride =
    data !== null &&
    range === 1 &&
    selection.metric !== "fall" &&
    typeof liveValue === "number" &&
    Number.isFinite(liveValue) &&
    data.points.length > 0;
  const displayPoints = liveOverride
    ? data!.points.map((p, i, arr) => (i === arr.length - 1 ? { ...p, value: liveValue as number } : p))
    : (data?.points ?? []);
  const displaySummary = (() => {
    if (!data) return { min: 0, max: 0, avg: 0 };
    if (!liveOverride) return data.summary;
    const vals = displayPoints.map((p) => p.value);
    return {
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    };
  })();

  return (
    <section
      className="rounded-md border border-cyan-500/40 bg-cyan-50 dark:border-cyan-400/30 dark:bg-cyan-400/[0.03]"
      style={{ fontFamily: "'Lato', system-ui, sans-serif" }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {workerName?.trim() ? (
            <span className="rounded bg-zinc-200 px-2 py-1 text-xs text-zinc-800 dark:bg-white/10 dark:text-zinc-100">
              <span className="font-semibold">{workerName.trim()}</span>
              {employeeId?.trim() && (
                <>
                  <span className="ml-2 text-zinc-500">사원번호</span>
                  <span className="ml-1 font-mono">{employeeId.trim()}</span>
                </>
              )}
            </span>
          ) : employeeId?.trim() ? (
            <span className="rounded bg-zinc-200 px-2 py-1 text-xs text-zinc-800 dark:bg-white/10 dark:text-zinc-100">
              <span className="text-zinc-500">사원번호</span>
              <span className="ml-1 font-mono">{employeeId.trim()}</span>
            </span>
          ) : (
            <span className="rounded bg-zinc-200 px-2 py-1 font-mono text-xs text-zinc-800 dark:bg-white/10 dark:text-zinc-100">
              {selection.workerId}
            </span>
          )}
          <div className="flex items-center gap-1">
            {METRICS.map((m) => {
              const isActive = selection.metric === m;
              const label = METRIC_LABEL[m];
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => onMetricChange?.(m)}
                  disabled={!onMetricChange || isActive}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    isActive
                      ? "border-current font-semibold"
                      : "border-zinc-300 text-zinc-600 hover:border-zinc-500 hover:text-zinc-900 dark:border-white/10 dark:text-zinc-400 dark:hover:border-white/30 dark:hover:text-zinc-200"
                  }`}
                  style={isActive ? { color: label.color } : undefined}
                >
                  {label.name}
                </button>
              );
            })}
          </div>
          <span className="text-xs text-zinc-600 dark:text-zinc-400">누적 추세</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded border border-zinc-300 dark:border-white/10">
            {CHART_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setChartType(t.value)}
                aria-pressed={chartType === t.value}
                title={`${t.label} 차트`}
                className={`px-3 py-1 text-xs ${
                  chartType === t.value
                    ? "bg-cyan-200 text-cyan-800 dark:bg-cyan-400/20 dark:text-cyan-100"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5"
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <div className="flex overflow-hidden rounded border border-zinc-300 dark:border-white/10">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRange(r.value)}
                className={`px-3 py-1 text-xs ${
                  range === r.value
                    ? "bg-cyan-200 text-cyan-800 dark:bg-cyan-400/20 dark:text-cyan-100"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/5"
          >
            닫기
          </button>
        </div>
      </header>

      <div className="px-4 py-4">
        {!hasLiveData ? (
          <EmptyMetricPlaceholder metricName={meta.name} />
        ) : loading && !data ? (
          <p className="text-xs text-zinc-600 dark:text-zinc-400">불러오는 중...</p>
        ) : data ? (
          <>
            <div className="mb-3 flex flex-wrap items-stretch gap-2">
              {selection.metric === "fall" ? (
                <>
                  <SummaryCell label="총 건수" value={displaySummary.min} unit={meta.unit} decimals={0} color={meta.color} />
                  <SummaryCell label="시간/일 최대" value={displaySummary.max} unit={meta.unit} decimals={0} color={meta.color} />
                  <SummaryCell label="평균" value={displaySummary.avg} unit={meta.unit} decimals={2} color={meta.color} />
                </>
              ) : (
                <>
                  <SummaryCell label="평균" value={displaySummary.avg} unit={meta.unit} decimals={meta.decimals} color={meta.color} sub={coreSub(displaySummary.avg)} />
                  <SummaryCell label="최저" value={displaySummary.min} unit={meta.unit} decimals={meta.decimals} color={meta.color} sub={coreSub(displaySummary.min)} />
                  <SummaryCell label="최고" value={displaySummary.max} unit={meta.unit} decimals={meta.decimals} color={meta.color} sub={coreSub(displaySummary.max)} />
                  <SafetyStatsCell metric={selection.metric} points={displayPoints} unit={meta.unit} decimals={meta.decimals} />
                </>
              )}
            </div>
            {selection.metric === "fall" || chartType === "bar" ? (
              <BarChart
                points={displayPoints}
                color={meta.color}
                unit={meta.unit}
                decimals={meta.decimals}
                referenceLines={metricReferenceLines(selection.metric)}
                pointSeverity={metricPointSeverity(selection.metric)}
                hoverExtra={coreHover}
              />
            ) : (
              <LineChart
                points={displayPoints}
                color={meta.color}
                unit={meta.unit}
                decimals={meta.decimals}
                referenceLines={metricReferenceLines(selection.metric)}
                pointSeverity={metricPointSeverity(selection.metric)}
                hoverExtra={coreHover}
              />
            )}
          </>
        ) : (
          <p className="text-xs text-red-600 dark:text-red-300">데이터를 불러오지 못했습니다.</p>
        )}
      </div>
    </section>
  );
}

function EmptyMetricPlaceholder({ metricName }: { metricName: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded border border-dashed border-zinc-300 bg-zinc-50 px-6 py-12 text-center dark:border-white/15 dark:bg-white/[0.02]">
      <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {metricName} 측정값 미수신
      </span>
      <p className="max-w-md text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
        현재 페어 워치·스마트폰에서 해당 메트릭이 수집되지 않아 누적 추세를 표시할 수 없습니다.
      </p>
      <p className="max-w-md text-xs leading-relaxed text-cyan-700 dark:text-cyan-300/80">
        자체 웨어러블 디바이스 연동 시 5종 생체 메트릭의 실시간 추세를 빠짐없이 수집합니다.
      </p>
    </div>
  );
}

export function SummaryCell({
  label,
  value,
  unit,
  decimals,
  color,
  sub,
}: {
  label: string;
  value: number;
  unit: string;
  decimals: number;
  color: string;
  sub?: string; // 보조 값 한 줄(예: 추정 체온). 미지정 시 미표시.
}) {
  return (
    <div className="flex items-baseline gap-2 rounded border border-zinc-200 bg-white px-3 py-1.5 dark:border-white/10 dark:bg-white/[0.02]">
      <span className="shrink-0 text-lg text-zinc-600 dark:text-zinc-400">{label}</span>
      <span className="text-lg font-semibold tabular-nums" style={{ color }}>
        {value.toFixed(decimals)}
        <span className="ml-1 text-xs font-normal text-zinc-600 dark:text-zinc-400">{unit}</span>
      </span>
      {sub && (
        <span className="ml-auto text-xs font-medium tabular-nums text-amber-600 dark:text-amber-300">{sub}</span>
      )}
    </div>
  );
}

// 선택 기간의 안전 요약 — 정상 구간 비율 + 주의/위험 구간 수 + 변동성(표준편차).
// 임계 판정이 있는 메트릭(심박/산소/체온)만 표시. points 는 집계 버킷이라 "구간" 기준이다.
// 3개 요약 박스가 내용 폭으로 축소된 뒤 남는 우측 공간(flex-1)을 채운다.
function SafetyStatsCell({
  metric,
  points,
  unit,
  decimals,
}: {
  metric: Metric;
  points: { value: number }[];
  unit: string;
  decimals: number;
}) {
  const sevFn = metricPointSeverity(metric);
  if (!sevFn || points.length === 0) return null;

  let caution = 0;
  let danger = 0;
  for (const p of points) {
    const s = sevFn(p.value);
    if (s === "danger") danger += 1;
    else if (s === "caution") caution += 1;
  }
  const normalPct = Math.round(((points.length - caution - danger) / points.length) * 100);

  const mean = points.reduce((a, p) => a + p.value, 0) / points.length;
  const std = Math.sqrt(points.reduce((a, p) => a + (p.value - mean) ** 2, 0) / points.length);

  const tone =
    danger > 0
      ? "text-red-600 dark:text-red-300"
      : caution > 0
        ? "text-amber-600 dark:text-amber-300"
        : "text-emerald-600 dark:text-emerald-300";

  // 심박은 '작업 중' 기준(작업부하 밴드)으로 판정 — 라벨·툴팁으로 기준을 명시한다.
  const isHr = metric === "heartRate";
  const basisLabel = isHr ? "작업부하 안전" : "기간 안전";
  const basisTitle = isHr
    ? `작업 중 심박 기준(ISO 8996·ACGIH 작업대사 HR 참고) — 정상 작업부하 <${WORK_HR.heavyBpm} · 고강도 ${WORK_HR.heavyBpm}–${WORK_HR.overloadBpm} · 과부하 >${WORK_HR.overloadBpm}. 참고용·의료진단 아님.`
    : undefined;

  return (
    <div
      title={basisTitle}
      className="flex flex-1 basis-48 items-baseline gap-2 rounded border border-zinc-200 bg-white px-3 py-1.5 dark:border-white/10 dark:bg-white/[0.02]"
    >
      <span className="shrink-0 text-xs text-zinc-600 dark:text-zinc-400">{basisLabel}</span>
      <span className={`text-lg font-semibold tabular-nums ${tone}`}>정상 {normalPct}%</span>
      <span className="shrink-0 text-xs tabular-nums text-amber-600 dark:text-amber-300">주의 {caution}</span>
      <span className="shrink-0 text-xs tabular-nums text-red-600 dark:text-red-300">위험 {danger}</span>
      <span className="ml-auto shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
        변동 ±{std.toFixed(decimals)} {unit}
      </span>
    </div>
  );
}

type ReferenceLine = { value: number; label: string; color?: string };

const REF_DANGER = "#ef4444";
const REF_CAUTION = "#f59e0b";

// WORK_HR 밴드·workHeartRateStatus 는 lib/severity 단일 source 에서 import.
// 차트는 집계 버킷이라 per-점 활동맥락이 없어 작업부하 밴드를 '무조건' 적용한다
// (카드/신호등은 활동 게이트로 작업 중일 때만 적용 — heartRateStatus(hr, activity)).

// 메트릭별 위험/주의 임계 기준선. 차트는 손목 온도(skinTempC)를 그리므로
// 심부 체온 임계(38.0/37.5℃)를 손목 스케일로 역산(core = 손목 + offset).
function metricReferenceLines(metric: Metric): ReferenceLine[] {
  switch (metric) {
    case "heartRate":
      // 작업 중 기준(ISO 8996·ACGIH 참고) — 안정 임계 110/130 대신 작업부하 밴드.
      return [
        { value: WORK_HR.overloadBpm, label: `과부하 ${WORK_HR.overloadBpm}`, color: REF_DANGER },
        { value: WORK_HR.heavyBpm, label: `고강도 ${WORK_HR.heavyBpm}`, color: REF_CAUTION },
      ];
    case "spo2":
      return [
        { value: THRESHOLDS.spo2.dangerPct, label: `위험 ${THRESHOLDS.spo2.dangerPct}`, color: REF_DANGER },
        { value: THRESHOLDS.spo2.cautionPct, label: `주의 ${THRESHOLDS.spo2.cautionPct}`, color: REF_CAUTION },
      ];
    case "skinTempC": {
      const off = THRESHOLDS.coreTemp.wristToCoreOffsetC;
      const danger = THRESHOLDS.coreTemp.dangerC - off;
      const caution = THRESHOLDS.coreTemp.cautionC - off;
      return [
        { value: danger, label: `위험 ${danger.toFixed(1)}`, color: REF_DANGER },
        { value: caution, label: `주의 ${caution.toFixed(1)}`, color: REF_CAUTION },
      ];
    }
    case "fall":
      return [];
  }
}

// 메트릭별 점 위험도 판정 함수(이상치 dot 강조용). fall 은 강조 없음.
function metricPointSeverity(metric: Metric): ((value: number) => Status) | undefined {
  switch (metric) {
    case "heartRate":
      return workHeartRateStatus; // 작업 중 기준(작업부하 밴드)
    case "spo2":
      return spo2Status;
    case "skinTempC":
      return coreTempStatus;
    case "fall":
      return undefined;
  }
}

type ChartProps = {
  points: { date: string; label?: string; value: number }[];
  color: string;
  unit: string;
  decimals: number;
  referenceLines?: ReferenceLine[];
  // 데이터 점별 위험도 — caution/danger 면 dot 를 앰버/빨강으로 강조. 미지정 시 평상 색.
  pointSeverity?: (value: number) => Status;
  // 호버 툴팁에 보조 값 한 줄 추가(예: 체온 그래프의 추정 체온). 미지정 시 미표시.
  hoverExtra?: (value: number) => string;
};

// 임계값 기준선(referenceLines)도 스케일에 포함해 항상 차트 범위 안에 보이도록 한다.
function useChartScale(points: ChartProps["points"], decimals: number, extra: number[] = []) {
  if (points.length === 0) {
    return null;
  }
  const values = [...points.map((p) => p.value), ...extra.filter((v) => Number.isFinite(v))];
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = Math.max(rawMax - rawMin, decimals === 0 ? 4 : 0.4);
  const min = rawMin - span * 0.15;
  const max = rawMax + span * 0.15;
  return { min, max, range: max - min };
}

// 차트 위에서 가장 가까운 데이터 포인트 인덱스 — viewBox 좌표로 환산해 즉시 계산.
function nearestIndex(e: MouseEvent<SVGSVGElement>, xs: number[], width: number): number {
  const rect = e.currentTarget.getBoundingClientRect();
  if (rect.width === 0) return 0;
  const vx = ((e.clientX - rect.left) / rect.width) * width;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const xi = xs[i];
    if (xi === undefined) continue;
    const d = Math.abs(xi - vx);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// 즉시 반응 커스텀 호버 툴팁 — 지연이 있는 네이티브 SVG <title> 을 대체한다.
function HoverOverlay({
  index,
  xs,
  ys,
  points,
  color,
  unit,
  decimals,
  padding,
  innerH,
  width,
  hoverExtra,
}: {
  index: number;
  xs: number[];
  ys: number[];
  points: ChartProps["points"];
  color: string;
  unit: string;
  decimals: number;
  padding: { top: number; right: number; bottom: number; left: number };
  innerH: number;
  width: number;
  hoverExtra?: (value: number) => string;
}) {
  const px = xs[index];
  const py = ys[index];
  const p = points[index];
  if (px === undefined || py === undefined || !p) return null;
  const labelText = p.label ?? p.date;
  const valueText = `${p.value.toFixed(decimals)} ${unit}`;
  const extraText = hoverExtra ? hoverExtra(p.value) : null;
  const boxW =
    Math.max(labelText.length, valueText.length + 2, extraText ? extraText.length + 2 : 0) * 6.4 + 16;
  const boxH = extraText ? 47 : 34;
  const flip = px + 12 + boxW > width - padding.right;
  const bx = flip ? px - 12 - boxW : px + 12;
  const by = Math.min(Math.max(py - boxH / 2, padding.top), padding.top + innerH - boxH);
  return (
    <g pointerEvents="none">
      <line
        x1={px}
        x2={px}
        y1={padding.top}
        y2={padding.top + innerH}
        stroke={color}
        strokeOpacity={0.45}
        strokeDasharray="3 3"
      />
      <circle cx={px} cy={py} r={4.5} fill={color} stroke="#ffffff" strokeWidth={1.5} />
      <rect x={bx} y={by} width={boxW} height={boxH} rx={5} fill="#0f172a" fillOpacity={0.94} />
      <text x={bx + 8} y={by + 14} fontSize="10" fill="#cbd5e1">
        {labelText}
      </text>
      <text x={bx + 8} y={by + 27} fontSize="11" fontWeight="600" fill="#ffffff">
        {valueText}
      </text>
      {extraText && (
        <text x={bx + 8} y={by + 40} fontSize="10" fontWeight="600" fill="#fbbf24">
          {extraText}
        </text>
      )}
    </g>
  );
}

// 임계값 기준선 — 그래프 폭 전체 점선 + 우측 라벨.
function ReferenceLines({
  lines,
  y,
  padding,
  width,
}: {
  lines: ReferenceLine[];
  y: (v: number) => number;
  padding: { top: number; right: number; bottom: number; left: number };
  width: number;
}) {
  return (
    <>
      {lines.map((rl, i) => {
        const yPos = y(rl.value);
        const c = rl.color ?? "#ef4444";
        return (
          <g key={`ref-${i}`} pointerEvents="none">
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yPos}
              y2={yPos}
              stroke={c}
              strokeWidth={1.2}
              strokeDasharray="5 3"
              strokeOpacity={0.9}
            />
            <text x={width - padding.right} y={yPos - 3} textAnchor="end" fontSize="9" fontWeight="600" fill={c}>
              {rl.label}
            </text>
          </g>
        );
      })}
    </>
  );
}

// 라인 차트 색상 유틸 — 단색에서 그라데이션 스톱/점별 보간색을 파생한다.
function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const s = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r: number, g: number, b: number) {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function mix(a: string, b: string, t: number) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(ca.r + (cb.r - ca.r) * t, ca.g + (cb.g - ca.g) * t, ca.b + (cb.b - ca.b) * t);
}
const lighten = (hex: string, t: number) => mix(hex, "#ffffff", t);
const darken = (hex: string, t: number) => mix(hex, "#000000", t);

// 데이터 점들을 부드러운 베지에 곡선(카드뮬-롬, tension≈0.9)으로 잇는 path d 문자열.
function smoothLinePath(pts: { x: number; y: number }[]) {
  const first = pts[0];
  if (!first) return "";
  if (pts.length === 1) return `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  const t = 0.9;
  let d = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    if (!p1 || !p2) continue;
    const p0 = pts[i - 1] ?? p1;
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + ((p2.x - p0.x) / 6) * t;
    const cp1y = p1.y + ((p2.y - p0.y) / 6) * t;
    const cp2x = p2.x - ((p3.x - p1.x) / 6) * t;
    const cp2y = p2.y - ((p3.y - p1.y) / 6) * t;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export function LineChart({ points, color, unit, decimals, referenceLines, pointSeverity, hoverExtra }: ChartProps) {
  const width = 720;
  const height = 220;
  const padding = { top: 12, right: 16, bottom: 28, left: 36 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const [hover, setHover] = useState<number | null>(null);

  const refs = referenceLines ?? [];
  const scale = useChartScale(points, decimals, refs.map((r) => r.value));
  if (!scale) {
    return <p className="text-xs text-zinc-400">데이터 없음</p>;
  }
  const { min, range } = scale;

  const x = (i: number) =>
    padding.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => padding.top + innerH - ((v - min) / range) * innerH;

  const baselineY = padding.top + innerH;
  const xs = points.map((_, i) => x(i));
  const ys = points.map((p) => y(p.value));
  const pts = points.map((p, i) => ({ x: x(i), y: y(p.value) }));

  // 부드러운 곡선(카드뮬-롬 스플라인) — 레퍼런스의 매끈한 라인
  const path = smoothLinePath(pts);
  const firstPt = pts[0];
  const lastPt = pts[pts.length - 1];
  const areaPath =
    firstPt && lastPt
      ? `${path} L ${lastPt.x.toFixed(1)} ${baselineY.toFixed(1)} L ${firstPt.x.toFixed(1)} ${baselineY.toFixed(1)} Z`
      : "";

  // 색상에서 파생한 가로 그라데이션(밝은 톤 → 짙은 톤) + 점별 보간색
  const id = color.replace(/[^a-z0-9]/gi, "");
  const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color);
  const gStart = isHex ? lighten(color, 0.3) : color;
  const gEnd = isHex ? darken(color, 0.12) : color;
  const dotColor = (i: number) =>
    isHex && points.length > 1 ? mix(gStart, gEnd, i / (points.length - 1)) : color;

  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) => min + (range * i) / yTicks);
  const xTickCount = Math.min(points.length, 6);
  const xTickIndices = Array.from({ length: xTickCount }, (_, i) =>
    Math.round((i / (xTickCount - 1)) * (points.length - 1)),
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full text-zinc-700 dark:text-zinc-300"
      role="img"
      aria-label={`라인 차트 (단위 ${unit})`}
      onMouseMove={(e) => setHover(nearestIndex(e, xs, width))}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`line-${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={gStart} />
          <stop offset="100%" stopColor={gEnd} />
        </linearGradient>
      </defs>

      {tickValues.map((t, i) => {
        const yPos = y(t);
        return (
          <g key={i}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yPos}
              y2={yPos}
              stroke="currentColor"
              strokeOpacity={i === 0 ? 0.35 : 0.15}
              strokeDasharray={i === 0 ? undefined : "3 3"}
            />
            <text x={padding.left - 6} y={yPos + 3} textAnchor="end" fontSize="9" fill="currentColor">
              {t.toFixed(decimals)}
            </text>
          </g>
        );
      })}

      {xTickIndices.map((idx) => {
        const pt = points[idx];
        if (!pt) return null;
        return (
          <text
            key={idx}
            x={x(idx)}
            y={height - 8}
            textAnchor="middle"
            fontSize="9"
            fill="currentColor"
          >
            {pt.label ?? pt.date.slice(5)}
          </text>
        );
      })}

      <path d={areaPath} fill={`url(#area-${id})`} />
      <path
        d={path}
        fill="none"
        stroke={`url(#line-${id})`}
        strokeWidth="2.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      <ReferenceLines lines={refs} y={y} padding={padding} width={width} />

      {points.map((p, i) => {
        const sev = pointSeverity?.(p.value);
        const abn = sev === "danger" || sev === "caution";
        const baseR = points.length > 30 ? 2 : 3.6;
        return (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.value)}
            r={abn ? Math.max(baseR, 4.2) : baseR}
            fill={sev === "danger" ? "#ef4444" : sev === "caution" ? "#f59e0b" : dotColor(i)}
            stroke="#ffffff"
            strokeOpacity={abn ? 0.95 : 0.65}
            strokeWidth={abn ? 1.5 : points.length > 30 ? 0.6 : 1}
          />
        );
      })}

      {hover !== null && (
        <HoverOverlay
          index={hover}
          xs={xs}
          ys={ys}
          points={points}
          color={color}
          unit={unit}
          decimals={decimals}
          padding={padding}
          innerH={innerH}
          width={width}
          hoverExtra={hoverExtra}
        />
      )}
    </svg>
  );
}

export function BarChart({ points, color, unit, decimals, referenceLines, pointSeverity, hoverExtra }: ChartProps) {
  const width = 720;
  const height = 220;
  // 막대 수가 적을 때만(≤8) 막대 상단에 값 라벨 표기 → 윗여백 확보
  const showValues = points.length > 0 && points.length <= 8;
  const padding = { top: showValues ? 26 : 12, right: 16, bottom: 28, left: 36 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const [hover, setHover] = useState<number | null>(null);

  const refs = referenceLines ?? [];
  const scale = useChartScale(points, decimals, refs.map((r) => r.value));
  if (!scale) {
    return <p className="text-xs text-zinc-400">데이터 없음</p>;
  }
  const { min, range } = scale;

  const slot = innerW / points.length;
  // 체온계(캡슐) 막대 — 슬롯 대비 가는 튜브 + 하단 원형 마커(레퍼런스 룩)
  const barWidth = Math.min(Math.max(slot * 0.3, 5), 24);
  const cx = (i: number) => padding.left + i * slot + slot / 2;
  const y = (v: number) => padding.top + innerH - ((v - min) / range) * innerH;
  const baselineY = padding.top + innerH;
  const dotR = Math.min(Math.max(barWidth * 0.78, 3), 13);
  const colorId = color.replace("#", "");

  const xs = points.map((_, i) => cx(i));
  const ys = points.map((p) => y(p.value));

  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) => min + (range * i) / yTicks);
  const xTickCount = Math.min(points.length, 6);
  const xTickIndices = Array.from({ length: xTickCount }, (_, i) =>
    Math.round((i / (xTickCount - 1)) * (points.length - 1)),
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full text-zinc-700 dark:text-zinc-300"
      role="img"
      aria-label={`막대 차트 (단위 ${unit})`}
      onMouseMove={(e) => setHover(nearestIndex(e, xs, width))}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id={`bar-${colorId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="0.82" />
        </linearGradient>
      </defs>

      {tickValues.map((t, i) => {
        const yPos = y(t);
        return (
          <g key={i}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yPos}
              y2={yPos}
              stroke="currentColor"
              strokeOpacity={i === 0 ? 0.35 : 0.15}
              strokeDasharray={i === 0 ? undefined : "3 3"}
            />
            <text x={padding.left - 6} y={yPos + 3} textAnchor="end" fontSize="9" fill="currentColor">
              {t.toFixed(decimals)}
            </text>
          </g>
        );
      })}

      {/* 체온계 트랙 — 전 구간 높이의 연한 회색 캡슐(테마 적응) */}
      {points.map((_, i) => (
        <rect
          key={`track-${i}`}
          x={cx(i) - barWidth / 2}
          y={padding.top}
          width={barWidth}
          height={innerH}
          rx={barWidth / 2}
          fill="currentColor"
          fillOpacity={0.1}
        />
      ))}

      {/* 값 캡슐(바닥→값) + 하단 원형 마커. 이상치(주의/위험)는 캡슐·마커를 앰버/빨강으로 강조 */}
      {points.map((p, i) => {
        const fillH = Math.max(baselineY - y(p.value), barWidth);
        const sev = pointSeverity?.(p.value);
        const sevColor = sev === "danger" ? "#ef4444" : sev === "caution" ? "#f59e0b" : null;
        return (
          <g key={`bar-${i}`}>
            <rect
              x={cx(i) - barWidth / 2}
              y={baselineY - fillH}
              width={barWidth}
              height={fillH}
              rx={barWidth / 2}
              fill={sevColor ?? `url(#bar-${colorId})`}
            />
            <circle
              cx={cx(i)}
              cy={baselineY}
              r={dotR}
              fill={sevColor ?? color}
              stroke="#ffffff"
              strokeOpacity={0.5}
              strokeWidth={1}
            />
          </g>
        );
      })}

      {showValues &&
        points.map((p, i) => (
          <text
            key={`val-${i}`}
            x={cx(i)}
            y={padding.top - 9}
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fill={color}
          >
            {p.value.toFixed(decimals)}
          </text>
        ))}

      <ReferenceLines lines={refs} y={y} padding={padding} width={width} />

      {xTickIndices.map((idx) => {
        const pt = points[idx];
        if (!pt) return null;
        return (
          <text
            key={idx}
            x={cx(idx)}
            y={height - 8}
            textAnchor="middle"
            fontSize="9"
            fill="currentColor"
          >
            {pt.label ?? pt.date.slice(5)}
          </text>
        );
      })}

      {hover !== null && (
        <HoverOverlay
          index={hover}
          xs={xs}
          ys={ys}
          points={points}
          color={color}
          unit={unit}
          decimals={decimals}
          padding={padding}
          innerH={innerH}
          width={width}
          hoverExtra={hoverExtra}
        />
      )}
    </svg>
  );
}
