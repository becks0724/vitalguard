// SOS 알람 모달 — manualSos:true sample 수신 시 자동 표시. 작업자 + 생체 + 연락처 + 통화/문자 액션.
"use client";

import { useEffect, useState } from "react";
import type { VitalSample } from "@safetymonitor/schemas";

import FitToViewport from "./FitToViewport";
import { NearestEmergency } from "./HospitalPanel";
import { heartRateStatus, skinTempStatus, spo2Status, type Status } from "../../lib/severity";
import { formatSpo2Age, spo2AgeMs } from "../../lib/spo2-freshness";
import { dangerMeasuredAt, kstClock } from "../../lib/vital-measured-at";

const COMPANY_NAME = "스마트인재개발원";

// 시연용 기본 보호자 연락처 (worker payload 의 guardianName/guardianPhone 이 있으면 그 값이 우선).
const DEMO_GUARDIANS: Record<string, { name: string; phone: string }> = {
  demo_ios_01: { name: "김보호 (배우자)", phone: "010-1234-5678" },
  demo_and_01: { name: "이보호 (자녀)", phone: "010-2345-6789" },
  demo_mock_01: { name: "박보호 (부모)", phone: "010-3456-7890" },
  demo_mock_02: { name: "최보호 (형제)", phone: "010-4567-8901" },
  demo_mock_03: { name: "정보호 (배우자)", phone: "010-5678-9012" },
};

// 심박·SpO₂ 판정은 lib/severity 단일 소스(heartRateStatus/spo2Status) 재사용 — 활동 미전달=안정 임계.
type Severity = Status;

/**
 * ★ 2026-09-18 — **피부온을 그대로 판정한다.** 종전에는 `estimateCoreTempC`(= 피부온 + 0.5)를
 * 심부 추정이라 부르고 심부 임계로 쟀는데, 그 오프셋은 출처가 없고 값도 형태도 틀렸다.
 * 실측 — 최근 30일 6,168행에 그 계산을 걸면 35℃ 미만 1,111행(18.0%) · 최저 25.98℃ 가 나온다.
 * 임계는 `THRESHOLDS.skinTemp`(워치와 같은 값) — 단일 소스는 lib/severity 의 skinTempStatus.
 */
function skinSeverity(skinTempC?: number): Severity {
  if (skinTempC === undefined) return "idle";
  // 값이 유한수가 아니면(NaN 등) >= 비교가 모두 false 라 'normal'(녹색)로 오분류 → idle 로 차단
  if (!Number.isFinite(skinTempC)) return "idle";
  return skinTempStatus(skinTempC);
}

