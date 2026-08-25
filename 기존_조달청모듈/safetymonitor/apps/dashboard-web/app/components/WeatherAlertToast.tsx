// 현장 환경 임계(주의/위험) 발생 시 우상단 경보 팝업 — 60초 자동 닫힘 + 수동 닫기.
// 임계에 걸린 기상 항목(체감온도/미세먼지/풍속/자외선/강수량)의 단계·권고 조치를 요약 표시.
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  SEVERITY_BADGE_CLASS,
  SEVERITY_LABEL,
  type RuleEvaluation,
} from "../../lib/weather-rules";
import FitToViewport from "./FitToViewport";

type Props = {
  alerts: RuleEvaluation[];
  onClose: () => void;
  onSelect?: (evaluation: RuleEvaluation) => void;
  onAck?: (evaluation: RuleEvaluation, status: "확인" | "조치완료") => void;
  durationMs?: number;
};

export function WeatherAlertToast({ alerts, onClose, onSelect, onAck, durationMs = 60000 }: Props) {
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
  // ⚠ body 로 포털한다 — 이 모달을 띄우는 현장 환경 패널이 `zoom`(FitToViewport)으로 축소되고,
  //   zoom 안의 position:fixed 는 기준이 뷰포트가 아니라 **축소된 좌표계**로 바뀐다. 패널 안에
  //   그대로 두면 전체 화면 오버레이가 패널 폭(296px)으로 쪼그라든다. 포털을 되돌리지 말 것.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="현장 환경 경보"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 dark:bg-black/70"
    >
      {/* 스크롤 대신 화면 비율에 맞춰 축소해 한 화면에 담는다. 내용이 들어가면 배율 1 = 기존과 동일. */}
      <FitToViewport className="w-full max-w-md">
      <div
        onClick={(e) => e.stopPropagation()}
        className={`overflow-hidden rounded-lg border ${borderTone} bg-canvas dark:bg-surface-dark`}
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
            title="닫기"
            className="shrink-0 rounded-md p-1 text-white/90 transition hover:bg-white/15 hover:text-white"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 임계 항목 목록 */}
        <ul className="wx-cards-scroll max-h-[50vh] divide-y divide-hairline overflow-y-auto dark:divide-white/10">
          {alerts.map((a) => (
            <li key={a.itemKey} className="px-3 py-2">
              <button
                type="button"
                onClick={() => onSelect?.(a)}
                className="block w-full rounded text-left hover:bg-surface-soft dark:hover:bg-white/5"
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
              {onAck && (
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onAck(a, "확인")}
                    className="rounded border border-hairline px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-surface-soft dark:border-white/15 dark:text-on-dark dark:hover:bg-white/5"
                  >
                    확인
                  </button>
                  <button
                    type="button"
                    onClick={() => onAck(a, "조치완료")}
                    className="rounded bg-primary px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90"
                  >
                    조치완료
                  </button>
                  <span className="ml-auto text-[10px] text-muted dark:text-on-dark-soft">
                    확인 시 악화 전까지 안 뜸
                  </span>
                </div>
              )}
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
          확인/조치완료 = DB 기록 후 팝업 억제 · 항목 클릭 = 정책 근거 · 1분 후 자동 닫힘
        </p>
      </div>
      </FitToViewport>
    </div>,
    document.body,
  );
}
