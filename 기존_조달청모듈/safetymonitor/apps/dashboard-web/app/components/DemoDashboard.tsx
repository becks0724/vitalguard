"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
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
import { parseOcrStamp } from "../../lib/ocr-stamp";
import {
  evaluateHazardKmaWarnings,
  evaluateHazardWeather,
  HAZARD_TYPES,
  hazardTypeName,
  kmhToMs,
  mergeHazardWarnings,
  type HazardDailyForecast,
  type HazardSeverity,
} from "../lib/calendar-hazard";
import { INSPECTION_ITEM_LABEL, type InspectionItem } from "../lib/inspection-schedule";
import { AdminExportModal, type SiteInfo } from "./AdminExportModal";
import { ExpandableTabs } from "./ExpandableTabs";
import { KoshaAccidentCaseCard } from "./KoshaAccidentCaseCard";
import { getSessionRole, getSessionToken, useSession } from "./LoginGate";
import { KoshaAccidentTicker } from "./KoshaAccidentTicker";
import { SafetySignalBoard, type WorkerSignal } from "./SafetySignalBoard";
import {
  WorkerGpsMap,
  type MapFocus,
  type MapZone,
  type SiteCircle,
  type WorkerMapExcluded,
  type WorkerMapPoint,
} from "./WorkerGpsMap";

// 지도 모드 현장 구획 근사 원 반경(m) — 현장 규모에 맞게 조정.
// 중심 = 서버 캐시 현장 좌표(site_coord_daily·일 단위 고정) 우선 — 작업자 이동에 중심이 끌려다니지 않게.
// 주소 문자열 기반 정확 지오코딩은 무키 서비스가 건물번호를 못 잡음(도로 중심 ~800m 오차 실측) →
// NCP Maps/VWorld 키 활성화 시 주소 중심으로 승격 예정.
const SITE_CIRCLE_RADIUS_M = 100;
import { RadarRealtime } from "./RadarRealtime";
import { TyphoonTrack } from "./TyphoonTrack";
import { WarningVideoPanel } from "./WarningVideoPanel";
import { HospitalPanel } from "./HospitalPanel";
import { NewsPanel } from "./NewsPanel";
import { extractRegion } from "../lib/hospital";
import {
  GEOFENCE_INITIAL,
  ZONE_ENTRY_INITIAL,
  geofenceDistanceM,
  stepGeofence,
  stepZoneEntry,
  type GeofenceState,
  type ZoneEntryState,
} from "../lib/geofence";
import { TRACK_WINDOW_MIN, type TrackPoint } from "../lib/track";
import {
  AedAlertTable,
  GasDetectorTable,
  SiteMetricChartPanel,
  type SiteMetric,
} from "./SiteSafetyTables";
import { SosAlertModal } from "./SosAlertModal";
import { GeofenceAlertModal } from "./GeofenceAlertModal";
import { ThemeToggle } from "./ThemeToggle";
import { VitalHistoryPanel } from "./VitalHistoryPanel";
import { WeatherStrip, weatherLabel } from "./WeatherStrip";
import { WeatherIcon, weatherIconKey } from "./WeatherIcons";
import { WidgetCarousel } from "./WidgetCarousel";
import { CctvQuadView } from "./CctvQuadView";
import { WorkerQueueModal } from "./WorkerQueueModal";
import SafetyVerificationTabs from "./SafetyVerificationTabs";
import { SectionPager } from "./SectionPager";
import ErpDemoPage from "../erp/page";
import { MyProfileModal } from "./MyProfileModal";
import { ProfileGateModal } from "./ProfileGateModal";
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

// 슬롯 등록을 서버(공유 관제 1벌)에도 반영 — 다른 기기·브라우저 공유. fire-and-forget(실패는 localStorage 폴백).
function persistSlotsServer(slots: SlotAssignments) {
  if (typeof window === "undefined") return;
  try {
    const token = getSessionToken();
    void fetch("/api/monitor/slots", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ slots }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 무시 — 다음 변경 시 재시도 */
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

function formatTemp(value?: number | null) {
  return value == null ? "--" : value.toFixed(1);
}

// HR/SpO2 는 의학 표준 정수 표시 (폰이 raw double 보내도 round)
function formatInt(value?: number | null) {
  return value == null ? "--" : Math.round(value).toString();
}

// 체온 미수신(기기 미전송) 안내 — 애플워치 등 일부 기기는 작업 중 체온을 전송하지 않음.
// store sticky-carry 로 한번이라도 값이 오면 유지되므로, 남아있는 null/undefined ≈ "미수신".
const TEMP_UNAVAILABLE_TITLE = "체온 미수신 — 이 기기에서 체온 데이터가 들어오지 않습니다";

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
// 로그인에서 선택한 현장 id("main" | "demo-…"). 메인 현장만 서버 DB(관리자 저장값)를 우선 로드한다.
const SITE_ID_STORAGE_KEY = "safetymonitor.site-id.v1";
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
      noticeId: parsed.noticeId, // 안전관리비 검증 매칭 키 — 드롭하면 재저장 시 영구 삭제된다
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

// SOS/낙상 팝업 확인(ack) 영속 — 메모리 상태만으론 새로고침 시 이미 확인한 경보가 재팝업.
// 값 = 확인한 경보 자연키("sos|<workerId>|<ts>" / "fall|<workerId>|<ts>") 배열.
const ALERT_ACK_STORAGE_KEY = "safetymonitor.alertAck.v1";
const ALERT_ACK_MAX_KEYS = 200; // 오래된 키부터 밀어내 localStorage 무한 증가 방지

function loadAckedAlertKeys(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ALERT_ACK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is string => typeof k === "string");
  } catch {
    return [];
  }
}

function appendAckedAlertKey(key: string) {
  if (typeof window === "undefined") return;
  try {
    const next = [...loadAckedAlertKeys().filter((k) => k !== key), key].slice(
      -ALERT_ACK_MAX_KEYS,
    );
    window.localStorage.setItem(ALERT_ACK_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 사용 불가 환경은 조용히 무시(세션 내 메모리 ack 는 유지)
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

// 일정 라벨 색상 — 8색 프리셋 팔레트(라이트/다크 모드 모두 가독성 보장하는 Tailwind 토큰)
type LabelColor =
  | "red"
  | "orange"
  | "amber"
  | "emerald"
  | "teal"
  | "blue"
  | "violet"
  | "slate";

const LABEL_COLOR_ORDER: LabelColor[] = [
  "red",
  "orange",
  "amber",
  "emerald",
  "teal",
  "blue",
  "violet",
  "slate",
];

const LABEL_COLOR_META: Record<
  LabelColor,
  { swatch: string; chip: string; dot: string; band: string }
> = {
  red: {
    swatch: "bg-red-500",
    chip: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200",
    dot: "bg-red-500",
    band: "bg-red-500/12 border-red-500/20 text-red-900 dark:bg-red-500/15 dark:text-red-100",
  },
  orange: {
    swatch: "bg-orange-500",
    chip: "bg-orange-100 text-orange-900 dark:bg-orange-500/20 dark:text-orange-200",
    dot: "bg-orange-500",
    band: "bg-orange-500/12 border-orange-500/20 text-orange-900 dark:bg-orange-500/15 dark:text-orange-100",
  },
  amber: {
    swatch: "bg-amber-400",
    chip: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100",
    dot: "bg-amber-400",
    band: "bg-amber-400/15 border-amber-400/25 text-amber-950 dark:bg-amber-500/15 dark:text-amber-100",
  },
  emerald: {
    swatch: "bg-emerald-500",
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
    dot: "bg-emerald-500",
    band: "bg-emerald-500/12 border-emerald-500/20 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-100",
  },
  teal: {
    swatch: "bg-teal-500",
    chip: "bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-200",
    dot: "bg-teal-500",
    band: "bg-teal-500/12 border-teal-500/20 text-teal-900 dark:bg-teal-500/15 dark:text-teal-100",
  },
  blue: {
    swatch: "bg-blue-500",
    chip: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200",
    dot: "bg-blue-500",
    band: "bg-blue-500/12 border-blue-500/20 text-blue-900 dark:bg-blue-500/15 dark:text-blue-100",
  },
  violet: {
    swatch: "bg-violet-500",
    chip: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200",
    dot: "bg-violet-500",
    band: "bg-violet-500/12 border-violet-500/20 text-violet-900 dark:bg-violet-500/15 dark:text-violet-100",
  },
  slate: {
    swatch: "bg-slate-500",
    chip: "bg-slate-200 text-slate-700 dark:bg-slate-500/25 dark:text-slate-200",
    dot: "bg-slate-500",
    band: "bg-slate-500/12 border-slate-500/20 text-slate-800 dark:bg-slate-500/15 dark:text-slate-100",
  },
};

const FALLBACK_LABEL_COLOR: LabelColor = "slate";

// 사용자 정의 일정 라벨 — 이름·색상 편집 및 추가/삭제 가능, 서버 DB 영속(관리자 간 공유)
type ScheduleLabelDef = {
  id: string;
  name: string;
  color: LabelColor;
};

const DEFAULT_LABELS: ScheduleLabelDef[] = [
  { id: "lbl_important", name: "중요일정", color: "red" },
  { id: "lbl_order", name: "발주계획", color: "amber" },
  { id: "lbl_start", name: "착수계획", color: "emerald" },
  { id: "lbl_etc", name: "기타", color: "blue" },
];

type CalendarEvent = {
  id: string;
  dateKey: string;
  title: string;
  labelId: string;
  startTime?: string;
  endTime?: string;
  // 위험작업 유형(calendar-hazard 5종) — 기상 예보와 충돌 시 경고 표시.
  hazardType?: string;
  // 등록자(서버 세션 username) — 서버가 최초 등록 시 저장, 클라는 표시만.
  createdBy?: string;
};

// 옛 localStorage 키 — 서버 승격 후에는 1회 마이그레이션 원본·서버 조회 실패 시 읽기 폴백으로만 사용.
// 설비 점검 자동 일정 마커(서버 /api/inspection-schedule 응답) — 읽기 전용.
type CalendarInspectionMarker = {
  deviceId: string;
  loc: string;
  item: InspectionItem;
  dueDateKey: string;
  dueDays: number;
  severity: "normal" | "caution" | "danger";
};

const CALENDAR_LABELS_STORAGE_KEY = "safetymonitor.calendar-labels.v1";
const CALENDAR_EVENTS_STORAGE_KEY = "safetymonitor.calendar-events.v1";
// localStorage → 서버 1회 마이그레이션 완료 플래그(브라우저별).
const CALENDAR_MIGRATED_KEY = "safetymonitor.calendar-migrated.v1";

// 클라우드 브릿지 — 앱 OCR 미디어(서버/DB 영속). 일정과 같은 서버 레이어(테이블 별개).
type CalendarMediaComment = {
  id: string;
  authorName: string | null;
  authorId: string | null;
  authorRole: string | null;
  authorTitle: string | null;
  body: string;
  createdAt: string;
  updatedAt: string | null;
};
type CalendarMedia = {
  id: string;
  dateKey: string;
  capturedAt: string | null;
  mediaType: string;
  title: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  ocrText: string | null;
  description: string | null;
  uploader: string | null;
  workerId: string | null;
  latitude: number | null;
  longitude: number | null;
  roadAddress: string | null;
  comments: CalendarMediaComment[];
};

function findLabelDef(labels: ScheduleLabelDef[], labelId: string): ScheduleLabelDef {
  return (
    labels.find((l) => l.id === labelId) ?? {
      id: labelId,
      name: "삭제된 라벨",
      color: FALLBACK_LABEL_COLOR,
    }
  );
}

function isLabelColor(value: unknown): value is LabelColor {
  return typeof value === "string" && (LABEL_COLOR_ORDER as string[]).includes(value);
}

function loadCalendarLabels(): ScheduleLabelDef[] {
  if (typeof window === "undefined") return DEFAULT_LABELS;
  try {
    const raw = window.localStorage.getItem(CALENDAR_LABELS_STORAGE_KEY);
    if (!raw) return DEFAULT_LABELS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_LABELS;
    const cleaned = parsed
      .filter(
        (l): l is ScheduleLabelDef =>
          l && typeof l.id === "string" && typeof l.name === "string" && isLabelColor(l.color),
      )
      .map((l) => ({ id: l.id, name: l.name, color: l.color }));
    return cleaned.length > 0 ? cleaned : DEFAULT_LABELS;
  } catch {
    return DEFAULT_LABELS;
  }
}

// 서버 응답 라벨 행(snake 없음·검증만) → ScheduleLabelDef. 형식 불량 행은 버림.
function calendarLabelsFromServer(rows: unknown[]): ScheduleLabelDef[] {
  return rows
    .filter(
      (l): l is { id: string; name: string; color: LabelColor } =>
        typeof (l as { id?: unknown })?.id === "string" &&
        typeof (l as { name?: unknown })?.name === "string" &&
        isLabelColor((l as { color?: unknown })?.color),
    )
    .map((l) => ({ id: l.id, name: l.name, color: l.color }));
}

// 서버 응답 일정 행(snake_case) → CalendarEvent. 형식 불량 행은 버림.
function calendarEventsFromServer(rows: unknown[]): CalendarEvent[] {
  return rows
    .filter(
      (r): r is Record<string, unknown> =>
        typeof (r as { id?: unknown })?.id === "string" &&
        typeof (r as { date_key?: unknown })?.date_key === "string" &&
        typeof (r as { title?: unknown })?.title === "string" &&
        typeof (r as { label_id?: unknown })?.label_id === "string",
    )
    .map((r) => ({
      id: r.id as string,
      dateKey: r.date_key as string,
      title: r.title as string,
      labelId: r.label_id as string,
      startTime: typeof r.start_time === "string" ? r.start_time : undefined,
      endTime: typeof r.end_time === "string" ? r.end_time : undefined,
      hazardType: typeof r.hazard_type === "string" ? r.hazard_type : undefined,
      createdBy: typeof r.created_by === "string" ? r.created_by : undefined,
    }));
}

// 설비 점검 스케줄 응답 → dateKey별 마커 맵. 형식 불량 행은 버림.
async function inspectionMapFromResponse(
  res: Response,
): Promise<Record<string, CalendarInspectionMarker[]> | null> {
  const json = (await res.json()) as { ok?: boolean; markers?: unknown[] };
  if (!json.ok || !Array.isArray(json.markers)) return null;
  const map: Record<string, CalendarInspectionMarker[]> = {};
  for (const raw of json.markers) {
    const m = raw as Record<string, unknown>;
    const dateKey = typeof m.dueDateKey === "string" ? m.dueDateKey : "";
    const item = m.item === "battery" || m.item === "pad" ? m.item : null;
    const sev =
      m.severity === "danger" || m.severity === "caution" || m.severity === "normal"
        ? m.severity
        : null;
    if (!dateKey || !item || !sev || typeof m.dueDays !== "number") continue;
    (map[dateKey] ??= []).push({
      deviceId: typeof m.deviceId === "string" ? m.deviceId : "",
      loc: typeof m.loc === "string" ? m.loc : "",
      item,
      dueDateKey: dateKey,
      dueDays: m.dueDays,
      severity: sev,
    });
  }
  return map;
}

function loadCalendarEvents(): CalendarEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CALENDAR_EVENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is CalendarEvent =>
          e &&
          typeof e.id === "string" &&
          typeof e.dateKey === "string" &&
          typeof e.title === "string" &&
          typeof e.labelId === "string",
      )
      .map((e) => ({
        id: e.id,
        dateKey: e.dateKey,
        title: e.title,
        labelId: e.labelId,
        startTime: typeof e.startTime === "string" ? e.startTime : undefined,
        endTime: typeof e.endTime === "string" ? e.endTime : undefined,
      }));
  } catch {
    return [];
  }
}

function calendarSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 캘린더 배지 — '이미 본' 현장 사진(미디어) id 집합을 localStorage 에 보관(카카오톡 미확인 방식).
// 새 미디어 id 개수 = 배지 숫자. 캘린더를 열면 현재 미디어 전부를 seen 에 추가해 배지를 비운다.
const CALENDAR_SEEN_KEY = "safetymonitor.calendarSeen.v1";
const CALENDAR_SEEN_MAX = 500; // localStorage 무한 증가 방지 — 최근 N개 id 만 보관
function loadCalendarSeen(): { ids: string[]; existed: boolean } {
  try {
    const raw = localStorage.getItem(CALENDAR_SEEN_KEY);
    if (raw === null) return { ids: [], existed: false };
    const arr = JSON.parse(raw);
    return {
      ids: Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [],
      existed: true,
    };
  } catch {
    return { ids: [], existed: false };
  }
}
function saveCalendarSeen(ids: string[]) {
  try {
    localStorage.setItem(CALENDAR_SEEN_KEY, JSON.stringify(ids.slice(-CALENDAR_SEEN_MAX)));
  } catch {
    // 저장 실패(용량/프라이빗 모드)는 무시 — 배지는 세션 내에서만 동작
  }
}

function weekDateKeys(anchor: Date): string[] {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset);
  const keys: string[] = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(start);
    cur.setDate(start.getDate() + i);
    keys.push(toDateKey(cur));
  }
  return keys;
}

function formatDateKeyLabel(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(y, m - 1, d));
}

