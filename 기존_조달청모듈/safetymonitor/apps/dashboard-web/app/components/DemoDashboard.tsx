"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { VitalSample } from "@safetymonitor/schemas";
import {
  THRESHOLDS,
  estimateCoreTempC,
  computeStressIndex,
  stressInputsFromSample,
  type StressLevel,
  type StressResult,
} from "@safetymonitor/analyzers";

import { heartRateStatus, spo2Status, coreTempStatus, workActivity } from "../../lib/severity";
import { AdminExportModal, type SiteInfo } from "./AdminExportModal";
import { ExpandableTabs } from "./ExpandableTabs";
import { KoshaAccidentCaseCard } from "./KoshaAccidentCaseCard";
import { getSessionRole, getSessionToken, useSession } from "./LoginGate";
import { KoshaAccidentTicker } from "./KoshaAccidentTicker";
import { SafetySignalBoard, type WorkerSignal } from "./SafetySignalBoard";
import { RadarRealtime } from "./RadarRealtime";
import { TyphoonTrack } from "./TyphoonTrack";
import { WarningVideoPanel } from "./WarningVideoPanel";
import {
  AedAlertTable,
  GasDetectorTable,
  SiteMetricChartPanel,
  type SiteMetric,
} from "./SiteSafetyTables";
import { SosAlertModal } from "./SosAlertModal";
import { ThemeToggle } from "./ThemeToggle";
import { VitalHistoryPanel } from "./VitalHistoryPanel";
import { WeatherStrip } from "./WeatherStrip";
import { WidgetCarousel } from "./WidgetCarousel";
import { CctvQuadView } from "./CctvQuadView";
import { WorkerQueueModal } from "./WorkerQueueModal";
import SafetyCostAuditBoard from "./SafetyCostAuditBoard";
import { SectionPager } from "./SectionPager";
import { UserManagementModal } from "./UserManagementModal";

type HistoryMetric = "heartRate" | "spo2" | "skinTempC" | "fall";
type Selection = { workerId: string; metric: HistoryMetric };

type MockVitalResponse = {
  latest: VitalSample[];
  recent: VitalSample[];
  totalPersisted?: number;
  countsByWorker?: Record<string, number>;
  // 직급/직책 관제 웹 오버라이드(workerId → 직급) — 폰 발신값(sample.jobTitle)보다 우선.
  workerProfiles?: Record<string, string>;
};

const SLOT_COUNT = 100;
const SLOTS_STORAGE_KEY = "safetymonitor.slots.v1";
const SLIDEMODE_STORAGE_KEY = "safetymonitor.slidemode.v1";
// 표 행 높이(h-12=48px) — 세로 자동 슬라이딩의 한 벌(firstCopyHeight) 계산용
const TABLE_ROW_PX = 48;
// 작업자 표 13열 그리드 — 헤더·행 공용. [정렬핸들·작업자·직급·심박·SpO₂·체온·낙상·스트레스·신호·상태·수신·누적·해제]
const TABLE_GRID =
  "grid items-center gap-x-2 grid-cols-[1.75rem_minmax(8rem,1.2fr)_5.5rem_4.5rem_4.5rem_6rem_5.5rem_5rem_3.5rem_4.5rem_5rem_4.5rem_3rem]";

// 테스트용 가상 작업자 12명 — 대기 큐에 항상 노출(슬롯 등록 → 표 세로 자동 슬라이딩 검증용).
// 서버로 전송되지 않는 클라이언트 전용 픽스처. ts 는 렌더 시 현재 시각으로 주입.
// VW-004(주의)·VW-005(위험) 는 이상 자동 스크롤+빨강 링 시연용. 나머지는 정상치(순수 슬라이딩 검증).
const VIRTUAL_WORKER_TEMPLATES: Omit<VitalSample, "ts">[] = [
  { workerId: "VW-001", workerName: "가상작업자 1", employeeId: "VW-001", jobTitle: "현장소장", heartRate: 78, spo2: 98, skinTempC: 36.4, batteryPct: 88 },
  { workerId: "VW-002", workerName: "가상작업자 2", employeeId: "VW-002", jobTitle: "안전관리자", heartRate: 82, spo2: 97, skinTempC: 36.6, batteryPct: 76 },
  { workerId: "VW-003", workerName: "가상작업자 3", employeeId: "VW-003", jobTitle: "공사부장", heartRate: 75, spo2: 99, skinTempC: 36.3, batteryPct: 64 },
  { workerId: "VW-004", workerName: "가상작업자 4", employeeId: "VW-004", jobTitle: "작업반장", heartRate: 118, spo2: 94, skinTempC: 36.9, batteryPct: 55 },
  { workerId: "VW-005", workerName: "가상작업자 5", employeeId: "VW-005", jobTitle: "철근공", heartRate: 138, spo2: 88, skinTempC: 37.5, batteryPct: 41 },
  { workerId: "VW-006", workerName: "가상작업자 6", employeeId: "VW-006", jobTitle: "형틀목공", heartRate: 80, spo2: 98, skinTempC: 36.5, batteryPct: 92 },
  { workerId: "VW-007", workerName: "가상작업자 7", employeeId: "VW-007", jobTitle: "전기공", heartRate: 72, spo2: 99, skinTempC: 36.2, batteryPct: 81 },
  { workerId: "VW-008", workerName: "가상작업자 8", employeeId: "VW-008", jobTitle: "배관공", heartRate: 88, spo2: 97, skinTempC: 36.7, batteryPct: 69 },
  { workerId: "VW-009", workerName: "가상작업자 9", employeeId: "VW-009", jobTitle: "타워크레인 기사", heartRate: 76, spo2: 98, skinTempC: 36.4, batteryPct: 73 },
  { workerId: "VW-010", workerName: "가상작업자 10", employeeId: "VW-010", jobTitle: "콘크리트공", heartRate: 84, spo2: 96, skinTempC: 36.5, batteryPct: 58 },
  { workerId: "VW-011", workerName: "가상작업자 11", employeeId: "VW-011", jobTitle: "비계공", heartRate: 79, spo2: 99, skinTempC: 36.3, batteryPct: 90 },
  { workerId: "VW-012", workerName: "가상작업자 12", employeeId: "VW-012", jobTitle: "신호수", heartRate: 81, spo2: 98, skinTempC: 36.6, batteryPct: 47 },
];

function isVirtualWorker(workerId: string | undefined): boolean {
  return !!workerId && workerId.startsWith("VW-");
}
type SlotAssignments = (string | null)[];

function loadSlots(): SlotAssignments {
  if (typeof window === "undefined") {
    return Array(SLOT_COUNT).fill(null);
  }
  try {
    const raw = window.localStorage.getItem(SLOTS_STORAGE_KEY);
    if (!raw) return Array(SLOT_COUNT).fill(null);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return Array(SLOT_COUNT).fill(null);
    const normalized = Array.from({ length: SLOT_COUNT }, (_, i) =>
      typeof parsed[i] === "string" ? (parsed[i] as string) : null,
    );
    return normalized;
  } catch {
    return Array(SLOT_COUNT).fill(null);
  }
}

function saveSlots(slots: SlotAssignments) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SLOTS_STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // localStorage 사용 불가 환경(시크릿/스토리지 꽉 참)은 조용히 무시
  }
}

function formatTime(ts?: string) {
  if (!ts) {
    return "--:--:--";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

function formatTemp(value?: number) {
  return value === undefined ? "--" : value.toFixed(1);
}

// HR/SpO2 는 의학 표준 정수 표시 (폰이 raw double 보내도 round)
function formatInt(value?: number) {
  return value === undefined ? "--" : Math.round(value).toString();
}

// 누적 추세 차트는 자체 웨어러블 디바이스가 실측한 메트릭에만 표시.
// 폰 측 store 에 해당 metric 값이 실시간 들어와 있는 경우만 live 로 판정.
function hasLiveMetric(
  sample: VitalSample | undefined,
  metric: HistoryMetric,
  lastFallTs: string | undefined,
): boolean {
  if (metric === "fall") return lastFallTs !== undefined;
  if (!sample) return false;
  const value = sample[metric];
  return typeof value === "number" && Number.isFinite(value);
}

type VitalStatus = "idle" | "normal" | "caution" | "danger";

// 메트릭별 위험도 판정(heartRateStatus / spo2Status / coreTempStatus)은 lib/severity.ts 에서 import.
// 임계는 analyzers THRESHOLDS 단일 source — 컴포넌트에 매직넘버로 중복 정의하지 않는다.

// 정상은 블링크 없이 정적 녹색. 주의/위험만 블링크 (속도 차등).
const STATUS_CLASS: Record<VitalStatus, string> = {
  idle: "text-muted",
  normal: "text-semantic-up",
  caution: "text-amber-600 vital-blink-caution dark:text-amber-300",
  danger: "text-semantic-down vital-blink-danger",
};

const STATUS_LABEL: Record<VitalStatus, string> = {
  idle: "대기",
  normal: "정상",
  caution: "주의",
  danger: "위험",
};

// 카드 전체에 worst-of 상태 — 신호등 인디케이터 + 상태 배지 라벨용
function overallStatus(sample?: VitalSample): VitalStatus {
  if (!sample) return "idle";
  const statuses: VitalStatus[] = [
    heartRateStatus(sample.heartRate, workActivity(sample)), // 작업 중이면 작업부하 밴드
    spo2Status(sample.spo2),
    coreTempStatus(sample.skinTempC),
  ];
  if (statuses.includes("danger")) return "danger";
  if (statuses.includes("caution")) return "caution";
  if (statuses.includes("normal")) return "normal";
  return "idle";
}

// 작업자 상태 종합 — 워치 native 낙상 감지 + 폰 SOS + 생체 worst-of 조합.
// 낙상/SOS 는 워치(Apple Watch · Galaxy Watch) 의 자체 fall detection 이 트리거하는 신호로 받음.
type WorkerStatus =
  | { label: "낙상 감지"; tone: "danger" }
  | { label: "SOS 요청"; tone: "danger" }
  | { label: "위험"; tone: "danger" }
  | { label: "주의"; tone: "caution" }
  | { label: "정상"; tone: "normal" }
  | { label: "대기"; tone: "idle" };

function workerStatus(sample?: VitalSample): WorkerStatus {
  if (!sample) return { label: "대기", tone: "idle" };
  if (sample.fallDetected) return { label: "낙상 감지", tone: "danger" };
  if (sample.manualSos) return { label: "SOS 요청", tone: "danger" };
  const overall = overallStatus(sample);
  if (overall === "danger") return { label: "위험", tone: "danger" };
  if (overall === "caution") return { label: "주의", tone: "caution" };
  if (overall === "normal") return { label: "정상", tone: "normal" };
  return { label: "대기", tone: "idle" };
}

const FOCUS_CLASS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const SITE_INFO_STORAGE_KEY = "safetymonitor.site-info.v1";
// 마지막 사고 시각 — SOS 후 보호자/119 연락 시 기록. 무사고 카운터는 이 시각부터 다시 셈.
const ACCIDENT_STORAGE_KEY = "safetymonitor.last-accident.v1";
const DEFAULT_SITE_INFO: SiteInfo = {
  companyName: "스마트인재개발원",
  siteName: "",
  constructionType: "",
  address: "",
  startDate: "",
  completionDate: "",
};

function loadSiteInfo(): SiteInfo {
  if (typeof window === "undefined") return DEFAULT_SITE_INFO;
  try {
    const raw = window.localStorage.getItem(SITE_INFO_STORAGE_KEY);
    if (!raw) return DEFAULT_SITE_INFO;
    const parsed = JSON.parse(raw) as Partial<SiteInfo>;
    return {
      companyName: parsed.companyName ?? DEFAULT_SITE_INFO.companyName,
      siteName: parsed.siteName ?? DEFAULT_SITE_INFO.siteName,
      constructionType: parsed.constructionType ?? DEFAULT_SITE_INFO.constructionType,
      address: parsed.address ?? DEFAULT_SITE_INFO.address,
      startDate: parsed.startDate ?? DEFAULT_SITE_INFO.startDate,
      completionDate: parsed.completionDate ?? DEFAULT_SITE_INFO.completionDate,
    };
  } catch {
    return DEFAULT_SITE_INFO;
  }
}

function saveSiteInfo(siteInfo: SiteInfo) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SITE_INFO_STORAGE_KEY, JSON.stringify(siteInfo));
  } catch {
    // localStorage 사용 불가 환경은 현재 화면 상태만 유지
  }
}

