// 현장 구획 이탈(앰버) 알림 모달 — 히스테리시스 확정 전이 시 표시. 사이렌 없음.
"use client";

import { useEffect, useState } from "react";
import type { VitalSample } from "@safetymonitor/schemas";
import FitToViewport from "./FitToViewport";

const COMPANY_NAME = "스마트인재개발원";

function formatTime(ts?: string) {
  if (!ts) return "--:--:--";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

export function GeofenceAlertModal({
  sample,
  distM,
  radiusM,
  onDismiss,
  onAcknowledge,
  onShowMap,
}: {
  sample: VitalSample;
  // 확정 시점의 구획 중심 거리(m).
  distM: number;
  radiusM: number;
  onDismiss: () => void;
  // 관리자 '확인' 클릭 시 호출 — 이 알림을 대응 확인(ack)으로 기록.
  onAcknowledge?: () => void | Promise<void>;
  // "관제 지도에서 보기" 클릭 시 호출 — 내부 지도 모드 전환·해당 작업자 포커스.
  onShowMap?: () => void;
}) {
  // 관리자 확인 상태 — 확인 클릭 시 ack 기록 후 '확인됨' 표시(팝업은 열린 채 유지).
  const [acked, setAcked] = useState(false);
  const handleAck = () => {
    if (acked) return;
    setAcked(true);
    void onAcknowledge?.();
  };

  // ESC 키로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const mapsLink =
    sample.latitude !== undefined && sample.longitude !== undefined
      ? `https://maps.google.com/?q=${sample.latitude.toFixed(6)},${sample.longitude.toFixed(6)}`
      : undefined;

  const overM = Math.max(0, Math.round(distM - radiusM));
  const title = "현장 구획 이탈 알림";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 dark:bg-black/70"
      onClick={onDismiss}
    >
      {/* 스크롤 대신 화면 비율에 맞춰 축소해 한 화면에 담는다. 내용이 들어가면 배율 1 = 기존과 동일. */}
      <FitToViewport className="w-full max-w-md">
      <div
        onClick={(e) => e.stopPropagation()}
        className={`overflow-hidden rounded-2xl border bg-canvas shadow-xl dark:bg-surface-dark border-amber-500/60 dark:border-amber-500/50`}
      >
        <header
          className={`flex items-center justify-between gap-3 border-b px-5 py-3 border-amber-500/30 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full vital-blink-caution ring-1 dark:ring-white/30 bg-amber-500 ring-amber-300`}
            />
            <h2
              className={`truncate font-display text-base font-bold tracking-tight text-amber-700 dark:text-amber-200`}
            >
              {title}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onAcknowledge &&
              (acked ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-200"
                  aria-label="확인 완료"
                >
                  확인됨
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleAck}
                  aria-label="관리자 확인"
                  title="이 알림을 확인 처리합니다(대응 확인 이력에 기록)"
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-500/60 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-400/40 dark:bg-white/5 dark:text-emerald-200 dark:hover:bg-emerald-500/15"
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12.5l4 4 10-10" />
                  </svg>
                  확인
                </button>
              ))}
            <button
              type="button"
              onClick={onDismiss}
              aria-label="닫기"
              className="rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-muted transition hover:bg-surface-strong dark:border-white/15 dark:text-on-dark-soft dark:hover:bg-white/10"
            >
              닫기
            </button>
          </div>
        </header>

        <div className="space-y-4 px-5 py-4">
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted dark:text-on-dark-soft">작업자</h3>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-2xl font-bold tracking-tight text-ink dark:text-on-dark">
                {sample.workerName?.trim() || sample.workerId}
              </span>
              {sample.employeeId?.trim() && (
                <span className="text-sm text-muted dark:text-on-dark-soft">
                  <span className="mr-1 text-muted-soft">사원번호</span>
                  <span className="font-mono">{sample.employeeId.trim()}</span>
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted">
              <span className="text-muted-soft">소속</span>{" "}
              <span className="text-body dark:text-on-dark-soft">{COMPANY_NAME}</span>
              <span className="mx-2 text-muted-soft">·</span>
              이탈 감지 시각{" "}
              <span className="font-mono">{formatTime(sample.ts)}</span>
            </p>
          </section>

          <section
            className={`rounded-xl border px-4 py-3 border-amber-500/30 bg-amber-50/60 dark:border-amber-500/25 dark:bg-amber-500/[0.08]`}
          >
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted dark:text-on-dark-soft">
              이탈 정보
            </h3>
              <p className="mt-1 text-sm text-body dark:text-on-dark-soft">
                현장 구획 중심에서{" "}
                <span className="font-display text-lg font-bold text-amber-700 dark:text-amber-300">
                  {Math.round(distM)}m
                </span>{" "}
                — 반경 <span className="font-mono">{radiusM}m</span> 기준{" "}
                <span className="font-semibold text-amber-700 dark:text-amber-300">+{overM}m 초과</span>
              </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted dark:text-on-dark-soft">
              GPS 지터 방어를 위해 반경 초과가 연속 관측으로 확정된 경우에만 알림이 발생합니다. 작업자 위치·작업 지시 상태를 확인하세요.
            </p>
          </section>

          {sample.latitude !== undefined && sample.longitude !== undefined && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted dark:text-on-dark-soft">
                현재 위치 (작업자 GPS 좌표)
              </h3>
              <p className="mt-1 font-mono text-sm text-body dark:text-on-dark-soft">
                위도 {sample.latitude.toFixed(6)} · 경도 {sample.longitude.toFixed(6)}
              </p>
              <span className="mt-1 flex items-center gap-3">
                {onShowMap && (
                  <button
                    type="button"
                    onClick={onShowMap}
                    title="관제 웹 작업자 지도로 전환해 이 작업자 위치를 표시합니다"
                    className="text-xs font-semibold text-primary underline underline-offset-2 hover:opacity-80"
                  >
                    🧭 관제 지도에서 보기
                  </button>
                )}
                {mapsLink && (
                  <a
                    href={mapsLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80"
                  >
                    Google Maps
                  </a>
                )}
              </span>
            </section>
          )}
        </div>
      </div>
      </FitToViewport>
    </div>
  );
}