function formatKoreanTime(time: string) {
  const [hRaw, mRaw] = time.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const period = h < 12 ? "오전" : "오후";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${period} ${hour12}:${String(m).padStart(2, "0")}`;
}

function sortCalendarEventsByTime(events: CalendarEvent[]) {
  return [...events].sort((a, b) => {
    if (!a.startTime && !b.startTime) return 0;
    if (!a.startTime) return 1;
    if (!b.startTime) return -1;
    return a.startTime.localeCompare(b.startTime);
  });
}

// 댓글 작성 시각(ISO) → "MM/DD 오후 2:31" 표시.
function formatCommentTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

// 앱 OCR 미디어 촬영정보 정리 — 촬영시각·도로명주소·GPS·작업자만 명시(원문 OCR은 접어두기 토글).
// 소스 = 앱 구조화 필드 우선, 없으면 사진 하단 스탬프(OCR 텍스트 말미) 파싱.
function MediaMetaBlock({ media, dark }: { media: CalendarMedia; dark?: boolean }) {
  const [rawOpen, setRawOpen] = useState(false);
  const stamp = parseOcrStamp(media.ocrText);

  const capturedLabel = stamp.capturedAt
    ? `${stamp.capturedAt.slice(0, 10)} ${formatKoreanTime(stamp.capturedAt.slice(11, 16))}`
    : media.capturedAt
      ? `${media.capturedAt.slice(0, 10)} ${formatKoreanTime(media.capturedAt.slice(11, 16))}`
      : null;
  const gpsLabel =
    media.latitude != null && media.longitude != null
      ? `${media.latitude.toFixed(6)}, ${media.longitude.toFixed(6)}`
      : stamp.gps;
  const roadAddress = media.roadAddress ?? stamp.roadAddress;
  const workerId = media.workerId ?? stamp.workerId;
  const workerLabel =
    media.uploader || workerId
      ? `${media.uploader ?? "—"}${workerId ? ` · ${workerId}` : ""}`
      : null;
  const hasMeta = capturedLabel || roadAddress || gpsLabel || workerLabel;
  if (!hasMeta && !media.ocrText) return null;

  const wrapCls = dark
    ? "mt-2 rounded-lg bg-white/10 px-3 py-2"
    : "mt-1.5 rounded-md bg-surface-soft px-2 py-1.5 dark:bg-surface-dark-elevated";
  const labelCls = dark ? "text-white/60" : "text-muted dark:text-on-dark-soft";
  const valueCls = dark ? "text-white/90" : "text-ink dark:text-on-dark";
  const rows: Array<[string, string, boolean?]> = [];
  if (capturedLabel) rows.push(["촬영 시각", capturedLabel]);
  if (roadAddress) rows.push(["도로명 주소", roadAddress]);
  if (gpsLabel) rows.push(["GPS 좌표", gpsLabel, true]);
  if (workerLabel) rows.push(["작업자", workerLabel]);

  return (
    <div className={wrapCls}>
      {rows.length > 0 && (
        <dl className="space-y-0.5 text-[11px] leading-relaxed">
          {rows.map(([label, value, mono]) => (
            <div key={label} className="flex gap-1.5">
              <dt className={`w-16 shrink-0 font-semibold ${labelCls}`}>{label}</dt>
              <dd className={`${mono ? "tabular-nums " : ""}${valueCls}`}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {media.ocrText && (
        <div className={rows.length > 0 ? "mt-1.5" : ""}>
          <button
            type="button"
            onClick={() => setRawOpen((v) => !v)}
            className={`text-[10px] font-medium underline-offset-2 hover:underline ${labelCls}`}
          >
            {rawOpen ? "원문 접기 ▴" : "원문 보기 ▾"}
          </button>
          {rawOpen && (
            <p
              className={`wx-cards-scroll mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed ${valueCls}`}
            >
              {media.ocrText}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// 시작/종료 시간을 "오전 9:00 ~ 오전 11:00" 형태로 — 종료는 선택, 둘 다 없으면 빈 문자열
function formatScheduleTime(event: CalendarEvent): string {
  if (event.startTime && event.endTime) {
    return `${formatKoreanTime(event.startTime)} ~ ${formatKoreanTime(event.endTime)}`;
  }
  if (event.startTime) return formatKoreanTime(event.startTime);
  if (event.endTime) return `~ ${formatKoreanTime(event.endTime)}`;
  return "";
}

function parseTime24(value: string) {
  const [hRaw, mRaw] = value.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const period: "오전" | "오후" = h < 12 ? "오전" : "오후";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h === 12 ? 12 : h;
  return { period, hour12, minute: m };
}

function toTime24(period: "오전" | "오후", hour12: number, minute: number) {
  let h = hour12 % 12;
  if (period === "오후") h += 12;
  if (period === "오전" && hour12 === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatTimeInputDigits(raw: string) {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function parseFormattedTime12(text: string) {
  if (!/^\d{2}:\d{2}$/.test(text)) return null;
  const [hStr, mStr] = text.split(":");
  const hour12 = Number(hStr);
  const minute = Number(mStr);
  if (hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) return null;
  return { hour12, minute };
}

function toDisplayTime12(hour12: number, minute: number) {
  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function ScheduleTimePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const parsed = value ? parseTime24(value) : null;
  const [period, setPeriod] = useState<"오전" | "오후">(parsed?.period ?? "오전");
  const [timeText, setTimeText] = useState(parsed ? toDisplayTime12(parsed.hour12, parsed.minute) : "");

  useEffect(() => {
    if (!value) {
      setTimeText("");
      return;
    }
    const next = parseTime24(value);
    if (!next) return;
    setPeriod(next.period);
    setTimeText(toDisplayTime12(next.hour12, next.minute));
  }, [value]);

  const emitTime = (p: "오전" | "오후", text: string) => {
    const manual = parseFormattedTime12(text);
    if (!manual) return;
    onChange(toTime24(p, manual.hour12, manual.minute));
  };

  const periodBtnClass = (selected: boolean) =>
    [
      "rounded-xl border-2 px-3 py-2 text-sm font-semibold text-ink transition outline-none dark:text-on-dark",
      selected
        ? "border-brand-accent bg-primary-subtle dark:border-primary dark:bg-primary-subtle"
        : "border-hairline bg-surface-soft hover:border-ink/15 dark:border-white/10 dark:bg-surface-dark-elevated dark:hover:border-white/20",
    ].join(" ");

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {(["오전", "오후"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setPeriod(p);
              if (parseFormattedTime12(timeText)) emitTime(p, timeText);
            }}
            className={periodBtnClass(period === p)}
            aria-pressed={period === p}
          >
            {p}
          </button>
        ))}
      </div>
      <input
        type="text"
        inputMode="numeric"
        value={timeText}
        maxLength={5}
        onChange={(e) => {
          const formatted = formatTimeInputDigits(e.target.value);
          setTimeText(formatted);
          if (parseFormattedTime12(formatted)) emitTime(period, formatted);
          else if (!formatted) onChange("");
        }}
        onBlur={() => {
          const manual = parseFormattedTime12(timeText);
          if (!manual) {
            if (value) {
              const next = parseTime24(value);
              if (next) setTimeText(toDisplayTime12(next.hour12, next.minute));
              else setTimeText("");
            } else {
              setTimeText("");
            }
            return;
          }
          const normalized = toDisplayTime12(manual.hour12, manual.minute);
          setTimeText(normalized);
          emitTime(period, normalized);
        }}
        placeholder="00:00"
        className="w-full rounded-2xl border border-hairline bg-surface-soft px-3 py-2 text-sm tabular-nums text-ink outline-none transition focus:ring-2 focus:ring-ink/20 dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark"
      />
    </div>
  );
}

function ScheduleLabelDot({ color, className }: { color: LabelColor; className?: string }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${LABEL_COLOR_META[color].dot} ${className ?? ""}`}
      aria-hidden="true"
    />
  );
}

