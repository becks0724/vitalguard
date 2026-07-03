// SOS 알람 모달 — manualSos:true sample 수신 시 자동 표시. 작업자 + 생체 + 연락처 + 통화/문자 액션.
"use client";

import { useEffect, useState } from "react";
import type { VitalSample } from "@safetymonitor/schemas";
import { THRESHOLDS, estimateCoreTempC } from "@safetymonitor/analyzers";

import { NearestEmergency } from "./HospitalPanel";

const COMPANY_NAME = "스마트인재개발원";

// 시연용 기본 보호자 연락처 (worker payload 의 guardianName/guardianPhone 이 있으면 그 값이 우선).
const DEMO_GUARDIANS: Record<string, { name: string; phone: string }> = {
  demo_ios_01: { name: "김보호 (배우자)", phone: "010-1234-5678" },
  demo_and_01: { name: "이보호 (자녀)", phone: "010-2345-6789" },
  demo_mock_01: { name: "박보호 (부모)", phone: "010-3456-7890" },
  demo_mock_02: { name: "최보호 (형제)", phone: "010-4567-8901" },
  demo_mock_03: { name: "정보호 (배우자)", phone: "010-5678-9012" },
};

type Severity = "idle" | "normal" | "caution" | "danger";

function hrSeverity(hr?: number): Severity {
  if (hr === undefined) return "idle";
  if (hr >= 130 || hr <= 40) return "danger";
  if (hr >= 110 || hr <= 50) return "caution";
  return "normal";
}

function spo2Severity(spo2?: number): Severity {
  if (spo2 === undefined) return "idle";
  if (spo2 < 88) return "danger";
  if (spo2 < 92) return "caution";
  return "normal";
}

function coreSeverity(skinTempC?: number): Severity {
  if (skinTempC === undefined) return "idle";
  const core = estimateCoreTempC(skinTempC);
  // 추정 체온이 유한수가 아니면(NaN 등) >= 비교가 모두 false 라 'normal'(녹색)로 오분류 → idle 로 차단
  if (!Number.isFinite(core)) return "idle";
  if (core >= THRESHOLDS.coreTemp.dangerC) return "danger";
  if (core >= THRESHOLDS.coreTemp.cautionC) return "caution";
  return "normal";
}

const TONE: Record<Severity, string> = {
  idle: "text-zinc-500",
  normal: "text-emerald-600 dark:text-emerald-300",
  caution: "text-amber-600 vital-blink-caution dark:text-amber-300",
  danger: "text-red-600 vital-blink-danger dark:text-red-400",
};

