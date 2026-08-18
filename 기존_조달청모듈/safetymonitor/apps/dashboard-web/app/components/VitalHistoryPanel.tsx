// 작업자 + 메트릭 선택 시 프리셋(24시간~1년) 또는 지정 기간 누적 시계열을 Recharts 라인/막대 차트로 표시
// (하단 export LineChart/BarChart/SummaryCell 은 수작업 SVG — SiteSafetyTables 에서 재사용)
"use client";

import { useEffect, useState, type MouseEvent } from "react";

import { THRESHOLDS } from "@safetymonitor/analyzers";

import {
  spo2Status,
  workHeartRateStatus,
  WORK_HR,
  type Status,
} from "../../lib/severity";

import {
  RechartsLineChart,
  RechartsBarChart,
  RechartsTimeDotChart,
  RechartsActivityComboChart,
} from "./VitalChartsRecharts";
import { CoverageHeatmap } from "./CoverageHeatmap";
import { getSessionToken } from "./LoginGate";

type Metric = "heartRate" | "spo2" | "coreTempEst" | "activity" | "fall" | "coverage";
type Range = 1 | 7 | 30 | 60 | 365;
type ChartType = "line" | "bar";

type Selection = {
  workerId: string;
  metric: Metric;
};

type CustomRange = { from: string; to: string }; // YYYY-MM-DD

type HistoryResponse = {
  workerId: string;
  metric: Metric;
  range: Range | 0; // 0 = 사용자 지정 기간(from/to)
  from?: string;
  to?: string;
  points: { date: string; label?: string; value: number; tsMs?: number }[];
  summary: { min: number; max: number; avg: number };
  windowFromMs?: number;
  windowToMs?: number;
  /** coverage 전용 — 히트맵이 "운영 이전"과 "미수신"을 가르는 기준. */
  firstDataDate?: string | null;
};

const METRIC_LABEL: Record<Metric, { name: string; unit: string; color: string; decimals: number }> = {
  heartRate: { name: "심박", unit: "bpm", color: "#f87171", decimals: 0 },
  spo2: { name: "산소포화도", unit: "%", color: "#22d3ee", decimals: 0 },
  // 워치 실측 손목온도는 서드파티 미개방(수면 전용 API)이라 탭에서 내림 — 심박 기반 추정으로 대체.
  coreTempEst: { name: "체온(심박 추정)", unit: "℃", color: "#34d399", decimals: 1 },
  // 활동 = 작업 강도 축(kcal 구간 합·실측) — ≤1주 뷰는 심박 선 오버레이 복합 차트(사용자 승인 08-13).
  activity: { name: "활동", unit: "kcal", color: "#fb923c", decimals: 2 },
  fall: { name: "낙상", unit: "회", color: "#facc15", decimals: 0 },
  // 수집 = 생체 값이 아니라 "그날 얼마나 수집됐나"(분). 히트맵 전용이라 선/막대 축을 쓰지 않는다.
  coverage: { name: "수집", unit: "분", color: "#22d3ee", decimals: 0 },
};

const METRICS: Metric[] = ["heartRate", "spo2", "coreTempEst", "activity", "fall", "coverage"];