function CalendarEventChip({
  event,
  color,
  compact,
  inverted,
}: {
  event: CalendarEvent;
  color: LabelColor;
  compact?: boolean;
  inverted?: boolean;
}) {
  const meta = LABEL_COLOR_META[color];
  const title = event.title.trim();
  const timeText = formatScheduleTime(event);
  const timeSuffix = !compact && timeText ? ` · ${timeText}` : "";
  const hazardName = hazardTypeName(event.hazardType);
  const fullTitle = [
    title,
    timeText,
    hazardName ? `위험작업: ${hazardName}` : "",
    event.createdBy ? `등록: ${event.createdBy}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  if (compact) {
    return (
      <div
        className={[
          "flex min-w-0 items-center gap-0.5 truncate text-left text-[8px] leading-tight",
          inverted ? "text-white/95" : "text-ink dark:text-on-dark",
        ].join(" ")}
        title={fullTitle}
      >
        <ScheduleLabelDot color={color} className="h-1.5 w-1.5" />
        <span className="truncate">{title}</span>
      </div>
    );
  }

  return (
    <div
      className={["flex min-w-0 items-center gap-1 truncate rounded px-2 py-1 text-left text-[10px] leading-snug", meta.chip].join(" ")}
      title={fullTitle}
    >
      <ScheduleLabelDot color={color} className="h-2 w-2" />
      <span className="truncate font-medium">
        {title}
        {timeSuffix}
      </span>
      {hazardName && (
        <span className="ml-auto shrink-0 rounded border border-current px-1 text-[8px] font-semibold opacity-80">
          {hazardName}
        </span>
      )}
    </div>
  );
}

function ScheduleEventFormModal({
  events,
  labels,
  onLabelsChange,
  onAdd,
  onUpdate,
  onDelete,
  onClose,
}: {
  events: CalendarEvent[];
  labels: ScheduleLabelDef[];
  onLabelsChange: (labels: ScheduleLabelDef[]) => void;
  onAdd: (event: Omit<CalendarEvent, "id" | "dateKey">) => void;
  onUpdate: (id: string, event: Omit<CalendarEvent, "id" | "dateKey">) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [labelId, setLabelId] = useState<string>(labels[0]?.id ?? "");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  // 위험작업 유형 — "" = 없음(일반 일정).
  const [hazardType, setHazardType] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelEditOpen, setLabelEditOpen] = useState(false);

  const resetForm = () => {
    setTitle("");
    setLabelId(labels[0]?.id ?? "");
    setStartTime("");
    setEndTime("");
    setHazardType("");
    setEditingId(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 선택된 라벨이 삭제되면 첫 라벨로 되돌림
  useEffect(() => {
    if (!labels.some((l) => l.id === labelId)) {
      setLabelId(labels[0]?.id ?? "");
    }
  }, [labels, labelId]);

  const startEdit = (event: CalendarEvent) => {
    setEditingId(event.id);
    setTitle(event.title);
    setLabelId(labels.some((l) => l.id === event.labelId) ? event.labelId : labels[0]?.id ?? "");
    setStartTime(event.startTime ?? "");
    setEndTime(event.endTime ?? "");
    setHazardType(event.hazardType ?? "");
  };

  const handleSubmit = () => {
    const trimmed = title.trim();
    if (!trimmed || !labelId) return;
    const draft = {
      title: trimmed,
      labelId,
      startTime: startTime.trim() || undefined,
      endTime: endTime.trim() || undefined,
      hazardType: hazardType || undefined,
    };
    if (editingId) {
      onUpdate(editingId, draft);
    } else {
      onAdd(draft);
    }
    resetForm();
  };

  const addLabel = () => {
    const used = new Set(labels.map((l) => l.color));
    const nextColor = LABEL_COLOR_ORDER.find((c) => !used.has(c)) ?? LABEL_COLOR_ORDER[0]!;
    const id = `lbl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    onLabelsChange([...labels, { id, name: "새 라벨", color: nextColor }]);
    setLabelId(id);
  };

  const renameLabel = (id: string, name: string) => {
    onLabelsChange(labels.map((l) => (l.id === id ? { ...l, name } : l)));
  };

  const recolorLabel = (id: string, color: LabelColor) => {
    onLabelsChange(labels.map((l) => (l.id === id ? { ...l, color } : l)));
  };

  const removeLabel = (id: string) => {
    if (labels.length <= 1) return; // 최소 1개는 유지
    onLabelsChange(labels.filter((l) => l.id !== id));
  };

  return (
    <div
      className="absolute inset-0 z-10 flex items-end justify-center bg-black/30 p-3 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="일정 등록"
    >
      <div
        className="wx-cards-scroll max-h-[85%] w-full overflow-y-auto rounded-2xl border border-hairline-strong bg-canvas dark:border-white/10 dark:bg-surface-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3 dark:border-white/10">
          <p className="text-sm font-bold text-ink dark:text-on-dark">일정 등록</p>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-strong dark:hover:bg-white/10"
            aria-label="일정 등록 닫기"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {events.length > 0 && (
          <div className="space-y-2 border-b border-hairline px-4 py-3 dark:border-white/10">
            <p className="text-[11px] font-semibold text-muted dark:text-on-dark-soft">등록된 일정</p>
            <ul className="space-y-1.5">
              {events.map((event) => (
                <li
                  key={event.id}
                  className={[
                    "flex items-start justify-between gap-2 rounded-xl border px-2.5 py-2",
                    editingId === event.id
                      ? "border-ink/20 bg-surface-card dark:border-white/20 dark:bg-surface-dark-elevated"
                      : "border-hairline bg-surface-soft dark:border-white/10 dark:bg-surface-dark-elevated",
                  ].join(" ")}
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${LABEL_COLOR_META[findLabelDef(labels, event.labelId).color].chip}`}
                      >
                        {findLabelDef(labels, event.labelId).name}
                      </span>
                      {event.createdBy && (
                        <span className="text-[9px] text-muted dark:text-on-dark-soft">
                          등록 {event.createdBy}
                        </span>
                      )}
                    </div>
                    <CalendarEventChip event={event} color={findLabelDef(labels, event.labelId).color} />
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(event)}
                      className="rounded-lg px-2 py-1 text-[10px] font-medium text-ink transition hover:bg-surface-strong dark:text-on-dark dark:hover:bg-white/10"
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onDelete(event.id);
                        if (editingId === event.id) resetForm();
                      }}
                      className="rounded-lg px-2 py-1 text-[10px] font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                    >
                      삭제
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-3 px-4 py-3">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-muted dark:text-on-dark-soft">
              일정 제목
            </label>
            <input
              type="text"
              value={title}
              maxLength={60}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
              placeholder=""
              className="w-full rounded-lg border border-hairline bg-surface-soft px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-ink/20 dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-semibold text-muted dark:text-on-dark-soft">일정 라벨</p>
              <button
                type="button"
                onClick={() => setLabelEditOpen((v) => !v)}
                className="rounded-lg px-2 py-0.5 text-[11px] font-medium text-brand-accent transition hover:bg-surface-strong dark:text-primary dark:hover:bg-white/10"
                aria-expanded={labelEditOpen}
              >
                {labelEditOpen ? "편집 완료" : "라벨 편집"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {labels.map((l) => (
                <label
                  key={l.id}
                  className={[
                    "flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition",
                    labelId === l.id
                      ? "border-ink/20 bg-surface-card text-ink dark:border-white/20 dark:bg-surface-dark-elevated dark:text-on-dark"
                      : "border-hairline text-muted hover:bg-surface-soft dark:border-white/10 dark:hover:bg-white/5",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="schedule-label"
                    value={l.id}
                    checked={labelId === l.id}
                    onChange={() => setLabelId(l.id)}
                    className="sr-only"
                  />
                  <ScheduleLabelDot color={l.color} className="h-2 w-2" />
                  {l.name.trim() || "(이름 없음)"}
                </label>
              ))}
            </div>

            {labelEditOpen && (
              <div className="mt-2 space-y-2 rounded-xl border border-hairline bg-surface-soft p-2.5 dark:border-white/10 dark:bg-surface-dark-elevated">
                {labels.map((l) => (
                  <div
                    key={l.id}
                    className="space-y-1.5 rounded-lg border border-hairline bg-canvas p-2 dark:border-white/10 dark:bg-surface-dark"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={l.name}
                        maxLength={20}
                        onChange={(e) => renameLabel(l.id, e.target.value)}
                        placeholder="라벨 이름"
                        className="min-w-0 flex-1 rounded-lg border border-hairline bg-surface-soft px-2 py-1 text-xs text-ink outline-none focus:ring-2 focus:ring-ink/20 dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark"
                      />
                      <button
                        type="button"
                        onClick={() => removeLabel(l.id)}
                        disabled={labels.length <= 1}
                        className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-500/10"
                      >
                        삭제
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {LABEL_COLOR_ORDER.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => recolorLabel(l.id, c)}
                          aria-label={`색상 ${c}`}
                          aria-pressed={l.color === c}
                          className={[
                            "h-5 w-5 rounded-full transition",
                            LABEL_COLOR_META[c].swatch,
                            l.color === c
                              ? "ring-2 ring-ink/50 ring-offset-1 ring-offset-canvas dark:ring-white/70 dark:ring-offset-surface-dark"
                              : "opacity-50 hover:opacity-100",
                          ].join(" ")}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addLabel}
                  className="w-full rounded-lg border border-dashed border-hairline-strong px-2 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-strong dark:border-white/15 dark:text-on-dark-soft dark:hover:bg-white/10"
                >
                  + 라벨 추가
                </button>
              </div>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-muted dark:text-on-dark-soft">
              위험작업 (선택) — 지정 시 기상 예보와 자동 대조
            </p>
            <div className="flex flex-wrap gap-2">
              {[{ id: "", name: "없음" }, ...HAZARD_TYPES].map((h) => (
                <label
                  key={h.id || "none"}
                  className={[
                    "flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition",
                    hazardType === h.id
                      ? "border-ink/20 bg-surface-card text-ink dark:border-white/20 dark:bg-surface-dark-elevated dark:text-on-dark"
                      : "border-hairline text-muted hover:bg-surface-soft dark:border-white/10 dark:hover:bg-white/5",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="schedule-hazard"
                    value={h.id}
                    checked={hazardType === h.id}
                    onChange={() => setHazardType(h.id)}
                    className="sr-only"
                  />
                  {h.id && (
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                      <path d="M12 9v4" />
                      <path d="M12 17h.01" />
                    </svg>
                  )}
                  {h.name}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-muted dark:text-on-dark-soft">
              시작 시간 (선택)
            </label>
            <ScheduleTimePicker value={startTime} onChange={setStartTime} />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-muted dark:text-on-dark-soft">
              종료 시간 (선택)
            </label>
            <ScheduleTimePicker value={endTime} onChange={setEndTime} />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-hairline px-4 py-3 dark:border-white/10">
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-strong dark:hover:bg-white/10"
            >
              수정 취소
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-strong dark:hover:bg-white/10"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!title.trim()}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary transition hover:bg-primary-active disabled:cursor-not-allowed disabled:bg-primary-disabled disabled:text-muted"
          >
            {editingId ? "수정 완료" : "일정 추가"}
          </button>
        </div>
      </div>
    </div>
  );
}

function getKoreanHolidays(year: number): Record<string, string> {
  const y = year;
  const fixed: Record<string, string> = {
    [`${y}-01-01`]: "신정",
    [`${y}-03-01`]: "삼일절",
    [`${y}-05-05`]: "어린이날",
    [`${y}-06-06`]: "현충일",
    [`${y}-08-15`]: "광복절",
    [`${y}-10-03`]: "개천절",
    [`${y}-10-09`]: "한글날",
    [`${y}-12-25`]: "성탄절",
  };
  const variable: Record<number, Record<string, string>> = {
    2024: {
      "2024-02-09": "설 연휴",
      "2024-02-10": "설날",
      "2024-02-11": "설 연휴",
      "2024-02-12": "대체공휴일",
      "2024-05-15": "부처님오신날",
      "2024-09-16": "추석 연휴",
      "2024-09-17": "추석",
      "2024-09-18": "추석 연휴",
    },
    2025: {
      "2025-01-28": "설 연휴",
      "2025-01-29": "설날",
      "2025-01-30": "설 연휴",
      "2025-05-06": "부처님오신날",
      "2025-10-05": "추석 연휴",
      "2025-10-06": "추석",
      "2025-10-07": "추석 연휴",
      "2025-10-08": "대체공휴일",
    },
    2026: {
      "2026-02-16": "설 연휴",
      "2026-02-17": "설날",
      "2026-02-18": "설 연휴",
      "2026-05-24": "부처님오신날",
      "2026-05-25": "대체공휴일",
      "2026-09-24": "추석 연휴",
      "2026-09-25": "추석",
      "2026-09-26": "추석 연휴",
    },
    2027: {
      "2027-02-05": "설 연휴",
      "2027-02-06": "설날",
      "2027-02-07": "설 연휴",
      "2027-02-08": "대체공휴일",
      "2027-05-13": "부처님오신날",
      "2027-09-14": "추석 연휴",
      "2027-09-15": "추석",
      "2027-09-16": "추석 연휴",
    },
    2028: {
      "2028-01-25": "설 연휴",
      "2028-01-26": "설날",
      "2028-01-27": "설 연휴",
      "2028-05-02": "부처님오신날",
      "2028-10-02": "추석 연휴",
      "2028-10-03": "추석",
      "2028-10-04": "추석 연휴",
    },
    2029: {
      "2029-02-12": "설 연휴",
      "2029-02-13": "설날",
      "2029-02-14": "설 연휴",
      "2029-05-20": "부처님오신날",
      "2029-05-21": "대체공휴일",
      "2029-09-21": "추석 연휴",
      "2029-09-22": "추석",
      "2029-09-23": "추석 연휴",
    },
    2030: {
      "2030-02-02": "설 연휴",
      "2030-02-03": "설날",
      "2030-02-04": "설 연휴",
      "2030-05-09": "부처님오신날",
      "2030-09-11": "추석 연휴",
      "2030-09-12": "추석",
      "2030-09-13": "추석 연휴",
    },
  };
  return { ...(variable[y] ?? {}), ...fixed };
}

function HeaderCalendarPopup({
  open,
  onClose,
  lat,
  lon,
  workerCount,
}: {
  open: boolean;
  onClose: () => void;
  lat?: number;
  lon?: number;
  workerCount: number;
}) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [labels, setLabels] = useState<ScheduleLabelDef[]>(DEFAULT_LABELS);
  const [formDate, setFormDate] = useState<Date | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [hoverDateKey, setHoverDateKey] = useState<string | null>(null);
  // 현장 GPS 좌표 기반 일일 예보 — dateKey(YYYY-MM-DD) → WMO weatherCode. 예보 창(오늘~+6일)만 채워짐.
  const [weatherByDate, setWeatherByDate] = useState<Record<string, number>>({});
  // 위험작업 충돌 판정용 일일 예보(돌풍 m/s·강수량·최고기온) — 같은 예보 응답에서 파생.
  const [hazardForecastByDate, setHazardForecastByDate] = useState<
    Record<string, HazardDailyForecast>
  >({});
  // 현장 시·도 발효 기상특보 type 목록("강풍주의보" 등) — 오늘 위험작업 일정 경고 합성용.
  const [activeWarningTypes, setActiveWarningTypes] = useState<string[]>([]);
  // 설비 점검 자동 일정(AED 교환주기) — dateKey → 마커(읽기 전용·서버 파생). 편집 불가.
  const [inspectionByDate, setInspectionByDate] = useState<Record<string, CalendarInspectionMarker[]>>({});
  // 클라우드 브릿지 — dateKey → 앱 OCR 미디어(서버 조회). 댓글 작성 드래프트(mediaId→입력값) + 편집 중 댓글.
  const [mediaByDate, setMediaByDate] = useState<Record<string, CalendarMedia[]>>({});
  // 현장 사진(앱 OCR) 수동 새로고침 진행 표시 — 아이콘 회전용.
  const [mediaRefreshing, setMediaRefreshing] = useState(false);
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [editingComment, setEditingComment] = useState<{ id: string; body: string } | null>(null);
  // 사진 클릭 시 확대 팝업(라이트박스) 대상 미디어.
  const [lightbox, setLightbox] = useState<CalendarMedia | null>(null);
  // 초기 일정·라벨 로드 완료 플래그 — 로드 전엔 라벨 서버 반영(PUT) 보류
  const [hydrated, setHydrated] = useState(false);

  // 미디어 조회 레이스 가드 — 빠른 월 이동 시 느린 이전 달 응답이 현재 달을 덮지 않게 최신 요청만 commit.
  const mediaFetchSeqRef = useRef(0);

  // 보이는 달(viewDate) 범위의 미디어를 서버에서 조회 — 관리자 세션 토큰 동봉.
  const fetchMedia = useCallback(async (d: Date) => {
    const seq = ++mediaFetchSeqRef.current;
    const y = d.getFullYear();
    const mo = d.getMonth();
    const from = toDateKey(new Date(y, mo, 1));
    const to = toDateKey(new Date(y, mo + 1, 0));
    const token = getSessionToken();
    try {
      const res = await fetch(`/api/calendar/media?from=${from}&to=${to}`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) return;
      type RawComment = Record<string, string | null>;
      type RawMedia = Record<string, string | null> & { comments?: RawComment[] };
      const json = (await res.json()) as { ok?: boolean; media?: RawMedia[] };
      if (!json.ok || !Array.isArray(json.media)) return;
      const map: Record<string, CalendarMedia[]> = {};
      for (const r of json.media) {
        const dateKey = r.date_key ?? "";
        if (!dateKey) continue;
        (map[dateKey] ??= []).push({
          id: r.id ?? "",
          dateKey,
          capturedAt: r.captured_at ?? null,
          mediaType: r.media_type ?? "image",
          title: r.title ?? null,
          mediaUrl: r.media_url ?? null,
          thumbnailUrl: r.thumbnail_url ?? null,
          ocrText: r.ocr_text ?? null,
          description: r.description ?? null,
          uploader: r.uploader ?? null,
          workerId: r.worker_id ?? null,
          latitude: r.latitude != null ? Number(r.latitude) : null,
          longitude: r.longitude != null ? Number(r.longitude) : null,
          roadAddress: r.road_address ?? null,
          comments: (r.comments ?? []).map((c) => ({
            id: c.id ?? "",
            authorName: c.author_name ?? null,
            authorId: c.author_id ?? null,
            authorRole: c.author_role ?? null,
            authorTitle: c.author_title ?? null,
            body: c.body ?? "",
            createdAt: c.created_at ?? "",
            updatedAt: c.updated_at ?? null,
          })),
        });
      }
      if (seq !== mediaFetchSeqRef.current) return; // 더 새 조회(월 이동·폴링) 진행 중 — 옛 달 응답 무시
      setMediaByDate(map);
    } catch {
      // 미디어 조회 실패는 조용히 무시 — 캘린더 본기능 유지
    }
  }, []);

  // 일정·라벨 서버 조회(단일 진실 소스) — 보이는 달 ±7일 패딩(주간 Plan 의 월 경계 커버).
  // 반환 = 실패 null / 성공 { labelCount: 서버 라벨 수(기본 라벨 폴백 전 원값, 마이그레이션 판단용) }.
  const scheduleFetchSeqRef = useRef(0);
  const fetchSchedule = useCallback(async (d: Date): Promise<{ labelCount: number } | null> => {
    const seq = ++scheduleFetchSeqRef.current;
    const y = d.getFullYear();
    const mo = d.getMonth();
    const from = toDateKey(new Date(y, mo, 1 - 7));
    const to = toDateKey(new Date(y, mo + 1, 7));
    const token = getSessionToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    try {
      // 설비 점검 자동 일정은 보조 항목 — 실패해도 events/labels 본기능은 유지(별도 catch).
      const [evRes, lbRes, inspRes] = await Promise.all([
        fetch(`/api/calendar/events?from=${from}&to=${to}`, { cache: "no-store", headers }),
        fetch("/api/calendar/labels", { cache: "no-store", headers }),
        fetch(`/api/inspection-schedule?from=${from}&to=${to}`, { cache: "no-store", headers }).catch(
          () => null,
        ),
      ]);
      if (!evRes.ok || !lbRes.ok) return null;
      const evJson = (await evRes.json()) as { ok?: boolean; events?: unknown[] };
      const lbJson = (await lbRes.json()) as { ok?: boolean; labels?: unknown[] };
      if (!evJson.ok || !Array.isArray(evJson.events) || !lbJson.ok || !Array.isArray(lbJson.labels)) {
        return null;
      }
      const serverEvents = calendarEventsFromServer(evJson.events);
      const serverLabels = calendarLabelsFromServer(lbJson.labels);
      const inspByDate = inspRes && inspRes.ok ? await inspectionMapFromResponse(inspRes) : null;
      if (seq === scheduleFetchSeqRef.current) {
        setEvents(serverEvents);
        setLabels(serverLabels.length > 0 ? serverLabels : DEFAULT_LABELS);
        if (inspByDate) setInspectionByDate(inspByDate);
      }
      return { labelCount: serverLabels.length };
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    fetchMedia(viewDate);
  }, [open, viewDate, fetchMedia]);

  // 수동 새로고침 — 팝업을 닫지 않고 현재 달의 앱 OCR 사진을 다시 조회(실시간 반영 대체).
  const refreshMedia = useCallback(async () => {
    setMediaRefreshing(true);
    try {
      await fetchMedia(viewDate);
    } finally {
      setMediaRefreshing(false);
    }
  }, [fetchMedia, viewDate]);

  // 자동 폴링 — 팝업 열려 있는 동안 60초마다 현재 달 미디어·일정·라벨을 조용히 재조회(스피너 없음).
  // 다중 관리자 간 일정 동기화 겸용. 탭 숨김 시엔 폴링하지 않아 백그라운드 DB 부하를 줄인다.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchMedia(viewDate);
      fetchSchedule(viewDate);
    }, 60000);
    return () => clearInterval(id);
  }, [open, viewDate, fetchMedia, fetchSchedule]);

  const authHeaders = (json: boolean) => {
    const token = getSessionToken();
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const addComment = async (mediaId: string) => {
    const body = (commentDraft[mediaId] ?? "").trim();
    if (!body) return;
    try {
      const res = await fetch("/api/calendar/media/comment", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ mediaId, body }),
      });
      if (res.ok) {
        setCommentDraft((prev) => ({ ...prev, [mediaId]: "" }));
        fetchMedia(viewDate);
      }
    } catch {
      // 무시
    }
  };

  const saveCommentEdit = async () => {
    if (!editingComment) return;
    const body = editingComment.body.trim();
    if (!body) return;
    try {
      const res = await fetch("/api/calendar/media/comment", {
        method: "PATCH",
        headers: authHeaders(true),
        body: JSON.stringify({ id: editingComment.id, body }),
      });
      if (res.ok) {
        setEditingComment(null);
        fetchMedia(viewDate);
      }
    } catch {
      // 무시
    }
  };

  const removeComment = async (id: string) => {
    try {
      const res = await fetch(`/api/calendar/media/comment?id=${id}`, {
        method: "DELETE",
        headers: authHeaders(false),
      });
      if (res.ok) {
        if (editingComment?.id === id) setEditingComment(null);
        fetchMedia(viewDate);
      }
    } catch {
      // 무시
    }
  };

  const deleteMedia = async (id: string) => {
    const token = getSessionToken();
    try {
      const res = await fetch(`/api/calendar/media?id=${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.ok) fetchMedia(viewDate);
    } catch {
      // 무시
    }
  };

  // 미디어 다운로드 — 서버가 attachment 프리사인 URL 발급 → 브라우저 저장 강제(서버 바이트 미경유).
  const downloadMedia = async (m: CalendarMedia) => {
    const token = getSessionToken();
    try {
      const res = await fetch(`/api/calendar/media/download-url?id=${m.id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = (await res.json()) as { ok?: boolean; url?: string };
      if (data?.ok && data.url) {
        const a = document.createElement("a");
        a.href = data.url;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch {
      // 무시
    }
  };

  // 라이트박스 ESC 닫기.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // 팝업이 열리고 현장 좌표가 있을 때 7일 예보를 받아 날짜별 날씨코드 맵 구성(WeatherStrip과 동일 캐시 엔드포인트).
  useEffect(() => {
    if (!open || lat === undefined || lon === undefined) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/weather?lat=${lat}&lon=${lon}&workers=${workerCount}`,
          { cache: "no-store" },
        );
        if (!active || !res.ok) return;
        const json = (await res.json()) as {
          ok?: boolean;
          daily7?: {
            time?: string[];
            weatherCode?: number[];
            tMax?: number[];
            windGustMaxKmh?: (number | null)[];
            precipSumMm?: (number | null)[];
          };
        };
        if (!active || !json.ok || !json.daily7?.time || !json.daily7.weatherCode) return;
        const { time, weatherCode } = json.daily7;
        const map: Record<string, number> = {};
        const fcMap: Record<string, HazardDailyForecast> = {};
        time.forEach((t, i) => {
          if (typeof t !== "string") return;
          const code = weatherCode[i];
          if (typeof code === "number") map[t] = code;
          const gustKmh = json.daily7?.windGustMaxKmh?.[i];
          const rain = json.daily7?.precipSumMm?.[i];
          const tMax = json.daily7?.tMax?.[i];
          fcMap[t] = {
            windGustMs: typeof gustKmh === "number" ? kmhToMs(gustKmh) : null,
            precipSumMm: typeof rain === "number" ? rain : null,
            tMaxC: typeof tMax === "number" ? tMax : null,
          };
        });
        setWeatherByDate(map);
        setHazardForecastByDate(fcMap);
      } catch {
        // 날씨 조회 실패는 조용히 무시 — 아이콘만 생략, 캘린더 본기능은 유지
      }
      // 발효 기상특보 — 실패해도 예보 축만으로 동작(별도 try).
      try {
        const res = await fetch(`/api/kma-warning?lat=${lat}&lon=${lon}`, { cache: "no-store" });
        if (!active || !res.ok) return;
        const json = (await res.json()) as { ok?: boolean; warnings?: { type?: string }[] };
        if (!active || !json.ok || !Array.isArray(json.warnings)) return;
        setActiveWarningTypes(
          json.warnings
            .map((w) => w.type)
            .filter((t): t is string => typeof t === "string"),
        );
      } catch {
        // 특보 조회 실패 — 예보 기반 경고만 유지
      }
    })();
    return () => {
      active = false;
    };
  }, [open, lat, lon, workerCount]);

  // 서버 우선 로드(팝업 열림·월 이동 시 재조회). 실패 시 옛 localStorage 로 읽기 폴백(저장은 서버 전용).
  // 성공 시 1회 마이그레이션 — 옛 localStorage 일정을 서버로 승격(id 보존 업서트 = 멱등, 브라우저별 플래그).
  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      const result = await fetchSchedule(viewDate);
      if (!active) return;
      if (result === null) {
        setLabels(loadCalendarLabels());
        setEvents(loadCalendarEvents());
        setHydrated(true);
        return;
      }
      try {
        if (!window.localStorage.getItem(CALENDAR_MIGRATED_KEY)) {
          const localEvents = loadCalendarEvents();
          const hadLocalLabels =
            window.localStorage.getItem(CALENDAR_LABELS_STORAGE_KEY) !== null;
          const token = getSessionToken();
          const jsonHeaders = {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          };
          let uploaded = false;
          for (const ev of localEvents) {
            const res = await fetch("/api/calendar/events", {
              method: "POST",
              headers: jsonHeaders,
              body: JSON.stringify(ev),
            });
            if (!res.ok) throw new Error("migrate failed");
            uploaded = true;
          }
          // 라벨은 전체교체(PUT)라 다른 관리자가 저장한 서버 라벨을 덮지 않게 서버가 비어 있을 때만.
          if (hadLocalLabels && result.labelCount === 0) {
            const res = await fetch("/api/calendar/labels", {
              method: "PUT",
              headers: jsonHeaders,
              body: JSON.stringify({ labels: loadCalendarLabels() }),
            });
            if (!res.ok) throw new Error("migrate failed");
            uploaded = true;
          }
          window.localStorage.setItem(CALENDAR_MIGRATED_KEY, new Date().toISOString());
          if (uploaded && active) await fetchSchedule(viewDate);
        }
      } catch {
        // 마이그레이션 실패 — 플래그 미설정 상태로 두어 다음 열기에서 재시도
      }
      if (active) setHydrated(true);
    })();
    return () => {
      active = false;
    };
  }, [open, viewDate, fetchSchedule]);

  // 라벨 편집 서버 반영 — 인라인 이름 편집이 keystroke 마다 오므로 600ms 디바운스 전체교체 PUT.
  // 서버 조회 echo 로는 PUT 하지 않도록 사용자 변경(dirty)일 때만 전송.
  const labelsDirtyRef = useRef(false);
  const handleLabelsChange = useCallback((next: ScheduleLabelDef[]) => {
    labelsDirtyRef.current = true;
    setLabels(next);
  }, []);
  useEffect(() => {
    if (!hydrated || !labelsDirtyRef.current) return;
    const t = setTimeout(async () => {
      labelsDirtyRef.current = false;
      const token = getSessionToken();
      try {
        await fetch("/api/calendar/labels", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ labels }),
        });
      } catch {
        // 저장 실패 — 다음 편집·폴링 재조회에서 수렴
      }
    }, 600);
    return () => clearTimeout(t);
  }, [labels, hydrated]);

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    setViewDate(now);
    setSelected(now);
    setFormDate(null);
    setPlanOpen(false);
    setHoverDateKey(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (formDate) setFormDate(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, formDate]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

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

  const holidayMap = getKoreanHolidays(year);

  const eventsByDate = events.reduce<Record<string, CalendarEvent[]>>((acc, event) => {
    const bucket = acc[event.dateKey] ?? (acc[event.dateKey] = []);
    bucket.push(event);
    return acc;
  }, {});

  const todayKey = toDateKey(today);
  // 일정별 경고 = 예보 축(해당 날짜) ∪ 발효 특보 축(발효=현재 상태라 오늘 일정만) worst-of.
  const hazardWarningForEvent = (event: CalendarEvent) =>
    mergeHazardWarnings(
      evaluateHazardWeather(event.hazardType, hazardForecastByDate[event.dateKey] ?? null),
      event.dateKey === todayKey
        ? evaluateHazardKmaWarnings(event.hazardType, activeWarningTypes)
        : null,
    );

  const selectedEvents = eventsByDate[toDateKey(selected)] ?? [];
  const selectedMedia = mediaByDate[toDateKey(selected)] ?? [];
  const selectedInspections = inspectionByDate[toDateKey(selected)] ?? [];
  const weekKeys = weekDateKeys(selected);
  const weeklyPlanEvents = weekKeys.flatMap((key) =>
    (eventsByDate[key] ?? []).map((e) => ({ ...e, dateKey: key })),
  );

  const goPrevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const goNextMonth = () => setViewDate(new Date(year, month + 1, 1));
  const goToday = () => {
    const now = new Date();
    setViewDate(now);
    setSelected(now);
  };

  // 날짜 클릭 = 선택만(하단에 해당 날짜 일정·미디어 표시). 일정 추가는 하단 (+) 버튼으로.
  const handleDateClick = (cellDate: Date) => {
    setSelected(cellDate);
  };

  // 일정 CUD — 낙관적 로컬 반영 후 서버 반영(업서트). 실패 시 서버 상태 재조회로 복원.
  // 성공 시 서버 확정 행(등록자 등 서버 부여 필드 포함)으로 해당 일정을 치환.
  const persistEvent = (event: CalendarEvent) => {
    const token = getSessionToken();
    void fetch("/api/calendar/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(event),
    })
      .then(async (res) => {
        if (!res.ok) {
          fetchSchedule(viewDate);
          return;
        }
        const json = (await res.json()) as { ok?: boolean; event?: unknown };
        const [confirmed] = json.ok && json.event ? calendarEventsFromServer([json.event]) : [];
        if (confirmed) {
          setEvents((prev) => prev.map((e) => (e.id === confirmed.id ? confirmed : e)));
        }
      })
      .catch(() => fetchSchedule(viewDate));
  };

  const handleAddEvent = (draft: Omit<CalendarEvent, "id" | "dateKey">) => {
    if (!formDate) return;
    const dateKey = toDateKey(formDate);
    const event: CalendarEvent = {
      ...draft,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${dateKey}`,
      dateKey,
    };
    setEvents((prev) => [...prev, event]);
    persistEvent(event);
  };

  const handleDeleteEvent = (id: string) => {
    setEvents((prev) => prev.filter((event) => event.id !== id));
    const token = getSessionToken();
    void fetch(`/api/calendar/events?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then((res) => {
        if (!res.ok) fetchSchedule(viewDate);
      })
      .catch(() => fetchSchedule(viewDate));
  };

  const handleUpdateEvent = (id: string, draft: Omit<CalendarEvent, "id" | "dateKey">) => {
    const current = events.find((event) => event.id === id);
    if (!current) return;
    const updated = { ...current, ...draft };
    setEvents((prev) => prev.map((event) => (event.id === id ? updated : event)));
    persistEvent(updated);
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-black/25 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="일정 캘린더"
    >
      <div
        className="absolute bottom-4 right-4 top-[4.5rem] flex w-full max-w-[580px] flex-col overflow-hidden rounded-2xl border border-hairline-strong bg-canvas dark:border-white/10 dark:bg-surface-dark sm:top-20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between rounded-t-2xl border-b border-hairline bg-surface-soft px-4 py-3 dark:border-white/10 dark:bg-surface-dark-elevated">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-card text-ink dark:bg-white/10 dark:text-on-dark">
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
              <p className="text-[11px] text-muted dark:text-on-dark-soft">날짜를 클릭해 일정을 등록하세요</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={refreshMedia}
            disabled={mediaRefreshing}
            aria-label="현장 사진 새로고침"
            title="현장 사진 새로고침"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-strong hover:text-ink disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-on-dark"
          >
            <svg
              className={mediaRefreshing ? "animate-spin" : ""}
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setPlanOpen((v) => !v)}
            aria-expanded={planOpen}
            className={[
              "rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
              planOpen
                ? "bg-primary text-on-primary"
                : "bg-surface-card text-ink hover:bg-surface-strong dark:bg-surface-dark-elevated dark:text-on-dark dark:hover:bg-white/10",
            ].join(" ")}
          >
            Plan
          </button>
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
        </div>

        <div className="wx-cards-scroll flex-1 overflow-y-auto overscroll-y-contain" onWheel={(e) => e.stopPropagation()}>
        {planOpen && (
          <div className="border-b border-hairline bg-surface-soft px-4 py-3 dark:border-white/10 dark:bg-surface-dark-elevated">
            <p className="mb-1.5 text-[11px] font-semibold text-ink dark:text-on-dark">주간 일정</p>
            {weeklyPlanEvents.length === 0 ? (
              <p className="text-[11px] text-muted dark:text-on-dark-soft">이번 주(월~일)에 등록된 일정이 없습니다.</p>
            ) : (
              <ul className="space-y-2">
                {weekKeys.map((key) => {
                  const dayPlans = weeklyPlanEvents.filter((e) => e.dateKey === key);
                  if (dayPlans.length === 0) return null;
                  return (
                    <li key={key}>
                      <p className="mb-1 text-[10px] font-medium text-muted dark:text-on-dark-soft">
                        {formatDateKeyLabel(key)}
                      </p>
                      <ul className="space-y-1">
                        {sortCalendarEventsByTime(dayPlans).map((event) => (
                          <li
                            key={event.id}
                            className="flex items-center gap-2 rounded-lg border border-hairline bg-canvas px-2.5 py-1.5 dark:border-white/10 dark:bg-surface-dark"
                          >
                            <ScheduleLabelDot color={findLabelDef(labels, event.labelId).color} className="h-2 w-2" />
                            <span className="min-w-0 flex-1 truncate text-xs text-ink dark:text-on-dark">
                              {findLabelDef(labels, event.labelId).name} · {event.title}
                              {formatScheduleTime(event) ? ` · ${formatScheduleTime(event)}` : ""}
                            </span>
                            {(() => {
                              const w = hazardWarningForEvent(event);
                              if (!w) return null;
                              return (
                                <span
                                  className={[
                                    "shrink-0",
                                    w.severity === "danger"
                                      ? "text-red-600 dark:text-red-400"
                                      : "text-amber-600 dark:text-amber-400",
                                  ].join(" ")}
                                  title={`${hazardTypeName(event.hazardType) ?? "위험작업"} — ${w.messages.join(" / ")}`}
                                >
                                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                                    <path d="M12 9v4" />
                                    <path d="M12 17h.01" />
                                  </svg>
                                </span>
                              );
                            })()}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div className="px-3 pb-4 pt-3">
          <div className="mb-3 flex items-center justify-between px-1">
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

          <div className="mb-1 grid grid-cols-7 gap-0.5 px-0.5">
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

          <div className="grid grid-cols-7 gap-0.5 overflow-visible">
            {cells.map((day, idx) => {
              if (day === null) {
                return <div key={`empty-${idx}`} className="min-h-[4.5rem]" />;
              }
              const cellDate = new Date(year, month, day);
              const dateKey = toDateKey(cellDate);
              const dayEvents = eventsByDate[dateKey] ?? [];
              const isToday = calendarSameDay(cellDate, today);
              const isSelected = calendarSameDay(cellDate, selected);
              const weekday = cellDate.getDay();
              const holiday = holidayMap[dateKey];
              const dayWeatherCode = weatherByDate[dateKey];
              const dayMedia = mediaByDate[dateKey] ?? [];
              // 위험작업 일정 × 악천후(예보∪발효 특보) 겹침 — 그 날 일정들의 worst severity(없으면 null).
              const dayHazardSev = dayEvents.reduce<HazardSeverity | null>((acc, e) => {
                const w = hazardWarningForEvent(e);
                if (!w) return acc;
                return w.severity === "danger" || acc === "danger" ? "danger" : "caution";
              }, null);
              // 설비 점검 예정(AED 교환주기) — 그 날 마커의 worst severity(없으면 null).
              const dayInspections = inspectionByDate[dateKey] ?? [];
              const dayInspSev = dayInspections.some((m) => m.severity === "danger")
                ? "danger"
                : dayInspections.some((m) => m.severity === "caution")
                  ? "caution"
                  : dayInspections.length > 0
                    ? "normal"
                    : null;

              return (
                <button
                  key={`${year}-${month}-${day}`}
                  type="button"
                  onClick={() => handleDateClick(cellDate)}
                  onMouseEnter={() => {
                    if (dayEvents.length > 0) setHoverDateKey(dateKey);
                  }}
                  onMouseLeave={() => setHoverDateKey(null)}
                  className={[
                    "relative flex min-h-[4.5rem] flex-col rounded-lg p-0.5 text-left transition",
                    isSelected
                      ? "bg-primary text-on-primary"
                      : isToday
                        ? "bg-surface-card ring-1 ring-hairline"
                        : "hover:bg-surface-strong dark:hover:bg-white/10",
                  ].join(" ")}
                  aria-label={`${year}년 ${month + 1}월 ${day}일`}
                  aria-pressed={isSelected}
                >
                  {dayWeatherCode !== undefined && (
                    <span
                      className={[
                        "pointer-events-none absolute right-0.5 top-0.5 z-10",
                        isSelected ? "text-white/90" : "text-muted dark:text-on-dark-soft",
                      ].join(" ")}
                      title={weatherLabel(dayWeatherCode)}
                      aria-label={`날씨: ${weatherLabel(dayWeatherCode)}`}
                    >
                      <WeatherIcon name={weatherIconKey(dayWeatherCode)} className="h-3.5 w-3.5" />
                    </span>
                  )}
                  {dayMedia.length > 0 && (
                    <span
                      className={[
                        "pointer-events-none absolute bottom-0.5 right-0.5 z-10 inline-flex items-center gap-0.5 rounded px-1 text-[8px] font-bold leading-none",
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-primary-subtle text-primary dark:text-on-dark",
                      ].join(" ")}
                      title={`현장 이미지/미디어 ${dayMedia.length}건`}
                    >
                      <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                      {dayMedia.length}
                    </span>
                  )}
                  {dayHazardSev && (
                    <span
                      className={[
                        "pointer-events-none absolute bottom-0.5 left-0.5 z-10 inline-flex items-center rounded px-0.5 py-0.5",
                        isSelected
                          ? "bg-white/20 text-white"
                          : dayHazardSev === "danger"
                            ? "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400"
                            : "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
                      ].join(" ")}
                      title="위험작업 일정과 악천후 예보가 겹칩니다 — 날짜를 선택해 상세 확인"
                    >
                      <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                        <path d="M12 9v4" />
                        <path d="M12 17h.01" />
                      </svg>
                    </span>
                  )}
                  {hoverDateKey === dateKey && dayEvents.length > 0 && (
                    <div
                      className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 w-[10.5rem] -translate-x-1/2 rounded-lg border border-primary-ring bg-primary px-2.5 py-2"
                      role="tooltip"
                    >
                      <p className="mb-1 text-[10px] font-semibold text-on-primary/80">{day}일</p>
                      <ul className="space-y-1">
                        {sortCalendarEventsByTime(dayEvents).map((event) => (
                          <li key={event.id} className="flex min-w-0 items-center gap-1">
                            <ScheduleLabelDot
                              color={findLabelDef(labels, event.labelId).color}
                              className="h-1.5 w-1.5 shrink-0 ring-1 ring-white/30"
                            />
                            <span className="min-w-0 truncate text-[10px] text-on-primary">
                              {event.title.trim()}
                              {formatScheduleTime(event) ? ` · ${formatScheduleTime(event)}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {holiday && !isSelected ? (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-100 px-0.5 text-[11px] font-semibold tabular-nums text-red-600 dark:bg-red-500/20 dark:text-red-400">
                      {day}
                    </span>
                  ) : (
                    <span
                      className={[
                        "px-0.5 text-[11px] font-semibold tabular-nums",
                        isSelected
                          ? "text-white"
                          : isToday
                            ? "font-bold text-ink dark:text-on-dark"
                            : weekday === 0
                              ? "text-red-500 dark:text-red-400"
                              : weekday === 6
                                ? "text-blue-600 dark:text-blue-400"
                                : "text-ink dark:text-on-dark",
                      ].join(" ")}
                    >
                      {day}
                    </span>
                  )}
                  {holiday && (
                    <span
                      className={[
                        "truncate px-0.5 text-[7px] font-medium leading-tight",
                        isSelected ? "text-white/80" : "text-red-500 dark:text-red-400",
                      ].join(" ")}
                    >
                      {holiday}
                    </span>
                  )}
                  <div className="mt-0.5 flex flex-1 flex-col gap-0.5 overflow-hidden">
                    {dayInspSev && (
                      <span
                        className={[
                          "flex min-w-0 items-center gap-0.5 truncate rounded px-1 text-[8px] font-semibold leading-tight",
                          isSelected
                            ? "bg-white/20 text-white"
                            : dayInspSev === "danger"
                              ? "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400"
                              : dayInspSev === "caution"
                                ? "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
                                : "bg-surface-strong text-muted dark:bg-white/10 dark:text-on-dark-soft",
                        ].join(" ")}
                        title={`설비 점검 예정 ${dayInspections.length}건`}
                      >
                        <svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                        </svg>
                        점검 {dayInspections.length}
                      </span>
                    )}
                    {sortCalendarEventsByTime(dayEvents).slice(0, 2).map((event) => (
                      <CalendarEventChip
                        key={event.id}
                        event={event}
                        color={findLabelDef(labels, event.labelId).color}
                        compact
                        inverted={isSelected}
                      />
                    ))}
                    {dayEvents.length > 2 && (
                      <span
                        className={[
                          "px-0.5 text-[8px] font-medium",
                          isSelected ? "text-white/80" : "text-muted dark:text-on-dark-soft",
                        ].join(" ")}
                      >
                        +{dayEvents.length - 2}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-2 rounded-xl border border-hairline bg-surface-soft px-3 py-2.5 dark:border-white/10 dark:bg-surface-dark-elevated">
              <p className="min-w-0 truncate text-xs text-muted dark:text-on-dark-soft">{selectedLabel}</p>
              <button
                type="button"
                onClick={goToday}
                className="shrink-0 rounded-lg bg-surface-card px-2.5 py-1 text-xs font-semibold text-ink transition hover:bg-surface-strong"
              >
                오늘
              </button>
            </div>

            <div className="rounded-xl border border-hairline bg-surface-soft px-3 py-2.5 dark:border-white/10 dark:bg-surface-dark-elevated">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-muted dark:text-on-dark-soft">선택 날짜 일정</p>
                <button
                  type="button"
                  onClick={() => setFormDate(selected)}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-[11px] font-semibold text-on-primary transition hover:bg-primary-active"
                >
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  일정 추가
                </button>
              </div>
              {selectedEvents.length > 0 ? (
                <div className="space-y-1">
                  {sortCalendarEventsByTime(selectedEvents).map((event) => {
                    const warning = hazardWarningForEvent(event);
                    return (
                      <div key={event.id} className="space-y-0.5">
                        <CalendarEventChip
                          event={event}
                          color={findLabelDef(labels, event.labelId).color}
                        />
                        {warning && (
                          <div
                            className={[
                              "rounded-lg border px-2 py-1.5 text-[10px] leading-snug",
                              warning.severity === "danger"
                                ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
                                : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
                            ].join(" ")}
                          >
                            {warning.messages.map((m) => (
                              <p key={m} className="flex items-start gap-1">
                                <svg className="mt-0.5 shrink-0" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                                  <path d="M12 9v4" />
                                  <path d="M12 17h.01" />
                                </svg>
                                <span>
                                  {hazardTypeName(event.hazardType)} · {m}
                                </span>
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {sortCalendarEventsByTime(selectedEvents).some((event) =>
                    hazardWarningForEvent(event),
                  ) && (
                    <p className="pt-0.5 text-[9px] leading-snug text-muted dark:text-on-dark-soft">
                      기상 예보(Open-Meteo)·발효 특보(기상청) 기반 참고 정보 — 작업중지 여부는 현장 책임자가 당일 실측으로 판단합니다.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted dark:text-on-dark-soft">등록된 일정이 없습니다.</p>
              )}
            </div>

            {selectedInspections.length > 0 && (
              <div className="rounded-xl border border-hairline bg-surface-soft px-3 py-2.5 dark:border-white/10 dark:bg-surface-dark-elevated">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted dark:text-on-dark-soft">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  </svg>
                  설비 점검 예정 {selectedInspections.length}건
                </p>
                <div className="space-y-1">
                  {selectedInspections.map((m) => (
                    <div
                      key={`${m.deviceId}-${m.item}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-canvas px-2.5 py-1.5 dark:border-white/10 dark:bg-surface-dark"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-ink dark:text-on-dark">
                          {INSPECTION_ITEM_LABEL[m.item]}
                        </p>
                        <p className="truncate text-[10px] text-muted dark:text-on-dark-soft">
                          {m.deviceId} · {m.loc}
                        </p>
                      </div>
                      <span
                        className={[
                          "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                          m.severity === "danger"
                            ? "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400"
                            : m.severity === "caution"
                              ? "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
                              : "bg-surface-strong text-muted dark:bg-white/10 dark:text-on-dark-soft",
                        ].join(" ")}
                      >
                        {m.dueDays < 0 ? `${-m.dueDays}일 경과` : m.dueDays === 0 ? "오늘" : `D-${m.dueDays}`}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-[9px] leading-snug text-muted dark:text-on-dark-soft">
                  교환 주기 기반 자동 표시(AED 배터리 48·패드 24개월) — 현장 NFC 점검 태깅 시 다음 예정일이 자동 갱신됩니다.
                </p>
              </div>
            )}

            {selectedMedia.length > 0 && (
              <div className="rounded-xl border border-hairline bg-surface-soft px-3 py-2.5 dark:border-white/10 dark:bg-surface-dark-elevated">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted dark:text-on-dark-soft">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  현장 이미지/미디어 {selectedMedia.length}건
                </p>
                {lightbox &&
                  createPortal(
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-label="사진 크게 보기"
                      onClick={() => setLightbox(null)}
                      className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/80 p-4"
                    >
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="wx-cards-scroll flex max-h-[92vh] w-full max-w-3xl flex-col overflow-y-auto"
                      >
                        <div className="mb-2 flex items-center justify-between gap-3 text-white">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {lightbox.title ??
                                (lightbox.mediaType === "video" ? "현장 영상" : "현장 이미지")}
                            </p>
                            <p className="text-[11px] text-white/70">
                              {lightbox.dateKey}
                              {lightbox.capturedAt
                                ? ` ${formatKoreanTime(lightbox.capturedAt.slice(11, 16))}`
                                : ""}
                              {lightbox.uploader ? ` · ${lightbox.uploader}` : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => downloadMedia(lightbox)}
                              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                            >
                              ⬇ 다운로드
                            </button>
                            <button
                              type="button"
                              onClick={() => setLightbox(null)}
                              className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25"
                            >
                              닫기 ✕
                            </button>
                          </div>
                        </div>
                        {lightbox.mediaType === "video" ? (
                          <video
                            src={lightbox.mediaUrl ?? ""}
                            controls
                            className="max-h-[80vh] w-full rounded-lg bg-black"
                          />
                        ) : (
                          <img
                            src={lightbox.mediaUrl ?? ""}
                            alt={lightbox.title ?? "현장 이미지"}
                            className="max-h-[80vh] w-full rounded-lg object-contain"
                          />
                        )}
                        <MediaMetaBlock media={lightbox} dark />
                      </div>
                    </div>,
                    document.body,
                  )}
                <div className="space-y-2.5">
                  {selectedMedia.map((m) => (
                    <div
                      key={m.id}
                      className="rounded-lg border border-hairline bg-canvas p-2 dark:border-white/10 dark:bg-surface-dark"
                    >
                      {/* 제목 영역 — 썸네일 + 제목/메타 + 삭제 */}
                      <div className="flex gap-2">
                        {m.thumbnailUrl || m.mediaUrl ? (
                          <button
                            type="button"
                            onClick={() => setLightbox(m)}
                            aria-label="사진 크게 보기"
                            className="relative shrink-0 overflow-hidden rounded-md transition hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            <img
                              src={m.thumbnailUrl ?? m.mediaUrl ?? ""}
                              alt={m.title ?? "현장 이미지"}
                              className="h-14 w-14 object-cover"
                            />
                            <span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-black/55 px-1 text-[8px] font-semibold text-white">
                              🔍
                            </span>
                          </button>
                        ) : (
                          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-surface-strong text-[9px] text-muted dark:bg-white/10 dark:text-on-dark-soft">
                            {m.mediaType === "video" ? "영상" : "이미지"}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-bold text-ink dark:text-on-dark">
                            {m.title ?? (m.mediaType === "video" ? "현장 영상" : "현장 이미지")}
                          </p>
                          {m.capturedAt && (
                            <p className="mt-0.5 text-[10px] text-muted dark:text-on-dark-soft">
                              {formatKoreanTime(m.capturedAt.slice(11, 16))}
                              {m.uploader ? ` · ${m.uploader}` : ""}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteMedia(m.id)}
                          className="h-fit shrink-0 rounded-lg px-2 py-1 text-[10px] font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                        >
                          삭제
                        </button>
                      </div>

                      {/* 내용 영역 — 촬영정보 정리(촬영시각·도로명주소·GPS·작업자), 원문 OCR은 접어두기 */}
                      <MediaMetaBlock media={m} />

                      {/* 댓글 스레드 — 작성자·시각 + 수정/삭제, 하단 입력 */}
                      <div className="mt-2 space-y-1.5 border-t border-hairline pt-2 dark:border-white/10">
                        {m.comments.map((c) => (
                          <div
                            key={c.id}
                            className="rounded-md bg-surface-soft px-2 py-1.5 dark:bg-surface-dark-elevated"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="min-w-0 truncate text-[10px] font-semibold text-ink dark:text-on-dark">
                                {c.authorName ?? "관리자"}
                                {c.authorTitle && (
                                  <span className="font-normal text-muted dark:text-on-dark-soft">
                                    {" "}· {c.authorTitle}
                                  </span>
                                )}
                                {c.authorId && (
                                  <span className="font-normal text-muted dark:text-on-dark-soft">
                                    {" "}· 사번 {c.authorId}
                                  </span>
                                )}
                                <span className="font-normal text-muted dark:text-on-dark-soft">
                                  {" "}· {formatCommentTime(c.createdAt)}
                                  {c.updatedAt ? " (수정됨)" : ""}
                                </span>
                              </p>
                              {editingComment?.id !== c.id && (
                                <span className="flex shrink-0 items-center gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => setEditingComment({ id: c.id, body: c.body })}
                                    title="수정"
                                    aria-label="댓글 수정"
                                    className="grid h-6 w-6 place-items-center rounded text-muted transition hover:bg-surface-strong hover:text-ink dark:hover:bg-white/10 dark:hover:text-on-dark"
                                  >
                                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <path d="M12 20h9" />
                                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeComment(c.id)}
                                    title="삭제"
                                    aria-label="댓글 삭제"
                                    className="grid h-6 w-6 place-items-center rounded text-muted transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                                  >
                                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <path d="M3 6h18" />
                                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    </svg>
                                  </button>
                                </span>
                              )}
                            </div>
                            {editingComment?.id === c.id ? (
                              <div className="mt-1 flex items-end gap-1.5">
                                <textarea
                                  value={editingComment.body}
                                  onChange={(e) =>
                                    setEditingComment({ id: c.id, body: e.target.value })
                                  }
                                  rows={2}
                                  className="min-w-0 flex-1 resize-none rounded-lg border border-hairline bg-canvas px-2 py-1 text-[11px] text-ink outline-none focus:ring-2 focus:ring-ink/20 dark:border-white/10 dark:bg-surface-dark dark:text-on-dark"
                                />
                                <button
                                  type="button"
                                  onClick={saveCommentEdit}
                                  className="shrink-0 rounded-lg bg-primary px-2 py-1.5 text-[10px] font-semibold text-on-primary transition hover:bg-primary-active"
                                >
                                  저장
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingComment(null)}
                                  className="shrink-0 rounded-lg px-2 py-1.5 text-[10px] font-medium text-muted transition hover:bg-surface-strong dark:hover:bg-white/10"
                                >
                                  취소
                                </button>
                              </div>
                            ) : (
                              <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-muted dark:text-on-dark-soft">
                                {c.body}
                              </p>
                            )}
                          </div>
                        ))}

                        {/* 새 댓글 입력 */}
                        <div className="flex items-end gap-1.5">
                          <textarea
                            value={commentDraft[m.id] ?? ""}
                            onChange={(e) =>
                              setCommentDraft((prev) => ({ ...prev, [m.id]: e.target.value }))
                            }
                            placeholder="설명·댓글 입력"
                            rows={2}
                            className="min-w-0 flex-1 resize-none rounded-lg border border-hairline bg-surface-soft px-2 py-1 text-[11px] text-ink outline-none focus:ring-2 focus:ring-ink/20 dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark"
                          />
                          <button
                            type="button"
                            onClick={() => addComment(m.id)}
                            className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-on-primary transition hover:bg-primary-active"
                          >
                            저장
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        </div>

        {formDate && (
          <ScheduleEventFormModal
            events={eventsByDate[toDateKey(formDate)] ?? []}
            labels={labels}
            onLabelsChange={handleLabelsChange}
            onAdd={handleAddEvent}
            onUpdate={handleUpdateEvent}
            onDelete={handleDeleteEvent}
            onClose={() => setFormDate(null)}
          />
        )}
      </div>
    </div>
  );
}

// 문자열을 글자 단위 span 으로 렌더 — key 에 글자값을 넣어 바뀐 글자만 remount → 롤링(슬라이드업) 애니메이션.
// 헤더 시계와 DB 누적 숫자가 같은 애니메이션(.clock-roll-char)을 공유한다.
function RollingChars({ text }: { text: string }) {
  return (
    <>
      {text.split("").map((ch, i) => (
        <span key={`${i}-${ch}`} className="clock-roll-char">
          {ch === " " ? " " : ch}
        </span>
      ))}
    </>
  );
}

// 헤더 중앙 라이브 시계 — yyyy/mm/dd(요일) hh:mm:ss. 매초 갱신, 바뀐 글자만 롤링(슬라이드업) 애니메이션.
function HeaderClock() {
  // SSR/하이드레이션 시각 불일치 방지 — 마운트 후에만 렌더(초기 null).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!now) return null;

  const p2 = (n: number) => String(n).padStart(2, "0");
  const dow = ["일", "월", "화", "수", "목", "금", "토"][now.getDay()];
  const text = `${now.getFullYear()}/${p2(now.getMonth() + 1)}/${p2(now.getDate())}(${dow}) ${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;

  return (
    <div
      aria-label={`현재 시각 ${text}`}
      className="hidden select-none items-center lg:flex"
    >
      {/* 각 글자를 개별 span 으로 — 바뀐 글자만 key 변경으로 remount 되어 롤링 애니메이션 재생(변한 글자만 움직임). */}
      <span className="font-mono text-[15px] font-semibold tabular-nums tracking-[0.04em] text-ink dark:text-on-dark">
        {text.split("").map((ch, i) => (
          <span key={`${i}-${ch}`} className="clock-roll-char">
            {ch === " " ? " " : ch}
          </span>
        ))}
      </span>
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
  // 상단 페이저 활성 페이지 — ERP: 스마트경리(3번째 탭) 활성 시 하단 부속 UI(속보 티커·DB 스트립) 숨김.
  const [pagerIdx, setPagerIdx] = useState(0);
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
  // 구획 이탈 경보 — 현재 표시 중 {sample, distM} + ack(구획 복귀 시 해제)된 워커 + 이탈 확정 워커 집합.
  const [activeGeofenceAlert, setActiveGeofenceAlert] = useState<{
    sample: VitalSample;
    distM: number;
  } | null>(null);
  const [ackedGeofence, setAckedGeofence] = useState<Set<string>>(() => new Set());
  const [outsideWorkers, setOutsideWorkers] = useState<Set<string>>(() => new Set());
  // 알림 → 지도 포커스 — 모달 "관제 지도에서 보기" 클릭 시 지도 모드 전환 + 해당 좌표 flyTo·펄스.
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null);
  // 이동 경로 트레일 — 지도 마커 클릭으로 토글된 작업자 + 서버 조회 좌표 시계열.
  const [trailWorkerId, setTrailWorkerId] = useState<string | null>(null);
  const [trailPoints, setTrailPoints] = useState<TrackPoint[] | null>(null);
  // 위험구역(진입 금지 존) — 서버 등록 존 + 진입 확정 워커×존 키(`workerId|zoneId`) + 팝업/ack.
  const [dangerZones, setDangerZones] = useState<MapZone[]>([]);
  const [activeZoneAlert, setActiveZoneAlert] = useState<{
    sample: VitalSample;
    zone: MapZone;
    distM: number;
  } | null>(null);
  const [ackedZone, setAckedZone] = useState<Set<string>>(() => new Set());
  const [insideZones, setInsideZones] = useState<Set<string>>(() => new Set());
  const [sirenEnabled, setSirenEnabled] = useState(true);
  const [audioArmed, setAudioArmed] = useState(false); // 오디오 컨텍스트 running 여부(브라우저 제스처 unlock)
  const [slots, setSlots] = useState<SlotAssignments>(() => Array(SLOT_COUNT).fill(null));
  const [queueModalSlot, setQueueModalSlot] = useState<number | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  // 캘린더 배지·토스트 — 새 현장 사진(앱 업로드 미디어) 미확인 개수 배지 + 도착 알림 토스트.
  const [calendarNewCount, setCalendarNewCount] = useState(0);
  const [calendarToast, setCalendarToast] = useState<{ count: number; key: number } | null>(null);
  const calendarSeenRef = useRef<Set<string>>(new Set());
  const calendarRecentIdsRef = useRef<string[]>([]);
  const calendarSeenExistedRef = useRef(false);
  const calendarFirstPollRef = useRef(true);
  const calendarToastKeyRef = useRef(0);
  const calendarOpenRef = useRef(false);
  useEffect(() => {
    calendarOpenRef.current = calendarOpen;
  }, [calendarOpen]);

  // 현재 조회된 미디어 전부를 '봄' 처리 → 배지 0. 캘린더 열 때 호출.
  const markCalendarSeen = useCallback(() => {
    const seen = calendarSeenRef.current;
    calendarRecentIdsRef.current.forEach((id) => seen.add(id));
    saveCalendarSeen([...seen]);
    setCalendarNewCount(0);
    setCalendarToast(null);
  }, []);

  // 최근 30일 현장 사진을 조회해 미확인(새 id) 개수를 계산 — 팝업 열림/닫힘과 무관하게 백그라운드 동작.
  const runCalendarPoll = useCallback(async () => {
    const token = getSessionToken();
    if (!token) return;
    const now = new Date();
    const from = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30));
    const to = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    try {
      const res = await fetch(`/api/calendar/media?from=${from}&to=${to}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = (await res.json()) as { ok?: boolean; media?: { id?: string | null }[] };
      if (!json.ok || !Array.isArray(json.media)) return;
      const ids = json.media.map((m) => m.id).filter((x): x is string => !!x);
      const seen = calendarSeenRef.current;
      const wasFirst = calendarFirstPollRef.current;
      calendarFirstPollRef.current = false;

      // (a) 캘린더 열려 있으면 즉시 봄 처리, (b) 첫 폴이고 저장된 seen 이 없으면 baseline(현재 전부 봄) → 배지 0.
      if (calendarOpenRef.current || (wasFirst && !calendarSeenExistedRef.current)) {
        ids.forEach((id) => seen.add(id));
        saveCalendarSeen([...seen]);
        calendarRecentIdsRef.current = ids;
        setCalendarNewCount(0);
        return;
      }

      const prevIds = new Set(calendarRecentIdsRef.current);
      const unseen = ids.filter((id) => !seen.has(id));
      const arrived = unseen.filter((id) => !prevIds.has(id)); // 직전 조회엔 없던 새 도착분
      calendarRecentIdsRef.current = ids;
      setCalendarNewCount(unseen.length);
      // 새로 도착한 사진이 있고 첫 폴이 아니면 토스트(초기 로드 스팸 방지).
      if (arrived.length > 0 && !wasFirst) {
        calendarToastKeyRef.current += 1;
        setCalendarToast({ count: unseen.length, key: calendarToastKeyRef.current });
      }
    } catch {
      // 조용히 무시 — 배지 없이도 캘린더 본기능 유지
    }
  }, []);

  // mount: seen 로드 + 즉시 1회 폴 + 60초 인터벌(탭 숨김 시 스킵).
  useEffect(() => {
    const { ids, existed } = loadCalendarSeen();
    calendarSeenRef.current = new Set(ids);
    calendarSeenExistedRef.current = existed;
    runCalendarPoll();
    const pollId = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      runCalendarPoll();
    }, 60000);
    return () => clearInterval(pollId);
  }, [runCalendarPoll]);

  // 토스트 자동 사라짐(6초) — key 변경마다 타이머 재설정.
  useEffect(() => {
    if (!calendarToast) return;
    const toastId = setTimeout(() => setCalendarToast(null), 6000);
    return () => clearTimeout(toastId);
  }, [calendarToast]);

  const [usersOpen, setUsersOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // 로그인 역할 — owner 만 "사용자 관리" 탭 노출. sessionStorage 는 클라이언트에서만 접근.
  const [role, setRole] = useState<string | null>(null);
  // 관리자 메뉴(CSV 등) 접근 권한 — owner 거나 owner가 부여한 admin_access. 서버에서도 강제.
  const [adminAccess, setAdminAccess] = useState(false);
  // 로그인 상태 칩 표시용 — 이름/직책/사번/아이디. 환경 관리자(owner)는 프로필이 없어 null("관리자"로 표시).
  const [loginInfo, setLoginInfo] = useState<{
    name: string | null;
    jobTitle: string | null;
    employeeId: string | null;
    username: string | null;
  } | null>(null);
  // 내 정보 수정 진입 전 비밀번호 게이트(step-up 인증) — 공용 관제 화면 무단 조회·수정 방지.
  const [profileGateOpen, setProfileGateOpen] = useState(false);
  useEffect(() => {
    setRole(getSessionRole());
    const token = getSessionToken();
    fetch("/api/admin/profile", {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.ok) {
          setAdminAccess(!!j.adminAccess);
          const p = j.profile;
          setLoginInfo(
            p
              ? {
                  name: p.name ?? null,
                  jobTitle: p.job_title ?? null,
                  employeeId: p.employee_id ?? null,
                  username: p.username ?? null,
                }
              : null,
          );
        }
      })
      .catch(() => {});
  }, []);
  const canAdminMenu = role === "owner" || adminAccess;
  const [siteInfo, setSiteInfo] = useState<SiteInfo>(DEFAULT_SITE_INFO);
  const [lastAccidentTs, setLastAccidentTs] = useState<string | null>(null);
  // 작업자 표 슬라이딩 모드 — auto: 세로 자동 슬라이딩 / manual: 정지 + 드래그 정렬
  const [slideMode, setSlideMode] = useState<"auto" | "manual">("auto");
  // 작업자 뷰 — table: 기존 표 / map: GPS 위성지도(마커 호버 시 생체 툴팁). 세션 한정(영속 없음).
  const [workerView, setWorkerView] = useState<"table" | "map">("table");
  // 국내 재해사례 데이터 출처 — 캐러셀 헤더 배지(좌측 화살표 우측)로 표시. 카드가 fetch 후 통지.
  const [koshaSource, setKoshaSource] = useState<"live" | "mock" | null>(null);

  // SSR/CSR mismatch 회피 — mount 후 1회 localStorage 로드(빠른 페인트), 이어서 서버(공유 관제) 슬롯으로 덮어쓰기.
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
    // 확인(ack)한 SOS/낙상 경보 키 복원 — 새로고침 시 이미 확인한 팝업 재발화 방지.
    // 워커별 최신 ts 만 유지(트리거 판정이 lastSosByWorker/lastFallByWorker 의 최신 ts 와 비교).
    const sosAcks: Record<string, string> = {};
    const fallAcks: Record<string, string> = {};
    for (const key of loadAckedAlertKeys()) {
      const [type, workerId, ts] = key.split("|");
      if (!workerId || !ts) continue;
      const target = type === "sos" ? sosAcks : type === "fall" ? fallAcks : null;
      if (!target) continue;
      const cur = target[workerId];
      if (cur === undefined || ts > cur) target[workerId] = ts;
    }
    if (Object.keys(sosAcks).length > 0) setAcknowledgedSosTs((prev) => ({ ...sosAcks, ...prev }));
    if (Object.keys(fallAcks).length > 0)
      setAcknowledgedFallTs((prev) => ({ ...fallAcks, ...prev }));
    // 서버(공유 관제 1벌) 슬롯 로드 — 있으면 로컬보다 우선(다른 기기에서 등록한 것 반영). 실패 시 localStorage 유지.
    (async () => {
      try {
        const token = getSessionToken();
        const res = await fetch("/api/monitor/slots", {
          headers: token ? { authorization: `Bearer ${token}` } : undefined,
          cache: "no-store",
        });
        const j = (await res.json()) as { ok?: boolean; slots?: unknown };
        if (res.ok && j.ok && Array.isArray(j.slots)) {
          const server = j.slots;
          const normalized = Array.from({ length: SLOT_COUNT }, (_, i) =>
            typeof server[i] === "string" ? (server[i] as string) : null,
          );
          setSlots(normalized);
          saveSlots(normalized); // 로컬 캐시도 서버와 동기화
        }
      } catch {
        /* 서버 불가 — localStorage 값 유지 */
      }
    })();
    // 현장정보 — 메인 현장이면 서버 DB(관리자 저장값)를 진실 소스로 우선 로드.
    // 데모 현장은 로그인 프리셋 유지(DB 단일 snapshot 이 데모 선택을 덮어쓰지 않게).
    (async () => {
      try {
        const siteId = window.localStorage.getItem(SITE_ID_STORAGE_KEY);
        if (siteId && siteId !== "main") return; // 데모 현장 선택 시 DB 미적용
        const token = getSessionToken();
        if (!token) return; // 세션 없으면(비관리자 등) localStorage 유지
        const res = await fetch("/api/admin/site-info", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!res.ok) return; // 401 등 → localStorage 유지
        const j = (await res.json()) as {
          ok?: boolean;
          siteInfo?: {
            company_name?: string;
            site_name?: string;
            construction_type?: string;
            address?: string;
            start_date?: string;
            completion_date?: string;
          } | null;
        };
        const s = j.siteInfo;
        if (j.ok && s && (s.company_name || s.site_name || s.start_date)) {
          const next: SiteInfo = {
            companyName: s.company_name ?? "",
            siteName: s.site_name ?? "",
            constructionType: s.construction_type ?? "",
            address: s.address ?? "",
            startDate: s.start_date ?? "",
            completionDate: s.completion_date ?? "",
            noticeId: loadSiteInfo().noticeId, // DB 미저장 필드는 로컬 프리셋 값 보존
          };
          setSiteInfo(next);
          saveSiteInfo(next); // 로컬 캐시도 서버와 동기화
        }
      } catch {
        /* 서버 불가 — localStorage 값 유지 */
      }
    })();
  }, []);

  const handleSiteInfoSave = useCallback((next: SiteInfo) => {
    // 관리자 저장값(DB)은 noticeId 를 담지 않으므로 기존 값 보존(안전관리비 검증 매칭 키).
    setSiteInfo((prev) => {
      const merged: SiteInfo = { ...next, noticeId: next.noticeId ?? prev.noticeId };
      saveSiteInfo(merged);
      return merged;
    });
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
    // 다음 상태를 updater 밖에서 계산 — StrictMode updater 2회 실행 시 저장/PUT 중복 방지(순수 updater 유지).
    // 다른 슬롯에 이미 있으면 그 자리는 비움 (중복 등록 방지)
    const next = slots.map((id) => (id === workerId ? null : id));
    next[slotIndex] = workerId;
    setSlots(next);
    saveSlots(next);
    persistSlotsServer(next);
    setQueueModalSlot(null);
  }

  function clearSlot(slotIndex: number) {
    const next = [...slots];
    next[slotIndex] = null;
    setSlots(next);
    saveSlots(next);
    persistSlotsServer(next);
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
  // 다음 상태를 updater 밖에서 계산 — StrictMode updater 2회 실행 시 저장/PUT 중복 방지(순수 updater 유지).
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const filled = slots.filter((id): id is string => id !== null);
      const from = filled.indexOf(String(active.id));
      const to = filled.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      const reordered = arrayMove(filled, from, to);
      const next: SlotAssignments = Array.from(
        { length: SLOT_COUNT },
        (_, i) => reordered[i] ?? null,
      );
      setSlots(next);
      saveSlots(next);
      persistSlotsServer(next);
    },
    [slots],
  );

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    // 요청 순서 가드 — 응답 지연으로 뒤늦게 도착한 옛 응답이 더 새 응답을 덮어
    // 경보가 위험↔정상으로 플랩(사이렌 재트리거·순간 해제)하지 않게, 마지막 commit 이후 시퀀스만 반영.
    let pollSeq = 0;
    let committedSeq = 0;

    async function load() {
      const seq = ++pollSeq;
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
        if (!active || seq <= committedSeq) return; // 더 새 응답이 이미 반영됨 — 오래된 응답 무시
        committedSeq = seq;
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

  // 지도 포커스 펄스 — 12초 후 자동 해제(영구 잔존 시 다음 관제에 혼란).
  useEffect(() => {
    if (!mapFocus) return;
    const t = window.setTimeout(() => setMapFocus(null), 12_000);
    return () => window.clearTimeout(t);
  }, [mapFocus]);

  // 트레일 조회 — 지도 모드에서 대상 작업자가 있는 동안 15초 주기 갱신(실패는 조용히 직전 경로 유지).
  useEffect(() => {
    if (!trailWorkerId || workerView !== "map") {
      setTrailPoints(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const token = getSessionToken();
        const res = await fetch(`/api/monitor/track?workerId=${encodeURIComponent(trailWorkerId)}`, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
          cache: "no-store",
        });
        const j = (await res.json()) as { ok?: boolean; points?: TrackPoint[] };
        if (alive && res.ok && j.ok && Array.isArray(j.points)) setTrailPoints(j.points);
      } catch {
        // 트레일은 보조 표시 — 일시 실패 시 직전 경로 유지
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 15_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [trailWorkerId, workerView]);

  function dismissSos() {
    if (activeSos) {
      setAcknowledgedSosTs((prev) => ({ ...prev, [activeSos.workerId]: activeSos.ts }));
      appendAckedAlertKey(`sos|${activeSos.workerId}|${activeSos.ts}`); // 새로고침 재팝업 방지 영속
    }
    setActiveSos(null);
  }

  function dismissFallAlert() {
    if (activeFallAlert) {
      setAcknowledgedFallTs((prev) => ({ ...prev, [activeFallAlert.workerId]: activeFallAlert.ts }));
      appendAckedAlertKey(`fall|${activeFallAlert.workerId}|${activeFallAlert.ts}`); // 새로고침 재팝업 방지 영속
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

  function dismissGeofenceAlert() {
    if (activeGeofenceAlert) {
      setAckedGeofence((prev) => {
        const next = new Set(prev);
        next.add(activeGeofenceAlert.sample.workerId);
        return next;
      });
    }
    setActiveGeofenceAlert(null);
  }

  function dismissZoneAlert() {
    if (activeZoneAlert) {
      const key = `${activeZoneAlert.sample.workerId}|${activeZoneAlert.zone.id}`;
      setAckedZone((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    }
    setActiveZoneAlert(null);
  }

  // 알림 모달 "관제 지도에서 보기" — 지도 모드 전환 + 해당 좌표 포커스(모달 닫기는 호출부에서, ack 는 별개).
  function showAlertOnMap(sample: VitalSample) {
    if (sample.latitude === undefined || sample.longitude === undefined) return;
    setWorkerView("map");
    setMapFocus({ lat: sample.latitude, lon: sample.longitude, key: Date.now() });
  }

  // 알림 팝업 '확인' — 해당 작업자·종류의 최근 미대응 알림을 대응 확인(ack)으로 기록.
  // 관리자 메뉴 'SOS·낙상 이력' 표에 대응완료로 반영된다(자연키 ack, 팝업은 alert id 를 모름).
  async function acknowledgeAlert(
    sample: VitalSample,
    type: "sos" | "fall" | "vital" | "geofence" | "danger_zone",
  ) {
    // 확인 즉시 자연키 영속 — 닫기 전에 새로고침해도 재팝업 안 함
    // (vital·geofence·danger_zone 은 레벨형이라 복귀 시 ack 해제 → localStorage 영속 제외).
    if (type !== "vital" && type !== "geofence" && type !== "danger_zone")
      appendAckedAlertKey(`${type}|${sample.workerId}|${sample.ts}`);
    const token = getSessionToken();
    try {
      await fetch("/api/alerts/ack", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ workerId: sample.workerId, type, ackBy: "관제자" }),
      });
    } catch (e) {
      console.error("[알림 확인 오류]", e);
    }
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
        Number.isFinite(s.latitude) &&
        Number.isFinite(s.longitude) &&
        // 한국 범위 게이트 — 위 32.5~39.5 / 경 123.5~132.5 밖 좌표(시뮬레이터 기본값·NaN·좌표 swap)는
        // 현장 날씨 평균을 엉뚱한 지역으로 끌고 가는 오염원이라 제외한다. 국내 현장 전용 전제.
        (s.latitude as number) >= 32.5 &&
        (s.latitude as number) <= 39.5 &&
        (s.longitude as number) >= 123.5 &&
        (s.longitude as number) <= 132.5,
      );
    if (points.length === 0) return { lat: undefined, lon: undefined, count: 0 };
    const latSum = points.reduce((acc, p) => acc + (p.latitude as number), 0);
    const lonSum = points.reduce((acc, p) => acc + (p.longitude as number), 0);
    // GPS 지터 억제 — 소수 3자리(≈110m) 양자화. 매 2초 폴마다 평균 좌표가 미세 변동해
    // [lat,lon] 을 fetch deps 로 쓰는 패널(날씨·특보·특보영상·병원)이 재호출되는 것을 막는다.
    return {
      lat: Math.round((latSum / points.length) * 1000) / 1000,
      lon: Math.round((lonSum / points.length) * 1000) / 1000,
      count: points.length,
    };
  }, [slots, latestMap]);

  // ── 현장 좌표 캐시(서버 DB) ─────────────────────────────────────────────────
  // 작업자 앱 연결이 끊겨도(라이브 좌표 0) 마지막으로 기억한 현장 좌표로 기상 유지.
  // 하루 최초 라이브 좌표를 서버가 그날 1행으로 캡처(자동은 덮지 않음), 수동 새로고침 시 재캡처.
  const [cachedCoord, setCachedCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [locRefreshing, setLocRefreshing] = useState(false);
  // WeatherStrip 등 하위 기상 컴포넌트 재요청 트리거(수동 새로고침 시 증가).
  const [weatherRefreshNonce, setWeatherRefreshNonce] = useState(0);
  const coordCapturedRef = useRef(false);

  // 유효 현장 좌표 — 라이브(count>0) 우선, 없으면 캐시 좌표 fallback → 연결 끊겨도 기상 표시.
  const effLat = fieldCoords.count > 0 ? fieldCoords.lat : cachedCoord?.lat;
  const effLon = fieldCoords.count > 0 ? fieldCoords.lon : cachedCoord?.lon;
  const coordSource: "live" | "cached" | "none" =
    fieldCoords.count > 0 ? "live" : cachedCoord ? "cached" : "none";

  // ── 오늘 위험작업 요약(캘린더 안 열어도 관제 화면에 노출) ────────────────────
  // 오늘 일정(서버) + 오늘 예보(돌풍·강수·기온) + 발효 특보를 합성해 통합 신호등 아래 칩으로 표시.
  // 120초 폴(탭 숨김 스킵) — weather 5분·kma 10분 서버 캐시 재사용이라 부하 미미.
  const [todayHazard, setTodayHazard] = useState<{
    total: number;
    conflicts: number;
    severity: HazardSeverity | null;
  }>({ total: 0, conflicts: 0, severity: null });

  const runTodayHazardPoll = useCallback(async () => {
    const token = getSessionToken();
    if (!token || effLat === undefined || effLon === undefined) return;
    const todayKey = toDateKey(new Date());
    try {
      const [evRes, wxRes, kmaRes] = await Promise.all([
        fetch(`/api/calendar/events?from=${todayKey}&to=${todayKey}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/weather?lat=${effLat}&lon=${effLon}&workers=${fieldCoords.count}`, {
          cache: "no-store",
        }),
        fetch(`/api/kma-warning?lat=${effLat}&lon=${effLon}`, { cache: "no-store" }),
      ]);
      if (!evRes.ok) return;
      const evJson = (await evRes.json()) as { ok?: boolean; events?: unknown[] };
      if (!evJson.ok || !Array.isArray(evJson.events)) return;
      const hazardEvents = calendarEventsFromServer(evJson.events).filter((e) => e.hazardType);

      // 오늘 예보(첫 항목이 오늘) — 실패 시 발효 특보 축만으로 판정.
      let todayFc: HazardDailyForecast | null = null;
      if (wxRes.ok) {
        try {
          const wx = (await wxRes.json()) as {
            ok?: boolean;
            daily7?: {
              time?: string[];
              tMax?: number[];
              windGustMaxKmh?: (number | null)[];
              precipSumMm?: (number | null)[];
            };
          };
          const idx = wx.ok ? (wx.daily7?.time ?? []).indexOf(todayKey) : -1;
          if (idx >= 0) {
            const gustKmh = wx.daily7?.windGustMaxKmh?.[idx];
            const rain = wx.daily7?.precipSumMm?.[idx];
            const tMax = wx.daily7?.tMax?.[idx];
            todayFc = {
              windGustMs: typeof gustKmh === "number" ? kmhToMs(gustKmh) : null,
              precipSumMm: typeof rain === "number" ? rain : null,
              tMaxC: typeof tMax === "number" ? tMax : null,
            };
          }
        } catch {
          /* 예보 파싱 실패 — 특보 축만 */
        }
      }
      let warningTypes: string[] = [];
      if (kmaRes.ok) {
        try {
          const kma = (await kmaRes.json()) as { ok?: boolean; warnings?: { type?: string }[] };
          if (kma.ok && Array.isArray(kma.warnings)) {
            warningTypes = kma.warnings
              .map((w) => w.type)
              .filter((t): t is string => typeof t === "string");
          }
        } catch {
          /* 특보 파싱 실패 — 예보 축만 */
        }
      }

      let conflicts = 0;
      let worst: HazardSeverity | null = null;
      for (const e of hazardEvents) {
        const w = mergeHazardWarnings(
          evaluateHazardWeather(e.hazardType, todayFc),
          evaluateHazardKmaWarnings(e.hazardType, warningTypes),
        );
        if (!w) continue;
        conflicts += 1;
        worst = w.severity === "danger" || worst === "danger" ? "danger" : "caution";
      }
      setTodayHazard({ total: hazardEvents.length, conflicts, severity: worst });
    } catch {
      // 조회 실패 — 직전 요약 유지(칩 없이도 관제 본기능 유지)
    }
  }, [effLat, effLon, fieldCoords.count]);

  // calendarOpen 을 deps 에 포함 — 캘린더에서 일정을 편집하고 닫으면 즉시 재집계.
  useEffect(() => {
    runTodayHazardPoll();
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      runTodayHazardPoll();
    }, 120000);
    return () => clearInterval(id);
  }, [runTodayHazardPoll, calendarOpen]);

  // 현장 주소 지오코딩(VWorld) — 지도 모드 구획 원 중심을 주소 기준으로 고정. 실패/미설정 시 폴백 체인 유지.
  const [siteAnchor, setSiteAnchor] = useState<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    const address = siteInfo.address.trim();
    if (!address) {
      setSiteAnchor(null);
      return;
    }
    let active = true;
    (async () => {
      try {
        const token = getSessionToken();
        if (!token) return;
        const res = await fetch(`/api/site-geocode?address=${encodeURIComponent(address)}`, {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const j = (await res.json()) as { ok?: boolean; lat?: number; lon?: number };
        if (active && res.ok && j.ok && typeof j.lat === "number" && typeof j.lon === "number") {
          setSiteAnchor({ lat: j.lat, lon: j.lon });
        }
      } catch {
        /* 지오코딩 실패 — 캐시 좌표 폴백 유지 */
      }
    })();
    return () => {
      active = false;
    };
  }, [siteInfo.address]);

  // 현장 필지 경계 폴리곤 — 주소 지오코딩 좌표가 확정되면 1회 조회(시각 레드라인 전용, 판정은 원 유지).
  const [siteParcel, setSiteParcel] = useState<{ lat: number; lon: number }[] | null>(null);
  useEffect(() => {
    if (!siteAnchor) {
      setSiteParcel(null);
      return;
    }
    let active = true;
    (async () => {
      try {
        const token = getSessionToken();
        if (!token) return;
        const res = await fetch(`/api/site-parcel?lat=${siteAnchor.lat}&lon=${siteAnchor.lon}`, {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const j = (await res.json()) as {
          ok?: boolean;
          found?: boolean;
          ring?: { lat: number; lon: number }[];
        };
        if (active && res.ok && j.ok && j.found && Array.isArray(j.ring)) setSiteParcel(j.ring);
      } catch {
        /* 폴리곤은 보조 표시 — 실패 시 원만 표시 */
      }
    })();
    return () => {
      active = false;
    };
  }, [siteAnchor]);

  // 현장 주소에서 인근 병원 검색용 지역 키워드(예: "광주 동구"). 지역검색은 좌표가 아닌 지역명이 필요.
  const siteRegion = useMemo(() => extractRegion(siteInfo.address), [siteInfo.address]);

  // 구획 원 중심 단일 소스 — 지도 모드의 레드라인 원과 이탈 판정이 같은 값을 쓴다.
  // 우선순위: 현장 주소 지오코딩(VWorld) → 캐시 좌표(일 고정) → 라이브 GPS 평균.
  const siteCircleCenter = useMemo(() => {
    const cLat = siteAnchor?.lat ?? cachedCoord?.lat ?? effLat;
    const cLon = siteAnchor?.lon ?? cachedCoord?.lon ?? effLon;
    return typeof cLat === "number" && typeof cLon === "number" ? { lat: cLat, lon: cLon } : null;
  }, [siteAnchor, cachedCoord, effLat, effLon]);

  // mount 시 서버 캐시 좌표 로드(라이브 좌표 없을 때 기상 fallback 용).
  useEffect(() => {
    (async () => {
      try {
        const token = getSessionToken();
        if (!token) return;
        const res = await fetch("/api/monitor/site-coord", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const j = (await res.json()) as {
          ok?: boolean;
          coord?: { lat: number; lon: number } | null;
        };
        if (res.ok && j.ok && j.coord) setCachedCoord({ lat: j.coord.lat, lon: j.coord.lon });
      } catch {
        /* 서버 불가 — 캐시 없음 */
      }
    })();
  }, []);

  // 라이브 좌표가 처음 잡히면 서버에 하루 최초 캡처(POST). 서버가 그날 1행만 유지(자동은 덮지 않음).
  useEffect(() => {
    if (
      fieldCoords.count > 0 &&
      fieldCoords.lat !== undefined &&
      fieldCoords.lon !== undefined &&
      !coordCapturedRef.current
    ) {
      coordCapturedRef.current = true;
      const { lat, lon, count } = fieldCoords;
      (async () => {
        try {
          const token = getSessionToken();
          if (!token) return;
          const res = await fetch("/api/monitor/site-coord", {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ lat, lon, workerCount: count }),
          });
          const j = (await res.json()) as {
            ok?: boolean;
            coord?: { lat: number; lon: number } | null;
          };
          if (res.ok && j.ok && j.coord) setCachedCoord({ lat: j.coord.lat, lon: j.coord.lon });
        } catch {
          /* 서버 불가 — 라이브 좌표만으로 표시 */
        }
      })();
    }
  }, [fieldCoords.count, fieldCoords.lat, fieldCoords.lon]);

  // 수동 새로고침 — 라이브 좌표 있으면 그날 좌표 재캡처(force), 캐시 재조회, 기상 재요청.
  const refreshFieldWeather = useCallback(async () => {
    setLocRefreshing(true);
    try {
      const token = getSessionToken();
      if (
        token &&
        fieldCoords.count > 0 &&
        fieldCoords.lat !== undefined &&
        fieldCoords.lon !== undefined
      ) {
        await fetch("/api/monitor/site-coord", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            lat: fieldCoords.lat,
            lon: fieldCoords.lon,
            workerCount: fieldCoords.count,
            manual: true,
          }),
        }).catch(() => {});
      }
      if (token) {
        const res = await fetch("/api/monitor/site-coord", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const j = (await res.json()) as {
          ok?: boolean;
          coord?: { lat: number; lon: number } | null;
        };
        if (res.ok && j.ok && j.coord) setCachedCoord({ lat: j.coord.lat, lon: j.coord.lon });
      }
      setWeatherRefreshNonce((n) => n + 1); // WeatherStrip 등 기상 재요청
    } finally {
      setLocRefreshing(false);
    }
  }, [fieldCoords.count, fieldCoords.lat, fieldCoords.lon]);

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

  // 지도 모드 마커 데이터 — 등록 슬롯 중 한국 범위 GPS 보유 작업자만(fieldCoords 와 동일 게이트).
  // 못 올린 작업자는 명단·사유로 수신 상태 패널에 안내. now(1초 tick)로 수신 age 계산.
  const workerMapData = useMemo(() => {
    const pts: WorkerMapPoint[] = [];
    const excluded: WorkerMapExcluded[] = [];
    for (const { workerId } of filledSlots) {
      const s = latestMap.get(workerId);
      const lat = s?.latitude;
      const lon = s?.longitude;
      if (
        s &&
        typeof lat === "number" &&
        typeof lon === "number" &&
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= 32.5 &&
        lat <= 39.5 &&
        lon >= 123.5 &&
        lon <= 132.5
      ) {
        const status = workerStatus(s);
        const ageMs = now - Date.parse(s.ts);
        const ageSec = Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 1000)) : null;
        // STALE_MS(60초) 초과 미수신 = 표의 "연결끊김" 강등과 동일 기준 — 지도도 마지막 상태색
        // (false-OK) 대신 고스트(마지막 확인 위치)로 강등한다.
        const stale = ageSec !== null && ageSec * 1000 >= STALE_MS;
        pts.push({
          workerId,
          name: s.workerName ?? workerId,
          employeeId: s.employeeId ?? undefined,
          jobTitle: data.workerProfiles?.[workerId] ?? s.jobTitle ?? undefined,
          lat,
          lon,
          heartRate: s.heartRate,
          spo2: s.spo2,
          skinTempC: s.skinTempC,
          statusLabel: stale ? "연결끊김" : status.label,
          tone: stale ? "idle" : status.tone,
          ageSec,
          stale,
        });
      } else {
        const reason = !s
          ? "미접속 — 수신 샘플 없음"
          : isVirtualWorker(workerId)
            ? "가상 작업자(테스트) — GPS 없음"
            : typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)
              ? "GPS 미포함 — 위치 권한·로그인 게이트 확인"
              : "한국 범위 밖 좌표 — 표시 제외";
        excluded.push({ workerId, name: s?.workerName ?? workerId, reason });
      }
    }
    return { pts, excluded };
  }, [filledSlots, latestMap, data.workerProfiles, now]);

  // ── 현장 구획(반경 100m) 이탈 알림 ──────────────────────────────────────────
  // 지도 원과 동일 중심·반경으로 히스테리시스 판정. 워커별 상태 + 마지막 관측 ts(같은 샘플 재관측 시
  // 상태머신을 전진시키지 않아 이상치 1건이 틱 반복으로 이탈 확정되는 것을 방지).
  const geofenceStates = useRef(new Map<string, { st: GeofenceState; lastTs: string }>());

  // 이탈 확정 전이 시 DB 이력 기록(전이당 1건, worker/type/ts 자연키 dedup).
  const recordGeofenceAlert = useCallback(
    (workerId: string, workerName: string | null, ts: string) => {
      const token = getSessionToken();
      fetch("/api/alerts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ type: "geofence", workerId, workerName, ts }),
      }).catch((e) => console.error("[구획 이탈 기록 오류]", e));
    },
    [],
  );

  useEffect(() => {
    const states = geofenceStates.current;
    if (!siteCircleCenter) {
      // 중심 미확정이면 판정 불가 — 상태 리셋(중심 확보 시 초기부터 다시 판정).
      if (states.size > 0) states.clear();
      setOutsideWorkers((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    const fresh = new Set<string>();
    for (const pt of workerMapData.pts) {
      // 60초 초과 미수신(연결끊김 상태머신과 동일 임계)은 stale 좌표 발화 방지를 위해 판정 보류.
      if (pt.ageSec === null || pt.ageSec >= 60) continue;
      fresh.add(pt.workerId);
      const base = latestMap.get(pt.workerId);
      const entry = states.get(pt.workerId);
      if (!base?.ts || entry?.lastTs === base.ts) continue; // 새 관측 없음 — 상태 유지
      const dist = geofenceDistanceM(pt.lat, pt.lon, siteCircleCenter.lat, siteCircleCenter.lon);
      const { state, event } = stepGeofence(
        entry?.st ?? GEOFENCE_INITIAL,
        dist,
        SITE_CIRCLE_RADIUS_M,
      );
      states.set(pt.workerId, { st: state, lastTs: base.ts });
      if (event === "exit") {
        recordGeofenceAlert(pt.workerId, base.workerName ?? pt.name ?? null, base.ts);
      }
    }
    // GPS 가 끊긴 워커는 상태 제거 — 재수신 시 초기 상태부터 다시 판정(미수신 ≠ 이탈).
    for (const id of Array.from(states.keys())) {
      if (!fresh.has(id)) states.delete(id);
    }
    const outs = new Set<string>();
    for (const [id, entry] of states) if (entry.st.outside) outs.add(id);
    setOutsideWorkers((prev) => {
      if (prev.size === outs.size && Array.from(outs).every((id) => prev.has(id))) return prev;
      return outs;
    });
  }, [workerMapData, siteCircleCenter, latestMap, recordGeofenceAlert]);

  // 구획 이탈 팝업 — SOS/낙상/생체 경보 우선, ack(복귀 전) 안 된 첫 이탈 워커 표시.
  useEffect(() => {
    if (activeSos || activeFallAlert || activeVitalAlert || activeGeofenceAlert) return;
    if (!siteCircleCenter) return;
    for (const id of outsideWorkers) {
      if (ackedGeofence.has(id)) continue;
      const base = latestMap.get(id);
      if (!base || base.latitude === undefined || base.longitude === undefined) continue;
      setActiveGeofenceAlert({
        sample: base,
        distM: geofenceDistanceM(
          base.latitude,
          base.longitude,
          siteCircleCenter.lat,
          siteCircleCenter.lon,
        ),
      });
      return;
    }
  }, [
    outsideWorkers,
    ackedGeofence,
    activeSos,
    activeFallAlert,
    activeVitalAlert,
    activeGeofenceAlert,
    latestMap,
    siteCircleCenter,
  ]);

  // 구획 복귀한 워커는 ack 해제 → 다음 이탈 시 재경보(vital 패턴).
  useEffect(() => {
    setAckedGeofence((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (outsideWorkers.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [outsideWorkers]);

  // ── 위험구역(진입 금지 존) 진입 경보 ────────────────────────────────────────
  // 워커×존 키(`workerId|zoneId`)별 히스테리시스 — 구획 이탈과 같은 fresh 게이트(60초)·ts 전진 규칙.
  const zoneStates = useRef(new Map<string, { st: ZoneEntryState; lastTs: string }>());

  const loadDangerZones = useCallback(async () => {
    try {
      const token = getSessionToken();
      const res = await fetch("/api/danger-zones", {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      const j = (await res.json()) as {
        ok?: boolean;
        zones?: { id: number; name: string; lat: number; lon: number; radius_m: number }[];
      };
      if (res.ok && j.ok && Array.isArray(j.zones)) {
        setDangerZones(
          j.zones.map((z) => ({ id: z.id, name: z.name, lat: z.lat, lon: z.lon, radiusM: z.radius_m })),
        );
      }
    } catch (e) {
      console.error("[위험구역 조회 오류]", e);
    }
  }, []);

  useEffect(() => {
    void loadDangerZones();
  }, [loadDangerZones]);

  const createDangerZone = useCallback(
    async (zone: { name: string; lat: number; lon: number; radiusM: number }) => {
      try {
        const token = getSessionToken();
        await fetch("/api/danger-zones", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(zone),
        });
      } catch (e) {
        console.error("[위험구역 등록 오류]", e);
      }
      void loadDangerZones();
    },
    [loadDangerZones],
  );

  const removeDangerZone = useCallback(
    async (id: number) => {
      try {
        const token = getSessionToken();
        await fetch(`/api/danger-zones?id=${id}`, {
          method: "DELETE",
          headers: token ? { authorization: `Bearer ${token}` } : {},
        });
      } catch (e) {
        console.error("[위험구역 삭제 오류]", e);
      }
      void loadDangerZones();
    },
    [loadDangerZones],
  );

  // 진입 확정 전이 시 DB 이력 기록(전이당 1건, worker/type/ts 자연키 dedup).
  const recordZoneAlert = useCallback(
    (workerId: string, workerName: string | null, ts: string) => {
      const token = getSessionToken();
      fetch("/api/alerts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ type: "danger_zone", workerId, workerName, ts }),
      }).catch((e) => console.error("[위험구역 진입 기록 오류]", e));
    },
    [],
  );

  useEffect(() => {
    const states = zoneStates.current;
    if (dangerZones.length === 0) {
      if (states.size > 0) states.clear();
      setInsideZones((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    const freshKeys = new Set<string>();
    for (const pt of workerMapData.pts) {
      // 60초 초과 미수신은 stale 좌표 발화 방지를 위해 판정 보류(미수신 ≠ 진입/이탈).
      if (pt.ageSec === null || pt.ageSec >= 60) continue;
      const base = latestMap.get(pt.workerId);
      if (!base?.ts) continue;
      for (const zone of dangerZones) {
        const key = `${pt.workerId}|${zone.id}`;
        freshKeys.add(key);
        const entry = states.get(key);
        if (entry?.lastTs === base.ts) continue; // 새 관측 없음 — 상태 유지
        const dist = geofenceDistanceM(pt.lat, pt.lon, zone.lat, zone.lon);
        const { state, event } = stepZoneEntry(entry?.st ?? ZONE_ENTRY_INITIAL, dist, zone.radiusM);
        states.set(key, { st: state, lastTs: base.ts });
        if (event === "enter") {
          recordZoneAlert(pt.workerId, base.workerName ?? pt.name ?? null, base.ts);
        }
      }
    }
    // GPS 가 끊긴 워커·삭제된 존 키는 상태 제거 — 재수신 시 초기부터 재판정.
    for (const key of Array.from(states.keys())) {
      if (!freshKeys.has(key)) states.delete(key);
    }
    const ins = new Set<string>();
    for (const [key, entry] of states) if (entry.st.inside) ins.add(key);
    setInsideZones((prev) => {
      if (prev.size === ins.size && Array.from(ins).every((k) => prev.has(k))) return prev;
      return ins;
    });
  }, [workerMapData, dangerZones, latestMap, recordZoneAlert]);

  // 위험구역 진입 팝업 — SOS/낙상/생체 우선(구획 이탈보다는 우선), ack(구역 밖 복귀 전) 안 된 첫 키 표시.
  useEffect(() => {
    if (activeSos || activeFallAlert || activeVitalAlert || activeZoneAlert) return;
    for (const key of insideZones) {
      if (ackedZone.has(key)) continue;
      const sep = key.lastIndexOf("|");
      const workerId = key.slice(0, sep);
      const zoneId = Number(key.slice(sep + 1));
      const zone = dangerZones.find((z) => z.id === zoneId);
      const base = latestMap.get(workerId);
      if (!zone || !base || base.latitude === undefined || base.longitude === undefined) continue;
      setActiveZoneAlert({
        sample: base,
        zone,
        distM: geofenceDistanceM(base.latitude, base.longitude, zone.lat, zone.lon),
      });
      return;
    }
  }, [
    insideZones,
    ackedZone,
    activeSos,
    activeFallAlert,
    activeVitalAlert,
    activeZoneAlert,
    latestMap,
    dangerZones,
  ]);

  // 구역 밖으로 복귀한 키는 ack 해제 → 재진입 시 재경보(구획 이탈 패턴).
  useEffect(() => {
    setAckedZone((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const key of prev) {
        if (insideZones.has(key)) next.add(key);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [insideZones]);

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

  // 헤더 로고 클릭 → 홈(1페이지 실시간 현장 관제) 복귀 신호 — 증가할 때마다 SectionPager 가 첫 페이지로 전환.
  const [homeSignal, setHomeSignal] = useState(0);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1280px] flex-col gap-4 px-6 py-4 font-sans text-body dark:text-on-dark-soft max-[640px]:px-4">
      {/* 브라우저 autoplay 정책상 첫 제스처 전에는 소리 불가 → SOS 경보음 활성화 배너(클릭=제스처=arm). */}
      {sirenEnabled && !audioArmed && (
        <button
          type="button"
          onClick={armAudio}
          className="flex items-center justify-center gap-2 rounded-xl border border-amber-400/60 bg-amber-100 px-6 py-3 text-sm font-semibold text-amber-900 transition hover:bg-amber-200 dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-100 dark:hover:bg-amber-500/25"
          title="브라우저 정책상 한 번 클릭해야 SOS 경보음을 재생할 수 있습니다"
        >
          <span aria-hidden className="text-base">🔔</span>
          SOS 경보음 활성화 — 한 번 클릭하면 이후 SOS 시 자동으로 사이렌이 울립니다
        </button>
      )}
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-4 rounded-xl border border-hairline-strong bg-canvas px-6 py-3 dark:border-white/10 dark:bg-surface-dark">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setHomeSignal((n) => n + 1);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            aria-label="홈 화면으로 이동"
            title="홈 화면으로 이동"
            className="relative h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded-xl"
          >
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
          </button>
          <div className="min-w-0">
            <h1 className="truncate font-display text-[24px] font-semibold leading-none tracking-[-0.4px] text-ink dark:text-on-dark">
              VitAlGuard
            </h1>
            <p className="mt-1 truncate text-xs text-body dark:text-on-dark-soft">
              관제 · 실시간 수집 · DB 영속{" "}
              <span className="font-semibold tabular-nums text-ink dark:text-on-dark">
                <RollingChars text={(data.totalPersisted ?? 0).toLocaleString()} />
              </span>
              건 누적
            </p>
          </div>
        </div>

        <HeaderClock />

        <div className="flex min-w-0 items-center gap-2">
          {/* 로그인 상태 칩 — 표시 전용(클릭 없음). 접속점 + 이름/직책/사번/아이디.
              내 정보 수정 진입은 dock '내 정보' 아이콘 + 비밀번호 게이트로만(보안). */}
          {role && (
            <div
              title="로그인 계정"
              className="hidden h-8 max-w-[24rem] items-center gap-1.5 overflow-hidden rounded-lg bg-surface-strong px-3 text-xs text-body dark:bg-surface-dark-elevated dark:text-on-dark-soft sm:inline-flex"
            >
              <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              {role === "owner" ? (
                <>
                  <span className="font-semibold text-ink dark:text-on-dark">관리자</span>
                  <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-200">
                    총괄 관리자
                  </span>
                </>
              ) : (
                <>
                  <span className="shrink-0 truncate font-semibold text-ink dark:text-on-dark">
                    {loginInfo?.name ?? loginInfo?.username ?? "관리자"}
                    {loginInfo?.jobTitle ? ` ${loginInfo.jobTitle}` : ""}
                  </span>
                  <span className="truncate text-muted dark:text-on-dark-soft">
                    {loginInfo?.employeeId ? `· 사번 ${loginInfo.employeeId} ` : ""}
                    {loginInfo?.username ? `· ${loginInfo.username}` : ""}
                  </span>
                </>
              )}
            </div>
          )}
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
                tooltip: "일정 캘린더 — 새 현장 사진 알림",
                badge: calendarNewCount,
                onSelect: () => {
                  setCalendarOpen(true);
                  markCalendarSeen();
                },
                icon: (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="9" width="18" height="12" rx="2" />
                    <line x1="3" y1="13" x2="21" y2="13" />
                    <path d="M6.5 9a2 2 0 0 1 0-4 3 3 0 0 1 5.8-1.2 2.2 2.2 0 0 1 4.2 1.2 2 2 0 0 1-.5 4Z" />
                  </svg>
                ),
              },
              // 관리자 메뉴 — owner 거나 admin_access 부여받은 사용자만 노출(서버에서도 강제).
              ...(canAdminMenu
                ? [
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
                  ]
                : []),
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
              // 가입 회원(admin)만 노출 — 내 가입 정보 수정.
              ...(role === "admin"
                ? [
                    {
                      title: "내 정보",
                      tooltip: "내 가입 정보 수정 (이름·회사·연락처·비밀번호)",
                      onSelect: () => setProfileGateOpen(true),
                      icon: (
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                          <path d="m18.5 2.5 3 3L17 10l-3 .5.5-3z" />
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

      {/* 상단 페이저 — 3페이지(1.실시간 현장 관제 / 2.안전관리비 검증 / 3.ERP 스마트경리) */}
      <SectionPager
        homeSignal={homeSignal}
        onPageChange={setPagerIdx}
        pages={[
          {
            title: "실시간 현장 관제",
            content: (
              <div className="flex flex-col gap-4">
      <section className="overflow-hidden rounded-xl border border-hairline-strong bg-canvas px-6 py-4 text-ink dark:border-white/10 dark:bg-surface-dark dark:text-on-dark max-[640px]:px-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-stretch">
          {/* 좌측 — 히어로 카피 + 안전 신호등 + 현장정보/재해사례 캐러셀 */}
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex-1">
                <SafetySignalBoard lat={effLat} lon={effLon} worker={workerSignal} />
              </div>
              {/* 오늘 위험작업 요약 칩 — 캘린더 안 열어도 관제 화면에서 확인, 클릭 = 캘린더 열기 */}
              {todayHazard.total > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setCalendarOpen(true);
                    markCalendarSeen();
                  }}
                  aria-label="오늘 위험작업 일정 — 일정 캘린더 열기"
                  className={[
                    "mt-2 inline-flex items-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-[11px] font-semibold transition",
                    todayHazard.conflicts > 0 && todayHazard.severity === "danger"
                      ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20"
                      : todayHazard.conflicts > 0
                        ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
                        : "border-hairline bg-surface-soft text-body hover:bg-surface-strong dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark-soft dark:hover:bg-white/10",
                  ].join(" ")}
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <path d="M12 9v4" />
                    <path d="M12 17h.01" />
                  </svg>
                  오늘 위험작업 {todayHazard.total}건
                  {todayHazard.conflicts > 0 && ` · 기상 충돌 ${todayHazard.conflicts}건`}
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              )}
            </div>
            {/* 현장정보 + 국내재해사례 — 좌우 화살표 캐러셀(‹ 제목 N/M ›). 자동회전 없음·수동 전환만 */}
            <WidgetCarousel
              className="h-[140px]"
              autoRotate={false}
              pages={[
                {
                  title: "현장정보",
                  content: (
                    <div className="grid h-full w-full grid-cols-3 gap-1 p-1.5 max-[640px]:grid-cols-2">
                      {siteInfoRows(siteInfo).map((item) => (
                        <div key={item.label} className="flex min-w-0 flex-col justify-center rounded-lg bg-surface-card px-2.5 py-0.5 dark:bg-surface-dark-elevated">
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
                {
                  title: "산업 안전뉴스",
                  content: <NewsPanel />,
                },
              ]}
            />
          </div>

          {/* 우측 — 그룹 캐러셀(현황 요약·실시간 레이더·태풍 진로·특보영상). 자동회전 없음·수동 전환만 */}
          <WidgetCarousel
            className="min-h-[300px]"
            autoRotate={false}
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
                        <SummaryStat label="DB 누적" value={(data.totalPersisted ?? 0).toLocaleString()} roll />
                      </div>
                    </div>
                  </div>
                ),
              },
              { title: "실시간 레이더", content: <RadarRealtime /> },
              {
                title: "태풍 진로",
                content: <TyphoonTrack lat={effLat} lon={effLon} />,
              },
              {
                title: "특보 영상",
                content: <WarningVideoPanel lat={effLat} lon={effLon} />,
              },
              {
                title: "인근 병원",
                content: (
                  <HospitalPanel lat={effLat} lon={effLon} region={siteRegion} />
                ),
              },
            ]}
          />
        </div>
      </section>

      <WeatherStrip
        lat={effLat}
        lon={effLon}
        workerCount={fieldCoords.count}
        coordSource={coordSource}
        onRefresh={refreshFieldWeather}
        refreshing={locRefreshing}
        refreshNonce={weatherRefreshNonce}
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
              onClick={() => canAdminMenu && firstEmptySlot >= 0 && setQueueModalSlot(firstEmptySlot)}
              disabled={!canAdminMenu || firstEmptySlot < 0}
              title={
                !canAdminMenu
                  ? "관리자 권한(권한있음)이 있는 계정만 작업자 등록이 가능합니다"
                  : firstEmptySlot < 0
                    ? "슬롯이 가득 찼습니다"
                    : "대기 큐에서 작업자 등록"
              }
              className={`inline-flex h-8 items-center gap-1 rounded-pill bg-primary px-3 text-xs font-semibold text-on-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_CLASS}`}
            >
              + 작업자 등록
              {pendingWorkers.length > 0 && (
                <span className="ml-1 rounded-full bg-white/25 px-1.5 text-[10px]">대기 {pendingWorkers.length}</span>
              )}
            </button>
            {workerView === "table" && (
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
            )}
            <button
              type="button"
              onClick={() => setWorkerView((v) => (v === "map" ? "table" : "map"))}
              title={
                workerView === "map"
                  ? "지도 모드 — 클릭하면 표로 전환"
                  : "작업자 GPS 위성지도 보기 (마커 호버 시 생체 데이터)"
              }
              className={`inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-xs font-semibold active:scale-95 ${FOCUS_CLASS} ${
                workerView === "map"
                  ? "bg-primary text-on-primary"
                  : "bg-surface-strong text-body dark:bg-surface-dark dark:text-on-dark-soft"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {workerView === "map" ? "표 보기" : "지도"}
            </button>
          </div>
        </div>

                {workerView === "map" ? (
                  <div className="min-h-0 flex-1 p-2">
                    <WorkerGpsMap
                      points={workerMapData.pts}
                      excluded={workerMapData.excluded}
                      siteCircle={
                        siteCircleCenter
                          ? ({
                              lat: siteCircleCenter.lat,
                              lon: siteCircleCenter.lon,
                              radiusM: SITE_CIRCLE_RADIUS_M,
                            } satisfies SiteCircle)
                          : undefined
                      }
                      focus={mapFocus ?? undefined}
                      sitePolygon={siteParcel ?? undefined}
                      zones={dangerZones}
                      canManage={canAdminMenu}
                      onCreateZone={createDangerZone}
                      onDeleteZone={removeDangerZone}
                      trail={
                        trailWorkerId
                          ? {
                              workerId: trailWorkerId,
                              name:
                                latestMap.get(trailWorkerId)?.workerName ?? trailWorkerId,
                              windowMin: TRACK_WINDOW_MIN,
                              points: trailPoints ?? [],
                            }
                          : undefined
                      }
                      onToggleTrail={(workerId) =>
                        setTrailWorkerId((cur) => (cur === workerId ? null : workerId))
                      }
                    />
                  </div>
                ) : filledSlots.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-muted dark:text-on-dark-soft">
                    등록된 작업자가 없습니다. 우측 상단 <b className="text-ink dark:text-on-dark">+ 작업자 등록</b> 으로 추가하세요.
                  </p>
                ) : (
                  <div className="wx-cards-scroll min-h-0 flex-1 overflow-x-auto">
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
                          canManage={canAdminMenu}
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
                          canManage={canAdminMenu}
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
          { title: "가스 누출 감지기", content: <GasDetectorTable onSelect={openSiteChart} canManage={canAdminMenu} /> },
          { title: "심장 제세동기(AED) 알림", content: <AedAlertTable canManage={canAdminMenu} /> },
          { title: "CCTV 관제", content: <CctvQuadView canManage={canAdminMenu} /> },
        ]}
      />
              </div>
            ),
          },
          {
            title: "안전관리비 검증",
            content: <SafetyVerificationTabs />,
          },
          {
            // 시공사 경리 시스템(스마트경리 데모) — /erp 단독 라우트와 동일 컴포넌트를 탭으로 열람.
            // 자체 인디고 헤더·라이트 룩 유지 = "별개 시스템을 관제에서 열람" 역할극.
            title: "ERP: 스마트경리",
            content: (
              <div className="overflow-hidden rounded-xl border border-hairline-strong dark:border-white/10">
                <ErpDemoPage />
              </div>
            ),
          },
        ]}
      />

      {siteChart && (
        <SiteMetricChartPanel metric={siteChart} onClose={() => setSiteChart(null)} />
      )}

      {/* 전국 산업재해 사망 속보 — KOSHA OpenAPI (작업자 모니터링 하단으로 이동).
          ERP: 스마트경리(pagerIdx 2) 활성 시 숨김 — ERP 화면을 한 화면에 최대한 노출(언마운트=마퀴·폴링도 정지). */}
      {pagerIdx !== 2 && <KoshaAccidentTicker />}

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
          region={siteRegion}
          onDismiss={dismissSos}
          onContact={recordAccident}
          onAcknowledge={() => acknowledgeAlert(activeSos, "sos")}
          onShowMap={() => {
            showAlertOnMap(activeSos);
            dismissSos();
          }}
        />
      )}

      {activeFallAlert && !activeSos && (
        <SosAlertModal
          sample={activeFallAlert}
          reason="fall"
          region={siteRegion}
          onDismiss={dismissFallAlert}
          onContact={recordAccident}
          onAcknowledge={() => acknowledgeAlert(activeFallAlert, "fall")}
          onShowMap={() => {
            showAlertOnMap(activeFallAlert);
            dismissFallAlert();
          }}
        />
      )}

      {activeVitalAlert && !activeSos && !activeFallAlert && (
        <SosAlertModal
          sample={activeVitalAlert}
          reason="vital"
          region={siteRegion}
          onDismiss={dismissVitalAlert}
          onAcknowledge={() => acknowledgeAlert(activeVitalAlert, "vital")}
          onShowMap={() => {
            showAlertOnMap(activeVitalAlert);
            dismissVitalAlert();
          }}
        />
      )}

      {activeZoneAlert && !activeSos && !activeFallAlert && !activeVitalAlert && (
        <GeofenceAlertModal
          kind="entry"
          zoneName={activeZoneAlert.zone.name}
          sample={activeZoneAlert.sample}
          distM={activeZoneAlert.distM}
          radiusM={activeZoneAlert.zone.radiusM}
          onDismiss={dismissZoneAlert}
          onAcknowledge={() => acknowledgeAlert(activeZoneAlert.sample, "danger_zone")}
          onShowMap={() => {
            showAlertOnMap(activeZoneAlert.sample);
            dismissZoneAlert();
          }}
        />
      )}

      {activeGeofenceAlert &&
        !activeSos &&
        !activeFallAlert &&
        !activeVitalAlert &&
        !activeZoneAlert && (
        <GeofenceAlertModal
          sample={activeGeofenceAlert.sample}
          distM={activeGeofenceAlert.distM}
          radiusM={SITE_CIRCLE_RADIUS_M}
          onDismiss={dismissGeofenceAlert}
          onAcknowledge={() => acknowledgeAlert(activeGeofenceAlert.sample, "geofence")}
          onShowMap={() => {
            showAlertOnMap(activeGeofenceAlert.sample);
            dismissGeofenceAlert();
          }}
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

      {/* 새 현장 사진 도착 알림 토스트 — 클릭 시 캘린더 열림+확인 처리, 6초 후 자동 사라짐. */}
      {calendarToast && (
        <button
          type="button"
          aria-live="polite"
          onClick={() => {
            setCalendarOpen(true);
            markCalendarSeen();
          }}
          className="fixed right-4 top-20 z-[70] flex max-w-[20rem] items-center gap-3 rounded-2xl border border-hairline bg-surface-strong px-4 py-3 text-left shadow-xl transition hover:brightness-105 dark:border-white/10 dark:bg-surface-dark-elevated"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#0052ff]/10 text-primary dark:bg-[#0052ff]/25">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <path d="m9 15 2 2 4-4" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink dark:text-on-dark">
              새 현장 사진 {calendarToast.count}건
            </span>
            <span className="block text-xs text-muted dark:text-on-dark-soft">
              캘린더에서 확인하기
            </span>
          </span>
          <span className="relative ml-1 flex h-2 w-2 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
        </button>
      )}

      <HeaderCalendarPopup
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        lat={effLat}
        lon={effLon}
        workerCount={fieldCoords.count}
      />

      {usersOpen && <UserManagementModal onClose={() => setUsersOpen(false)} />}
      {profileGateOpen && (
        <ProfileGateModal
          onClose={() => setProfileGateOpen(false)}
          onVerified={() => {
            setProfileGateOpen(false);
            setProfileOpen(true);
          }}
        />
      )}
      {profileOpen && <MyProfileModal onClose={() => setProfileOpen(false)} />}

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
          liveValue={(() => {
            // 선택 작업자·메트릭의 현재 라이브 값 — 2초 폴 리렌더마다 갱신 → 그래프 24시간 뷰 마지막 점 실시간 반영.
            if (selection.metric === "fall") return null;
            const v = latestMap.get(selection.workerId)?.[selection.metric];
            return typeof v === "number" && Number.isFinite(v) ? v : null;
          })()}
          onMetricChange={(metric) =>
            setSelection({ workerId: selection.workerId, metric })
          }
          onClose={() => setSelection(null)}
        />
      )}

      {/* 실시간 수집 · DB 영속 스트립 — ERP: 스마트경리 활성 시 숨김(속보 티커와 동일 사유). */}
      {pagerIdx !== 2 && (
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
          <div className="wx-cards-scroll max-h-[32rem] overflow-auto">
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
                    <td
                      className="px-4 py-3 font-mono"
                      title={sample.skinTempC == null ? TEMP_UNAVAILABLE_TITLE : undefined}
                    >
                      {formatTemp(sample.skinTempC)}
                    </td>
                    <td className="px-4 py-3 font-mono text-body dark:text-on-dark-soft">
                      {sample.skinTempC == null
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
      )}
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
  // 슬롯 해제 권한 — 관리자 권한(owner 또는 admin_access) 있는 계정만 true. false 면 해제 버튼 비활성.
  canManage: boolean;
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
  canManage,
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
  const core = sample?.skinTempC == null ? undefined : estimateCoreTempC(sample.skinTempC);
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
          ? "bg-primary-subtle ring-1 ring-inset ring-primary-ring"
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

      {/* 6 체온 — 손목 + 추정 (미수신 시 명시) */}
      {metricCell(
        "skinTempC",
        sample?.skinTempC == null ? (
          <span className="leading-tight" title={TEMP_UNAVAILABLE_TITLE}>
            <span className="font-mono text-sm tabular-nums text-muted">
              --<span className="ml-0.5 text-[10px]">℃</span>
            </span>
            <span className="block text-[9px] leading-none text-muted">미수신</span>
          </span>
        ) : (
          <span className="leading-tight">
            <span className="font-mono text-sm tabular-nums">
              <span className={STATUS_CLASS[coreTempStatus(sample.skinTempC)]}>
                {formatTemp(sample.skinTempC)}
              </span>
              <span className="ml-0.5 text-[10px] text-muted">℃</span>
            </span>
            <span className="block text-[9px] leading-none text-muted">
              추정 {core == null ? "--" : formatTemp(core)}℃
            </span>
          </span>
        ),
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
          disabled={!canManage}
          onClick={(e) => {
            e.stopPropagation();
            if (!canManage) return;
            onClear(entry.slotIndex);
          }}
          title={
            canManage
              ? `슬롯 ${entry.slotIndex + 1}번에서 해제`
              : "관리자 권한(권한있음)이 있는 계정만 해제할 수 있습니다"
          }
          className={`rounded-md px-1.5 py-1 text-[11px] font-medium text-muted hover:bg-surface-strong hover:text-semantic-down disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted dark:hover:bg-white/10 ${FOCUS_CLASS}`}
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
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-hairline-strong bg-canvas dark:border-white/10 dark:bg-surface-dark"
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
            className="w-full rounded-lg border border-hairline bg-surface-soft px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-ink/20 dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark"
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
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-active"
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
  type: "sos" | "fall" | "vital" | "geofence";
  ts: string;
  created_at: string;
  ack_at: string | null;
  ack_by: string | null;
};

const ALERT_LABEL: Record<string, string> = {
  sos: "SOS 요청",
  fall: "낙상 감지",
  vital: "생체 위험",
  geofence: "구획 이탈",
  danger_zone: "위험구역 진입",
};
// 미대응 알림 카드/아이콘 톤 — SOS 레드 / 낙상 앰버 / 생체 위험 로즈 / 구획 이탈·위험구역 진입 오렌지.
const ALERT_UNACK_CARD: Record<string, string> = {
  sos: "border-[#dc2626]/30 bg-[#dc2626]/[0.06] dark:border-[#dc2626]/40 dark:bg-[#dc2626]/[0.10]",
  fall: "border-[#f59e0b]/35 bg-[#f59e0b]/[0.08] dark:border-[#f59e0b]/40 dark:bg-[#f59e0b]/[0.10]",
  vital: "border-[#e11d48]/30 bg-[#e11d48]/[0.06] dark:border-[#e11d48]/40 dark:bg-[#e11d48]/[0.10]",
  geofence: "border-[#f97316]/35 bg-[#f97316]/[0.08] dark:border-[#f97316]/40 dark:bg-[#f97316]/[0.10]",
  danger_zone: "border-[#f97316]/35 bg-[#f97316]/[0.08] dark:border-[#f97316]/40 dark:bg-[#f97316]/[0.10]",
};
const ALERT_UNACK_ICON: Record<string, string> = {
  sos: "text-semantic-down",
  fall: "text-amber-600 dark:text-amber-400",
  vital: "text-rose-600 dark:text-rose-400",
  geofence: "text-orange-600 dark:text-orange-400",
  danger_zone: "text-orange-600 dark:text-orange-400",
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
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-hairline-strong bg-canvas dark:border-white/10 dark:bg-surface-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3 dark:border-white/10">
          <span className="text-sm font-bold text-ink dark:text-on-dark">
            SOS·낙상·생체·이탈 알림 이력
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
        <div className="wx-cards-scroll overflow-y-auto px-5 py-3">
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
  if (type === "geofence") {
    // map-pin (구획 이탈)
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    );
  }
  if (type === "danger_zone") {
    // octagon-alert (위험구역 진입)
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86L7.86 2Z" />
        <path d="M12 8v4" />
        <path d="M12 16h.01" />
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

// roll=true 면 값을 헤더 시계와 같은 롤링(.clock-roll-char) 애니메이션으로 표시(바뀐 자리만 굴러감).
function SummaryStat({ label, value, roll = false }: { label: string; value: string; roll?: boolean }) {
  return (
    <div className="flex min-h-0 flex-col justify-center rounded-lg bg-surface-soft px-2.5 py-1 dark:bg-surface-dark-elevated">
      <div className="text-xs leading-tight text-body dark:text-on-dark-soft">{label}</div>
      <div className="font-mono text-base font-medium leading-tight text-ink dark:text-on-dark">
        {roll ? (
          <span className="tabular-nums">
            <RollingChars text={value} />
          </span>
        ) : (
          value
        )}
      </div>
    </div>
  );
}
