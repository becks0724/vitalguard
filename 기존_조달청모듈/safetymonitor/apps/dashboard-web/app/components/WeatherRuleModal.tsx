// 기상 항목 클릭 시 노출 — 정책 임계 단계 + 현재 적용 단계 + 권고 조치 + 법적 근거
"use client";

import {
  BINDING_LABEL,
  SEVERITY_BADGE_CLASS,
  SEVERITY_LABEL,
  type RuleEvaluation,
  type ThresholdStep,
} from "../../lib/weather-rules";

// 모달 부가 예보 — 날씨 항목엔 일주일 예보, 기온 항목엔 24시간 시간대별 기온.
// WeatherStrip 이 날씨코드→아이콘/라벨 변환을 마친 뒤 문자열로 전달(모달엔 변환 로직 없음).
export type ForecastDay = {
  dateLabel: string;
  icon: string;
  label: string;
  tMax: number;
  tMin: number;
  precipProb?: number;
};
export type ForecastHour = { label: string; temp: number };
export type ForecastExtra = { days?: ForecastDay[]; hourly?: ForecastHour[] };

type Props = {
  evaluation: RuleEvaluation;
  forecast?: ForecastExtra;
  onClose: () => void;
};

// 법적 강제 / 권고 / 참고 binding 배지 — 라이트/다크 양쪽 톤 페어
const BINDING_BADGE_CLASS: Record<ThresholdStep["binding"], string> = {
  legal:
    "border-red-500/60 bg-red-100 text-red-800 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-200",
  recommendation:
    "border-amber-500/60 bg-amber-100 text-amber-800 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200",
  reference:
    "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-white/15 dark:bg-white/5 dark:text-zinc-300",
};

export function WeatherRuleModal({ evaluation, forecast, onClose }: Props) {
  const { itemKey, itemLabel, currentValue, currentSeverity, currentStep, steps, baseline, notes } =
    evaluation;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 dark:bg-black/70"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-md border border-hairline-strong bg-canvas p-5 dark:border-white/10 dark:bg-surface-dark"
      >
        <header className="mb-4 flex items-start justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-white/10">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{itemLabel}</h2>
              <span
                className={`rounded border px-2 py-0.5 text-xs font-semibold ${SEVERITY_BADGE_CLASS[currentSeverity]}`}
              >
                {SEVERITY_LABEL[currentSeverity]}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              현재 측정값:{" "}
              <span className="font-mono text-zinc-900 dark:text-zinc-100">{currentValue}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/5"
          >
            닫기
          </button>
        </header>

        {itemKey === "weather" && forecast?.days && forecast.days.length > 0 && (
          <ForecastDays days={forecast.days} />
        )}
        {itemKey === "temperature" && forecast?.hourly && forecast.hourly.length > 0 && (
          <HourlyTempSection hourly={forecast.hourly} />
        )}

        {currentStep && (
          <section className="mb-4 rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/[0.02]">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs text-zinc-500">현재 적용 단계</span>
              <span
                className={`rounded border px-2 py-0.5 text-[10px] ${BINDING_BADGE_CLASS[currentStep.binding]}`}
              >
                {BINDING_LABEL[currentStep.binding]}
              </span>
            </div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{currentStep.label}</p>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{currentStep.action}</p>
            <p className="mt-2 text-[11px] text-zinc-500">근거: {currentStep.source}</p>
          </section>
        )}

        {!currentStep && (
          <section className="mb-4 rounded border border-emerald-500/50 bg-emerald-50 p-3 dark:border-emerald-400/20 dark:bg-emerald-400/5">
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-200">정상 범위</p>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{baseline}</p>
          </section>
        )}

        {steps.length > 0 && (
          <section className="mb-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              전체 임계 단계
            </h3>
            <ul className="flex flex-col gap-2">
              {steps.map((step, i) => (
                <StepRow
                  key={`${step.label}-${i}`}
                  step={step}
                  isCurrent={currentStep === step}
                />
              ))}
            </ul>
          </section>
        )}

        {steps.length === 0 && (
          <section className="mb-3 rounded border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-white/10 dark:bg-white/[0.02] dark:text-zinc-300">
            {baseline}
          </section>
        )}

        {notes && (
          <footer className="mt-3 rounded border border-zinc-200 bg-zinc-50/60 px-3 py-2 text-[11px] text-zinc-500 dark:border-white/5 dark:bg-white/[0.01]">
            {notes}
          </footer>
        )}
      </div>
    </div>
  );
}

