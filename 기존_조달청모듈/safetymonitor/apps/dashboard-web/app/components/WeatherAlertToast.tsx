// 현장 환경 임계(주의/위험) 발생 시 우상단 경보 팝업 — 60초 자동 닫힘 + 수동 닫기.
// 임계에 걸린 기상 항목(체감온도/미세먼지/풍속/자외선/강수량)의 단계·권고 조치를 요약 표시.
"use client";

import { useEffect, useState } from "react";

import {
  SEVERITY_BADGE_CLASS,
  SEVERITY_LABEL,
  type RuleEvaluation,
} from "../../lib/weather-rules";

type Props = {
  alerts: RuleEvaluation[];
  onClose: () => void;
  onSelect?: (evaluation: RuleEvaluation) => void;
  durationMs?: number;
};

export function WeatherAlertToast({ alerts, onClose, onSelect, durationMs = 60000 }: Props) {
  // 마운트 후 카운트다운 바를 100%→0% 로 durationMs 동안 줄임(남은 시간 시각화).
  const [shrunk, setShrunk] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShrunk(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // ESC 로 닫기 (SOS 모달과 동일)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasDanger = alerts.some((a) => a.currentSeverity === "danger");
  const headerTone = hasDanger
    ? "bg-semantic-down text-white"
    : "bg-amber-500 text-white dark:bg-amber-500";
  const borderTone = hasDanger
    ? "border-semantic-down/70 dark:border-semantic-down/60"
    : "border-amber-500/70 dark:border-amber-500/50";

  // SOS 팝업처럼 화면 중앙 모달 — 배경 클릭/ESC/닫기 버튼으로 해제, 60초 자동 닫힘.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="현장 환경 경보"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 dark:bg-black/70"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md overflow-hidden rounded-lg border ${borderTone} bg-white shadow-2xl dark:bg-[#0d1117]`}
      >
        {/* 헤더 — 위험 빨강 / 주의 amber */}
        <div className={`flex items-center justify-between gap-2 px-3 py-2 ${headerTone}`}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="inline-block h-2 w-2 rounded-full bg-white vital-blink-danger" />
            현장 환경 경보
            <span className="rounded-pill bg-white/20 px-2 py-0.5 text-[10px] font-semibold">
              {alerts.length}건
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="경보 닫기"
            className="rounded px-1.5 py-0.5 text-xs font-semibold text-white/90 hover:bg-white/15"
          >
            닫기 ✕
          </button>
        </div>

        {/* 임계 항목 목록 */}
        <ul className="max-h-[50vh] divide-y divide-hairline overflow-y-auto dark:divide-white/10">
          {alerts.map((a) => (
            <li key={a.itemKey}>
              <button
                type="button"
                onClick={() => onSelect?.(a)}
                className="block w-full px-3 py-2 text-left hover:bg-surface-soft dark:hover:bg-white/5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink dark:text-on-dark">
                    {a.itemLabel}
                  </span>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${SEVERITY_BADGE_CLASS[a.currentSeverity]}`}
                  >
                    {SEVERITY_LABEL[a.currentSeverity]}
                  </span>
                  <span className="ml-auto font-mono text-xs text-body dark:text-on-dark-soft">
                    {a.currentValue}
                  </span>
                </div>
                {a.currentStep && (
                  <>
                    <p className="mt-1 text-xs font-medium text-ink dark:text-on-dark">
                      {a.currentStep.label}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-tight text-body dark:text-on-dark-soft">
                      {a.currentStep.action}
                    </p>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>

        {/* 60초 자동 닫힘 카운트다운 바 */}
        <div className="h-1 w-full bg-hairline dark:bg-white/10">
          <div
            className={hasDanger ? "h-full bg-semantic-down" : "h-full bg-amber-500"}
            style={{ width: shrunk ? "0%" : "100%", transition: `width ${durationMs}ms linear` }}
          />
        </div>
        <p className="px-3 py-1 text-center text-[10px] text-muted dark:text-on-dark-soft">
          1분 후 자동으로 닫힙니다 · 항목 클릭 시 정책 근거 보기
        </p>
      </div>
    </div>
  );
}