function siteInfoRows(siteInfo: SiteInfo) {
  return [
    { label: "기업명", value: siteInfo.companyName || "미입력" },
    { label: "현장명", value: siteInfo.siteName || "미입력" },
    { label: "공사종류", value: siteInfo.constructionType || "미입력" },
    { label: "주소", value: siteInfo.address || "미입력" },
    { label: "착수 날짜", value: formatSiteDate(siteInfo.startDate) },
    { label: "준공 날짜", value: formatSiteDate(siteInfo.completionDate) },
  ];
}

function formatSiteDate(value: string) {
  if (!value) return "미입력";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${year}.${month}.${day}`;
}

// 착수~준공 날짜와 현재 시각으로 공정률(경과 비율) 산정. 착수 전 0% / 준공 후 100% 로 clamp.
type SiteProgress = {
  status: "before" | "ongoing" | "done" | "unknown";
  pct: number;
  totalDays: number;
  elapsedDays: number;
  daysLeft: number;
};
function computeSiteProgress(
  startDate: string,
  completionDate: string,
  nowMs: number,
): SiteProgress {
  const start = Date.parse(`${startDate}T00:00:00`);
  const end = Date.parse(`${completionDate}T00:00:00`);
  if (!startDate || !completionDate || Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return { status: "unknown", pct: 0, totalDays: 0, elapsedDays: 0, daysLeft: 0 };
  }
  const dayMs = 86_400_000;
  const ratio = (nowMs - start) / (end - start);
  const pct = Math.max(0, Math.min(100, ratio * 100));
  return {
    status: ratio < 0 ? "before" : ratio >= 1 ? "done" : "ongoing",
    pct,
    totalDays: Math.round((end - start) / dayMs),
    elapsedDays: Math.max(0, Math.round((nowMs - start) / dayMs)),
    daysLeft: Math.max(0, Math.ceil((end - nowMs) / dayMs)),
  };
}

// 0~100% RGB 스펙트럼 (빨강→주황→노랑→초록→파랑→보라). 게이지 채움 색.
const PROGRESS_GRADIENT =
  "linear-gradient(90deg,#ff3b30,#ff9500,#ffd60a,#34c759,#0a84ff,#5e5ce6)";

// 무사고 연속 일수 — 착수일(또는 마지막 사고 시각, 둘 중 나중) 부터 셈. 다음 100일 마일스톤까지 진행률.
// 마지막 사고 시각 = SOS 후 보호자/119 연락 시 기록 → 무사고 카운터 초기화.
function computeSafetyStreak(
  startDate: string,
  lastAccidentTs: string | null,
  nowMs: number,
) {
  const start = Date.parse(`${startDate}T00:00:00`);
  if (!startDate || Number.isNaN(start) || nowMs < start) {
    return { known: false, days: 0, target: 100, pct: 0, toGo: 100, reset: false };
  }
  const accident = lastAccidentTs ? Date.parse(lastAccidentTs) : NaN;
  const reset = !Number.isNaN(accident) && accident > start;
  const base = reset ? accident : start;
  const day = 86_400_000;
  const days = Math.max(0, Math.floor((nowMs - base) / day));
  const target = Math.max(100, Math.ceil((days + 1) / 100) * 100);
  return { known: true, days, target, pct: Math.min(100, (days / target) * 100), toGo: target - days, reset };
}

// 공통 게이지 1줄 — 라벨 + 큰 숫자 + 0~100% RGB 바. 공정률·무사고 동일 구성(컴팩트).
// 착수/준공일 footer 는 바로 아래 현장정보 패널과 중복이라 생략(높이 절약).
function GaugeRow({
  title,
  status,
  value,
  note,
  pct,
  known,
  ariaLabel,
}: {
  title: string;
  status: string;
  value: string;
  note?: string;
  pct: number;
  known: boolean;
  ariaLabel: string;
}) {
  return (
    <div>
      {/* 1줄 — 라벨 + 값 + 경과/총 */}
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-[13px] font-semibold text-ink dark:text-on-dark">{title}</span>
        <span className="font-mono text-[17px] font-semibold leading-none text-ink dark:text-on-dark">
          {known ? value : "--"}
        </span>
        {known && note && (
          <span className="truncate font-mono text-[10px] text-body dark:text-on-dark-soft">{note}</span>
        )}
      </div>
      {/* 2줄 — 게이지 바 (오른쪽 끝 안쪽에 상태 텍스트 삽입) */}
      <div
        className="relative mt-1 h-4 w-full overflow-hidden rounded-md ring-1 ring-black/10 dark:ring-white/10"
        style={{ background: PROGRESS_GRADIENT }}
        role="progressbar"
        aria-valuenow={known ? Math.round(pct) : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel}
      >
        {/* 진행 지점 이후는 어둡게 가려 채움 위치 표시 (그라데이션은 0~100 고정) */}
        <div
          className="absolute inset-y-0 right-0 bg-black/45 dark:bg-black/65"
          style={{ left: `${known ? pct : 0}%` }}
        />
        {/* 현재 위치 마커 */}
        {known && (
          <div
            className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-white/90 shadow-[0_0_3px_rgba(0,0,0,0.5)]"
            style={{ left: `${pct}%` }}
          />
        )}
        {/* 상태(D-day 등) — 바 오른쪽 끝 안쪽 */}
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-[10px] font-medium text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.7)]">
          {status}
        </span>
      </div>
    </div>
  );
}

// 우상단 패널 — 공정률(상) + 무사고(하)를 한 박스에 상하로 구분해 동일 구성으로 배치.
function GaugePanel({
  siteInfo,
  nowMs,
  lastAccidentTs,
}: {
  siteInfo: SiteInfo;
  nowMs: number;
  lastAccidentTs: string | null;
}) {
  const p = computeSiteProgress(siteInfo.startDate, siteInfo.completionDate, nowMs);
  const pKnown = p.status !== "unknown";
  const pStatus =
    p.status === "before"
      ? "착수 전"
      : p.status === "done"
        ? "준공 완료"
        : p.status === "ongoing"
          ? `준공까지 D-${p.daysLeft}`
          : "날짜 미입력";

  const s = computeSafetyStreak(siteInfo.startDate, lastAccidentTs, nowMs);
  const sStatus = s.known ? `목표 ${s.target}일까지 ${s.toGo}일` : "착수일 미입력";

  return (
    <div className="flex shrink-0 flex-col justify-center gap-1 rounded-xl bg-canvas p-2 dark:bg-surface-dark">
      <GaugeRow
        title="공정률"
        status={pStatus}
        value={`${p.pct.toFixed(1)}%`}
        note={`경과 ${p.elapsedDays}일 / 총 ${p.totalDays}일`}
        pct={p.pct}
        known={pKnown}
        ariaLabel="현장 공정률"
      />
      <div className="border-t border-hairline dark:border-white/10" />
      <GaugeRow
        title="무사고"
        status={sStatus}
        value={`${s.days}일`}
        note={s.reset ? "사고 후 재집계" : "연속 무사고"}
        pct={s.pct}
        known={s.known}
        ariaLabel="무사고 연속 일수"
      />
    </div>
  );
}

// 마지막 vital 수신 시점으로부터 경과시간 → 신호 강도 0~4
// 폰 polling 주기 5초 기준. 8s 내 = full, 60s 이상 = no signal
function signalLevel(sample: VitalSample | undefined, nowMs: number): 0 | 1 | 2 | 3 | 4 {
  if (!sample) return 0;
  const ageMs = nowMs - new Date(sample.ts).getTime();
  if (ageMs < 8_000) return 4;
  if (ageMs < 15_000) return 3;
  if (ageMs < 30_000) return 2;
  if (ageMs < 60_000) return 1;
  return 0;
}

// 마지막 수신 후 STALE_MS 초과 = "연결끊김". sticky merge 가 직전 실측값을 유지하므로,
// 이 판정 없이는 폰/워치가 끊겨도 카드가 마지막 정상값을 계속 녹색으로 표시(false-OK).
// 임계는 60초 — 워치는 30초 배칭 전송이라 정상 상태에서도 ts 가 최대 ~30초 묵을 수 있어,
// 30초 임계면 매 flush 직전 "연결끊김"으로 깜빡(오탐). 60초면 정상 배칭은 통과·진짜 끊김만 잡는다.
// signalLevel 과 동일 기준: 행은 sample 존재 + signal===0(≥60초), 보드는 isStale 로 판정.
const STALE_MS = 60_000;
function isStale(sample: VitalSample | undefined, nowMs: number): boolean {
  if (!sample) return false; // 샘플 자체가 없으면 "대기"(idle), 끊김 아님
  return nowMs - new Date(sample.ts).getTime() > STALE_MS;
}

function workerHeading(sample: VitalSample | undefined, fallbackId: string) {
  const name = sample?.workerName?.trim();
  const empId = sample?.employeeId?.trim();
  if (name && empId) {
    return { title: name, subtitle: empId, isFallback: false };
  }
  if (empId) {
    return { title: empId, subtitle: fallbackId, isFallback: true };
  }
  if (name) {
    return { title: name, subtitle: fallbackId, isFallback: true };
  }
  return { title: fallbackId, subtitle: undefined, isFallback: true };
}

function workerCell(sample: VitalSample) {
  const name = sample.workerName?.trim();
  const empId = sample.employeeId?.trim();
  if (name && empId) {
    return `${name} (${empId})`;
  }
  return name ?? empId ?? sample.workerId;
}

const CALENDAR_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function calendarSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function HeaderCalendarPopup({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    setViewDate(now);
    setSelected(now);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const today = new Date();
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const monthLabel = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
  }).format(viewDate);

  const selectedLabel = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(selected);

  const goPrevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const goNextMonth = () => setViewDate(new Date(year, month + 1, 1));
  const goToday = () => {
    const now = new Date();
    setViewDate(now);
    setSelected(now);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end bg-black/25 p-4 pt-[4.5rem] backdrop-blur-[2px] sm:pt-20"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="일정 캘린더"
    >
      <div
        className="w-full max-w-[320px] overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-surface-dark dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline bg-gradient-to-r from-[#0052ff]/10 via-transparent to-transparent px-4 py-3 dark:border-white/10">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#0052ff]/12 text-primary">
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </span>
            <div>
              <p className="text-sm font-bold text-ink dark:text-on-dark">일정 캘린더</p>
              <p className="text-[11px] text-muted dark:text-on-dark-soft">날짜를 선택하세요</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-strong hover:text-ink dark:hover:bg-white/10 dark:hover:text-on-dark"
            aria-label="캘린더 닫기"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-4 pb-4 pt-3">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={goPrevMonth}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-strong hover:text-ink dark:hover:bg-white/10 dark:hover:text-on-dark"
              aria-label="이전 달"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <p className="text-sm font-semibold tabular-nums text-ink dark:text-on-dark">{monthLabel}</p>
            <button
              type="button"
              onClick={goNextMonth}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-strong hover:text-ink dark:hover:bg-white/10 dark:hover:text-on-dark"
              aria-label="다음 달"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          <div className="mb-1.5 grid grid-cols-7 gap-1">
            {CALENDAR_WEEKDAYS.map((label, i) => (
              <div
                key={label}
                className={[
                  "py-1 text-center text-[11px] font-semibold",
                  i === 0 ? "text-red-500 dark:text-red-400" : "",
                  i === 6 ? "text-blue-600 dark:text-blue-400" : "",
                  i > 0 && i < 6 ? "text-muted dark:text-on-dark-soft" : "",
                ].join(" ")}
              >
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, idx) => {
              if (day === null) {
                return <div key={`empty-${idx}`} className="aspect-square" />;
              }
              const cellDate = new Date(year, month, day);
              const isToday = calendarSameDay(cellDate, today);
              const isSelected = calendarSameDay(cellDate, selected);
              const weekday = cellDate.getDay();

              return (
                <button
                  key={`${year}-${month}-${day}`}
                  type="button"
                  onClick={() => setSelected(cellDate)}
                  className={[
                    "aspect-square rounded-lg text-sm font-medium tabular-nums transition",
                    isSelected
                      ? "bg-[#0052ff] text-white shadow-sm shadow-[#0052ff]/30"
                      : isToday
                        ? "bg-[#0052ff]/12 font-semibold text-primary ring-1 ring-[#0052ff]/30"
                        : "text-ink hover:bg-surface-strong dark:text-on-dark dark:hover:bg-white/10",
                    !isSelected && weekday === 0 ? "text-red-500 dark:text-red-400" : "",
                    !isSelected && weekday === 6 ? "text-blue-600 dark:text-blue-400" : "",
                  ].join(" ")}
                  aria-label={`${year}년 ${month + 1}월 ${day}일`}
                  aria-pressed={isSelected}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-hairline bg-surface-soft px-3 py-2.5 dark:border-white/10 dark:bg-surface-dark-elevated">
            <p className="min-w-0 truncate text-xs text-muted dark:text-on-dark-soft">{selectedLabel}</p>
            <button
              type="button"
              onClick={goToday}
              className="shrink-0 rounded-lg bg-[#0052ff]/10 px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-[#0052ff]/20"
            >
              오늘
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DemoDashboard() {
  const { logout } = useSession();
  const [data, setData] = useState<MockVitalResponse>({
    latest: [],
    recent: [],
    totalPersisted: 0,
    countsByWorker: {},
  });
  const [logExpanded, setLogExpanded] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  // 설비 메트릭(가스 측정값/제세동기 배터리) 선택 → 하단 추세 그래프
  const [siteChart, setSiteChart] = useState<SiteMetric | null>(null);
  // 직급/직책 편집 모달 — 작업자 표의 직급 칸 클릭 시 열림(관제 웹 입력).
  const [jobTitleEdit, setJobTitleEdit] = useState<{ workerId: string; current: string } | null>(
    null,
  );
  const [now, setNow] = useState(() => Date.now());
  // 새 SOS sample 감지용 — workerId → 가장 최근 처리된 sample.ts.
  // SOS payload 의 ts 가 acknowledgedSosTs 와 다르면 모달 표시.
  const [acknowledgedSosTs, setAcknowledgedSosTs] = useState<Record<string, string>>({});
  const [acknowledgedFallTs, setAcknowledgedFallTs] = useState<Record<string, string>>({});
  const [activeSos, setActiveSos] = useState<VitalSample | null>(null);
  const [activeFallAlert, setActiveFallAlert] = useState<VitalSample | null>(null);
  // 생체 위험 자동 경보 — 현재 표시 중 워커 + ack(정상복귀 시 해제)된 워커.
  const [activeVitalAlert, setActiveVitalAlert] = useState<VitalSample | null>(null);
  const [ackedVital, setAckedVital] = useState<Set<string>>(() => new Set());
  const [sirenEnabled, setSirenEnabled] = useState(true);
  const [audioArmed, setAudioArmed] = useState(false); // 오디오 컨텍스트 running 여부(브라우저 제스처 unlock)
  const [slots, setSlots] = useState<SlotAssignments>(() => Array(SLOT_COUNT).fill(null));
  const [queueModalSlot, setQueueModalSlot] = useState<number | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  // 로그인 역할 — owner 만 "사용자 관리" 탭 노출. sessionStorage 는 클라이언트에서만 접근.
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    setRole(getSessionRole());
  }, []);
  const [siteInfo, setSiteInfo] = useState<SiteInfo>(DEFAULT_SITE_INFO);
  const [lastAccidentTs, setLastAccidentTs] = useState<string | null>(null);
  // 작업자 표 슬라이딩 모드 — auto: 세로 자동 슬라이딩 / manual: 정지 + 드래그 정렬
  const [slideMode, setSlideMode] = useState<"auto" | "manual">("auto");
  // 국내 재해사례 데이터 출처 — 캐러셀 헤더 배지(좌측 화살표 우측)로 표시. 카드가 fetch 후 통지.
  const [koshaSource, setKoshaSource] = useState<"live" | "mock" | null>(null);

  // SSR/CSR mismatch 회피 — mount 후 1회 localStorage 로드
  useEffect(() => {
    setSlots(loadSlots());
    setSiteInfo(loadSiteInfo());
    try {
      const raw = window.localStorage.getItem(ACCIDENT_STORAGE_KEY);
      if (raw) setLastAccidentTs(raw);
      const mode = window.localStorage.getItem(SLIDEMODE_STORAGE_KEY);
      if (mode === "auto" || mode === "manual") setSlideMode(mode);
    } catch {
      /* localStorage 불가 환경 무시 */
    }
  }, []);

  const handleSiteInfoSave = useCallback((next: SiteInfo) => {
    setSiteInfo(next);
    saveSiteInfo(next);
  }, []);

  // SOS 후 보호자/119 연락 시 사고로 기록 → 무사고 카운터 초기화.
  const recordAccident = useCallback(() => {
    const ts = new Date().toISOString();
    setLastAccidentTs(ts);
    try {
      window.localStorage.setItem(ACCIDENT_STORAGE_KEY, ts);
    } catch {
      /* localStorage 불가 환경 무시 */
    }
  }, []);

  function assignWorkerToSlot(slotIndex: number, workerId: string) {
    setSlots((prev) => {
      // 다른 슬롯에 이미 있으면 그 자리는 비움 (중복 등록 방지)
      const next = prev.map((id) => (id === workerId ? null : id));
      next[slotIndex] = workerId;
      saveSlots(next);
      return next;
    });
    setQueueModalSlot(null);
  }

  function clearSlot(slotIndex: number) {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = null;
      saveSlots(next);
      return next;
    });
  }

  function toggleSelection(next: Selection) {
    setSiteChart(null); // 작업자 생체 차트를 열면 설비(가스/AED) 차트를 닫는다 — 하단 차트는 항상 하나만.
    setSelection((prev) =>
      prev && prev.workerId === next.workerId && prev.metric === next.metric ? null : next,
    );
  }

  // 설비(가스/AED) 차트를 열면 작업자 생체 차트를 닫는다(역방향, 상호 배타).
  function openSiteChart(m: SiteMetric) {
    setSelection(null);
    setSiteChart(m);
  }

  // 자동/수동 토글 — 영속화. 수동 전환 시 드래그 정렬 활성·자동 슬라이딩 정지.
  const toggleSlideMode = useCallback(() => {
    setSlideMode((prev) => {
      const next = prev === "auto" ? "manual" : "auto";
      try {
        window.localStorage.setItem(SLIDEMODE_STORAGE_KEY, next);
      } catch {
        /* localStorage 불가 환경 무시 */
      }
      return next;
    });
  }, []);

  // 드래그앤드롭 센서 — 포인터(6px 이동 후 시작, 클릭/스크롤과 구분) + 키보드 접근성.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // 드래그 종료 → 채워진 작업자 순서 재배열 후 슬롯 배열을 앞으로 compact 하여 영속.
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSlots((prev) => {
      const filled = prev.filter((id): id is string => id !== null);
      const from = filled.indexOf(String(active.id));
      const to = filled.indexOf(String(over.id));
      if (from < 0 || to < 0) return prev;
      const reordered = arrayMove(filled, from, to);
      const next: SlotAssignments = Array.from(
        { length: SLOT_COUNT },
        (_, i) => reordered[i] ?? null,
      );
      saveSlots(next);
      return next;
    });
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function load() {
      // 로그인 세션 토큰을 동봉 → 서버가 인증된 대시보드에만 PII(GPS·보호자) 노출. 비로그인 익명 호출은 redaction.
      const token = getSessionToken();
      try {
        const response = await fetch("/api/mock/vital", {
          cache: "no-store",
          signal: controller.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!active || !response.ok) {
          return;
        }
        const json = (await response.json()) as MockVitalResponse;
        if (!active) return;
        setData(json);
      } catch {
        // abort(언마운트/재폴) 또는 일시 네트워크 실패 — 다음 폴에서 복구
      }
    }

    load();
    const timer = window.setInterval(load, 2000);

    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  // 신호 강도 freshness 갱신 — 1초 단위로 sample.ts 경과를 재평가
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  function dismissSos() {
    if (activeSos) {
      setAcknowledgedSosTs((prev) => ({ ...prev, [activeSos.workerId]: activeSos.ts }));
    }
    setActiveSos(null);
  }

  function dismissFallAlert() {
    if (activeFallAlert) {
      setAcknowledgedFallTs((prev) => ({ ...prev, [activeFallAlert.workerId]: activeFallAlert.ts }));
    }
    setActiveFallAlert(null);
  }

  function dismissVitalAlert() {
    if (activeVitalAlert) {
      setAckedVital((prev) => {
        const next = new Set(prev);
        next.add(activeVitalAlert.workerId);
        return next;
      });
    }
    setActiveVitalAlert(null);
  }

  const openJobTitleEditor = useCallback((workerId: string, current: string) => {
    setJobTitleEdit({ workerId, current });
  }, []);

  // 직급/직책 관제 웹 입력 저장 — 세션 토큰 동봉 POST → worker_profile 오버라이드 영속.
  // 성공 시 낙관적 갱신(다음 2초 폴이 서버값으로 재동기화).
  async function saveJobTitle(workerId: string, jobTitle: string) {
    const token = getSessionToken();
    const trimmed = jobTitle.trim().slice(0, 40);
    try {
      const res = await fetch("/api/worker-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ workerId, jobTitle: trimmed }),
      });
      if (!res.ok) {
        console.error("[직급 저장 실패]", res.status);
        return;
      }
      setData((prev) => {
        const next = { ...(prev.workerProfiles ?? {}) };
        if (trimmed) next[workerId] = trimmed;
        else delete next[workerId];
        return { ...prev, workerProfiles: next };
      });
    } catch (e) {
      console.error("[직급 저장 오류]", e);
    } finally {
      setJobTitleEdit(null);
    }
  }

  // 실제 수신 워커 + 가상 워커(테스트용). 실제가 우선, ts 는 "수신 중"처럼 보이도록 주입.
  // ts 를 매초 바뀌는 now 가 아니라 data.latest 변경 시각에 고정해 latestMap→pendingWorkers→fieldCoords
  // 체인이 1초마다 재계산되지 않게 한다(신호 강도 freshness 는 별도 now state 로 평가).
  const allLatest = useMemo(() => {
    const realIds = new Set(data.latest.map((s) => s.workerId));
    const stampIso = new Date().toISOString();
    const virtuals: VitalSample[] = VIRTUAL_WORKER_TEMPLATES.filter(
      (v) => !realIds.has(v.workerId),
    ).map((v) => ({ ...v, ts: stampIso }));
    return [...data.latest, ...virtuals];
  }, [data.latest]);

  const latestMap = useMemo(() => {
    return new Map(allLatest.map((sample) => [sample.workerId, sample]));
  }, [allLatest]);

  // 이벤트 시각 추적 — store 의 manualSos/fallDetected 는 비-sticky 라
  // 마지막 발생 시각은 recent 스트림을 스캔해서 계산.
  const lastSosByWorker = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of data.recent) {
      if (s.manualSos !== true) continue;
      const existing = map.get(s.workerId);
      if (!existing || s.ts > existing) map.set(s.workerId, s.ts);
    }
    return map;
  }, [data.recent]);

  // 새 SOS 감지 — lastSosTs 가 ack 와 다르면 모달 자동 표시. 모달 sample 은
  // 최신 vital + SOS 발신 시각 으로 구성 (vital 비어 있으면 직전 polling 값 활용).
  useEffect(() => {
    if (activeSos) return;
    for (const [workerId, sosTs] of lastSosByWorker) {
      if (acknowledgedSosTs[workerId] === sosTs) continue;
      const base = latestMap.get(workerId);
      if (!base) continue;
      setActiveSos({ ...base, ts: sosTs, manualSos: true });
      return;
    }
  }, [lastSosByWorker, latestMap, acknowledgedSosTs, activeSos]);

  const lastFallByWorker = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of data.recent) {
      if (s.fallDetected !== true) continue;
      const existing = map.get(s.workerId);
      if (!existing || s.ts > existing) map.set(s.workerId, s.ts);
    }
    return map;
  }, [data.recent]);

  // 새 낙상 감지 — 워치 확인 프롬프트 무응답/도움 요청으로 fallDetected 가 들어오면
  // SOS 와 동일한 긴급 모달 및 사이렌 경로를 탄다.
  useEffect(() => {
    if (activeSos || activeFallAlert) return;
    for (const [workerId, fallTs] of lastFallByWorker) {
      if (acknowledgedFallTs[workerId] === fallTs) continue;
      const base = latestMap.get(workerId);
      if (!base) continue;
      setActiveFallAlert({ ...base, ts: fallTs, fallDetected: true });
      return;
    }
  }, [lastFallByWorker, latestMap, acknowledgedFallTs, activeSos, activeFallAlert]);

  // 생체 위험 경보 대상 — 실제 수신 워커(data.latest, 가상 워커 제외) 중 심박/SpO₂/체온 danger.
  // SOS·낙상은 SOS 모달이 처리하므로 제외(중복 팝업 방지).
  const dangerVitalWorkers = useMemo(() => {
    const out: VitalSample[] = [];
    for (const s of data.latest) {
      if (s.manualSos === true || s.fallDetected === true) continue;
      const danger =
        heartRateStatus(s.heartRate, workActivity(s)) === "danger" ||
        spo2Status(s.spo2) === "danger" ||
        coreTempStatus(s.skinTempC) === "danger";
      if (danger) out.push(s);
    }
    return out;
  }, [data.latest]);

  // 생체 위험 자동 경보 — SOS 모달 우선, 이미 떠 있으면 skip, ack 안 된 첫 위험 워커 표시.
  useEffect(() => {
    if (activeSos || activeFallAlert || activeVitalAlert) return;
    for (const s of dangerVitalWorkers) {
      if (ackedVital.has(s.workerId)) continue;
      setActiveVitalAlert(s);
      return;
    }
  }, [dangerVitalWorkers, activeSos, activeFallAlert, activeVitalAlert, ackedVital]);

  // 정상/주의로 복귀한 워커는 ack 해제 → 다음 위험 진입 시 재경보(WeatherAlertToast 패턴).
  useEffect(() => {
    setAckedVital((prev) => {
      if (prev.size === 0) return prev;
      const dangerIds = new Set(dangerVitalWorkers.map((s) => s.workerId));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (dangerIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [dangerVitalWorkers]);

  // 등록 대기 큐 — publish 중인 작업자 중 슬롯에 할당 안 된 워커들
  const pendingWorkers = useMemo(() => {
    const registered = new Set(slots.filter((id): id is string => id !== null));
    return [...allLatest]
      .filter((sample) => !registered.has(sample.workerId))
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));
  }, [allLatest, slots]);

  // 현장 환경 패널 좌표 — 등록된 작업자 폰 GPS 좌표 평균 (없으면 미표시)
  const fieldCoords = useMemo(() => {
    const points = slots
      .map((id) => (id ? latestMap.get(id) : undefined))
      .filter((s): s is VitalSample =>
        s !== undefined &&
        typeof s.latitude === "number" &&
        typeof s.longitude === "number",
      );
    if (points.length === 0) return { lat: undefined, lon: undefined, count: 0 };
    const latSum = points.reduce((acc, p) => acc + (p.latitude as number), 0);
    const lonSum = points.reduce((acc, p) => acc + (p.longitude as number), 0);
    return {
      lat: latSum / points.length,
      lon: lonSum / points.length,
      count: points.length,
    };
  }, [slots, latestMap]);

  // 표 행 = 채워진 슬롯만(빈 슬롯 등록은 상단 버튼으로 분리). 표시 순서 = 슬롯 배열 순서.
  const filledSlots = useMemo(() => {
    const out: { workerId: string; slotIndex: number }[] = [];
    slots.forEach((workerId, slotIndex) => {
      if (workerId !== null) out.push({ workerId, slotIndex });
    });
    return out;
  }, [slots]);

  // 워커별 스트레스 지수 — 행 렌더마다 인라인 계산하던 것을 채워진 슬롯 기준 1회 계산해 Map 으로 공유.
  // (자동 슬라이딩 복제본까지 같은 workerId 를 여러 번 그리므로 인라인 호출 시 중복 비용 발생)
  const stressByWorker = useMemo(() => {
    const map = new Map<string, StressResult>();
    for (const { workerId } of filledSlots) {
      map.set(workerId, computeStressIndex(stressInputsFromSample(latestMap.get(workerId) ?? {})));
    }
    return map;
  }, [filledSlots, latestMap]);

  // 첫 빈 슬롯 — "+ 작업자 등록" 버튼이 여는 대상. 없으면(-1) 버튼 비활성.
  const firstEmptySlot = useMemo(() => slots.findIndex((id) => id === null), [slots]);

  // ── 작업자 표 세로 자동 슬라이딩 + 수동 스크롤 + 이상 자동 스크롤 ──
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const tableHovered = useRef(false);
  const tableOffset = useRef(0); // 세로 자동 슬라이딩 누적 위치(소수 픽셀 유실 방지)
  // 행이 뷰포트를 초과(overflow)할 때만 seamless 복제본 렌더 — 행이 적으면 복제본을 그리지 않아 같은 작업자 중복 노출 방지.
  const [tableOverflowing, setTableOverflowing] = useState(false);
  const tableOverflowingRef = useRef(false);

  // 채워진 행 중 첫 이상(주의/위험) 작업자의 표시 위치. 없으면 -1.
  const anomalyPos = useMemo(() => {
    for (let pos = 0; pos < filledSlots.length; pos++) {
      const slot = filledSlots[pos];
      if (!slot) continue;
      const status = overallStatus(latestMap.get(slot.workerId));
      if (status === "caution" || status === "danger") return pos;
    }
    return -1;
  }, [filledSlots, latestMap]);

  // 통합 안전 신호등용 — 등록 슬롯 작업자 worst-of status(낙상·SOS 포함) + 이상 상세.
  const workerSignal = useMemo<WorkerSignal>(() => {
    const rank: Record<VitalStatus, number> = { idle: 0, normal: 1, caution: 2, danger: 3 };
    let sev: VitalStatus = "idle";
    let count = 0;
    const issues: { name: string; metrics: string }[] = [];
    for (const slot of filledSlots) {
      if (!slot) continue;
      count += 1;
      const sample = latestMap.get(slot.workerId);
      // 연결끊김은 생체 상태보다 우선 — stale 이면 주의(caution)로 강등하고 이상으로 집계.
      // sticky 직전값이 "정상"이어도 끊긴 작업자를 정상으로 보고하는 false-OK 를 막는다.
      const stale = isStale(sample, now);
      const tone: WorkerStatus["tone"] = stale ? "caution" : workerStatus(sample).tone;
      if (rank[tone] > rank[sev]) sev = tone;
      const name = sample?.workerName?.trim() || sample?.employeeId?.trim() || slot.workerId;
      if (stale) {
        issues.push({ name, metrics: "연결끊김" });
      } else if (tone === "caution" || tone === "danger") {
        const ms: string[] = [];
        if (sample?.manualSos) ms.push("SOS");
        if (sample?.fallDetected) ms.push("낙상");
        const hr = heartRateStatus(sample?.heartRate, workActivity(sample ?? {}));
        if (hr === "caution" || hr === "danger") ms.push("심박");
        const sp = spo2Status(sample?.spo2);
        if (sp === "caution" || sp === "danger") ms.push("SpO₂");
        const tp = coreTempStatus(sample?.skinTempC);
        if (tp === "caution" || tp === "danger") ms.push("체온");
        issues.push({ name, metrics: ms.length ? ms.join("·") : "이상" });
      }
    }
    const anomaly = issues.length;
    const first = issues[0];
    const summary =
      count === 0 ? "작업자 대기" : anomaly > 0 ? `이상 ${anomaly}명 / 전체 ${count}명` : `정상 ${count}명`;
    const short =
      count === 0
        ? "작업자 등록 대기"
        : anomaly > 0 && first
          ? first.metrics === "연결끊김"
            ? `${first.name} 연결끊김 — 즉시 연락·현장 확인`
            : `${first.name} ${first.metrics} 이상 — 심정지·SOS 골든타임 4분`
          : "전 작업자 정상 범위";
    return {
      sev,
      summary,
      short,
      detail: {
        title: anomaly > 0 ? `작업자 이상 ${anomaly}명 / 전체 ${count}명` : count > 0 ? `작업자 정상 (${count}명)` : "작업자 대기",
        location: "작업자 GPS · 작업자 모니터링 표 참조",
        lines:
          anomaly > 0
            ? [
                ...issues.map((it, idx) => ({ label: `이상 ${idx + 1}`, text: `${it.name} — ${it.metrics}` })),
                { label: "골든타임", text: "심정지·SOS 4분 / 낙상 후 의식없음 즉시 / 열사병 즉시 냉각·수분" },
                { label: "권장 대응", text: "해당 작업자 카드·생체 확인. SOS 시 119·보호자 연락, 낙상 시 의식·외상 확인." },
              ]
            : count > 0
              ? [{ label: "상태", text: `등록 ${count}명 전부 정상 범위(심박·SpO₂·체온·낙상·SOS)` }]
              : [{ label: "안내", text: "빈 슬롯에 작업자 등록 시 실시간 평가됩니다." }],
      },
    };
  }, [filledSlots, latestMap, now]);

  // 이상 발생 시 해당 행으로 자동 스크롤 — 자동 모드에서만(수동 정렬 존중). 빨강 링은 모드 무관.
  useEffect(() => {
    if (slideMode === "auto" && anomalyPos >= 0) {
      tableScrollRef.current?.scrollTo({ top: anomalyPos * TABLE_ROW_PX, behavior: "smooth" });
    }
  }, [slideMode, anomalyPos]);

  // 세로 자동 슬라이딩 — 행 2벌 복제 → 한 벌 높이만큼 지나면 되감아 seamless(rAF).
  // 자동 모드 + 행이 뷰포트 초과(overflow) 시에만 작동. 이상/호버 시 정지(수동 스크롤 우선).
  useEffect(() => {
    if (slideMode !== "auto") return; // 수동 모드는 네이티브 스크롤만
    let raf = 0;
    const SPEED = 0.5; // px/frame ≈ 30px/s
    const firstCopyHeight = filledSlots.length * TABLE_ROW_PX;
    const tick = () => {
      const el = tableScrollRef.current;
      if (el && firstCopyHeight > 0) {
        const overflow = firstCopyHeight > el.clientHeight + 1;
        if (overflow !== tableOverflowingRef.current) {
          tableOverflowingRef.current = overflow;
          setTableOverflowing(overflow);
        }
        if (anomalyPos < 0 && !tableHovered.current && overflow) {
          let next = tableOffset.current + SPEED;
          if (next >= firstCopyHeight) next -= firstCopyHeight;
          tableOffset.current = next;
          el.scrollTop = next;
        } else {
          tableOffset.current = el.scrollTop % firstCopyHeight;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [slideMode, anomalyPos, filledSlots.length]);

  // ── SOS 사이렌 — SOS 모달 표시 중 앰뷸런스 두톤("삐뽀삐뽀") 재생. Web Audio 합성(오디오 파일 불필요) ──
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sirenRef = useRef<{ osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null>(null);

  const ensureAudioCtx = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!audioCtxRef.current) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      // 상태 변화(running/suspended)를 audioArmed 에 반영 → 배너/표시 동기화.
      ctx.addEventListener("statechange", () => setAudioArmed(ctx.state === "running"));
      audioCtxRef.current = ctx;
    }
    return audioCtxRef.current;
  }, []);

  // 오디오 활성화(arm) — 사용자 제스처에서 호출. resume 성공 시 audioArmed=true.
  const armAudio = useCallback(() => {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    void ctx
      .resume()
      .then(() => setAudioArmed(ctx.state === "running"))
      .catch(() => {});
  }, [ensureAudioCtx]);

  const stopSiren = useCallback(() => {
    const cur = sirenRef.current;
    const ctx = audioCtxRef.current;
    sirenRef.current = null;
    if (!cur || !ctx) return;
    try {
      cur.gain.gain.cancelScheduledValues(ctx.currentTime);
      cur.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.04);
      cur.osc.stop(ctx.currentTime + 0.25);
      cur.lfo.stop(ctx.currentTime + 0.25);
    } catch {
      /* 이미 정지된 노드 */
    }
  }, []);

  const startSiren = useCallback(() => {
    const ctx = ensureAudioCtx();
    if (!ctx || sirenRef.current) return;
    // 앰뷸런스 '왈(wail)' 사이렌 — 삼각 LFO 로 반송파를 부드럽게 위아래로 스윕(삐요~삐요~ 구급차 효과음 톤).
    const build = () => {
      const c = audioCtxRef.current;
      if (!c || c.state !== "running" || sirenRef.current) return;
      const osc = c.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = 950; // 스윕 중심
      const lfo = c.createOscillator();
      lfo.type = "triangle";
      lfo.frequency.value = 0.8; // 1.25초 주기로 왕복 스윕
      const lfoGain = c.createGain();
      lfoGain.gain.value = 350; // 약 600 ↔ 1300 Hz 스윕
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.0001, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.16, c.currentTime + 0.06);
      lfo.connect(lfoGain).connect(osc.frequency);
      osc.connect(gain).connect(c.destination);
      osc.start();
      lfo.start();
      sirenRef.current = { osc, lfo, gain };
    };
    // 컨텍스트가 suspended 면 resume 완료 후 그래프 생성(suspended 상태로 만들면 무음).
    if (ctx.state === "running") build();
    else void ctx.resume().then(build).catch(() => {});
  }, [ensureAudioCtx]);

  // 브라우저 autoplay 정책 — 마운트 시 1회 + 사용자 제스처마다 arm 시도. running 되면 리스너 해제.
  useEffect(() => {
    armAudio(); // best-effort(대개 제스처 전이라 실패 → 배너로 유도)
    const onGesture = () => {
      armAudio();
      if (audioCtxRef.current?.state === "running") {
        window.removeEventListener("pointerdown", onGesture);
        window.removeEventListener("keydown", onGesture);
      }
    };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [armAudio]);

  // SOS/낙상/생체위험 모달 + 사이렌 ON + 오디오 arm 된 경우에만 재생.
  useEffect(() => {
    if ((activeSos || activeFallAlert || activeVitalAlert) && sirenEnabled && audioArmed) startSiren();
    else stopSiren();
  }, [activeSos, activeFallAlert, activeVitalAlert, sirenEnabled, audioArmed, startSiren, stopSiren]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1280px] flex-col gap-4 px-6 py-4 font-sans text-body dark:text-on-dark-soft max-[640px]:px-4">
      {/* 브라우저 autoplay 정책상 첫 제스처 전에는 소리 불가 → SOS 경보음 활성화 배너(클릭=제스처=arm). */}
      {sirenEnabled && !audioArmed && (
        <button
          type="button"
          onClick={armAudio}
          className="flex items-center justify-center gap-2 rounded-xl border border-amber-400/60 bg-amber-100 px-6 py-3 text-sm font-semibold text-amber-900 shadow-sm transition hover:bg-amber-200 dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-100 dark:hover:bg-amber-500/25"
          title="브라우저 정책상 한 번 클릭해야 SOS 경보음을 재생할 수 있습니다"
        >
          <span aria-hidden className="text-base">🔔</span>
          SOS 경보음 활성화 — 한 번 클릭하면 이후 SOS 시 자동으로 사이렌이 울립니다
        </button>
      )}
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-4 rounded-xl bg-canvas px-6 py-3 dark:bg-surface-dark">
        <div className="flex items-center gap-3">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-strong dark:bg-surface-dark-elevated">
            <img
              src="/brand/vitalguard-logo-light.png"
              alt="VitAlGuard Industrial Safety OS"
              className="h-full w-full object-cover dark:hidden"
            />
            <img
              src="/brand/vitalguard-logo-dark.png"
              alt="VitAlGuard Industrial Safety OS"
              className="hidden h-full w-full object-cover dark:block"
            />
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-[24px] font-normal leading-none tracking-[-0.4px] text-primary">
              VitAlGuard
            </h1>
            <p className="mt-1 truncate text-xs text-body dark:text-on-dark-soft">
              관제 · 실시간 수집 · DB 영속 {(data.totalPersisted ?? 0).toLocaleString()}건 누적
            </p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <div className="hidden h-8 items-center rounded-lg bg-surface-strong px-3 font-mono text-xs text-body dark:bg-surface-dark-elevated dark:text-on-dark-soft sm:inline-flex">
            POST /api/mock/vital
          </div>
          {/* 헤더 액션 버튼 — 아이콘만 보이다 선택 시 라벨이 펼쳐지는 확장 탭(ExpandableTabs).
              라이트/다크 토글은 제외하고 그대로 유지. */}
          <ExpandableTabs
            tabs={[
              {
                title: "알림 이력",
                tooltip: "SOS·낙상 알림 이력 (발생/대응 시각)",
                onSelect: () => setAlertsOpen(true),
                icon: (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                ),
              },
              {
                title: "캘린더",
                tooltip: "일정 캘린더 — 날짜 선택",
                onSelect: () => setCalendarOpen(true),
                icon: (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                ),
              },
              {
                title: "관리자",
                tooltip: "관리자 메뉴 (CSV 내보내기 등)",
                onSelect: () => setAdminOpen(true),
                icon: (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 11c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z" />
                    <path d="M4 21v-1c0-3.31 3.58-6 8-6s8 2.69 8 6v1" />
                  </svg>
                ),
              },
              // owner(env 관리자)만 노출 — 가입 신청 승인/거절.
              ...(role === "owner"
                ? [
                    {
                      title: "사용자 관리",
                      tooltip: "관리자 가입 신청 승인/거절 (owner 전용)",
                      onSelect: () => setUsersOpen(true),
                      icon: (
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                      ),
                    },
                  ]
                : []),
              {
                title: "사이렌",
                tooltip: sirenEnabled
                  ? "SOS 사이렌 켜짐 — SOS 수신 시 자동 경보음 (클릭하여 끄기)"
                  : "SOS 사이렌 꺼짐 (클릭하여 켜기)",
                ariaPressed: sirenEnabled,
                dim: !sirenEnabled,
                onSelect: () => {
                  // 클릭(사용자 제스처) 시 오디오 arm → 이후 SOS 사이렌 자동 재생 보장.
                  armAudio();
                  setSirenEnabled((v) => !v);
                },
                icon: sirenEnabled ? (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ),
              },
              {
                title: "로그아웃",
                tooltip: "로그아웃 — 로그인 화면으로 돌아갑니다",
                onSelect: logout,
                icon: (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <path d="M16 17l5-5-5-5" />
                    <path d="M21 12H9" />
                  </svg>
                ),
              },
            ]}
          />
          {/* 라이트/다크 토글 — 제외 대상, 디자인·위치 그대로 유지 */}
          <ThemeToggle />
        </div>
      </header>

      {/* 상단 페이저 — 작업자 모니터링 캐러셀처럼 ‹ › 로 넘기는 2페이지(1.실시간 현장 관제 / 2.안전관리비 검증) */}
      <SectionPager
        pages={[
          {
            title: "실시간 현장 관제",
            content: (
              <div className="flex flex-col gap-4">
      <section className="overflow-hidden rounded-xl border border-hairline bg-canvas px-6 py-4 text-ink dark:border-white/10 dark:bg-surface-dark dark:text-on-dark max-[640px]:px-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-stretch">
          {/* 좌측 — 히어로 카피 + 안전 신호등 + 현장정보/재해사례 캐러셀 */}
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex-1">
                <SafetySignalBoard lat={fieldCoords.lat} lon={fieldCoords.lon} worker={workerSignal} />
              </div>
            </div>
            {/* 현장정보 + 국내재해사례 — 좌우 화살표 캐러셀(‹ 제목 N/M ›) 같은 자리에서 전환 */}
            <WidgetCarousel
              className="h-[140px]"
              pages={[
                {
                  title: "현장정보",
                  content: (
                    <div className="grid h-full w-full grid-cols-3 gap-1 p-1.5 max-[640px]:grid-cols-2">
                      {siteInfoRows(siteInfo).map((item) => (
                        <div key={item.label} className="flex min-w-0 flex-col justify-center rounded-lg bg-canvas px-2.5 py-0.5 dark:bg-surface-dark">
                          <div className="text-[10px] leading-tight text-body dark:text-on-dark-soft">{item.label}</div>
                          <div className="truncate text-[13px] font-semibold leading-tight text-ink dark:text-on-dark">
                            {item.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  ),
                },
                {
                  title: "국내 재해사례",
                  content: <KoshaAccidentCaseCard onSourceChange={setKoshaSource} />,
                  headerAccessory: koshaSource ? (
                    <span className="rounded-pill bg-surface-strong px-2 py-0.5 text-[10px] font-semibold text-body dark:bg-white/10 dark:text-on-dark-soft">
                      {koshaSource === "live" ? "KOSHA 실시간" : "샘플"}
                    </span>
                  ) : null,
                },
              ]}
            />
          </div>

          {/* 우측 — 그룹 캐러셀: [현황 요약(공정률·무사고·수신요약) ↔ 실시간 레이더] */}
          <WidgetCarousel
            className="min-h-[300px]"
            pages={[
              {
                title: "현황 요약",
                content: (
                  <div className="flex h-full flex-col justify-center gap-1.5 p-2">
                    <GaugePanel siteInfo={siteInfo} nowMs={now} lastAccidentTs={lastAccidentTs} />
                    <div className="flex flex-col rounded-xl bg-canvas p-2.5 dark:bg-surface-dark">
                      <div className="flex items-center justify-between border-b border-hairline pb-1.5 dark:border-white/10">
                        <span className="text-sm font-semibold text-ink dark:text-on-dark">수신 요약</span>
                        <span className="rounded-pill bg-primary px-2.5 py-0.5 text-xs font-semibold text-on-primary">
                          LIVE
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1.5">
                        <SummaryStat label="등록 작업자" value={`${slots.filter(Boolean).length}`} />
                        <SummaryStat label="대기 작업자" value={`${pendingWorkers.length}`} />
                        <SummaryStat label="최근 표시" value={`${data.recent.length}`} />
                        <SummaryStat label="DB 누적" value={(data.totalPersisted ?? 0).toLocaleString()} />
                      </div>
                    </div>
                  </div>
                ),
              },
              { title: "실시간 레이더", content: <RadarRealtime /> },
              {
                title: "태풍 진로",
                content: <TyphoonTrack lat={fieldCoords.lat} lon={fieldCoords.lon} />,
              },
              {
                title: "특보 영상",
                content: <WarningVideoPanel lat={fieldCoords.lat} lon={fieldCoords.lon} />,
              },
            ]}
          />
        </div>
      </section>

      <WeatherStrip
        lat={fieldCoords.lat}
        lon={fieldCoords.lon}
        workerCount={fieldCoords.count}
      />

      {/* 작업자 모니터링 + 가스 누출 감지기 + 심장 제세동기 알림 + CCTV 관제 — 4페이지 캐러셀(‹ › 수동 전환만, 자동회전 없음) */}
      <WidgetCarousel
        className="h-[460px]"
        autoRotate={false}
        pages={[
          {
            title: "작업자 모니터링",
            content: (
              <div className="flex h-full flex-col">
                {/* 툴바 — 등록 버튼 + 자동/수동 토글 (제목은 캐러셀 헤더가 표시) */}
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2 dark:border-white/10">
                  <span className="rounded-pill bg-surface-strong px-2 py-0.5 text-xs font-medium text-body dark:bg-surface-dark dark:text-on-dark-soft">
                    {filledSlots.length}명
                  </span>
                  <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => firstEmptySlot >= 0 && setQueueModalSlot(firstEmptySlot)}
              disabled={firstEmptySlot < 0}
              title={firstEmptySlot < 0 ? "슬롯이 가득 찼습니다" : "대기 큐에서 작업자 등록"}
              className={`inline-flex h-8 items-center gap-1 rounded-pill bg-primary px-3 text-xs font-semibold text-on-primary active:scale-95 disabled:opacity-40 ${FOCUS_CLASS}`}
            >
              + 작업자 등록
              {pendingWorkers.length > 0 && (
                <span className="ml-1 rounded-full bg-white/25 px-1.5 text-[10px]">대기 {pendingWorkers.length}</span>
              )}
            </button>
            <button
              type="button"
              onClick={toggleSlideMode}
              title={
                slideMode === "auto"
                  ? "자동 슬라이딩 중 — 클릭하면 수동(드래그 정렬)"
                  : "수동(드래그 정렬) 중 — 클릭하면 자동 슬라이딩"
              }
              className={`inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-xs font-semibold active:scale-95 ${FOCUS_CLASS} ${
                slideMode === "auto"
                  ? "bg-semantic-up/15 text-semantic-up"
                  : "bg-surface-strong text-body dark:bg-surface-dark dark:text-on-dark-soft"
              }`}
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${slideMode === "auto" ? "bg-semantic-up" : "bg-muted-soft"}`}
              />
              {slideMode === "auto" ? "자동 슬라이딩" : "수동 (드래그 정렬)"}
            </button>
          </div>
        </div>

                {filledSlots.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-muted dark:text-on-dark-soft">
                    등록된 작업자가 없습니다. 우측 상단 <b className="text-primary">+ 작업자 등록</b> 으로 추가하세요.
                  </p>
                ) : (
                  <div className="min-h-0 flex-1 overflow-x-auto">
                    <div className="flex h-full min-w-[920px] flex-col">
                      <WorkerTableHeader manual={slideMode === "manual"} />
                      <div
                        ref={tableScrollRef}
                        onMouseEnter={() => {
                          tableHovered.current = true;
                        }}
                        onMouseLeave={() => {
                          tableHovered.current = false;
                        }}
                        className={`min-h-0 flex-1 ${
                          slideMode === "auto" ? "overflow-hidden" : "wx-cards-scroll overflow-y-auto"
                        }`}
                      >
                {slideMode === "manual" ? (
                  <DndContext
                    sensors={dndSensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={filledSlots.map((e) => e.workerId)}
                      strategy={verticalListSortingStrategy}
                    >
                      {filledSlots.map((entry, pos) => (
                        <SortableWorkerTableRow
                          key={entry.workerId}
                          entry={entry}
                          sample={latestMap.get(entry.workerId)}
                          signal={signalLevel(latestMap.get(entry.workerId), now)}
                          stress={
                            stressByWorker.get(entry.workerId) ??
                            computeStressIndex(stressInputsFromSample(latestMap.get(entry.workerId) ?? {}))
                          }
                          isAnomaly={pos === anomalyPos}
                          fallTs={lastFallByWorker.get(entry.workerId)}
                          count={data.countsByWorker?.[entry.workerId] ?? 0}
                          isVirtual={isVirtualWorker(entry.workerId)}
                          jobTitle={
                            data.workerProfiles?.[entry.workerId] ??
                            latestMap.get(entry.workerId)?.jobTitle
                          }
                          onEditJobTitle={openJobTitleEditor}
                          selection={selection}
                          onSelect={toggleSelection}
                          onClear={clearSlot}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                ) : (
                  // overflow 시에만 복제본(copy 1) 추가 → 행이 적으면 한 벌만 렌더해 같은 작업자 중복 노출 방지
                  (tableOverflowing ? [0, 1] : [0]).map((copy) => (
                    <div
                      key={`copy-${copy}`}
                      // 복제본(copy 1)은 a11y 트리에서만 숨기고(aria-hidden) 마우스 클릭은 허용한다.
                      // 자동 슬라이딩 중 화면에 보이는 인스턴스가 복제본이어도 생체 셀을 선택할 수 있게 —
                      // 셀 onClick 은 같은 workerId 를 대상으로 하므로 원본 클릭과 동작이 동일하다.
                      // (pointer-events-none 이면 복제본이 보일 때 클릭이 무반응이라 "간헐적 선택 불가"가 발생)
                      aria-hidden={copy === 1}
                    >
                      {filledSlots.map((entry, pos) => (
                        <WorkerTableRow
                          key={`${copy}-${entry.workerId}`}
                          entry={entry}
                          sample={latestMap.get(entry.workerId)}
                          signal={signalLevel(latestMap.get(entry.workerId), now)}
                          stress={
                            stressByWorker.get(entry.workerId) ??
                            computeStressIndex(stressInputsFromSample(latestMap.get(entry.workerId) ?? {}))
                          }
                          isAnomaly={pos === anomalyPos}
                          fallTs={lastFallByWorker.get(entry.workerId)}
                          count={data.countsByWorker?.[entry.workerId] ?? 0}
                          isVirtual={isVirtualWorker(entry.workerId)}
                          jobTitle={
                            data.workerProfiles?.[entry.workerId] ??
                            latestMap.get(entry.workerId)?.jobTitle
                          }
                          onEditJobTitle={openJobTitleEditor}
                          selection={selection}
                          onSelect={toggleSelection}
                          onClear={clearSlot}
                          ariaHidden={copy === 1}
                        />
                      ))}
                    </div>
                  ))
                )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ),
          },
          { title: "가스 누출 감지기", content: <GasDetectorTable onSelect={openSiteChart} /> },
          { title: "심장 제세동기 알림", content: <AedAlertTable onSelect={openSiteChart} /> },
          { title: "CCTV 관제", content: <CctvQuadView /> },
        ]}
      />
              </div>
            ),
          },
          {
            title: "안전관리비 검증",
            content: (
              <div className="flex flex-col gap-4">
                {/* VitAlGuard 진입 메뉴 — 검증/보고서/제출 화면 */}
                <nav className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-canvas px-4 py-3 dark:border-white/10 dark:bg-surface-dark">
                  <span className="mr-1 text-xs font-bold text-ink dark:text-on-dark">VitAlGuard 안전관리비 검증</span>
                  <a
                    href="/weekly-report"
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
                  >
                    주간 검증 보고서
                  </a>
                  <a
                    href="/contractor"
                    className="rounded-md border border-hairline px-3 py-1.5 text-xs font-semibold text-body transition hover:border-primary dark:border-white/10 dark:text-on-dark-soft"
                  >
                    시공사 청구 제출
                  </a>
                  <a
                    href="/safety-audit"
                    className="rounded-md border border-hairline px-3 py-1.5 text-xs font-semibold text-body transition hover:border-primary dark:border-white/10 dark:text-on-dark-soft"
                  >
                    실집행 검증 전체화면
                  </a>
                </nav>

                {/* VitAlGuard — 안전관리비 실집행 검증(①계상=조달 × ③실집행=워치 출역).
                    (착공 전 발주 위험선별 ProcureRiskBoard 는 /safeprocure 부가 페이지로 이동.) */}
                <section className="overflow-hidden rounded-xl border border-hairline bg-canvas px-6 py-4 text-ink dark:border-white/10 dark:bg-surface-dark dark:text-on-dark max-[640px]:px-5">
                  <SafetyCostAuditBoard />
                </section>
              </div>
            ),
          },
        ]}
      />

      {siteChart && (
        <SiteMetricChartPanel metric={siteChart} onClose={() => setSiteChart(null)} />
      )}

      {/* 전국 산업재해 사망 속보 — KOSHA OpenAPI (작업자 모니터링 하단으로 이동) */}
      <KoshaAccidentTicker />

      {queueModalSlot !== null && (
        <WorkerQueueModal
          slotIndex={queueModalSlot}
          pendingWorkers={pendingWorkers}
          onAssign={(workerId) => assignWorkerToSlot(queueModalSlot, workerId)}
          onCancel={() => setQueueModalSlot(null)}
        />
      )}

      {activeSos && (
        <SosAlertModal
          sample={activeSos}
          onDismiss={dismissSos}
          onContact={recordAccident}
        />
      )}

      {activeFallAlert && !activeSos && (
        <SosAlertModal
          sample={activeFallAlert}
          reason="fall"
          onDismiss={dismissFallAlert}
          onContact={recordAccident}
        />
      )}

      {activeVitalAlert && !activeSos && !activeFallAlert && (
        <SosAlertModal
          sample={activeVitalAlert}
          reason="vital"
          onDismiss={dismissVitalAlert}
        />
      )}

      {adminOpen && (
        <AdminExportModal
          siteInfo={siteInfo}
          onSiteInfoSave={handleSiteInfoSave}
          onClose={() => setAdminOpen(false)}
        />
      )}

      {alertsOpen && <AlertHistoryModal onClose={() => setAlertsOpen(false)} />}

      <HeaderCalendarPopup open={calendarOpen} onClose={() => setCalendarOpen(false)} />

      {usersOpen && <UserManagementModal onClose={() => setUsersOpen(false)} />}

      {jobTitleEdit && (
        <JobTitleEditModal
          workerId={jobTitleEdit.workerId}
          current={jobTitleEdit.current}
          workerName={latestMap.get(jobTitleEdit.workerId)?.workerName}
          onSave={saveJobTitle}
          onClose={() => setJobTitleEdit(null)}
        />
      )}

      {selection && (
        <VitalHistoryPanel
          selection={selection}
          workerName={latestMap.get(selection.workerId)?.workerName}
          employeeId={latestMap.get(selection.workerId)?.employeeId}
          hasLiveData={hasLiveMetric(
            latestMap.get(selection.workerId),
            selection.metric,
            lastFallByWorker.get(selection.workerId),
          )}
          onMetricChange={(metric) =>
            setSelection({ workerId: selection.workerId, metric })
          }
          onClose={() => setSelection(null)}
        />
      )}

      <section className="overflow-hidden rounded-xl border border-hairline bg-canvas dark:border-white/10 dark:bg-surface-dark-elevated">
        <button
          type="button"
          onClick={() => setLogExpanded((prev) => !prev)}
          aria-expanded={logExpanded}
          className={`flex w-full items-center justify-between gap-3 border-b border-hairline px-6 py-4 text-sm font-semibold text-ink active:bg-surface-strong dark:border-white/10 dark:text-on-dark ${FOCUS_CLASS}`}
        >
          <span>
            실시간 수집 · DB 영속{" "}
            <span className="font-mono">{(data.totalPersisted ?? 0).toLocaleString()}</span>건 누적
            <span className="ml-2 text-xs font-normal text-muted dark:text-on-dark-soft">
              (화면 표시 최근 {data.recent.length}건)
            </span>
          </span>
          <span className="shrink-0 text-xs text-muted dark:text-on-dark-soft">
            {logExpanded ? "▲ 줄이기" : "▼ 펼치기"}
          </span>
        </button>
        {logExpanded && (
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-surface-soft text-xs text-body dark:bg-surface-dark dark:text-on-dark-soft">
                <tr>
                  <th className="px-4 py-3">시간</th>
                  <th className="px-4 py-3">작업자</th>
                  <th className="px-4 py-3">심박 (bpm)</th>
                  <th className="px-4 py-3">산소포화도 (%)</th>
                  <th className="px-4 py-3">손목 온도 (℃)</th>
                  <th
                    className="px-4 py-3"
                    title={`손목 온도 + ${THRESHOLDS.coreTemp.wristToCoreOffsetC}℃ 보정 (단순 추정 · 의학 진단 아님)`}
                  >
                    체온 추정 (℃)
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((sample, index) => (
                  <tr key={`${sample.workerId}-${sample.ts}-${index}`} className="border-t border-hairline dark:border-white/5">
                    <td className="px-4 py-3 font-mono">{formatTime(sample.ts)}</td>
                    <td className="px-4 py-3">{workerCell(sample)}</td>
                    <td className="px-4 py-3 font-mono">{formatInt(sample.heartRate)}</td>
                    <td className="px-4 py-3 font-mono">{formatInt(sample.spo2)}</td>
                    <td className="px-4 py-3 font-mono">{formatTemp(sample.skinTempC)}</td>
                    <td className="px-4 py-3 font-mono text-body dark:text-on-dark-soft">
                      {sample.skinTempC === undefined
                        ? "--"
                        : formatTemp(estimateCoreTempC(sample.skinTempC))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

// 빈 슬롯 placeholder — 클릭 시 대기 큐 모달 진입
// 작업자 상태 tone → 색상 (표 상태 셀). WorkerStatusRow 의 toneClass 와 동일 팔레트.
const WSTATUS_TONE: Record<WorkerStatus["tone"], string> = {
  idle: "text-muted",
  normal: "text-semantic-up",
  caution: "text-amber-600 vital-blink-caution dark:text-amber-300",
  danger: "text-semantic-down vital-blink-danger",
};

// 작업자 표 헤더 — 13열 라벨. 수동 모드일 때만 첫 열에 "정렬" 라벨.
function WorkerTableHeader({ manual }: { manual: boolean }) {
  const cols = ["", "작업자", "직급", "심박", "SpO₂", "체온", "낙상", "스트레스", "신호", "상태", "수신", "누적", ""];
  return (
    <div
      className={`${TABLE_GRID} border-b border-hairline bg-surface-soft px-3 py-2 text-[11px] font-semibold text-muted dark:border-white/10 dark:bg-surface-dark dark:text-on-dark-soft`}
    >
      {cols.map((label, i) => (
        <div key={i} className={i === 1 ? "" : "text-center"}>
          {i === 0 ? (manual ? "정렬" : "") : label}
        </div>
      ))}
    </div>
  );
}

type WorkerTableRowProps = {
  entry: { workerId: string; slotIndex: number };
  sample?: VitalSample;
  signal: 0 | 1 | 2 | 3 | 4;
  stress: StressResult;
  isAnomaly: boolean;
  fallTs?: string;
  count: number;
  isVirtual: boolean;
  // 효과 직급 = 관제 웹 오버라이드 ?? 폰 발신값 ?? (없으면 undefined → "—"). 클릭 시 편집.
  jobTitle?: string;
  onEditJobTitle: (workerId: string, current: string) => void;
  selection: Selection | null;
  onSelect: (next: Selection) => void;
  onClear: (slotIndex: number) => void;
  // 자동 복제본(aria-hidden)은 포커스/클릭 비활성
  ariaHidden?: boolean;
  // 드래그(수동 모드)용 — SortableWorkerTableRow 가 주입
  draggable?: boolean;
  innerRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
};

// 작업자 한 행 — 12열 그리드(h-12 고정). 메트릭 셀 클릭 → 누적 추세 차트. 위험/주의는 좌측 색 띠 + 빨강 링(이상).
function WorkerTableRow({
  entry,
  sample,
  signal,
  stress,
  isAnomaly,
  fallTs,
  count,
  isVirtual,
  jobTitle,
  onEditJobTitle,
  selection,
  onSelect,
  onClear,
  ariaHidden,
  draggable,
  innerRef,
  style,
  dragAttributes,
  dragListeners,
}: WorkerTableRowProps) {
  const workerId = entry.workerId;
  const overall = overallStatus(sample);
  const wstatus = workerStatus(sample);
  // 연결끊김 — sample 존재 + 신호 60초 초과(signal===0). sticky 직전값을 "정상"으로 오인하는 false-OK 차단.
  // 60초 기준은 워치 30초 배칭 오탐 회피용(STALE_MS 주석 참조).
  const stale = sample !== undefined && signal === 0;
  const heading = workerHeading(sample, workerId);
  const tabIndex = ariaHidden ? -1 : undefined;
  const accent = stale
    ? "border-l-slate-400 dark:border-l-slate-500"
    : overall === "danger"
      ? "border-l-semantic-down"
      : overall === "caution"
        ? "border-l-amber-400"
        : "border-l-transparent";
  const core = sample?.skinTempC === undefined ? undefined : estimateCoreTempC(sample.skinTempC);
  const fallRecent =
    fallTs !== undefined && Date.now() - new Date(fallTs).getTime() < 5 * 60 * 1000;

  const sel = (metric: HistoryMetric) =>
    selection?.workerId === workerId && selection.metric === metric;
  const metricCell = (metric: HistoryMetric, content: ReactNode, title: string) => (
    <button
      type="button"
      tabIndex={tabIndex}
      onClick={(e) => {
        e.stopPropagation();
        onSelect({ workerId, metric });
      }}
      title={title}
      className={`flex h-9 items-center justify-center rounded-md px-1 text-center transition ${
        sel(metric)
          ? "bg-surface-soft shadow-sm ring-1 ring-inset ring-hairline dark:bg-[#1c1f26] dark:shadow-[0_2px_8px_rgba(0,0,0,0.45)] dark:ring-white/15"
          : "hover:bg-surface-strong/60 dark:hover:bg-white/5"
      } ${FOCUS_CLASS}`}
    >
      {content}
    </button>
  );

  return (
    <div
      ref={innerRef}
      style={style}
      aria-hidden={ariaHidden}
      className={`${TABLE_GRID} h-12 border-b border-l-4 border-b-hairline ${accent} px-3 dark:border-b-white/10 ${
        isAnomaly ? "bg-semantic-down/5 ring-1 ring-inset ring-semantic-down" : ""
      }`}
    >
      {/* 1 드래그 핸들(수동) */}
      <div className="flex items-center justify-center">
        {draggable ? (
          <button
            type="button"
            {...dragAttributes}
            {...dragListeners}
            title="드래그하여 순서 변경"
            aria-label="순서 변경 핸들"
            className={`cursor-grab touch-none rounded p-1 text-muted hover:bg-surface-strong active:cursor-grabbing dark:hover:bg-white/10 ${FOCUS_CLASS}`}
          >
            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
              <circle cx="2" cy="2" r="1.4" />
              <circle cx="8" cy="2" r="1.4" />
              <circle cx="2" cy="7" r="1.4" />
              <circle cx="8" cy="7" r="1.4" />
              <circle cx="2" cy="12" r="1.4" />
              <circle cx="8" cy="12" r="1.4" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* 2 작업자 — 신호등 + 이름/사번 */}
      <div className="flex min-w-0 items-center gap-2">
        <TrafficLight status={overall} stale={stale} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink dark:text-on-dark">
            {heading.title}
          </div>
          <div className="truncate font-mono text-[11px] text-muted dark:text-on-dark-soft">
            {heading.subtitle ?? "사번 미설정"}
          </div>
        </div>
      </div>

      {/* 3 직급/직책 — 클릭 시 편집(관제 웹 입력). 폰 ⚙️ 발신값/오버라이드 효과값 표시. */}
      <div className="flex items-center justify-center">
        <button
          type="button"
          tabIndex={tabIndex}
          onClick={(e) => {
            e.stopPropagation();
            onEditJobTitle(workerId, jobTitle ?? "");
          }}
          title="직급/직책 — 클릭하여 편집"
          className={`max-w-full truncate rounded-md px-1.5 py-0.5 text-xs transition ${
            jobTitle
              ? "font-medium text-body dark:text-on-dark-soft"
              : "text-muted dark:text-on-dark-soft"
          } hover:bg-surface-strong/60 dark:hover:bg-white/5 ${FOCUS_CLASS}`}
        >
          {jobTitle || "직급 +"}
        </button>
      </div>

      {/* 4 심박 */}
      {metricCell(
        "heartRate",
        <span className="font-mono text-sm tabular-nums">
          <span className={STATUS_CLASS[heartRateStatus(sample?.heartRate, workActivity(sample ?? {}))]}>
            {formatInt(sample?.heartRate)}
          </span>
          <span className="ml-0.5 text-[10px] text-muted">bpm</span>
        </span>,
        "심박 — 클릭 시 누적 추세",
      )}

      {/* 5 SpO₂ */}
      {metricCell(
        "spo2",
        <span className="font-mono text-sm tabular-nums">
          <span className={STATUS_CLASS[spo2Status(sample?.spo2)]}>{formatInt(sample?.spo2)}</span>
          <span className="ml-0.5 text-[10px] text-muted">%</span>
        </span>,
        "산소포화도 — 클릭 시 누적 추세",
      )}

      {/* 6 체온 — 손목 + 추정 */}
      {metricCell(
        "skinTempC",
        <span className="leading-tight">
          <span className="font-mono text-sm tabular-nums">
            <span className={STATUS_CLASS[coreTempStatus(sample?.skinTempC)]}>
              {sample?.skinTempC === undefined ? "--" : formatTemp(sample.skinTempC)}
            </span>
            <span className="ml-0.5 text-[10px] text-muted">℃</span>
          </span>
          <span className="block text-[9px] leading-none text-muted">
            추정 {core === undefined ? "--" : formatTemp(core)}℃
          </span>
        </span>,
        "손목온도 / 추정체온 — 클릭 시 누적 추세",
      )}

      {/* 7 낙상 */}
      {metricCell(
        "fall",
        <span
          className={`text-xs font-medium ${fallRecent ? "text-semantic-down vital-blink-danger" : "text-muted"}`}
        >
          {fallRecent ? "발생" : "감지안됨"}
        </span>,
        "낙상 감지 — 클릭 시 누적 추세",
      )}

      {/* 8 스트레스 */}
      <div className="flex items-center justify-center">
        <StressChip result={stress} />
      </div>

      {/* 9 신호 */}
      <div className="flex items-center justify-center">
        <SignalBars level={signal} />
      </div>

      {/* 10 상태 — 연결끊김이면 생체 상태보다 우선 표시(false-OK 차단) */}
      <div className="flex items-center justify-center">
        {stale ? (
          <span className="whitespace-nowrap text-xs font-semibold text-slate-500 dark:text-slate-300">
            연결끊김
          </span>
        ) : (
          <span className={`whitespace-nowrap text-xs font-semibold ${WSTATUS_TONE[wstatus.tone]}`}>
            {wstatus.label}
          </span>
        )}
      </div>

      {/* 11 수신시각 */}
      <div className="text-center font-mono text-[11px] text-muted dark:text-on-dark-soft">
        {formatTime(sample?.ts)}
      </div>

      {/* 12 누적 건수 */}
      <div
        className="text-center font-mono text-[11px] font-semibold text-body dark:text-on-dark"
        title={isVirtual ? "가상(테스트) 작업자" : "실시간 수집 DB 누적 건수"}
      >
        {isVirtual ? "가상" : count.toLocaleString()}
      </div>

      {/* 13 해제 */}
      <div className="flex items-center justify-center">
        <button
          type="button"
          tabIndex={tabIndex}
          onClick={(e) => {
            e.stopPropagation();
            onClear(entry.slotIndex);
          }}
          title={`슬롯 ${entry.slotIndex + 1}번에서 해제`}
          className={`rounded-md px-1.5 py-1 text-[11px] font-medium text-muted hover:bg-surface-strong hover:text-semantic-down dark:hover:bg-white/10 ${FOCUS_CLASS}`}
        >
          해제
        </button>
      </div>
    </div>
  );
}

// 수동 모드 행 — dnd-kit useSortable 로 드래그 정렬 가능하게 래핑.
function SortableWorkerTableRow(props: WorkerTableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.entry.workerId,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.9 : undefined,
    position: isDragging ? "relative" : undefined,
  };
  return (
    <WorkerTableRow
      {...props}
      draggable
      innerRef={setNodeRef}
      style={style}
      dragAttributes={attributes}
      dragListeners={listeners}
    />
  );
}

// 직급/직책 편집 모달 — 관제 웹 입력. ESC/배경 클릭 닫기. 빈 값 저장 시 오버라이드 해제(폰 발신값 복귀).
function JobTitleEditModal({
  workerId,
  current,
  workerName,
  onSave,
  onClose,
}: {
  workerId: string;
  current: string;
  workerName?: string;
  onSave: (workerId: string, jobTitle: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(current);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-2xl dark:border-white/10 dark:bg-surface-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-hairline px-5 py-3 dark:border-white/10">
          <span className="text-sm font-bold text-ink dark:text-on-dark">직급/직책 입력</span>
        </div>
        <div className="px-5 py-4">
          <p className="mb-2 text-xs text-muted dark:text-on-dark-soft">
            {workerName ? `${workerName} · ` : ""}
            <span className="font-mono">{workerId}</span>
          </p>
          <input
            autoFocus
            type="text"
            value={value}
            maxLength={40}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave(workerId, value);
            }}
            placeholder="예: 현장소장 · 안전관리자 · 철근공"
            className="w-full rounded-lg border border-hairline bg-surface-soft px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-[#0052ff]/40 dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark"
          />
          <p className="mt-2 text-[11px] text-muted dark:text-on-dark-soft">
            비우고 저장하면 폰 발신값으로 복귀합니다.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-strong dark:hover:bg-white/10"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onSave(workerId, value)}
            className="rounded-lg bg-[#0052ff] px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// SOS·낙상 알림 이력 모달(AF4) — 발생/대응 시각·대응자 표시 + 미대응 알림 "대응 확인".
type ClientAlert = {
  id: number;
  worker_id: string;
  worker_name: string | null;
  type: "sos" | "fall" | "vital";
  ts: string;
  created_at: string;
  ack_at: string | null;
  ack_by: string | null;
};

const ALERT_LABEL: Record<string, string> = {
  sos: "SOS 요청",
  fall: "낙상 감지",
  vital: "생체 위험",
};
// 미대응 알림 카드/아이콘 톤 — SOS 레드 / 낙상 앰버 / 생체 위험 로즈.
const ALERT_UNACK_CARD: Record<string, string> = {
  sos: "border-[#dc2626]/30 bg-[#dc2626]/[0.06] dark:border-[#dc2626]/40 dark:bg-[#dc2626]/[0.10]",
  fall: "border-[#f59e0b]/35 bg-[#f59e0b]/[0.08] dark:border-[#f59e0b]/40 dark:bg-[#f59e0b]/[0.10]",
  vital: "border-[#e11d48]/30 bg-[#e11d48]/[0.06] dark:border-[#e11d48]/40 dark:bg-[#e11d48]/[0.10]",
};
const ALERT_UNACK_ICON: Record<string, string> = {
  sos: "text-semantic-down",
  fall: "text-amber-600 dark:text-amber-400",
  vital: "text-rose-600 dark:text-rose-400",
};

function fmtAlertTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function AlertHistoryModal({ onClose }: { onClose: () => void }) {
  const [alerts, setAlerts] = useState<ClientAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = getSessionToken();
    try {
      const res = await fetch("/api/alerts", {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.ok) {
        const data = (await res.json()) as { alerts?: ClientAlert[] };
        setAlerts(data.alerts ?? []);
      }
    } catch (e) {
      console.error("[알림 이력 로드 오류]", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load, onClose]);

  async function ack(id: number) {
    const token = getSessionToken();
    try {
      await fetch("/api/alerts/ack", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id, ackBy: "관제자" }),
      });
    } catch (e) {
      console.error("[알림 대응 확인 오류]", e);
    }
    load();
  }

  const unacked = alerts.filter((a) => !a.ack_at).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-2xl dark:border-white/10 dark:bg-surface-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3 dark:border-white/10">
          <span className="text-sm font-bold text-ink dark:text-on-dark">
            SOS·낙상·생체 알림 이력
            {unacked > 0 && (
              <span className="ml-2 text-semantic-down">미대응 {unacked}건</span>
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-strong dark:hover:bg-white/10"
          >
            닫기
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-3">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted">불러오는 중...</p>
          ) : alerts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">알림 이력이 없습니다.</p>
          ) : (
            <ul className="space-y-2.5">
              {alerts.map((a) => {
                const resolved = !!a.ack_at;
                // 미대응 = 종류별 라이트 톤(SOS 레드 / 낙상 앰버 / 생체 위험 로즈), 대응완료 = 중립 톤.
                const card = resolved
                  ? "border-hairline bg-surface-soft/60 dark:border-white/10 dark:bg-white/[0.03]"
                  : ALERT_UNACK_CARD[a.type] ?? ALERT_UNACK_CARD.sos!;
                // 대응완료=녹색(success) / 미대응=종류별(SOS 레드·낙상 앰버·생체 로즈)
                const iconTone = resolved ? "text-semantic-up" : ALERT_UNACK_ICON[a.type] ?? ALERT_UNACK_ICON.sos!;
                return (
                  <li
                    key={a.id}
                    className={`flex items-stretch gap-3 rounded-xl border px-3.5 py-3 ${card}`}
                  >
                    <div className={`mt-0.5 shrink-0 ${iconTone}`}>
                      {resolved ? <AlertResolvedIcon /> : <AlertTypeIcon type={a.type} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold tracking-tight text-ink dark:text-on-dark">
                        {ALERT_LABEL[a.type] ?? a.type} ·{" "}
                        {a.worker_name || a.worker_id}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] leading-relaxed text-muted dark:text-on-dark-soft">
                        발생 {fmtAlertTime(a.ts)}
                        {a.ack_at
                          ? ` · 대응 ${fmtAlertTime(a.ack_at)} (${a.ack_by ?? "-"})`
                          : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center">
                      {resolved ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#16a34a]/15 px-2.5 py-1 text-[11px] font-semibold text-semantic-up">
                          <AlertCheckIcon />
                          대응완료
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => ack(a.id)}
                          className="rounded-lg bg-semantic-down px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
                        >
                          대응 확인
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// 알림 이력 종류별 라인 아이콘(레퍼런스 cva Alert 세트) — SOS=삼각 경고(destructive) / 낙상=실드 경고(warning). currentColor 상속.
function AlertTypeIcon({ type }: { type: string }) {
  if (type === "sos") {
    // triangle-alert (destructive)
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    );
  }
  if (type === "vital") {
    // heart-pulse (생체 위험)
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
        <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
      </svg>
    );
  }
  // shield-alert (warning)
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

// 대응완료(success) 좌측 아이콘 — circle-check(녹색). currentColor 상속.
function AlertResolvedIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

// 대응완료 배지용 체크 아이콘 (모노톤)
function AlertCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4 4 10-10" />
    </svg>
  );
}

// 작업자 폰 ↔ 대시보드 통신 freshness — 모바일 시그널 바 (4 막대, 좌→우 증가)
function SignalBars({ level }: { level: 0 | 1 | 2 | 3 | 4 }) {
  const tone =
    level >= 3
      ? "bg-semantic-up"
      : level === 2
        ? "bg-amber-500 dark:bg-amber-400"
      : level === 1
          ? "bg-semantic-down"
          : "bg-muted-soft";
  const labelText = level === 0 ? "신호 없음" : `신호 ${level}/4`;
  return (
    <span
      aria-label={labelText}
      title={labelText}
      className="inline-flex h-3 shrink-0 items-end gap-[2px]"
    >
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`w-[3px] rounded-[1px] ${i <= level ? tone : "bg-hairline dark:bg-white/10"}`}
          style={{ height: `${3 + i * 2}px` }}
        />
      ))}
    </span>
  );
}

// 스트레스 지수 칩 (헤더) — 활동 보정 초과심박 + HRV 기반 0~100. 참고용 추정 (의료 진단 아님).
// 데이터/baseline 부족 시 "보정 중". 정상 정적 / 주의·위험 블링크 (생체 메트릭과 동일 키프레임).
const STRESS_CLASS: Record<StressLevel, string> = {
  idle: "border-hairline text-muted dark:border-white/15 dark:text-on-dark-soft",
  normal: "border-semantic-up text-semantic-up",
  caution:
    "border-amber-400/50 text-amber-700 vital-blink-caution dark:text-amber-300",
  danger: "border-semantic-down text-semantic-down vital-blink-danger",
};

function StressChip({ result }: { result: StressResult }) {
  if (result.calibrating || result.index === null) {
    return (
      <span
        title="스트레스 지수 — 데이터/baseline 축적 중 (자체 웨어러블 연동 시 산출)"
        className="shrink-0 whitespace-nowrap rounded-pill border border-hairline px-2 py-0.5 text-[10px] font-semibold text-muted dark:border-white/15 dark:text-on-dark-soft"
      >
        스트레스 보정 중
      </span>
    );
  }
  return (
    <span
      title="스트레스 지수 0~100 (활동 보정 초과심박 + HRV) · 참고용 추정 · 의료 진단 아님"
      className={`shrink-0 whitespace-nowrap rounded-pill border px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${STRESS_CLASS[result.level]}`}
    >
      스트레스 {result.index}
    </span>
  );
}

// 작업자 카드 헤더의 종합 상태 인디케이터 — 신호등 (녹/주/빨). 정상은 정적, 주의/위험은 블링크.
function TrafficLight({ status, stale }: { status: VitalStatus; stale?: boolean }) {
  const map: Record<VitalStatus, string> = {
    idle: "bg-muted-soft",
    normal: "bg-semantic-up",
    caution: "bg-amber-400 vital-blink-caution",
    danger: "bg-semantic-down vital-blink-danger",
  };
  // 연결끊김은 어떤 생체 상태보다 우선 — 슬레이트 점멸로 "정상 녹색" false-OK 차단.
  const cls = stale ? "bg-slate-400 dark:bg-slate-500 animate-pulse" : map[status];
  const label = stale ? "연결끊김" : STATUS_LABEL[status];
  return (
    <span
      aria-label={`종합 상태 ${label}`}
      title={`종합 상태: ${label}`}
      className={`inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-hairline dark:ring-white/20 ${cls}`}
    />
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-0 flex-col justify-center rounded-lg bg-surface-soft px-2.5 py-1 dark:bg-surface-dark-elevated">
      <div className="text-xs leading-tight text-body dark:text-on-dark-soft">{label}</div>
      <div className="font-mono text-base font-medium leading-tight text-ink dark:text-on-dark">{value}</div>
    </div>
  );
}