const TONE: Record<Severity, string> = {
  idle: "text-muted",
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
    vitals.push(`심박 ${sample.heartRate}bpm${labelSeverity(heartRateStatus(sample.heartRate))}`);
  }
  if (sample.spo2 !== undefined) {
    // 측정 시각을 붙인다(2026-09-29 경보 14212) — 산소포화도는 최대 30분 전 값이 겹쳐 보인다.
    //   받는 쪽이 「방금 잰 값」으로 읽지 않게 한다.
    const at = sample.spo2MeasuredAt ? kstClock(sample.spo2MeasuredAt) : null;
    vitals.push(`SpO₂ ${sample.spo2}%${labelSeverity(spo2Status(sample.spo2))}${at ? ` ${at} 측정` : ""}`);
  }
  // ⚠ **문자에는 「체온추정」이라 적지 않는다**(2026-09-18). 이 값은 `피부온 + 0.5` 이고
  //    그 오프셋은 근거가 확인된 적이 없다(`thresholds.ts` wristToCoreOffsetC 주석).
  //    실측 — 최근 30일 피부온 6,168행에 이 계산을 걸면 **35℃ 미만 1,111행(18.0%) ·
  //    32℃ 미만 51행 · 최저 25.98℃** 가 나온다. 정상 작업자의 문자에 「체온추정 26.0℃」가
  //    실리면 119 는 중증 저체온 응급으로 읽는다 — 수신자가 되돌릴 수 없는 오독이다.
  //    ⟹ 실측 피부온을 실측 피부온이라 적는다. 심부 추정은 심박 칼만(`coreTempStatusC`)이
  //      따로 있으나 그 값은 이 모달에 들어오지 않는다.
  //    ★ 판정 표시 `(위험)`은 **되살렸다**. 1차(dcc36c0c)에서는 그 판정도 `+0.5` 로 만든 값이라
  //      함께 뺐는데, 이제 피부온 임계로 재므로 119 가 읽을 근거가 생겼다.
  if (sample.skinTempC !== undefined) {
    const skin = sample.skinTempC.toFixed(1);
    vitals.push(`피부온 ${skin}℃${labelSeverity(skinSeverity(sample.skinTempC))} (심부체온 아님)`);
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
  onShowMap,
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
  // "관제 지도에서 보기" 클릭 시 호출 — 관제 웹 내부 지도 모드로 전환·해당 작업자 포커스.
  onShowMap?: () => void;
}) {
  // 관리자 확인 상태 — 확인 클릭 시 ack 기록 후 '확인됨' 표시(팝업은 열린 채 유지).
  const [acked, setAcked] = useState(acknowledged ?? false);
  const handleAck = () => {
    if (acked) return;
    setAcked(true);
    void onAcknowledge?.();
  };

  // 측정 경과(「8분 전」)용 시계 — 팝업이 열려 있는 동안 30초마다 갱신.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

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

  const hrSev = heartRateStatus(sample.heartRate);
  const spo2Sev = spo2Status(sample.spo2);
  const coreSev = skinSeverity(sample.skinTempC);
  // ★ 2026-09-18 — 화면도 문자와 같은 값을 보여준다. 종전에는 카드가 `피부온 + 0.5` 를
  //   심부 추정이라 띄워서 같은 순간에 화면과 문자가 다른 숫자·다른 이름을 썼다.
  const core = sample.skinTempC;

  // reason="vital" 경보용 위험 메트릭 사유 — 헤더 부제에 표시(danger 메트릭만).
  const dangerMetrics = [
    hrSev === "danger" ? "심박" : null,
    spo2Sev === "danger" ? "산소포화도" : null,
    coreSev === "danger" ? "피부온" : null,
  ].filter(Boolean) as string[];

  // 위험 값의 측정 시각과 경과 — 표본 도착 시각(ts)은 산소포화도 측정보다 최대 30분 늦다(2026-09-29 경보 14212).
  const detectedAt =
    reason === "vital"
      ? dangerMeasuredAt(sample, { spo2: spo2Sev === "danger", hr: hrSev === "danger" })
      : sample.ts;
  const detectedAtMs = Date.parse(detectedAt);
  const detectedAge = Number.isNaN(detectedAtMs) ? null : Math.max(0, nowMs - detectedAtMs);
  const spo2Age = spo2AgeMs(sample, nowMs);
  const spo2Clock = sample.spo2MeasuredAt ? kstClock(sample.spo2MeasuredAt) : null;
  const spo2Footnote =
    [spo2Clock && `${spo2Clock} 측정`, spo2Age !== null && formatSpo2Age(spo2Age)]
      .filter(Boolean)
      .join(" · ") || undefined;

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
      {/* 화면이 낮으면 119 신고 버튼에 손이 닿지 않았다. 스크롤 대신 **비율 그대로 축소해 한 화면에**
          담는다(FitToViewport). 내용이 이미 들어가면 배율 1 이라 아무것도 바뀌지 않는다. */}
      <FitToViewport className="w-full max-w-md">
      <div
        onClick={(e) => e.stopPropagation()}
        className="overflow-hidden rounded-2xl border border-red-500/60 bg-canvas shadow-xl dark:border-red-500/50 dark:bg-surface-dark"
      >
        <header className="flex items-center justify-between gap-3 border-b border-red-500/30 bg-red-50 px-5 py-3 dark:border-red-500/30 dark:bg-red-500/10">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 vital-blink-danger ring-1 ring-red-300 dark:ring-white/30" />
            <h2 className="truncate font-display text-base font-bold tracking-tight text-red-700 dark:text-red-200">
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
              {reason === "fall" ? "낙상 감지 시각" : reason === "vital" ? "위험 감지 시각" : "SOS 발신 시각"}{" "}
              <span className="font-mono">{formatTime(detectedAt)}</span>
              {reason === "vital" && detectedAge !== null && (
                <span className="ml-1 text-muted-soft">({formatSpo2Age(detectedAge)})</span>
              )}
            </p>
            {reason === "vital" && dangerMetrics.length > 0 && (
              <p className="mt-1 text-xs font-semibold text-red-600 dark:text-red-300">
                위험 감지: {dangerMetrics.join(" · ")}
              </p>
            )}
          </section>

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted dark:text-on-dark-soft">최신 생체 데이터</h3>
            <dl className="mt-2 grid grid-cols-3 gap-2 rounded-xl border border-hairline bg-surface-soft p-3 text-center dark:border-white/10 dark:bg-canvas/[0.02]">
              <MetricCell label="심박" value={sample.heartRate} unit="bpm" severity={hrSev} decimals={0} />
              <MetricCell
                label="산소포화도"
                value={sample.spo2}
                unit="%"
                severity={spo2Sev}
                decimals={0}
                footnote={sample.spo2 === undefined ? undefined : spo2Footnote}
              />
              <MetricCell
                label={`피부온`}
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
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted dark:text-on-dark-soft">
              현장 위치 <span className="font-normal normal-case tracking-normal text-muted-soft">(작업자 GPS 좌표)</span>
            </h3>
            {mapsLink ? (
              <div className="mt-1 flex flex-col gap-1">
                <span className="font-mono text-xs text-body dark:text-on-dark-soft">
                  위도 {sample.latitude!.toFixed(6)} · 경도 {sample.longitude!.toFixed(6)}
                </span>
                <span className="flex items-center gap-3">
                  {onShowMap && (
                    <button
                      type="button"
                      onClick={onShowMap}
                      title="관제 웹 작업자 지도로 전환해 이 작업자 위치를 표시합니다"
                      className="text-xs font-semibold text-primary underline underline-offset-2 transition hover:opacity-80"
                    >
                      🧭 관제 지도에서 보기
                    </button>
                  )}
                  <a
                    href={mapsLink}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xs font-medium text-primary underline underline-offset-2 transition hover:opacity-80"
                  >
                    🗺️ Google Maps
                  </a>
                </span>
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted">
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
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted dark:text-on-dark-soft">보호자 연락처</h3>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-sm text-ink dark:text-on-dark">{guardianName}</span>
              {guardianPhone && (
                <span className="font-mono text-sm text-body dark:text-on-dark-soft">{guardianPhone}</span>
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
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted dark:text-on-dark-soft">119 신고</h3>
            <p className="mt-1 text-xs text-muted">
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
      </FitToViewport>
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
      <div className="text-[10px] text-muted dark:text-on-dark-soft">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${TONE[severity]}`}>
        {value === undefined ? "--" : value.toFixed(decimals)}
        <span className="ml-1 text-[10px] font-normal text-muted dark:text-on-dark-soft">{unit}</span>
      </div>
      {footnote && (
        <div className="mt-0.5 text-[10px] text-muted-soft">{footnote}</div>
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
    ? "cursor-not-allowed border-hairline bg-surface-soft text-muted-soft dark:border-white/10 dark:bg-white/5 dark:text-muted"
    : emphasis
      ? "border-red-500/70 bg-red-100 text-red-800 hover:bg-red-200 dark:border-red-500/60 dark:bg-red-500/15 dark:text-red-100 dark:hover:bg-red-500/25"
      : "border-hairline bg-surface-strong text-body hover:bg-surface-card dark:border-white/15 dark:bg-white/5 dark:text-on-dark-soft dark:hover:bg-white/10";

  return (
    <a
      href={href}
      onClick={disabled ? (e) => e.preventDefault() : () => onContact?.()}
      aria-disabled={disabled}
      title={body ? `SMS 미리보기:\n\n${body}` : undefined}
      className={`flex items-center justify-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold transition ${cls}`}
    >
      {label}
    </a>
  );
}