/** epoch ms → KST 달력일 `YYYY-MM-DD`. 서버 로컬이 UTC 라 getDate() 로 뽑으면 9시간 밀린다. */
function kstDayKey(ms: number): string {
  const k = new Date(ms + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`;
}

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

// 차트 종류가 지표 자체로 고정돼 라인/막대 토글이 아무것도 바꾸지 않는 지표들.
// 여기 있는 지표에서는 토글을 **감춘다** — 눌러도 안 변하는 버튼은 고장으로 읽힌다.
//
//   activity  복합 고정(막대 kcal + 심박 선 오버레이) — 두 시리즈를 한 축에 겹치는 표현
//   spo2      희소 이벤트 측정. 곡선으로 이으면 "그 사이에도 값이 있었다"가 된다(08-12 결정)
//   fall      아직 모의 데이터(B2 실데이터화 대기)
//
// ⚠ 이 집합은 아래 렌더 분기의 `isBar` 강제 목록과 **같은 근거를 공유한다**.
//   한쪽만 바뀌면 버튼이 다시 거짓말을 하므로 가드로 함께 고정했다
//   (`lib/2026-08-15-chart-type-toggle.guard.test.ts`).
const METRIC_FIXED_CHART = new Set(["activity", "spo2", "fall"]);

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
  const [customRange, setCustomRange] = useState<CustomRange | null>(null); // 설정 시 프리셋(range) 대신 이 구간 조회
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [chartType, setChartType] = useState<ChartType>("line");
  const [data, setData] = useState<HistoryResponse | null>(null);
  // 활동 탭 심박 오버레이(≤1주 뷰) — 같은 창을 heartRate 로 한 번 더 조회해 겹친다.
  const [hrOverlay, setHrOverlay] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 추정 탭 전환 시 서버 상한(7일)에 맞게 범위를 접는다 — 남아 있던 30일+·커스텀이 400 을 만들지 않게.
    if (selection.metric === "coreTempEst" && (range > 7 || customRange)) {
      setRange(range > 7 ? 7 : range);
      setCustomRange(null);
      setFromInput("");
      setToInput("");
    }
    // 수집 히트맵은 1년 격자가 곧 화면 형태다 — 기간 선택이 의미가 없어 365 로 고정한다(사용자 결정).
    if (selection.metric === "coverage" && (range !== 365 || customRange)) {
      setRange(365);
      setCustomRange(null);
      setFromInput("");
      setToInput("");
    }
  }, [selection.metric, range, customRange]);

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

    const params = new URLSearchParams(
      customRange
        ? {
            workerId: selection.workerId,
            metric: selection.metric,
            from: customRange.from,
            to: customRange.to,
          }
        : {
            workerId: selection.workerId,
            metric: selection.metric,
            days: String(range),
          },
    );
    // 요청 시점 선택을 캡처 — 지연 응답이 새 선택 위에 덮이지 않게 커밋 전 대조한다.
    const requested = { workerId: selection.workerId, metric: selection.metric, range, customRange };
    // 생체 시계열은 인증 게이트 뒤(2026-08-13 수리) — vital 폴링과 같은 세션 토큰을 동봉한다.
    const token = getSessionToken();
    const authHeaders: HeadersInit | undefined = token
      ? { Authorization: `Bearer ${token}` }
      : undefined;

    fetch(`/api/mock/history?${params.toString()}`, { cache: "no-store", headers: authHeaders })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: HistoryResponse | null) => {
        if (active) {
          const matchesRequest =
            json !== null &&
            json.workerId === requested.workerId &&
            json.metric === requested.metric &&
            (requested.customRange
              ? json.from === requested.customRange.from && json.to === requested.customRange.to
              : json.range === requested.range);
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

    // 활동 탭 오버레이 — 같은 창의 심박을 병렬 조회. 실패해도 막대(활동)만 그리면 되므로 조용히 생략.
    setHrOverlay(null);
    if (selection.metric === "activity") {
      const hrParams = new URLSearchParams(params);
      hrParams.set("metric", "heartRate");
      fetch(`/api/mock/history?${hrParams.toString()}`, { cache: "no-store", headers: authHeaders })
        .then((res) => (res.ok ? res.json() : null))
        .then((json: HistoryResponse | null) => {
          if (active && json && json.workerId === requested.workerId && json.metric === "heartRate") {
            setHrOverlay(json);
          }
        })
        .catch(() => {});
    }

    return () => {
      active = false;
    };
  }, [selection.workerId, selection.metric, range, customRange, hasLiveData]);

  const meta = METRIC_LABEL[selection.metric];

  // 심부체온 추정 탭 — 값 자체가 추정이라 별도 보조표기는 없고, 기간은 24시간·1주일만 제공한다
  // (열 스트레스는 시간 단위 현상 — 장기 추정 추세는 검증 근거가 없다. 서버도 같은 제한을 강제).
  const isEst = selection.metric === "coreTempEst";
  // 수집 히트맵 — 1년 격자가 곧 화면 형태다(365 고정은 위 효과가 강제). 차트 종류·기간 컨트롤은
  // 이 탭에서 아무것도 바꾸지 않으므로 감춘다 — METRIC_FIXED_CHART 와 같은 근거다.
  const isCoverage = selection.metric === "coverage";
  const coreSub = (_v: number) => undefined;
  const coreHover = undefined;

  // 24시간(range=1) 실시간 뷰 — 마지막 버킷(현재 시각)을 라이브 값으로 덮어 실시간 반영.
  // 대시보드가 2초마다 새 liveValue 로 리렌더 → 그래프 tip 이 실시간 표와 동기화. 일/월 집계·낙상은 원본 유지.
  const liveOverride =
    data !== null &&
    customRange === null &&
    range === 1 &&
    selection.metric !== "fall" &&
    // SpO₂ 는 측정 이벤트 배열이라 마지막 점을 라이브 값으로 덮으면 측정 기록이 왜곡된다.
    selection.metric !== "spo2" &&
    // 활동은 버킷 "합"이라 순간값으로 덮으면 단위가 어긋난다(kcal 합 ↔ 순간 증분).
    selection.metric !== "activity" &&
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

  // 시작일/종료일 캘린더 입력 반영 — 둘 다 유효(from ≤ to)하면 커스텀 기간 조회, 아니면 프리셋 유지.
  const applyCustom = (f: string, t: string) => {
    setFromInput(f);
    setToInput(t);
    setCustomRange(f && t && f <= t ? { from: f, to: t } : null);
  };
  const clearCustom = (r: Range) => {
    setRange(r);
    setCustomRange(null);
    setFromInput("");
    setToInput("");
  };
  const todayIso = new Date().toISOString().slice(0, 10);

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
          {/* 컨트롤을 지우면 "1년"이라는 사실도 함께 사라진다 — 고정된 범위를 글자로 남긴다.
              버튼이 아니라 글자다(누를 수 있게 두면 다시 죽은 컨트롤이 된다). */}
          {isCoverage ? (
            <span className="rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-500 dark:border-white/10 dark:text-zinc-400">
              최근 1년
            </span>
          ) : (
            <>
          {/* 라인/막대가 실제로 갈리는 지표에서만 보인다 — 안 갈리는데 버튼을 두면
              눌러도 아무 일이 없어 "고장"으로 읽힌다(2026-08-15 사용자 제보:
              "라인/막대 동일한 차트. 구분이 의미 없음"). 이 레포가 반복해 고쳐 온
              계열이다 — 화면이 사실과 다른 것을 말한다. 목록 근거는 상수 주석 참조. */}
          {!METRIC_FIXED_CHART.has(selection.metric) && (
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
          )}
          <div className="flex overflow-hidden rounded border border-zinc-300 dark:border-white/10">
            {RANGES.filter((r) => !isEst || r.value <= 7).map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => clearCustom(r.value)}
                className={`px-3 py-1 text-xs ${
                  range === r.value && !customRange
                    ? "bg-cyan-200 text-cyan-800 dark:bg-cyan-400/20 dark:text-cyan-100"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {/* 기간 설정 — 시작일/종료일 캘린더(연·월·일) 선택. 추정 탭은 7일 상한이라 프리셋만. */}
          {!isEst && (
          <div
            className={`flex items-center gap-1 rounded border px-2 py-0.5 text-xs [color-scheme:light] dark:[color-scheme:dark] ${
              customRange
                ? "border-cyan-500/60 bg-cyan-100/60 dark:border-cyan-400/40 dark:bg-cyan-400/10"
                : "border-zinc-300 dark:border-white/10"
            }`}
          >
            <input
              type="date"
              aria-label="시작일"
              value={fromInput}
              max={toInput || todayIso}
              onChange={(e) => applyCustom(e.target.value, toInput)}
              className="bg-transparent text-xs text-zinc-700 outline-none dark:text-zinc-200"
            />
            <span className="text-zinc-500">~</span>
            <input
              type="date"
              aria-label="종료일"
              value={toInput}
              min={fromInput || undefined}
              max={todayIso}
              onChange={(e) => applyCustom(fromInput, e.target.value)}
              className="bg-transparent text-xs text-zinc-700 outline-none dark:text-zinc-200"
            />
            {customRange && (
              <button
                type="button"
                onClick={() => clearCustom(range)}
                aria-label="기간 해제"
                title="기간 설정 해제"
                className="ml-0.5 rounded px-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-zinc-100"
              >
                ×
              </button>
            )}
          </div>
          )}
            </>
          )}
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
        ) : data && data.points.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded border border-dashed border-zinc-300 bg-zinc-50 px-6 py-12 text-center dark:border-white/15 dark:bg-white/[0.02]">
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              선택 기간에 {meta.name} 데이터가 없습니다
            </span>
            {selection.metric === "spo2" && (
              <p className="max-w-md text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                SpO₂ 는 손목이 정지했을 때만 걸리는 기회 측정입니다 — 워치 혈중 산소 앱에서 수동 측정하면 즉시 기록됩니다.
              </p>
            )}
            {selection.metric === "activity" && (
              <p className="max-w-md text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                활동 에너지는 2026-08-13부터 수집을 시작했습니다 — 그 이전 기간에는 데이터가 없습니다.
              </p>
            )}
          </div>
        ) : data ? (
          <>
            <div className="mb-3 flex flex-wrap items-stretch gap-2">
              {selection.metric === "fall" ? (
                <>
                  <SummaryCell label="총 건수" value={displaySummary.min} unit={meta.unit} decimals={0} color={meta.color} />
                  <SummaryCell label="시간/일 최대" value={displaySummary.max} unit={meta.unit} decimals={0} color={meta.color} />
                  <SummaryCell label="평균" value={displaySummary.avg} unit={meta.unit} decimals={2} color={meta.color} />
                </>
              ) : selection.metric === "activity" ? (
                // 작업 강도의 머리기사 = 총 소모(합산량). 평균·최대는 구간(버킷) 기준.
                <>
                  <SummaryCell
                    label="총 소모"
                    value={displayPoints.reduce((a, p) => a + p.value, 0)}
                    unit={meta.unit}
                    decimals={1}
                    color={meta.color}
                  />
                  <SummaryCell label="구간 최대" value={displaySummary.max} unit={meta.unit} decimals={meta.decimals} color={meta.color} />
                  <SummaryCell label="구간 평균" value={displaySummary.avg} unit={meta.unit} decimals={meta.decimals} color={meta.color} />
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
            {(() => {
              // 수집 커버리지 = 시계열 차트가 아니라 달력 격자다. 선/막대 경로로 내려보내면
              // 365개 점이 축에 균등 배치돼 "며칠이 비었는지"가 사라진다 — 이 탭의 존재 이유가 그것이다.
              if (selection.metric === "coverage") {
                return (
                  <CoverageHeatmap
                    points={displayPoints}
                    firstDataDate={data.firstDataDate ?? null}
                    endDay={kstDayKey(data.windowToMs ?? Date.now())}
                    days={365}
                  />
                );
              }
              const chartProps = {
                points: displayPoints,
                color: meta.color,
                unit: meta.unit,
                decimals: meta.decimals,
                referenceLines: metricReferenceLines(selection.metric),
                pointSeverity: metricPointSeverity(selection.metric),
                hoverExtra: coreHover,
              };
              // 활동 = 복합 차트(막대 kcal + ≤1주 뷰 심박 선 오버레이) — 시간축 필수.
              // 장기 뷰의 심박 일평균은 착용 시간의 함수라 오버레이하지 않는다(체온 상한과 같은 원칙).
              if (
                selection.metric === "activity" &&
                data.windowFromMs != null &&
                data.windowToMs != null &&
                displayPoints.every((p) => typeof p.tsMs === "number")
              ) {
                const spanMs = data.windowToMs - data.windowFromMs;
                const overlayPts =
                  spanMs <= 86_400_000 * 7.01 &&
                  hrOverlay &&
                  hrOverlay.points.length > 0 &&
                  hrOverlay.points.every((p) => typeof p.tsMs === "number")
                    ? (hrOverlay.points as { date: string; value: number; tsMs: number }[])
                    : null;
                return (
                  <RechartsActivityComboChart
                    activity={displayPoints as { date: string; value: number; tsMs: number }[]}
                    heartRate={overlayPts}
                    domain={[data.windowFromMs, data.windowToMs]}
                  />
                );
              }
              // SpO₂ = 희소 이벤트 측정 — **서버가 원본 점을 그대로 주는 구간(≤7일)** 은
              // 실제 측정 시각 위치의 점(dot)으로 그린다. 30일+ 는 일평균 집계라 막대가 맞다.
              //
              // ★ 종전엔 24시간만 점이고 1주일은 막대였다. 그 근거로 적혀 있던
              //   "곡선으로 이으면 오독된다"는 **선을 배제할 뿐 점을 배제하지 않는다**.
              //   실제로 1주일 막대는 측정이 분 단위로 붙은 구간에서 recharts 가 겹침을 피하려
              //   폭을 최소 간격에 맞춰 **1~2px 헤어라인**이 됐다(2026-08-15 라이브 실측).
              //   폭을 넓히면 위치가 왜곡되므로 폭이 아니라 표현을 바꾼다.
              //   경계는 서버 계약과 맞춘다 — real.ts: spanDays <= 7 원본 점 / 30일+ 일평균.
              const spo2Dots =
                selection.metric === "spo2" &&
                data.windowFromMs != null &&
                data.windowToMs != null &&
                data.windowToMs - data.windowFromMs <= 86_400_000 * 7.01 &&
                displayPoints.every((p) => typeof p.tsMs === "number");
              if (spo2Dots) {
                return (
                  <RechartsTimeDotChart
                    {...chartProps}
                    points={displayPoints as { date: string; label?: string; value: number; tsMs: number }[]}
                    domain={[data.windowFromMs!, data.windowToMs!]}
                  />
                );
              }
              // 선 차트는 시간축으로 그린다 — 창을 넘겨 주면 점이 실제 시각 위치에 놓이고
              // 결측 구간에서 선이 끊긴다. 종전 카테고리 축은 점을 균등 배치해
              // 밤새 비어 있던 16시간을 2시간 간격과 같은 폭으로 그렸다(2026-08-13 제보).
              // 창이 없거나 tsMs 없는 경로(모의 낙상)는 차트 쪽에서 카테고리 축으로 떨어진다.
              const timeDomain: [number, number] | undefined =
                data.windowFromMs != null && data.windowToMs != null
                  ? [data.windowFromMs, data.windowToMs]
                  : undefined;
              // 지표로 고정된 것(spo2·fall)은 토글과 무관하게 막대다 — 그래서 위에서 토글을 감춘다.
              // ⚠ activity 는 이 분기 앞에서 복합 차트로 빠지므로 여기 목록에 없다.
              const isBar =
                METRIC_FIXED_CHART.has(selection.metric) || chartType === "bar";
              return isBar ? (
                <RechartsBarChart {...chartProps} domain={timeDomain} />
              ) : (
                <RechartsLineChart {...chartProps} domain={timeDomain} />
              );
            })()}
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
    case "coreTempEst":
      // 값이 심부체온 추정치라 심부 임계를 그대로 긋는다(참고선 — 판정 아님).
      return [
        { value: THRESHOLDS.coreTemp.dangerC, label: `위험 ${THRESHOLDS.coreTemp.dangerC.toFixed(1)}`, color: REF_DANGER },
        { value: THRESHOLDS.coreTemp.cautionC, label: `주의 ${THRESHOLDS.coreTemp.cautionC.toFixed(1)}`, color: REF_CAUTION },
      ];
    case "activity":
      // 활동량에는 안전 임계가 없다 — 부하 판독은 심박 오버레이와의 대비가 담당.
      return [];
    case "fall":
      return [];
    case "coverage":
      // 수집량에는 안전 임계가 없다 — 이 값은 작업자 상태가 아니라 감시 여부다.
      // (히트맵 경로라 참고선을 쓰지도 않지만, 열거를 비워 두면 다음 사람이 임계를 채워 넣는다.)
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
    case "coreTempEst":
      // 추정치는 판정 미주입 원칙 — 점 강조·안전율 계산 없이 참고선만 둔다.
      return undefined;
    case "activity":
      return undefined;
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