function StepRow({ step, isCurrent }: { step: ThresholdStep; isCurrent: boolean }) {
  return (
    <li
      className={`rounded border px-3 py-2 ${
        isCurrent
          ? `${SEVERITY_BADGE_CLASS[step.severity]} border-2`
          : "border-zinc-200 bg-zinc-50 dark:border-white/10 dark:bg-white/[0.02]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`text-sm font-semibold ${
            step.severity === "danger"
              ? "text-red-600 dark:text-red-300"
              : step.severity === "caution"
                ? "text-amber-600 dark:text-amber-300"
                : "text-zinc-800 dark:text-zinc-200"
          }`}
        >
          {step.label}
        </span>
        <span
          className={`shrink-0 rounded border px-2 py-0.5 text-[10px] ${BINDING_BADGE_CLASS[step.binding]}`}
        >
          {BINDING_LABEL[step.binding]}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-700 dark:text-zinc-300">{step.action}</p>
      <p className="mt-1 text-[10px] text-zinc-500">{step.source}</p>
    </li>
  );
}

// 일주일 기상예보 — 날짜/아이콘/요약 + 최고(빨강)·최저(파랑) + 강수확률. 가로 스크롤(좁은 화면).
function ForecastDays({ days }: { days: ForecastDay[] }) {
  return (
    <section className="mb-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        일주일 기상예보
      </h3>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {days.map((d, i) => (
          <div
            key={i}
            className="flex min-w-[64px] flex-1 flex-col items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-2 dark:border-white/10 dark:bg-white/[0.02]"
          >
            <span className="whitespace-nowrap text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
              {d.dateLabel}
            </span>
            <span className="text-xl leading-none" aria-hidden>
              {d.icon}
            </span>
            <span className="text-center text-[9px] leading-tight text-zinc-500">{d.label}</span>
            <span className="font-mono text-[11px]">
              <span className="text-red-500 dark:text-red-400">{Math.round(d.tMax)}°</span>
              <span className="text-zinc-400"> / </span>
              <span className="text-blue-500 dark:text-blue-400">{Math.round(d.tMin)}°</span>
            </span>
            {d.precipProb !== undefined && d.precipProb > 0 && (
              <span className="text-[9px] text-sky-600 dark:text-sky-400">💧{d.precipProb}%</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// 24시간 시간대별 기온 — 인라인 SVG 라인/영역 차트. 3시간 간격으로 값·시각 라벨.
function HourlyTempSection({ hourly }: { hourly: ForecastHour[] }) {
  // 빈 배열이면 Math.min/max 가 ±Infinity → span/yAt NaN 으로 SVG 깨짐 → 렌더 생략
  if (hourly.length === 0) return null;
  const temps = hourly.map((h) => h.temp);
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const span = max - min || 1;
  const n = hourly.length;
  const W = 660;
  const H = 132;
  const padX = 12;
  const padTop = 22;
  const padBottom = 24;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;
  const baseY = padTop + innerH;
  const xAt = (i: number) => padX + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const yAt = (t: number) => padTop + innerH - ((t - min) / span) * innerH;
  const pts = hourly.map((h, i) => ({ x: xAt(i), y: yAt(h.temp), temp: h.temp, label: h.label }));
  const linePath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const lastPt = pts[n - 1];
  const firstPt = pts[0];
  const areaPath =
    lastPt && firstPt
      ? `${linePath} L ${lastPt.x.toFixed(1)} ${baseY.toFixed(1)} L ${firstPt.x.toFixed(1)} ${baseY.toFixed(1)} Z`
      : linePath;

  return (
    <section className="mb-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        24시간 시간대별 기온
      </h3>
      <div className="rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-white/10 dark:bg-white/[0.02]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label="24시간 기온 추이"
        >
          <defs>
            <linearGradient id="tempArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fb923c" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#fb923c" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#tempArea)" />
          <path d={linePath} fill="none" stroke="#f97316" strokeWidth="2" strokeLinejoin="round" />
          {pts.map((p, i) =>
            i % 3 === 0 ? (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r="2.5" fill="#f97316" />
                <text
                  x={p.x}
                  y={p.y - 7}
                  textAnchor="middle"
                  fontSize="11"
                  fontFamily="monospace"
                  fill="currentColor"
                  className="text-zinc-700 dark:text-zinc-200"
                >
                  {Math.round(p.temp)}°
                </text>
                <text
                  x={p.x}
                  y={H - 7}
                  textAnchor="middle"
                  fontSize="10"
                  fill="currentColor"
                  className="text-zinc-500"
                >
                  {p.label}
                </text>
              </g>
            ) : null,
          )}
        </svg>
        <p className="mt-1 text-center text-[11px] text-zinc-500">
          최고 {Math.round(max)}° · 최저 {Math.round(min)}° · 출처 Open-Meteo
        </p>
      </div>
    </section>
  );
}