function formatTime(ts?: string) {
  if (!ts) return "--:--:--";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

// SMS 본문 사전작성 — 보호자/119 받는 사람별 톤 다르게.
// 회사 + 작업자 + 시각 + 위치 (좌표 + Google Maps 링크) + 생체 + 조치 요청
type AlertReason = "sos" | "fall" | "vital";

function buildSmsBody(sample: VitalSample, audience: "guardian" | "119", reason: AlertReason = "sos"): string {
  const lines: string[] = [];
  lines.push(`[SafetyMonitor 긴급 알림]`);
  lines.push(`회사: ${COMPANY_NAME}`);

  const worker = [sample.workerName?.trim(), sample.employeeId?.trim() && `(${sample.employeeId.trim()})`]
    .filter(Boolean)
    .join(" ");
  lines.push(`작업자: ${worker || sample.workerId}`);
  lines.push(`시각: ${formatTime(sample.ts)}`);

  if (sample.latitude !== undefined && sample.longitude !== undefined) {
    const lat = sample.latitude.toFixed(6);
    const lon = sample.longitude.toFixed(6);
    lines.push(`작업자 GPS 좌표: 위도 ${lat}, 경도 ${lon}`);
    lines.push(`지도: https://maps.google.com/?q=${lat},${lon}`);
  } else {
    lines.push(`작업자 GPS 좌표: 미확보 (GPS 신호 약함)`);
  }

  const vitals: string[] = [];
  if (sample.heartRate !== undefined) {
    vitals.push(`심박 ${sample.heartRate}bpm${labelSeverity(hrSeverity(sample.heartRate))}`);
  }
  if (sample.spo2 !== undefined) {
    vitals.push(`SpO₂ ${sample.spo2}%${labelSeverity(spo2Severity(sample.spo2))}`);
  }
  if (sample.skinTempC !== undefined) {
    const core = estimateCoreTempC(sample.skinTempC).toFixed(1);
    vitals.push(`체온추정 ${core}℃${labelSeverity(coreSeverity(sample.skinTempC))}`);
  }
  if (vitals.length > 0) {
    lines.push(`생체: ${vitals.join(", ")}`);
  }

  if (audience === "guardian") {
    lines.push(
      reason === "fall"
        ? `조치: 낙상 경보가 감지되었습니다. 즉시 안부 확인 부탁드리며, 응답이 없으시면 119 신고를 권장합니다.`
        : reason === "vital"
        ? `조치: 작업자 생체 위험 신호가 감지되었습니다. 안부 확인 부탁드리며, 응답이 없으시면 119 신고를 권장합니다.`
        : `조치: SOS 가 발신되었습니다. 안부 확인 부탁드리며, 응답이 없으시면 119 신고를 권장합니다.`,
    );
  } else {
    lines.push(
      reason === "fall"
        ? `조치: 작업자 낙상 경보가 감지되었습니다. 위 좌표로 119 출동을 요청드립니다.`
        : reason === "vital"
        ? `조치: 작업자 생체 위험이 감지되었습니다. 위 좌표로 119 출동을 요청드립니다.`
        : `조치: 산업 현장 응급 상황입니다. 위 좌표로 119 출동을 요청드립니다.`,
    );
  }
  return lines.join("\n");
}

function labelSeverity(s: Severity): string {
  if (s === "danger") return " (위험)";
  if (s === "caution") return " (주의)";
  return "";
}

export function SosAlertModal({
  sample,
  onDismiss,
  onContact,
  onAcknowledge,
  acknowledged,
  reason = "sos",
  region,
}: {
  sample: VitalSample;
  onDismiss: () => void;
  // 보호자/119 에 전화·문자 시 호출 — 무사고 카운터 초기화 트리거.
  onContact?: () => void;
  // 관리자 '확인' 클릭 시 호출 — 이 알림을 대응 확인(ack)으로 기록. 있으면 헤더에 확인 버튼 노출.
  onAcknowledge?: () => void | Promise<void>;
  // 이미 확인된 알림이면 true(초기 확인 상태).
  acknowledged?: boolean;
  // "sos" = 단말 SOS 발신, "vital" = 센서 생체 위험 자동 감지. 헤더·문구만 분기(동일 대응 액션).
  reason?: AlertReason;
  // 현장 지역 키워드(예: "광주 동구") — 가장 가까운 응급실/병원 조회용. 없으면 섹션 미표시.
  region?: string;
}) {
  // 관리자 확인 상태 — 확인 클릭 시 ack 기록 후 '확인됨' 표시(팝업은 열린 채 유지).
  const [acked, setAcked] = useState(acknowledged ?? false);
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

  const fallback = DEMO_GUARDIANS[sample.workerId];
  const guardianName = sample.guardianName ?? fallback?.name ?? "보호자 미등록";
  const guardianPhone = sample.guardianPhone ?? fallback?.phone ?? "";

  const hrSev = hrSeverity(sample.heartRate);
  const spo2Sev = spo2Severity(sample.spo2);
  const coreSev = coreSeverity(sample.skinTempC);
  const core = sample.skinTempC === undefined ? undefined : estimateCoreTempC(sample.skinTempC);

  // reason="vital" 경보용 위험 메트릭 사유 — 헤더 부제에 표시(danger 메트릭만).
  const dangerMetrics = [
    hrSev === "danger" ? "심박" : null,
    spo2Sev === "danger" ? "산소포화도" : null,
    coreSev === "danger" ? "체온" : null,
  ].filter(Boolean) as string[];

  const guardianSmsBody = buildSmsBody(sample, "guardian", reason);
  const emergencySmsBody = buildSmsBody(sample, "119", reason);
  const mapsLink =
    sample.latitude !== undefined && sample.longitude !== undefined
      ? `https://maps.google.com/?q=${sample.latitude.toFixed(6)},${sample.longitude.toFixed(6)}`
      : undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        reason === "fall" ? "낙상 긴급 알람" : reason === "vital" ? "생체 위험 경보" : "SOS 긴급 알람"
      }
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 dark:bg-black/70"
      onClick={onDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-lg border border-red-500/70 bg-canvas dark:border-red-500/60 dark:bg-surface-dark"
      >
        <header className="flex items-center justify-between gap-3 border-b border-red-500/40 bg-red-100 px-5 py-3 dark:bg-red-500/10">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-block h-3 w-3 shrink-0 rounded-full bg-red-500 vital-blink-danger ring-1 ring-red-300 dark:ring-white/30" />
            <h2 className="truncate text-base font-bold text-red-700 dark:text-red-200">
              {reason === "fall" ? "낙상 긴급 알람" : reason === "vital" ? "생체 위험 경보" : "SOS 긴급 알람"}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onAcknowledge &&
              (acked ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-200"
                  aria-label="확인 완료"
                >
                  <CheckIcon filled />
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
                  <CheckIcon />
                  확인
                </button>
              ))}
            <button
              type="button"
              onClick={onDismiss}
              aria-label="닫기"
              className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-white/15 dark:text-zinc-400 dark:hover:bg-white/10"
            >
              닫기
            </button>
          </div>
        </header>

        <div className="space-y-4 px-5 py-4">
          <section>
            <h3 className="text-xs text-zinc-600 dark:text-zinc-400">작업자</h3>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-zinc-900 dark:text-white">
                {sample.workerName?.trim() || sample.workerId}
              </span>
              {sample.employeeId?.trim() && (
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  <span className="mr-1 text-zinc-500">사원번호</span>
                  <span className="font-mono">{sample.employeeId.trim()}</span>
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              <span className="text-zinc-500">소속</span>{" "}
              <span className="text-zinc-700 dark:text-zinc-300">{COMPANY_NAME}</span>
              <span className="mx-2 text-zinc-400 dark:text-zinc-700">·</span>
              {reason === "fall" ? "낙상 감지 시각" : reason === "vital" ? "위험 감지 시각" : "SOS 발신 시각"}{" "}
              <span className="font-mono">{formatTime(sample.ts)}</span>
            </p>
            {reason === "vital" && dangerMetrics.length > 0 && (
              <p className="mt-1 text-xs font-semibold text-red-600 dark:text-red-300">
                위험 감지: {dangerMetrics.join(" · ")}
              </p>
            )}
          </section>

          <section>
            <h3 className="text-xs text-zinc-600 dark:text-zinc-400">최신 생체 데이터</h3>
            <dl className="mt-2 grid grid-cols-3 gap-2 rounded border border-zinc-200 bg-zinc-50 p-3 text-center dark:border-white/10 dark:bg-white/[0.02]">
              <MetricCell label="심박" value={sample.heartRate} unit="bpm" severity={hrSev} decimals={0} />
              <MetricCell label="산소포화도" value={sample.spo2} unit="%" severity={spo2Sev} decimals={0} />
              <MetricCell
                label={`체온 추정`}
                value={core}
                unit="℃"
                severity={coreSev}
                decimals={1}
                footnote={
                  sample.skinTempC === undefined
                    ? undefined
                    : `손목 ${sample.skinTempC.toFixed(1)}℃`
                }
              />
            </dl>
          </section>

          <section>
            <h3 className="text-xs text-zinc-600 dark:text-zinc-400">
              현장 위치 <span className="text-zinc-500">(작업자 GPS 좌표)</span>
            </h3>
            {mapsLink ? (
              <div className="mt-1 flex flex-col gap-1">
                <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                  위도 {sample.latitude!.toFixed(6)} · 경도 {sample.longitude!.toFixed(6)}
                </span>
                <a
                  href={mapsLink}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs text-cyan-700 underline decoration-cyan-500/60 underline-offset-2 hover:text-cyan-800 dark:text-cyan-300 dark:decoration-cyan-400/40 dark:hover:text-cyan-200"
                >
                  🗺️ 지도에서 보기 (Google Maps)
                </a>
              </div>
            ) : (
              <p className="mt-1 text-xs text-zinc-500">
                좌표 미확보 — 작업자 폰의 위치 권한 또는 GPS 수신 상태 확인 필요
              </p>
            )}
          </section>

          <NearestEmergency
            lat={sample.latitude}
            lon={sample.longitude}
            region={region ?? ""}
          />

          <section>
            <h3 className="text-xs text-zinc-600 dark:text-zinc-400">보호자 연락처</h3>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-sm text-zinc-900 dark:text-white">{guardianName}</span>
              {guardianPhone && (
                <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">{guardianPhone}</span>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <ContactButton
                kind="tel"
                phone={guardianPhone}
                label="📞 전화"
                disabled={!guardianPhone}
                onContact={onContact}
              />
              <ContactButton
                kind="sms"
                phone={guardianPhone}
                label="💬 문자"
                body={guardianSmsBody}
                disabled={!guardianPhone}
                onContact={onContact}
              />
            </div>
          </section>

          <section>
            <h3 className="text-xs text-zinc-600 dark:text-zinc-400">119 신고</h3>
            <p className="mt-1 text-xs text-zinc-500">
              산업안전 사고 시 응급 의료 — 자동 119 연계는 2차 (현재는 수동)
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <ContactButton kind="tel" phone="119" label="📞 119 전화" emphasis onContact={onContact} />
              <ContactButton
                kind="sms"
                phone="119"
                label="💬 119 문자"
                body={emergencySmsBody}
                emphasis
                onContact={onContact}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// 확인 버튼 아이콘 — 체크(빈/채움) 라인 SVG(무의존).
function CheckIcon({ filled }: { filled?: boolean }) {
  return filled ? (
    <svg viewBox="0 0 20 20" width="13" height="13" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}

function MetricCell({
  label,
  value,
  unit,
  severity,
  decimals,
  footnote,
}: {
  label: string;
  value: number | undefined;
  unit: string;
  severity: Severity;
  decimals: number;
  footnote?: string;
}) {
  return (
    <div>
      <div className="text-[10px] text-zinc-600 dark:text-zinc-400">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${TONE[severity]}`}>
        {value === undefined ? "--" : value.toFixed(decimals)}
        <span className="ml-1 text-[10px] font-normal text-zinc-600 dark:text-zinc-400">{unit}</span>
      </div>
      {footnote && (
        <div className="mt-0.5 text-[10px] text-zinc-500">{footnote}</div>
      )}
    </div>
  );
}

function ContactButton({
  kind,
  phone,
  label,
  body,
  emphasis,
  disabled,
  onContact,
}: {
  kind: "tel" | "sms";
  phone: string;
  label: string;
  body?: string;
  emphasis?: boolean;
  disabled?: boolean;
  onContact?: () => void;
}) {
  const sanitized = phone.replace(/[^0-9+]/g, "");
  // iOS Messages / macOS Messages 모두 `sms:<number>?body=<encoded>` 형식 지원.
  const href = disabled
    ? "#"
    : kind === "sms" && body
      ? `sms:${sanitized}?body=${encodeURIComponent(body)}`
      : `${kind}:${sanitized}`;
  const cls = disabled
    ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-white/10 dark:bg-white/5 dark:text-zinc-500"
    : emphasis
      ? "border-red-500/70 bg-red-100 text-red-800 hover:bg-red-200 dark:border-red-500/60 dark:bg-red-500/15 dark:text-red-100 dark:hover:bg-red-500/25"
      : "border-cyan-500/60 bg-cyan-100 text-cyan-800 hover:bg-cyan-200 dark:border-cyan-400/50 dark:bg-cyan-400/10 dark:text-cyan-100 dark:hover:bg-cyan-400/20";

  return (
    <a
      href={href}
      onClick={disabled ? (e) => e.preventDefault() : () => onContact?.()}
      aria-disabled={disabled}
      title={body ? `SMS 미리보기:\n\n${body}` : undefined}
      className={`flex items-center justify-center gap-1 rounded border px-3 py-2 text-sm font-semibold transition ${cls}`}
    >
      {label}
    </a>
  );
}
