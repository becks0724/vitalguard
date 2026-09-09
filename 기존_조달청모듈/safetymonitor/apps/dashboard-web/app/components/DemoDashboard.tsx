"use client";

import { motion, useReducedMotion, type Transition } from "framer-motion";
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
  computeStressIndex,
  stressInputsFromSample,
  type StressLevel,
  type StressResult,
} from "@safetymonitor/analyzers";

// coreTempStatusC = 심부체온 직접 판정(칼만 입력 · 라이브 판정의 정본).
// coreTempStatus(손목 입력)는 이 파일에서 더 쓰지 않는다 — 기기 발열 오염 때문에 판정에서 뺐다.
import {
  heartRateStatus,
  spo2Status,
  coreTempStatusC,
  CORE_TEMP_EST_MAX_AGE_MIN,
  workActivity,
} from "../../lib/severity";
import { computePsi, psiBand } from "../../lib/psi";
import { spo2AgeMs, freshSpo2, formatSpo2Age } from "../../lib/spo2-freshness";
import { formatElapsed } from "../../lib/absence-watch";
import { parseOcrStamp } from "../../lib/ocr-stamp";
import { impactRowView, isImpactSample, type ImpactRowView } from "../../lib/impact-row";
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
import { DotMatrix } from "./DotMatrix";
import { AnimateNumber } from "./AnimateNumber";
import { useSession } from "./LoginGate";
import { getSessionRole, getSessionToken } from "./session-token";
import { SafetySignalBoard, type WorkerSignal } from "./SafetySignalBoard";
import { QuantumPulseLoader } from "./ui/quantum-pulse-loader";
import {
  WorkerGpsMap,
  type MapFocus,
  type SiteCircle,
  type WorkerMapExcluded,
  type WorkerMapPoint,
} from "./WorkerGpsMap";

// 지도 모드 현장 구획 근사 원 반경(m).
// 중심 = 서버 캐시 현장 좌표(site_coord_daily·일 단위 고정) 우선 — 작업자 이동에 중심이 끌려다니지 않게.
// 주소 문자열 기반 정확 지오코딩은 무키 서비스가 건물번호를 못 잡음(도로 중심 ~800m 오차 실측) →
// NCP Maps/VWorld 키 활성화 시 주소 중심으로 승격 예정.
//
// ★ 값을 여기 리터럴로 두지 않는다 — iOS 앱의 위치 게이트와 **같은 정책**이어야 한다.
//   구 앱은 단말 500m · 관제 100m 로 5배 어긋나 있어서 100m 를 벗어나도 좌표가 안 올라왔다
//   (2026-08-16 실측 · docs/gps-phone-collection/context-notes.md G-04).
const SITE_CIRCLE_RADIUS_M = SITE_RADIUS_MAX_M;
import { RadarRealtime } from "./RadarRealtime";
import { TyphoonTrack } from "./TyphoonTrack";
import { WarningVideoPanel } from "./WarningVideoPanel";
import { HospitalPanel } from "./HospitalPanel";
import { extractRegion } from "../lib/hospital";
import {
  fixUsableForJudgment,
  GEOFENCE_INITIAL,
  geofenceDistanceM,
  stepGeofence,
  type GeofenceState,
} from "../lib/geofence";
import { TRACK_LINE_ACC_MAX_M, TRACK_WINDOW_MIN, mergeTrackSeq, type TrackCoarsePoint, type TrackPoint, type TrackQuality } from "../lib/track";
import {
  AedAlertTable,
  GasDetectorTable,
  SiteMetricChartPanel,
  type SiteMetric,
} from "./SiteSafetyTables";
import { SosAlertModal } from "./SosAlertModal";
import { GeofenceAlertModal } from "./GeofenceAlertModal";
import {
  disconnectMetric,
  effectiveTone,
  gateStaleVitals,
  overallStatus,
  withOutsideMetric,
  workerSignalCopy,
  workerStatus,
  worseTone,
  type WorkerStatus,
} from "../../lib/worker-signal";
import { vitalAgeMs, staleThresholdMs, staleKind, STALE_LABEL, OFF_BODY_LABEL, STALE_MS_DEFAULT, type StaleKind } from "../../lib/vital-age";
import { stillLabel } from "../../lib/vital-still";
import { type OffWristSuspect } from "../../lib/vital-offwrist";
import { SITE_RADIUS_MAX_M } from "../../lib/site-radius";
import { ThemeToggle } from "./ThemeToggle";
import { VitalHistoryPanel } from "./VitalHistoryPanel";
import { weatherLabel } from "./WeatherStrip";
import { WeatherIcon, weatherIconKey } from "./WeatherIcons";
import { WidgetCarousel } from "./WidgetCarousel";
import { CctvQuadView } from "./CctvQuadView";
import { WorkerQueueModal } from "./WorkerQueueModal";
import { SafetyNewsPage } from "./SafetyNewsPage";
import { SiteSidePanels } from "./SiteSidePanels";
import SafetyVerificationTabs from "./SafetyVerificationTabs";
import SubsidyAuditBoard from "./SubsidyAuditBoard";
import { SectionPager } from "./SectionPager";
import ErpDemoPage from "../erp/page";
import { MyProfileModal } from "./MyProfileModal";
import { ProfileGateModal } from "./ProfileGateModal";
import { UserManagementModal } from "./UserManagementModal";

// ⚠ VitalHistoryPanel 의 `Metric` 과 **같은 집합이어야 한다** — 한쪽만 늘리면 탭을 눌러도
//    선택이 전달되지 않거나(좁은 쪽이 여기) 타입만 통과하고 서버가 400 을 낸다(좁은 쪽이 저기).
//    `skinTempC` = 워치 온도 센서 실측(2026-08-26 복원 · coreTempEst 와 다른 값).
type HistoryMetric =
  | "heartRate"
  | "spo2"
  | "skinTempC"
  | "coreTempEst"
  | "activity"
  | "fall"
  | "coverage"
  // 배터리 잔량(%) — 생체가 아니라 단말 상태다. 점에 charging 이 함께 실려 충전 구간을 음영으로 그린다.
  | "battery";
type Selection = { workerId: string; metric: HistoryMetric };

// 서버 병합이 얹는 "마지막 정확 fix" 힌트(store.ts LatestVitalSample) — 스키마 밖 파생값이라 미러링.
// 필드명이 서버와 갈리면 조용히 undefined 가 된다 — 가드(2026-08-31-marker-last-good-fix)가 양쪽을 못 박는다.
type LatestSample = VitalSample & {
  lastAccurateLat?: number;
  lastAccurateLon?: number;
  lastAccurateAccM?: number;
  lastAccurateTs?: string;
};

type MockVitalResponse = {
  latest: LatestSample[];
  recent: VitalSample[];
  // ★ DB 조회 실패 시 서버가 **null** 을 준다(0 아님 — 2026-08-15 장애 대응).
  //   누적 21만 건이 "0건"으로 뜨면 미수신보다 나쁘므로 화면은 `—` 를 찍는다.
  totalPersisted?: number | null;
  dataMockup?: VitalSample[];
  dataMockupPersisted?: number | null;
  countsByWorker?: Record<string, number> | null;
  /** DB 조회에 실패한 항목 이름들. 비어 있으면 정상 — 값이 있으면 표시가 불완전하다. */
  degraded?: string[];
  // 심박 기반 심부체온 추정(서버 칼만필터·표시 전용) — workerId(주 ID) → 추정.
  coreTempEst?: Record<string, { tempC: number; basisMinutes: number; lastHrTs: string }>;
  /** 워밍업 진행률(표시 전용) — 값이 아직 없는 워커만. "미수신"과 "심박 누적 중"을 가른다. */
  coreTempWarmup?: Record<string, { buckets: number; needed: number }>;
  // 저활동·고심박 패턴(온열 ②·표시 주석 전용) — flagged 워커만 실린다. 판정 미주입.
  heatPattern?: Record<string, { hrAvg: number; aeKcalPerMin: number; coveredMinutes: number }>;
  /** 작업대사율(kcal/hr) — KOSHA 작업강도 분류 입력. 참고 권고 전용. */
  workRate?: Record<string, number>;
  // 온열 단계(온열 ③) — caution/warning 워커만. warning 은 신호등 주의 점등(사용자 결정 08-13).
  // workerStatus/overallStatus(생체 판정)에는 여전히 미주입 — 통제된 예외는 신호등 톤 합성뿐.
  heatStage?: Record<string, "caution" | "warning">;
  offWrist?: Record<string, OffWristSuspect>;
  // 별칭 맵(secondary → primary) — 실시간 수집 행(발신 ID)을 추정 맵(주 ID 키)에 잇는 데 쓴다.
  workerAliases?: Record<string, string>;
  // 직급/직책 관제 웹 오버라이드(workerId → 직급) — 폰 발신값(sample.jobTitle)보다 우선.
  workerProfiles?: Record<string, string>;
  /** workerId → 최빈 이름. 링 버퍼 밖 작업자의 **표시용 폴백**(판정 미주입 · 서버 db.ts 주석). */
  workerNames?: Record<string, string>;
};

const SLOT_COUNT = 100;
const SLOTS_STORAGE_KEY = "safetymonitor.slots.v1";
const SLIDEMODE_STORAGE_KEY = "safetymonitor.slidemode.v1";
// 표 행 높이(h-12=48px) — 세로 자동 슬라이딩의 한 벌(firstCopyHeight) 계산용
const TABLE_ROW_PX = 48;
// 작업자 표 14열 그리드 — 헤더·행 공용.
// [정렬핸들·작업자·직급·심박·SpO₂·손목온도·낙상·스트레스·신호·배터리·상태·수신·누적·해제]
//
// ★ 배터리는 **신호 바로 뒤**다(2026-09-03 사용자 지시). 의미상으로도 맞는 자리다 —
//   신호·배터리가 "단말이 살아 있는가" 2종으로 묶이고, 그 뒤부터 상태·수신·누적이 온다.
// ★ 폭은 `minmax(4.5rem,1fr)` = 심박·SpO₂·누적과 **같은 균등 배분 조**에 넣었다. 내용이
//   `88%` + 아래 `충전` 이라 4.5rem 안에 든다. 고정폭으로 두면 그만큼 1fr 몫이 줄어
//   나머지 열이 좁아진다 — 사용자가 말한 "간격 균등" 은 이 조에 함께 참여시키는 것이다.
// ⚠ 고정폭 넷(작업자 10rem·직급 4.5rem·신호 3.5rem·해제 3rem)은 건드리지 않는다.
//   특히 스트레스 8rem 은 아래 주석의 실측 근거가 있다.
// ★ 남는 폭은 생체 데이터 열들이 나눠 갖는다(각 minmax(…,1fr)). 종전엔 작업자 열만 `1.2fr` 이라
//   넓은 화면에서 그 열 혼자 여백을 전부 흡수해 작업자↔직급이 벌어지고 나머지가 몰려 있었다.
//   작업자 열은 가장 긴 표기("EMP-admin7276" + 신호등 = 127px 실측)가 들어가는 10rem 고정.
//   스트레스 8rem 은 헤드리스 실측 기준 — 「스트레스 100 · 심박 기반」 칩이 123.6px 이다(지수 0~100 이라
//   3자리가 도달 가능한 값). 좁히면 칩이 whitespace-nowrap·shrink-0 이라 줄지 않고 이웃 열로 넘친다.
const TABLE_GRID =
  "grid items-center gap-x-2 grid-cols-[1.75rem_10rem_4.5rem_minmax(4.5rem,1fr)_minmax(4.5rem,1fr)_minmax(6rem,1fr)_minmax(5rem,1fr)_minmax(8rem,1fr)_3.5rem_minmax(4.5rem,1fr)_minmax(4.5rem,1fr)_minmax(5rem,1fr)_minmax(4.5rem,1fr)_3rem]";

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
// 끊김 중 "마지막 값 회색 유지" 상한(ms) — 링 웜스타트·트레일 창과 같은 30분. 그 이상 묵은 값은 운영 의미가 없다.
const HELD_VALUE_MAX_MS = 30 * 60 * 1000;

function formatInt(value?: number | null) {
  return value == null ? "--" : Math.round(value).toString();
}

// 체온 미수신(기기 미전송) 안내 — 애플워치 등 일부 기기는 작업 중 체온을 전송하지 않음.
// store sticky-carry 로 한번이라도 값이 오면 유지되므로, 남아있는 null/undefined ≈ "미수신".
const TEMP_UNAVAILABLE_TITLE = "체온 미수신 — 이 기기에서 체온 데이터가 들어오지 않습니다";
// 워밍업 중 — 미수신과 정반대 상태다. 심박은 오고 있고 칼만이 아직 30버킷을 못 채운 것뿐이라
// 조치가 "기기 확인" 이 아니라 "계속 착용" 이다. 진행률을 함께 적어 멈춘 것과 구분되게 한다.
// ★ 갤럭시는 심박 보고가 2분 간격이라 30버킷이 실제로는 연속 착용 60~90분이다(2026-09-08 실측).
// ⚠ 문구가 짧은 이유 — 이 칸(`손목온도`)은 그리드 `minmax(6rem,1fr)` 이라 **최소 96px** 이고
//   metricCell 의 `px-1` 을 빼면 글자 가용 폭이 88px 뿐이다. 9px 한글은 자당 약 9px 이라
//   부값 줄의 `체온 ` 접두(약 20px)까지 세면 "체온 심박 누적 중 12/30"(약 98px)이 넘친다
//   — 2026-09-08 라이브 실측에서 실제로 두 줄로 접혔다. "체온 누적 12/30" 은 약 66px 로 들어간다.
//   전체 문장은 title 로 그대로 준다(아래 coreTempWarmupTitle).
const CORE_TEMP_WARMUP_LABEL = "누적";
const coreTempWarmupTitle = (w: { buckets: number; needed: number }) =>
  `심부체온 추정 준비 중 — 심박 ${w.buckets}/${w.needed}분 누적. 계속 착용하면 값이 뜹니다(갤럭시는 심박 보고가 2분 간격이라 보통 60~90분). 심박 공백이 60분을 넘으면 처음부터 다시 셉니다`;
// 연결끊김일 때는 "센서 없음" 이 아니라 "수신 중단" 이므로 사유를 구분해 표시한다.
// ★ 종전 문구는 "60초 초과" 고정이라 12시간 끊김도 1분처럼 읽혔다 — 실제 경과를 적는다.
// ★ 종류에 따라 조치가 정반대다(2026-08-28) — 샘플이 도착 중이면 기기가 아니라 착용을 봐야 한다.
//   근거는 lib/vital-age.ts 의 staleKind 주석.
const tempStaleTitle = (ageMs: number, kind: StaleKind) =>
  kind === "hrSilent"
    ? `${STALE_LABEL.hrSilent} — ${formatElapsed(ageMs)}째 심박 없음. 기기는 수신 중이니 워치 착용을 확인하세요`
    : `${STALE_LABEL.disconnected} — ${formatElapsed(ageMs)}째 수신 없음. 직전 값은 현재 상태가 아닙니다`;

// 누적 추세 차트는 자체 웨어러블 디바이스가 실측한 메트릭에만 표시.
// 폰 측 store 에 해당 metric 값이 실시간 들어와 있는 경우만 live 로 판정.
function hasLiveMetric(
  sample: VitalSample | undefined,
  metric: HistoryMetric,
  lastFallTs: string | undefined,
  coreTempEstC?: number,
): boolean {
  if (metric === "fall") return lastFallTs !== undefined;
  if (metric === "coreTempEst") return typeof coreTempEstC === "number";
  // 실측 피부온 — 아래 `sample[metric]` 일반 경로가 그대로 맞는다(메트릭 키 = 필드명 skinTempC).
  // 애플 전용 워커는 센서값이 안 와서 false 로 떨어지고 탭이 placeholder 가 된다(정직한 표시).
  // SpO₂ = 기회 측정 — "지금 신선한 값"이 아니라 "기간 내 측정"이 기준이라 항상 열고 서버 데이터로 판정.
  if (metric === "spo2") return true;
  // 활동 = 구간 합 이력 — 지금 정지 중(증분 없음)이어도 기간 내 이력은 있다. 서버 데이터로 판정.
  if (metric === "activity") return true;
  // 수집 커버리지 = 라이브 샘플이 아니라 과거 수집 이력이다. 지금 미수신이어도 지난 1년은 있다 —
  // 오히려 "지금 안 오는 워커"일수록 이 탭을 봐야 한다. 서버 데이터로 판정한다.
  if (metric === "coverage") return true;
  // 배터리 — 메트릭 키("battery")와 필드명(batteryPct)이 다르므로 아래 일반 경로에 안 걸린다.
  // 잔량이 한 번이라도 왔으면 이력이 있다(단말 상태라 착용 여부와 무관하게 계속 쌓인다).
  if (metric === "battery") return typeof sample?.batteryPct === "number";
  if (!sample) return false;
  const value = sample[metric];
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * 배터리 잔량 색 — 설비(제세동기) 게이지와 **같은 임계**(≤20 위험 · ≤50 주의)를 쓴다.
 * 두 화면이 다른 기준을 쓰면 같은 30% 가 한쪽은 빨강, 한쪽은 노랑이 된다.
 */
const batteryTone = (pct: number) =>
  pct <= 20
    ? "text-semantic-down"
    : pct <= 50
      ? "text-amber-600 dark:text-amber-300"
      : "text-body dark:text-on-dark";

/**
 * 충전 중인가 — Android `BATTERY_STATUS_*` 원시값. **2(CHARGING)·5(FULL)만** 확정으로 본다.
 *
 * ⚠ 4(NOT_CHARGING)는 뺐다. 이 워치는 배터리 보호 모드 상한이 90% 라(09-03 실측 SM-L355N
 *   `mMaximumProtectionThreshold: 90`) 독 위에서 4로 앉을 수 있지만, **4가 충전기 위를 뜻하는지
 *   실기로 확인한 적이 없다**(그날 관측된 값은 3뿐). 4를 충전으로 치면 근거 없는 표시가 된다.
 *   워치가 원시 정수를 보내므로 확인 뒤 **이 한 줄만** 고치면 된다(워치 재설치 불필요).
 * ⚠ undefined 는 "모름" 이다 — 구 표본에는 상태가 없다. false 로 접으면 "방전 확인"이 된다.
 */
const isCharging = (status: number | undefined) => status === 2 || status === 5;

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
// 낙상/SOS 긴급 팝업 신선도 — 이 시간보다 오래된 이벤트는 활성 경보로 재팝업하지 않는다.
// (표 셀 "발생" 표시와 동일 창. 팝업 트리거엔 이 필터가 없어 몇 시간 전 stale 샘플이 계속 재팝업하던 버그 수정.)
const ALARM_FRESH_MS = 5 * 60 * 1000;
// 낙상 "확인 중"(pending) 표시 창 — 워치 확인 프롬프트 20초 + 여유. 이 안의 fall 후보는 확인 중으로 표시.
const FALL_PENDING_MS = 22 * 1000;

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

// 공통 게이지 1줄 — [라벨 + 큰 숫자 + 경과] + 0~100% RGB 바를 가로로 나란히(사용자 요청).
// 줄 높이(h-5)를 바깥에서 정하고 게이지는 h-full 로 받아 글자와 바 높이를 같게 맞춘다.
// 착수/준공일 footer 는 바로 아래 현장정보 패널과 중복이라 생략(높이 절약).
function GaugeRow({
  title,
  status,
  value,
  fractionDigits = 0,
  unit,
  unitTight,
  note,
  pct,
  known,
  ariaLabel,
}: {
  title: string;
  status: string;
  /** 표시할 값. 자릿수 단위로 애니메이션하므로 **문자열이 아니라 숫자**로 넘긴다. */
  value: number;
  /** 소수 자릿수 — Intl 로 고정한다. 자릿수가 흔들리면 슬롯이 어긋나 엉뚱한 자리가 움직인다. */
  fractionDigits?: number;
  /** 단위 — 글리프에 없거나(한글) 도트로 그리면 뭉개지는 글자(%)는 여기로 뺀다(글꼴로 렌더). */
  unit?: string;
  /** 단위를 숫자에 붙일지. '%'처럼 값과 한 덩어리로 읽히는 기호는 true, '일'처럼 낱말이면 false. */
  unitTight?: boolean;
  note?: string;
  pct: number;
  known: boolean;
  ariaLabel: string;
}) {
  // 상태 라벨을 마커의 어느 쪽에 둘지 — 채움 쪽(왼쪽)이 기본이고, 그쪽 폭이 라벨보다 좁으면
  // 반대편으로 넘긴다. 폭은 글자 수로 어림할 수 없어(한글·숫자·공백이 섞인다) 실제로 잰다.
  const trackRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [labelRight, setLabelRight] = useState(false);
  useEffect(() => {
    const track = trackRef.current;
    const label = labelRef.current;
    if (!track || !label) return;
    const measure = () => {
      const filled = track.clientWidth * ((known ? pct : 0) / 100);
      setLabelRight(label.offsetWidth + 8 > filled);
    };
    measure();
    // ⚠ 라벨은 픽셀 글꼴(`font-pixel`)이고 `font-display: swap` 이라 **나중에 도착한다.**
    //   글꼴이 바뀌면 글자 폭이 달라져 flip 판정이 어긋나므로 로드 완료 시점에 한 번 더 잰다.
    //   ResizeObserver 는 트랙만 보므로 이 변화를 못 잡는다.
    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.ready.then(measure).catch(() => {});
    }
    // 바는 flex-1 이라 창 크기·형제 폭에 따라 계속 변한다 — 한 번 재고 끝내면 어긋난다.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, [pct, known, status]);

  // 채움이 0 에서 현재 값까지 차오른다(2026-08-28 사용자 지시 "로딩하는 것처럼").
  //
  // ★ 처음엔 21st.dev `@ddoemonn/progress-bar` 의 FILL 계수(stiffness 210·damping 34·mass 0.9)를
  //   그대로 썼는데 **0.6초 만에 끝나 사용자가 "바뀐 게 없다"고 했다** — 코드는 돌고 있었지만
  //   눈 깜빡할 사이였다. 그래서 계수 대신 **시간을 직접 지정**한다(1.4초).
  // ⚠ bounce: 0 — 게이지가 목표값을 넘었다 돌아오면 그 순간 **틀린 수치로 보인다.** 튐은 금물.
  // ⚠ 덮개·마커·라벨이 **같은 transition** 을 써야 한 덩어리로 움직인다. 하나라도 빠지면
  //   차오르는 동안 마커만 먼저 가 있어 어긋나 보인다.
  // ⚠ `left` 는 레이아웃 속성이라 보통은 transform 을 쓰지만, 여기 움직이는 요소는 셋뿐이고
  //   값이 바뀔 때만 도는 애니메이션이라 그대로 둔다(구조를 비틀면 덮개의 right-0 이 깨진다).
  const reduced = useReducedMotion();
  const fillTransition: Transition = reduced
    ? { duration: 0 }
    : { type: "spring", duration: 1.4, bounce: 0 };

  return (
    // items-stretch(기본) — 게이지가 텍스트 줄 높이를 그대로 받아 둘이 정확히 같아진다(고정값 없음).
    <div className="flex items-stretch gap-2.5">
      {/* 좌 — 라벨 + 값 + 경과/총 */}
      {/* items-baseline — AnimateNumber 는 an-root 가 baseline 정렬이라 라벨·단위와 밑선이 맞는다.
          items-center 로 두면 값만 반 픽셀 떠 보인다(7-세그먼트 시절의 정렬값이었다). */}
      <div className="flex shrink-0 items-baseline gap-1.5">
        <span className="text-[13px] font-semibold leading-none text-ink dark:text-on-dark">{title}</span>
        {/* 값 표시(2026-08-28) — 도트 격자 → 7-세그먼트 → **글꼴 + 자릿수 애니메이션**으로 왔다.
            ★ 앞의 둘이 실패한 이유는 같다: 이 화면은 devicePixelRatio=1 이라 격자가 정수 픽셀에
              갇히고, 14px 다음 크기가 곧바로 21px 로 뛴다. "작고·떨어져 있고·굵은" 조합이 없었다.
            그래서 크기는 세그먼트 도입 **이전 값(font-mono 17px semibold)** 으로 되돌리고,
            "값이 바뀌었다"는 신호는 형태가 아니라 **움직임**이 맡는다 — 바뀐 자릿수만 블러 슬라이드.
            ⚠ 미상(--)은 애니메이션 대상이 아니다(숫자가 아니라 상태다). 같은 크기의 글꼴로 그린다.
            ⚠ blur 기본값 21px 은 원본 데모의 60px 글자 기준이다. 17px 에 그대로 쓰면 획이 뭉갠다. */}
        {known ? (
          <AnimateNumber
            value={value}
            format={{ minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }}
            duration={420}
            blur={8}
            className="font-mono text-[17px] font-semibold leading-none text-ink dark:text-on-dark"
          />
        ) : (
          <span className="font-mono text-[17px] font-semibold leading-none text-ink dark:text-on-dark">--</span>
        )}
        {/* 단위는 값과 분리해 둔다 — 값만 애니메이션하고 단위는 가만히 있어야 눈이 값을 쫓는다.
            ⚠ 값에 단위를 섞어 넘길 수 없다: value 가 number 라 애초에 안 들어간다.
            ml-1 — 값과 단위가 붙으면 '157일'이 한 덩어리로 읽힌다(2026-08-28 사용자 지시로 벌림). */}
        {known && unit && (
          <span
            className={`${unitTight ? "ml-0.5" : "ml-1"} text-[13px] font-semibold leading-none text-ink dark:text-on-dark`}
          >
            {unit}
          </span>
        )}
        {known && note && (
          <span className="whitespace-nowrap font-mono text-[10px] leading-none text-body dark:text-on-dark-soft">
            {note}
          </span>
        )}
      </div>
      {/* 우 — 게이지 바 (오른쪽 끝 안쪽에 상태 텍스트 삽입). 남는 폭을 전부 쓴다. */}
      <div
        className="relative min-w-0 flex-1 rounded-full p-[2px] ring-2 ring-ink/45 dark:ring-white/25"
        role="progressbar"
        aria-valuenow={known ? Math.round(pct) : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel}
      >
        {/* 안쪽 트랙 — 바깥 테두리와 채움 사이 여백(2026-08-28 사용자 지시)을 padding 으로 만든다.
            ⚠ 채움·눈금·라벨은 전부 `absolute inset-*` 이라 **부모의 padding 을 무시한다.** 그래서
              여백을 주려면 이렇게 트랙을 한 겹 더 둘 수밖에 없다(패딩만 추가하면 아무 변화가 없다).
            ⚠ 폭 측정(labelRight 판정)의 기준도 이 트랙이다 — ref 를 바깥 div 에 두면 좌우 padding
              6px 만큼 넓게 재어 라벨이 뒤집히는 지점이 어긋난다. */}
        <div ref={trackRef} className="relative h-full w-full overflow-hidden rounded-full">
          {/* 채움(2026-08-28 사용자 지시) — 종전에는 반대였다: 0~100 무지개 그라데이션을 깔고
              진행 **이후**를 검정 반투명으로 덮었다. 그래서 남는 쪽이 남색(파랑·보라 구간 + 검정)으로
              보였다. 이제 진행 **까지**를 칠하고 나머지는 비운다.
              ★ 색은 `body` 토큰이다(2026-08-28 사용자 지시로 검정 → 회색). 라이트 96·100·108 /
                다크 176·180·186 이라 테마가 알아서 뒤집힌다 — `bg-gray-500` 같은 고정색을 박으면
                다크모드에서 대비가 무너진다.
              ⚠ `muted`(153·153·153)를 쓰지 않은 이유 = 그 위의 흰 라벨 대비가 **2.85:1** 로
                WCAG AA(4.5:1) 미달이다. `body` 는 5.68:1 로 통과한다.
              ⚠ 채움과 라벨 배경은 **같은 토큰**이어야 한다. 한쪽만 바꾸면 라벨 자리에서 색이
                끊겨 "끝만 회색"으로 보인다(2026-08-28 실제로 그렇게 나갔다).
              ⚠ `left` 가 아니라 `width` 를 애니메이션한다. 채움은 왼쪽 끝이 고정이다. */}
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-body"
            initial={{ width: "0%" }}
            animate={{ width: `${known ? pct : 0}%` }}
            transition={fillTransition}
          />
          {/* 20칸 눈금(2026-08-28 사용자 지시 "레트로 디지털 풍") — 21st.dev `@theorcdev/8bit-progress`
              의 retro variant 가 20분할이라 그 칸 수를 그대로 가져왔다. 그 컴포넌트 자체는 못 쓴다:
              class-variance-authority 를 요구하는데 이 레포에 없고, 채움이 단색이라 그라데이션이 죽는다.
              ★ div 20개를 놓지 않고 **repeating-linear-gradient 한 겹**으로 나눈다 — 칸을 요소로 만들면
                바 폭이 유동적(flex-1)이라 소수 픽셀에서 칸마다 폭이 1px 씩 어긋난다.
              ⚠ 구분선 색은 canvas 토큰이다. 흰색을 박으면 다크모드에서 칸이 흰 격자로 뜬다
                (같은 실수를 이 레포가 전에 한 번 했다 — tailwind 색은 `-rgb` 채널이 단일 소스).
              ⚠ 마커·라벨보다 **아래**에 둔다. 위에 두면 눈금선이 글자를 가로지른다.
              ⚠ 구간을 `calc(5% - 2px)` 로 잡았다가 브라우저 렌더러가 멈췄다 — 바는 flex-1 이라
                폭이 유동적이고, 좁아지면 5% 가 2px 밑으로 내려가 **구간이 음수**가 된다.
                픽셀을 섞지 말고 비율로만 잡는다(4.2% 채움 + 0.8% 틈 = 한 칸 5%). */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, transparent 0 4.2%, rgb(var(--color-canvas-rgb)) 4.2% 5%)",
            }}
            aria-hidden="true"
          />
          {/* 마커는 뺐다 — 채움이 그 자리에서 끊기므로 경계가 곧 마커다. 남겨 두면 흰 선의 절반이
              채움 위(검정), 절반이 빈 공간(흰 배경) 에 걸쳐 반쪽만 보인다. */}
          {/* 상태(D-day 등) — 마커에 붙인다(2026-08-28 사용자 지시).
              ⚠ 종전에는 `right-2` 고정이라 pct 가 커지면 **마커선이 글자를 관통했다** —
                실측: 공정률 80.5% 에서 '준공까지'의 '공'이 흰 선에 덮였다.
              ★ 원인은 둘이 **서로 다른 기준**으로 놓여 있던 것이다(마커=pct, 라벨=오른쪽 끝).
                어떤 값에서는 반드시 만난다. 같은 기준(pct)에 묶어야 겹침이 원천적으로 사라진다.
              채움 쪽이 기본 — 라벨이 채움 끝을 가리켜 마커 역할을 겸한다. 좁으면 반대편으로.
              ★ 색은 놓이는 쪽에 따라 **정반대**다. 채움 위(검정)면 canvas, 빈 공간(흰 바탕)이면 ink.
                한쪽 색으로 고정하면 flip 되는 순간 글자가 바탕에 묻는다.
                두 토큰 다 다크모드에서 뒤집히므로 dark: 변형이 따로 필요 없다.
              ★ 바탕색도 같이 깐다 — 20칸 눈금선이 canvas 색이라 **흰 글자와 같은 색**이 되어
                '준공까지'의 획을 세로줄이 먹었다(실측). 글자 뒤에서만 눈금을 덮는다.
                배경은 자기가 놓인 바닥과 같은 색이라 사각형이 따로 보이지는 않는다. */}
          <motion.span
            ref={labelRef}
            className={`pointer-events-none absolute inset-y-0 flex items-center whitespace-nowrap font-pixel text-[10px] font-normal ${
              labelRight
              ? "rounded-l-full pl-2 pr-1 text-ink bg-canvas"
              : "-translate-x-full rounded-r-full pl-1 pr-2 text-canvas bg-body"
            }`}
            initial={{ left: "0%" }}
            animate={{ left: `${known ? pct : 0}%` }}
            transition={fillTransition}
          >
            {status}
          </motion.span>
        </div>
      </div>
    </div>
  );
}

const PANEL_ID = "site-gauge-siteinfo"; // 펼침 영역 — 토글 버튼의 aria-controls 대상.

// 관제 탭 최상단 가로 바 — 공정률·무사고를 좌우로 나란히 둔다(사용자 요청).
// 종전에는 우상단 캐러셀 '현황 요약' 안에 상하로 있었고, 그 페이지는 수신 요약과 함께 삭제됐다.
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

  const [open, setOpen] = useState(false); // 현장정보 펼침 — 평시 접힘(바 높이 유지).

  return (
    // py-3(12px) → py-2(8px) — 바를 8px 낮춘다(사용자 요청). 게이지·숫자 크기는 그대로 둔다.
    <section className="overflow-hidden rounded-xl border border-hairline-strong bg-canvas px-6 py-2 dark:border-white/10 dark:bg-surface-dark">
      <div className="flex items-center gap-4">
        {/* 좁은 화면에서는 두 게이지가 바짝 붙어 읽기 어려워 세로로 접는다(md 미만). */}
        <div className="grid min-w-0 flex-1 gap-x-6 gap-y-2 md:grid-cols-2">
          <GaugeRow
            title="공정률"
            status={pStatus}
            value={p.pct}
            fractionDigits={1}
            unit="%"
            unitTight
            note={`경과 ${p.elapsedDays}일 / 총 ${p.totalDays}일`}
            pct={p.pct}
            known={pKnown}
            ariaLabel="현장 공정률"
          />
          <GaugeRow
            title="무사고"
            status={sStatus}
            value={s.days}
            unit="일"
            note={s.reset ? "사고 후 재집계" : "연속 무사고"}
            pct={s.pct}
            known={s.known}
            ariaLabel="무사고 연속 일수"
          />
        </div>
        {/* 펼침 — 현장정보를 이 바 아래로 접었다 편다(사용자 요청). */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={PANEL_ID}
          aria-label={`현장정보 ${open ? "접기" : "펼치기"}`}
          title={`현장정보 ${open ? "접기" : "펼치기"}`}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-hairline px-2 py-1 text-[11px] font-medium text-body transition-colors hover:bg-surface-strong hover:text-ink dark:border-white/10 dark:text-on-dark-soft dark:hover:bg-white/10 dark:hover:text-on-dark"
        >
          현장정보
          <svg
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
      {open && (
        // 6항목을 한 줄로(사용자 요청) — 라벨·값을 나란히 두고 폭이 모자라면 값만 줄인다.
        // 좁은 화면에서는 한 줄에 다 못 넣으므로 접어 내린다(잘라 감추는 것보다 낫다).
        <div
          id={PANEL_ID}
          className="mt-2.5 flex flex-wrap items-baseline gap-x-5 gap-y-1.5 border-t border-hairline pt-2.5 dark:border-white/10"
        >
          {siteInfoRows(siteInfo).map((item) => (
            <div key={item.label} className="flex min-w-0 items-baseline gap-1.5">
              <span className="shrink-0 text-[10px] leading-none text-body dark:text-on-dark-soft">
                {item.label}
              </span>
              <span className="truncate text-[13px] font-semibold leading-none text-ink dark:text-on-dark">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// 마지막 vital 수신 시점으로부터 경과시간 → 신호 강도 0~4
// 폰 polling 주기 5초 기준. 8s 내 = full, 60s 이상 = no signal
//
// ★ 사다리 전체를 문턱에 비례해 늘린다 — 칸의 의미는 절대 초가 아니라 "문턱까지의 몫"이다.
//   바닥칸(0 = 무신호)만 문턱에 맞추고 위 칸을 60초 기준으로 두면, 갤럭시(150초 문턱)가
//   정상 주기 안에서도 1칸에 눌러앉아 신호 막대가 늘 "약함"으로 보인다.
//   애플·구 데이터는 배율 1 이라 **종전과 완전히 같은 값**이다.
function signalLevel(sample: VitalSample | undefined, nowMs: number): 0 | 1 | 2 | 3 | 4 {
  if (!sample) return 0;
  const ageMs = vitalAgeMs(sample, nowMs);
  const scale = staleThresholdMs(sample.dataOrigin) / STALE_MS_DEFAULT;
  if (ageMs < 8_000 * scale) return 4;
  if (ageMs < 15_000 * scale) return 3;
  if (ageMs < 30_000 * scale) return 2;
  if (ageMs < 60_000 * scale) return 1;
  return 0;
}

// 마지막 생체 수신 후 문턱 초과 = "연결끊김". sticky merge 가 직전 실측값을 유지하므로,
// 이 판정 없이는 폰/워치가 끊겨도 카드가 마지막 정상값을 계속 녹색으로 표시(false-OK).
// 임계는 애플 60초 — 워치는 30초 배칭 전송이라 정상 상태에서도 ts 가 최대 ~30초 묵을 수 있어,
// 30초 임계면 매 flush 직전 "연결끊김"으로 깜빡(오탐). 60초면 정상 배칭은 통과·진짜 끊김만 잡는다.
// ★ 갤럭시는 120초 배칭이라 같은 논리로 150초다 — 문턱 정의와 근거는 lib/vital-age.ts.
// signalLevel 과 동일 기준: 행은 sample 존재 + signal===0(≥문턱), 보드는 isStale 로 판정.
//
// ★ 나이는 vitalAgeMs(심박 측정 시각)로 잰다 — 행 ts 는 활동에너지가 갱신해 못 쓴다(위 주석).
// 워치가 마지막 실측 후 30초까지 하트비트로 값을 복사하므로(WatchStreamer heartbeatMaxAge),
// 실제 미착용 감지는 30 + 60 = 약 90초다. 착용 중 심박 공백은 실측 p99 9.5초라 오탐은 드물다.
function isStale(sample: VitalSample | undefined, nowMs: number): boolean {
  if (!sample) return false; // 샘플 자체가 없으면 "대기"(idle), 끊김 아님
  return vitalAgeMs(sample, nowMs) > staleThresholdMs(sample.dataOrigin);
}

// ⚠ 이름은 **표시**만 바꾼다 — 상태(stale·signal·overall)는 이 함수를 안 거친다.
//   폴백 이름이 떴다고 수신 중인 것이 아니므로, 상태 셀은 그대로 `대기`·`연결끊김` 이어야 한다.
function workerHeading(
  sample: VitalSample | undefined,
  fallbackId: string,
  /** 서버가 준 최빈 이름 — 링 버퍼 밖이라 sample 이 없을 때만 쓴다(2026-08-19). */
  nameFallback?: string,
) {
  const name = sample?.workerName?.trim() || nameFallback?.trim();
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

// 충격 판정 행 색 — 색 ③(미경보 무채 · 확인 열림 앰버 · 실경보 빨강 · 2026-08-31 사용자 결정).
// 지나간 판정 기록이라 어느 톤이든 블링크(vital-blink-*)는 붙이지 않는다 — 경보 피로.
const IMPACT_TONE: Record<ImpactRowView["tone"], { chip: string; text: string }> = {
  neutral: {
    chip: "bg-surface-strong text-body dark:bg-white/10 dark:text-on-dark-soft",
    text: "text-muted dark:text-on-dark-soft",
  },
  caution: {
    chip: "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
    text: "text-body dark:text-on-dark-soft",
  },
  danger: {
    chip: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300",
    text: "text-red-600 dark:text-red-400",
  },
};

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
  /** 종료 날짜(YYYY-MM-DD). 없으면 하루짜리. */
  endDateKey?: string;
  /** 일정 메모(자유 텍스트). */
  note?: string;
  // 위험작업 유형(calendar-hazard 5종) — 기상 예보와 충돌 시 경고 표시.
  hazardType?: string;
  // 등록자(서버 세션 username) — 서버가 최초 등록 시 저장, 클라는 표시만.
  createdBy?: string;
  // 마지막 수정 시각(ISO) — 서버가 갱신 시에만 채운다. 없으면 등록 후 수정 이력 없음.
  updatedAt?: string;
  // 수정·삭제 가능 여부 — **서버 판정을 받아쓰기만 한다**. 화면이 같은 규칙(작성자·총괄)을
  // 다시 구현하면 언젠가 어긋나고, 그때 사용자는 "버튼은 있는데 눌러도 안 된다"를 겪는다.
  canEdit?: boolean;
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
/** 미확인 새 현장 사진 — 탭 배지와 미니 달력 아래 미확인 리스트가 공유하는 최소 정보. */
type CalendarUnseenMedia = {
  id: string;
  dateKey: string;
  capturedAt: string | null;
  mediaType: string;
  title: string | null;
  uploader: string | null;
  thumbnailUrl: string | null;
  /** 썸네일이 없을 때의 폴백 — 사이드바(4207행 부근)와 같은 규칙. 영상이면 img 에 못 넣으니 아이콘. */
  mediaUrl: string | null;
};

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
  /**
   * 각인 좌표와 같은 시각 생체 좌표의 거리(m) — 서버가 조회 시점에 계산한다. null = 대조 불가.
   * 실측된 어긋남 = 08-19 **5,239m** · 08-20 336m(지하 촬영). 각인은 이미지에 구워져 못 고치지만
   * 그 시각 생체 좌표는 정확도 10m 짜리였다 — 화면이 그 사실을 밝힌다.
   */
  coordGapM: number | null;
  /** 대조에 쓴 생체 좌표의 정확도(m). null = 미보고. */
  coordRefAccuracyM: number | null;
  // 서버가 계산한 삭제 가능 여부 — 화면이 권한 규칙을 다시 구현하지 않는다(단일 소스).
  canDelete: boolean;
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
      endDateKey: typeof r.end_date_key === "string" ? r.end_date_key : undefined,
      note: typeof r.note === "string" ? r.note : undefined,
      hazardType: typeof r.hazard_type === "string" ? r.hazard_type : undefined,
      createdBy: typeof r.created_by === "string" ? r.created_by : undefined,
      updatedAt: typeof r.updated_at === "string" ? r.updated_at : undefined,
      // 서버가 안 내려주면 감춘다 — 모르면 버튼을 보이지 않는 쪽이 안전하다.
      canEdit: r.canEdit === true,
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
        endDateKey: typeof e.endDateKey === "string" ? e.endDateKey : undefined,
        note: typeof e.note === "string" ? e.note : undefined,
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

// 날짜 입력(type=date)은 비우면 "" 가 오므로 저장 전에 형식을 확인한다(서버 검증과 동일 형식).
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// dateKey → 로컬 Date. new Date("2026-07-31") 은 UTC 로 해석돼 KST 에서 하루 밀리므로 직접 조립한다.
function dateFromKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
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
  const rows: Array<[string, string, boolean?, boolean?]> = [];   // [라벨, 값, 등폭, 경고]
  if (capturedLabel) rows.push(["촬영 시각", capturedLabel]);
  if (roadAddress) rows.push(["도로명 주소", roadAddress]);
  if (gpsLabel) rows.push(["GPS 좌표", gpsLabel, true]);
  // 각인 좌표 신뢰도 — 같은 시각 생체 좌표와의 거리. 각인 값을 덮어쓰지 않고 **밝힌다**.
  // ★ 임계는 새로 만들지 않고 관제 반경(SITE_RADIUS_MAX_M)을 쓴다. 그 거리를 넘으면 두
  //   좌표가 "같은 현장인가" 에서 갈린다 — 임계의 뜻이 이미 정의된 유일한 숫자다.
  if (media.coordGapM != null) {
    const acc = media.coordRefAccuracyM;
    const wide = media.coordGapM > SITE_RADIUS_MAX_M;
    rows.push([
      "좌표 대조",
      `생체 좌표와 ${media.coordGapM.toLocaleString()}m 차이` +
        (acc != null ? ` (생체 정확도 ±${Math.round(acc)}m)` : "") +
        (wide ? " — 각인 좌표 신뢰도 낮음" : ""),
      true,
      wide,
    ]);
  }
  if (workerLabel) rows.push(["작업자", workerLabel]);

  return (
    <div className={wrapCls}>
      {rows.length > 0 && (
        <dl className="space-y-0.5 text-[11px] leading-relaxed">
          {rows.map(([label, value, mono, warn]) => (
            <div key={label} className="flex gap-1.5">
              <dt className={`w-16 shrink-0 font-semibold ${labelCls}`}>{label}</dt>
              <dd
                className={`${mono ? "tabular-nums " : ""}${
                  warn ? (dark ? "text-amber-300" : "text-amber-600 dark:text-amber-300") : valueCls
                }`}
              >
                {value}
              </dd>
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

// 마지막 수정 시각 표시 — 서버는 갱신 시에만 updated_at 을 채우므로 없으면 수정 이력이 없다.
// 형식이 깨진 값은 표시하지 않는다("Invalid Date" 노출 방지).
function formatScheduleEdited(updatedAt: string | undefined): string {
  if (!updatedAt) return "";
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return "";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `수정 ${m}/${day} ${hh}:${mm}`;
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

/** 사이드바에서 초점을 받은 일정의 상세. 미디어 카드의 `dl` 표와 같은 관례를 쓴다.
 *  칩은 제목·시각만 보여주므로, 클릭으로 얻는 것이 있어야 클릭에 의미가 생긴다. */
function ScheduleDetail({ event, labels }: { event: CalendarEvent; labels: ScheduleLabelDef[] }) {
  const rows: Array<[string, string]> = [];
  // 날짜 — 기간이면 시작~종료. 하루짜리는 이미 선택 날짜라 굳이 반복하지 않는다.
  if (isSpanEvent(event)) rows.push(["기간", `${event.dateKey} ~ ${event.endDateKey ?? event.dateKey}`]);
  // 시각 — `start_time` 이 NULL 인 것이 곧 종일이다(스키마상 별도 컬럼이 없다).
  rows.push(["시각", formatScheduleTime(event) || "종일"]);
  rows.push(["라벨", findLabelDef(labels, event.labelId).name]);
  // ⚠ `hazardTypeName` 은 모르는 id 에 null 을 낸다. 그때 행을 빼면 값이 조용히 사라지므로
  //   원본 id 를 그대로 보인다(`findLabelDef` 가 "삭제된 라벨" 을 보이는 것과 같은 관례).
  if (event.hazardType) rows.push(["위험작업", hazardTypeName(event.hazardType) ?? event.hazardType]);
  const edited = formatScheduleEdited(event.updatedAt);
  if (event.createdBy || edited) {
    rows.push(["등록", [event.createdBy, edited].filter(Boolean).join(" · ")]);
  }
  return (
    <div className="mt-1 rounded-md bg-surface-soft px-2 py-1.5 dark:bg-surface-dark-elevated">
      <dl className="space-y-0.5 text-[11px] leading-relaxed">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-1.5">
            <dt className="w-14 shrink-0 text-muted dark:text-on-dark-soft">{label}</dt>
            <dd className="min-w-0 flex-1 break-words text-ink dark:text-on-dark">{value}</dd>
          </div>
        ))}
      </dl>
      {/* 메모는 자유 텍스트라 표 밖에 둔다 — 줄바꿈을 살려야 읽힌다. */}
      {event.note?.trim() && (
        <p className="mt-1 whitespace-pre-wrap border-t border-hairline pt-1 text-[11px] leading-relaxed text-ink dark:border-white/10 dark:text-on-dark">
          {event.note.trim()}
        </p>
      )}
    </div>
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

/** 일정 폼의 "지금 값" 묶음 — 저장 버튼의 변경 여부(dirty) 판정에만 쓴다.
 *  ★ 새 입력 필드를 추가하면 여기에도 넣어야 한다. 빠뜨리면 그 필드만 고쳤을 때
 *    버튼이 잠긴 채로 남아 저장할 수 없다(폼 상태·payload·복원과 한 벌). */
type ScheduleFormValues = {
  title: string;
  labelId: string;
  startTime: string;
  endTime: string;
  hazardType: string;
  dateDraft: string;
  endDateDraft: string;
  note: string;
  allDay: boolean;
};
const scheduleFormSignature = (v: ScheduleFormValues) => JSON.stringify(v);

function ScheduleEventFormModal({
  floating = false,
  dateKey,
  events,
  labels,
  labelsCanEdit,
  initialEditId,
  onLabelsChange,
  onAdd,
  onUpdate,
  onClose,
}: {
  // 모달이 열린 기준 날짜 — 신규 등록의 기본값이자 편집 취소 시 되돌아갈 값.
  dateKey: string;
  events: CalendarEvent[];
  labels: ScheduleLabelDef[];
  // 라벨 편집(전체교체)은 총괄 관리자 전용 — 서버 판정을 받아쓴다.
  labelsCanEdit: boolean;
  // 사이드바 연필로 열렸을 때 처음부터 편집 상태로 채울 대상.
  initialEditId: string | null;
  onLabelsChange: (labels: ScheduleLabelDef[]) => void;
  onAdd: (event: Omit<CalendarEvent, "id" | "dateKey">, dateKey: string) => void;
  onUpdate: (id: string, event: Omit<CalendarEvent, "id" | "dateKey">, dateKey: string) => void;
  onClose: () => void;
  /** 탭(inline)에서 body 로 포털돼 뜨는가. 그때는 fixed + 높은 z 를 쓴다. */
  floating?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [labelId, setLabelId] = useState<string>(labels[0]?.id ?? "");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  // 위험작업 유형 — "" = 없음(일반 일정).
  const [hazardType, setHazardType] = useState("");
  // 저장될 날짜 — 수정 시 다른 날로 옮길 수 있다. 신규는 모달을 연 날짜에서 시작.
  const [dateDraft, setDateDraft] = useState(dateKey);
  // 종료 날짜(여러 날 일정). 빈 값·시작과 같으면 하루짜리다.
  const [endDateDraft, setEndDateDraft] = useState("");
  const [note, setNote] = useState("");
  // 종일 일정 — 시각을 안 싣는다. 스키마상 `start_time` NULL 이 곧 종일이라 새 컬럼이 필요 없다.
  const [allDay, setAllDay] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelEditOpen, setLabelEditOpen] = useState(false);
  // 편집을 닫은 직후 잠깐 초록 체크(확대→복귀 팝)를 보여주는 상태 — 0.7초 뒤 + 버튼으로 복귀.
  const [labelSavedFlash, setLabelSavedFlash] = useState(false);
  useEffect(() => {
    if (!labelSavedFlash) return;
    const t = setTimeout(() => setLabelSavedFlash(false), 700);
    return () => clearTimeout(t);
  }, [labelSavedFlash]);

  // 변경 여부 기준선 — 폼을 채우는 두 자리(resetForm·startEdit)에서만 갱신한다.
  // 지금 값이 이것과 같으면 "바뀐 게 없다" → 저장 버튼을 반투명으로 잠근다.
  const baselineRef = useRef(
    scheduleFormSignature({
      title: "",
      labelId: labels[0]?.id ?? "",
      startTime: "",
      endTime: "",
      hazardType: "",
      dateDraft: dateKey,
      endDateDraft: "",
      note: "",
      allDay: false,
    }),
  );
  // 저장 직후 초록 체크(확대→복귀)를 보여주는 구간 — 그다음 창을 닫는다.
  const [submitFlash, setSubmitFlash] = useState(false);
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
    },
    [],
  );

  const resetForm = useCallback(() => {
    setTitle("");
    setLabelId(labels[0]?.id ?? "");
    setStartTime("");
    setEndTime("");
    setEndDateDraft("");
    setNote("");
    setAllDay(false);
    setHazardType("");
    setDateDraft(dateKey);
    setEditingId(null);
    baselineRef.current = scheduleFormSignature({
      title: "",
      labelId: labels[0]?.id ?? "",
      startTime: "",
      endTime: "",
      hazardType: "",
      dateDraft: dateKey,
      endDateDraft: "",
      note: "",
      allDay: false,
    });
  }, [labels, dateKey]);

  const startEdit = useCallback(
    (event: CalendarEvent) => {
      setEditingId(event.id);
      setTitle(event.title);
      setLabelId(labels.some((l) => l.id === event.labelId) ? event.labelId : labels[0]?.id ?? "");
      setStartTime(event.startTime ?? "");
      setEndTime(event.endTime ?? "");
      setHazardType(event.hazardType ?? "");
      setDateDraft(event.dateKey);
      // ⚠ 수정 시 기존 값을 안 채우면 **저장할 때마다 지워진다** — 새 필드를 넣을 때마다
      //   여기도 함께 채워야 한다(폼 상태 → 저장 payload → 이 복원, 셋이 한 벌이다).
      setEndDateDraft(event.endDateKey ?? "");
      setNote(event.note ?? "");
      setAllDay(!event.startTime);
      baselineRef.current = scheduleFormSignature({
        title: event.title,
        labelId: labels.some((l) => l.id === event.labelId) ? event.labelId : labels[0]?.id ?? "",
        startTime: event.startTime ?? "",
        endTime: event.endTime ?? "",
        hazardType: event.hazardType ?? "",
        dateDraft: event.dateKey,
        endDateDraft: event.endDateKey ?? "",
        note: event.note ?? "",
        allDay: !event.startTime,
      });
    },
    [labels],
  );

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

  // 목록의 [수정] 으로 열린 경우 — 대상 일정으로 폼을 채운 상태로 시작한다.
  const appliedInitialRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialEditId || appliedInitialRef.current === initialEditId) return;
    const target = events.find((e) => e.id === initialEditId);
    if (!target) return;
    appliedInitialRef.current = initialEditId;
    startEdit(target);
  }, [initialEditId, events, startEdit]);

  // 편집 중이던 일정이 목록에서 사라지면(삭제 확정) 폼을 되돌린다 — 지워진 대상에 저장하지 않는다.
  useEffect(() => {
    if (editingId && !events.some((e) => e.id === editingId)) resetForm();
  }, [events, editingId, resetForm]);

  const handleSubmit = () => {
    const trimmed = title.trim();
    if (!trimmed || !labelId || !DATE_KEY_RE.test(dateDraft)) return;
    const draft = {
      title: trimmed,
      labelId,
      // 종일이면 시각을 싣지 않는다 — `start_time` 이 없으면 화면이 종일 일정으로 그린다.
      startTime: allDay ? undefined : startTime.trim() || undefined,
      endTime: allDay ? undefined : endTime.trim() || undefined,
      // 종료일이 시작보다 빠르면 안 싣는다 — 서버도 400 으로 막지만, 여기서 먼저 거른다.
      endDateKey:
        endDateDraft && DATE_KEY_RE.test(endDateDraft) && endDateDraft > dateDraft
          ? endDateDraft
          : undefined,
      note: note.trim() || undefined,
      hazardType: hazardType || undefined,
    };
    if (editingId) {
      onUpdate(editingId, draft, dateDraft);
    } else {
      onAdd(draft, dateDraft);
    }
    // 저장은 이미 끝났다 — 화면만 초록 체크로 바꿔 "됐다"를 보여주고 잠깐 뒤 닫는다.
    // ★ 저장을 지연시키지 않는다. 애니메이션 중 사용자가 X 로 닫아도 데이터는 이미 갔다.
    setSubmitFlash(true);
    submitTimerRef.current = setTimeout(() => {
      resetForm();
      // 등록·수정을 마치면 닫는다(사용자 요청 2026-08-20). 종전엔 폼만 비우고 열려 있어
      // "저장이 됐나" 를 화면으로 확인할 수 없었다.
      onClose();
    }, 620);
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
      // ⚠ 탭(inline)에서는 **fixed + 포털**이어야 한다. `absolute` 는 기준 조상이 팝업 패널일 때만
      //   맞는데, 탭에서는 그 패널이 없어 엉뚱한 곳에 낮은 z 로 그려져 **눌러도 안 보인다**
      //   (사용자 실측 2026-08-20 — `+ 일정 추가` 무반응).
      className={
        floating
          ? "fixed inset-0 z-[75] flex items-end justify-center bg-black/40 p-3 sm:items-center"
          : "absolute inset-0 z-10 flex items-end justify-center bg-black/30 p-3 sm:items-center"
      }
      // ⚠ 바깥(배경) 클릭으로 닫지 않는다(2026-08-27 사용자 결정) — 입력·수정 중인 내용이
      //   오클릭 한 번에 통째로 날아가고 되돌릴 수단이 없다. 닫기는 우상단 X 와 ESC 로만.
      role="dialog"
      aria-modal="true"
      aria-label="일정 등록"
    >
      <div
        // ⚠ 폭 제한이 필요하다 — 팝업에서는 580px 패널이 폭을 잡아 줬지만, 탭에서는 전체화면
        //   포털이라 제한이 없어 **화면을 통째로 덮었다**(사용자 실측 2026-08-20).
        //   세로형 직사각형으로 — 입력이 한 열이라 폭이 넓어도 얻는 게 없다.
        className={`wx-cards-scroll w-full overflow-y-auto rounded-2xl border border-hairline-strong bg-canvas dark:border-white/10 dark:bg-surface-dark ${
          floating ? "max-h-[85vh] max-w-[26rem]" : "max-h-[85%]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3 dark:border-white/10">
          <p className="text-sm font-bold text-ink dark:text-on-dark">
            {editingId ? "일정 수정" : "일정 등록"}
          </p>
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
                      {formatScheduleEdited(event.updatedAt) && (
                        <span className="text-[9px] text-muted dark:text-on-dark-soft">
                          {formatScheduleEdited(event.updatedAt)}
                        </span>
                      )}
                    </div>
                    <CalendarEventChip event={event} color={findLabelDef(labels, event.labelId).color} />
                  </div>
                  {/* 수정·삭제 버튼은 두지 않는다(2026-08-27 사용자 결정) — 이 모달은 사이드바 연필로
                      열리는 순간 이미 그 일정을 편집 중이라 [수정]이 같은 값을 다시 싣는 무동작이었고,
                      수정·삭제는 사이드바 카드의 연필·휴지통에 이미 있다. 여기는 읽기용 목록이다. */}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-4 px-4 py-3">
          {/* 애플 캘린더식 그룹 카드(2026-08-20 사용자 요청) — 제목 → 일시 → 옵션 → 세부사항.
              ⚠ 항목은 우리가 가진 것만 쓴다. 위치·초대·알림·이동시간·첨부·URL 은 컬럼 자체가
                없어서 넣지 않았다(넣으려면 각각 DB·API·화면 네 층이 필요하다). */}
          <div className="overflow-hidden rounded-2xl border border-hairline bg-surface-soft p-3 dark:border-white/10 dark:bg-surface-dark-elevated">
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
          </div>

          <p className="px-1 text-[11px] font-semibold text-muted dark:text-on-dark-soft">일시</p>
          <div className="overflow-hidden rounded-2xl border border-hairline bg-surface-soft space-y-3 p-3 dark:border-white/10 dark:bg-surface-dark-elevated">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-muted dark:text-on-dark-soft">
              일정 날짜
            </label>
            <input
              type="date"
              value={dateDraft}
              onChange={(e) => setDateDraft(e.target.value)}
              className="w-full rounded-lg border border-hairline bg-surface-soft px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-ink/20 dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-muted dark:text-on-dark-soft">
              종료 날짜 <span className="font-normal">— 여러 날 일정일 때만</span>
            </label>
            <input
              type="date"
              value={endDateDraft}
              min={dateDraft}
              onChange={(e) => setEndDateDraft(e.target.value)}
              className="w-full rounded-lg border border-hairline bg-surface-soft px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-ink/20 dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark"
            />
            {/* ⚠ 거꾸로 된 기간은 저장하지 않는다 — 받아 두면 화면이 음수 길이 띠를 그리려다 사라진다. */}
            {endDateDraft && endDateDraft < dateDraft && (
              <p className="mt-1 text-[11px] font-semibold text-semantic-down">
                종료일이 시작일보다 빠릅니다 — 이대로 저장하면 하루 일정이 됩니다.
              </p>
            )}
          </div>
          </div>

          <p className="px-1 text-[11px] font-semibold text-muted dark:text-on-dark-soft">옵션</p>
          <div className="overflow-hidden rounded-2xl border border-hairline bg-surface-soft space-y-3 p-3 dark:border-white/10 dark:bg-surface-dark-elevated">

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-semibold text-muted dark:text-on-dark-soft">일정 라벨</p>
              {labelsCanEdit && (
                // 원 노드 3상태 — 닫힘: 진한 검정 + · 열림: 진한 검정 체크(=완료) ·
                // 완료 직후 0.7초: 초록 체크가 확대→복귀 팝(label-saved-pop) 후 + 로 복귀.
                <button
                  type="button"
                  onClick={() => {
                    if (labelEditOpen) {
                      setLabelEditOpen(false);
                      setLabelSavedFlash(true);
                    } else {
                      setLabelSavedFlash(false);
                      setLabelEditOpen(true);
                    }
                  }}
                  className="grid h-6 w-6 place-items-center rounded-full border border-hairline bg-canvas transition hover:bg-surface-strong dark:border-white/15 dark:bg-surface-dark dark:hover:bg-white/10"
                  aria-expanded={labelEditOpen}
                  aria-label={labelEditOpen ? "편집 완료" : "라벨 편집"}
                  title={labelEditOpen ? "편집 완료" : "라벨 편집"}
                >
                  {labelEditOpen ? (
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-ink dark:text-on-dark">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : labelSavedFlash ? (
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="label-saved-pop text-semantic-up">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true" className="text-ink dark:text-on-dark">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  )}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {labels.map((l) => (
                <label
                  key={l.id}
                  className={[
                    "group relative flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition",
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
                  {/* 호버 삭제 노드 — 칩 우상단 빈 원 + x. 권한자에게만, 마지막 1개는 못 지운다.
                      ⚠ label 안의 버튼이라 preventDefault 로 라디오 선택(label 기본 동작)을 막아야 한다.
                      ⚠ 선택 중인 라벨을 지우면 labelId 가 허공을 가리키므로 남는 라벨로 옮겨 준다. */}
                  {labelsCanEdit && labels.length > 1 && (
                    <button
                      type="button"
                      aria-label={`라벨 삭제: ${l.name.trim() || "(이름 없음)"}`}
                      title="라벨 삭제"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (labelId === l.id) setLabelId(labels.find((x) => x.id !== l.id)?.id ?? "");
                        removeLabel(l.id);
                      }}
                      className="absolute -right-1.5 -top-1.5 z-10 grid h-4 w-4 place-items-center rounded-full border border-hairline bg-canvas text-red-600 opacity-0 shadow-sm transition group-hover:opacity-100 focus-visible:opacity-100 dark:border-white/15 dark:bg-surface-dark dark:text-red-400"
                    >
                      <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  )}
                </label>
              ))}
            </div>

            {/* 라벨 편집 패널 — 열고 닫을 때 스르륵(grid-rows 0fr↔1fr 트랜지션).
                ⚠ max-height 방식이 아니라 grid-rows 인 이유: 내용 높이(라벨 수)를 몰라도 동작한다.
                ⚠ 조건부 언마운트가 아니라 상시 마운트 — 언마운트면 닫힘 애니메이션이 없다.
                  닫힘 상태의 포커스·클릭은 inert 가 막는다(React 19). */}
            <div
              className={[
                "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
                labelEditOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              ].join(" ")}
              inert={!labelEditOpen}
              aria-hidden={!labelEditOpen}
            >
              <div className="overflow-hidden">
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
                        aria-label="라벨 삭제"
                        title="라벨 삭제"
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-hairline bg-canvas text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:bg-surface-dark dark:text-red-400 dark:hover:bg-red-500/10"
                      >
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
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
              </div>
            </div>
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
          </div>

          <p className="px-1 text-[11px] font-semibold text-muted dark:text-on-dark-soft">시간</p>
          <div className="overflow-hidden rounded-2xl border border-hairline bg-surface-soft space-y-3 p-3 dark:border-white/10 dark:bg-surface-dark-elevated">

          {/* 종일 — 켜면 시각을 안 싣는다(스키마상 start_time NULL 이 곧 종일이라 새 컬럼이 없다).
              ⚠ 입력을 감추지 않고 **비활성화**한다 — 감추면 켜고 끌 때 카드 높이가 튀고,
                이미 넣어 둔 시각이 사라진 것처럼 보인다. */}
          <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg bg-canvas px-3 py-2 dark:bg-surface-dark">
            <span className="text-sm font-semibold text-ink dark:text-on-dark">종일</span>
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="h-4 w-4 accent-[color:var(--color-primary,#0d74ce)]"
              aria-label="종일 일정"
            />
          </label>

          <div className={allDay ? "pointer-events-none opacity-40" : undefined} aria-disabled={allDay}>
            <label className="mb-1.5 block text-[11px] font-semibold text-muted dark:text-on-dark-soft">
              시작 시간 (선택)
            </label>
            <ScheduleTimePicker value={startTime} onChange={setStartTime} />
          </div>

          <div className={allDay ? "pointer-events-none opacity-40" : undefined} aria-disabled={allDay}>
            <label className="mb-1.5 block text-[11px] font-semibold text-muted dark:text-on-dark-soft">
              종료 시간 (선택)
            </label>
            <ScheduleTimePicker value={endTime} onChange={setEndTime} />
          </div>
          </div>

          <p className="px-1 text-[11px] font-semibold text-muted dark:text-on-dark-soft">세부사항</p>
          <div className="overflow-hidden rounded-2xl border border-hairline bg-surface-soft space-y-3 p-3 dark:border-white/10 dark:bg-surface-dark-elevated">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-muted dark:text-on-dark-soft">
              메모 <span className="font-normal">— 최대 2000자</span>
            </label>
            <textarea
              value={note}
              maxLength={2000}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
              placeholder="작업 내용·유의사항 등"
              className="w-full resize-y rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-ink/20 dark:border-white/10 dark:bg-surface-dark dark:text-on-dark"
            />
          </div>
          </div>
        </div>

        {/* 하단은 저장 하나만 둔다(2026-08-27 사용자 결정) — [닫기]는 우상단 X 와 중복이고,
            [수정 취소]도 닫으면 어차피 편집이 풀리므로 같은 일을 두 번 말하던 버튼이었다. */}
        <div className="flex justify-end gap-2 border-t border-hairline px-4 py-3 dark:border-white/10">
          {/* 저장 버튼 — 3상태(2026-08-27 사용자 결정).
              ① 바뀐 게 없거나 필수값 미충족 → 반투명(잠김)  ② 변경 발생 → 불투명
              ③ 누르면 초록 체크가 살짝 커졌다 돌아온 뒤 창이 닫힌다.
              수정 모드는 흰 배경 + 검은 테두리, 신규 등록은 기존 파란 CTA 를 유지한다. */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              submitFlash ||
              !title.trim() ||
              !DATE_KEY_RE.test(dateDraft) ||
              scheduleFormSignature({
                title,
                labelId,
                startTime,
                endTime,
                hazardType,
                dateDraft,
                endDateDraft,
                note,
                allDay,
              }) === baselineRef.current
            }
            className={[
              "grid min-w-[4.5rem] place-items-center rounded-lg px-4 py-1.5 text-sm font-semibold transition",
              "disabled:cursor-not-allowed disabled:opacity-40",
              editingId
                ? "border border-ink bg-canvas text-ink hover:bg-surface-strong dark:border-white/70 dark:bg-surface-dark dark:text-on-dark dark:hover:bg-white/10"
                : "bg-primary text-on-primary hover:bg-primary-active",
            ].join(" ")}
          >
            {submitFlash ? (
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="label-saved-pop text-semantic-up"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : editingId ? (
              "수정"
            ) : (
              "일정 추가"
            )}
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

// 일정 캘린더. 두 자리에서 같은 화면을 쓴다 —
//   variant="popup"(기본)  헤더 아이콘으로 여는 떠 있는 패널. 드래그·닫기 있음.
//   variant="inline"       탭 본문. 페이지가 곧 캘린더라 오버레이·드래그·닫기가 없다.
// ★ 본문을 복제하지 않고 감싸는 껍데기만 가른다 — 두 벌이면 한쪽만 고쳐 화면이 갈린다.
// ── 주간 일정표 · 미니 월간 (2026-08-20 · 구글 캘린더 참고) ──────────────────────
// 근거·결정 = docs/calendar-week-view/context-notes.md
//   · 시간 범위 **00~24시**(2026-08-20 사용자 결정 — 야간·새벽 업무 가능성을 열어둔다).
//     ⚠ 종전 07~19시는 현장 일정 표본만 보고 정한 값이라, 그 밖의 시각은 **조용히 안 보였다.**
//       실제로 08-19 23:38 촬영분이 창 밖이라 격자에서 사라져 있었다. 범위를 좁히는 것은
//       "그 시간엔 일이 없다"는 주장이고, 그건 우리가 증명 못 한다.
//     대신 첫 렌더에서 07시로 스크롤한다 — 24시간을 다 보여주되 눈은 주간 근무대에 둔다.
//   · `end_time` 이 없을 수 있다(실측 50%) → 기본 1시간 블록으로 그린다.
//   · 사진은 **하루 단위로 묶어 종일 띠**에 둔다. 시간 단위로 묶으면 56%가 "1건" 이라
//     묶는 의미가 없고, 하루 묶음은 시각이 없어 어느 시간 칸에도 못 놓는다.
const WEEK_START_HOUR = 0;
const WEEK_END_HOUR = 24;
const WEEK_HOUR_PX = 44;

/** `HH:MM` → 분. 형식이 아니면 null(문자열 컬럼이라 방어한다). */
function hhmmToMinutes(v: string | undefined | null): number | null {
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 여러 날 일정인가. `endDateKey` 가 있고 시작보다 뒤면 참. */
function isSpanEvent(e: CalendarEvent): boolean {
  return !!e.endDateKey && e.endDateKey > e.dateKey;
}

/**
 * 주(7일) 안에서 이 일정이 차지하는 구간. 걸치지 않으면 null.
 * ★ 주 경계에서 자른다 — 구글 캘린더처럼 주가 바뀌면 띠가 두 줄로 쪼개진다.
 * `startIdx`/`endIdx` 는 0~6, `openStart`/`openEnd` 는 이 주 밖으로 이어지는지(화살표 표시용).
 */
function spanInWeek(
  e: CalendarEvent,
  weekKeys: string[],
): { startIdx: number; endIdx: number; openStart: boolean; openEnd: boolean } | null {
  const first = weekKeys[0];
  const last = weekKeys[weekKeys.length - 1];
  if (!first || !last) return null;
  const s0 = e.dateKey;
  const s1 = e.endDateKey && e.endDateKey > e.dateKey ? e.endDateKey : e.dateKey;
  if (s1 < first || s0 > last) return null; // 이 주와 안 겹친다
  let startIdx = weekKeys.indexOf(s0);
  let endIdx = weekKeys.indexOf(s1);
  const openStart = startIdx < 0;
  const openEnd = endIdx < 0;
  if (openStart) startIdx = 0;
  if (openEnd) endIdx = weekKeys.length - 1;
  return { startIdx, endIdx, openStart, openEnd };
}

/** 촬영 시각(ISO) → 분. 표시 코드와 같은 관례(`slice(11,16)`)를 쓴다. 못 읽으면 null. */
function mediaMinutes(m: CalendarMedia): number | null {
  return hhmmToMinutes(m.capturedAt?.slice(11, 16));
}

/** 그 날짜에 걸치는 일정 전부 — 그 날 시작한 것 **+ 기간 일정이 덮는 것**.
 *  ⚠⚠ `eventsByDate[key]` 만 보면 기간 일정이 **시작일 키에만** 있어 걸친 날에서 빠진다.
 *     이 레포가 같은 자리를 세 번 밟았다(사이드바 목록 · 미니 월간 밑줄 · 초점 유지 · 2026-08-20).
 *     그래서 규칙을 여기 한 곳에 두고 부르는 쪽이 공유한다. */
function eventsOnDate(eventsByDate: Record<string, CalendarEvent[]>, key: string): CalendarEvent[] {
  const own = eventsByDate[key] ?? [];
  const seen = new Set(own.map((e) => e.id));
  const covering = Object.values(eventsByDate)
    .flat()
    .filter((e) => isSpanEvent(e) && !seen.has(e.id) && e.dateKey <= key && (e.endDateKey ?? e.dateKey) >= key)
    .filter((e, i, arr) => arr.findIndex((y) => y.id === e.id) === i);
  return [...own, ...covering];
}

/** 그 시간 칸을 이미 차지한 일정. 없으면 null(= 등록 폼을 열어도 되는 칸).
 *  규칙(사용자 지시 2026-08-20) — **시각이 없는 일정(종일·기간)은 그 날 전체를 차지한다.**
 *  시각이 있으면 `[시작, 끝)` 만. 끝이 없으면 격자 렌더와 같은 관례로 1시간.
 *  ⚠ 시각 있는 쪽을 먼저 고른다 — 그 칸을 더 구체적으로 가리키는 일정이 사이드바에 떠야 한다. */
function eventOccupyingSlot(dayEvents: CalendarEvent[], hour: number): CalendarEvent | null {
  const slotStart = hour * 60;
  const slotEnd = slotStart + 60;
  const timed = dayEvents.find((e) => {
    const s = hhmmToMinutes(e.startTime);
    if (s === null) return false;
    const en = hhmmToMinutes(e.endTime);
    const end = en !== null && en > s ? en : s + 60;
    return s < slotEnd && end > slotStart;
  });
  if (timed) return timed;
  return dayEvents.find((e) => hhmmToMinutes(e.startTime) === null) ?? null;
}

function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay()); // 일요일 시작 — 월간 격자와 같은 규칙
  return x;
}

/** 미니 월간 — 날짜 이동 전용. 일정 칩·날씨·배지는 일부러 안 그린다(주간 격자가 그 역할). */
/** 미니 월간의 기간 표시 한 칸 — 색 + 앞뒤 연속 여부(연속이면 그쪽 끝을 각지게 해 옆 칸과 붙인다). */
type SpanDayMark = { color: LabelColor; contPrev: boolean; contNext: boolean };
/** 날짜키 → **레인별** 표시. 배열 인덱스가 곧 세로 줄 위치이고, 그 날 그 레인이 비면 undefined.
 *  ★ 색으로 뭉치지 않는다 — 일정마다 자기 줄을 갖는다(같은 파란색 두 일정도 두 줄). */
type SpanDayLanes = Map<string, (SpanDayMark | undefined)[]>;
/** 미니 월간에 그릴 최대 줄 수. 넘치는 일정은 메인 「기간」 행에서 본다(미니는 요약 신호다). */
const MINI_SPAN_LANE_MAX = 4;

function MiniMonth({
  viewDate,
  selected,
  today,
  spanDays,
  onSelect,
  onPrev,
  onNext,
}: {
  viewDate: Date;
  selected: Date;
  today: Date;
  /** 기간 일정이 걸친 날짜키 → 레인별 표시. 미니 월간에도 기간이 보이게 한다(사용자 요청 2026-08-20).
   *  2026-08-27: ①칸마다 끊긴 짧은 바 → **날짜 수만큼 이어지는 띠** ②색으로 뭉치지 않고
   *  **일정마다 자기 줄**(메인 「기간」 행이 여러 줄로 쌓는 것과 같은 읽기). */
  spanDays?: SpanDayLanes;
  onSelect: (d: Date) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const lead = new Date(year, month, 1).getDay();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  // 이 달에 필요한 줄 수 — 칸마다 다르면 숫자 높이가 들쭉날쭉해지므로 **달 전체를 같은 줄 수**로 맞춘다.
  const spanLaneCount = Math.min(
    MINI_SPAN_LANE_MAX,
    Math.max(
      0,
      ...cells.map((d) => (d === null ? 0 : (spanDays?.get(toDateKey(new Date(year, month, d)))?.length ?? 0))),
    ),
  );
  return (
    <div className="w-[13.5rem] shrink-0 rounded-xl border border-hairline bg-surface-soft p-2 dark:border-white/10 dark:bg-surface-dark-elevated">
      <div className="mb-1 flex items-center justify-between">
        <button type="button" onClick={onPrev} aria-label="이전 달" className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-surface-strong dark:hover:bg-white/10">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span className="text-[11px] font-bold text-ink dark:text-on-dark">{year}년 {month + 1}월</span>
        <button type="button" onClick={onNext} aria-label="다음 달" className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-surface-strong dark:hover:bg-white/10">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {CALENDAR_WEEKDAYS.map((w, i) => (
          <span key={w} className={`text-center text-[9px] font-semibold ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-600" : "text-muted dark:text-on-dark-soft"}`}>{w}</span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} />;
          const date = new Date(year, month, d);
          const isToday = calendarSameDay(date, today);
          const isSel = calendarSameDay(date, selected);
          // 기간 일정이 걸친 날 — 숫자 아래 얇은 색 막대. 숫자 자체는 안 건드린다(오늘/선택 표시와 겹치지 않게).
          const spanLanes = spanDays?.get(toDateKey(date));
          return (
            <button
              key={d}
              type="button"
              onClick={() => onSelect(date)}
              aria-label={`${year}년 ${month + 1}월 ${d}일${spanLanes?.some(Boolean) ? " · 기간 일정" : ""}`}
              aria-pressed={isSel}
              className="grid place-items-center py-0.5"
            >
              <span
                className={[
                  "grid h-[1.35rem] w-[1.35rem] place-items-center rounded-full text-[10px] tabular-nums transition",
                  // ★ 선택이 오늘보다 우선 — 오늘은 반투명(primary-subtle), 선택은 푸른 채움.
                  //   오늘을 클릭하면 반투명 → 푸른 채움으로 바뀌는 것이 요구 동작(2026-08-27 사용자 결정).
                  isSel
                    ? "bg-primary font-bold text-on-primary"
                    : isToday
                      ? "bg-primary-subtle font-semibold text-primary"
                      : "text-ink hover:bg-surface-strong dark:text-on-dark dark:hover:bg-white/10",
                ].join(" ")}
              >
                {d}
              </span>
              {/* 기간 띠 — **일정마다 한 줄**(레인). 칸 폭 전체라 옆 날과 맞닿아 가로로 이어지고,
                  이어지는 쪽 끝은 각지게·시작/종료 끝만 둥글게(메인 「기간」 행의 openStart/openEnd 규칙).
                  ⚠ 빈 레인도 자리를 남긴다 — 안 남기면 같은 일정의 줄이 날마다 위아래로 흔들린다. */}
              {spanLaneCount > 0 && (
                <span aria-hidden="true" className="mt-[1px] flex w-full flex-col gap-[1px]">
                  {Array.from({ length: spanLaneCount }, (_, lane) => {
                    const mk = spanLanes?.[lane];
                    return (
                      <span
                        key={lane}
                        className={[
                          "block h-[2px] w-full",
                          mk ? LABEL_COLOR_META[mk.color].dot : "bg-transparent",
                          mk && !mk.contPrev ? "rounded-l-full" : "",
                          mk && !mk.contNext ? "rounded-r-full" : "",
                        ].join(" ")}
                      />
                    );
                  })}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 주간 일정표 — 시간축(07~19시) × 7열. 일정은 시작 시각 위치에, 사진은 종일 띠에 하루 묶음으로. */
function WeekGrid({
  weekStart,
  today,
  selected,
  eventsByDate,
  mediaByDate,
  labels,
  onSelectDate,
  onCreateAt,
  onOpenEvent,
  onOpenMedia,
}: {
  weekStart: Date;
  today: Date;
  selected: Date;
  eventsByDate: Record<string, CalendarEvent[]>;
  mediaByDate: Record<string, CalendarMedia[]>;
  labels: ScheduleLabelDef[];
  onSelectDate: (d: Date) => void;
  onCreateAt: (d: Date, hhmm: string) => void;
  onOpenEvent: (e: CalendarEvent) => void;
  onOpenMedia: (m: CalendarMedia) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const hours = Array.from({ length: WEEK_END_HOUR - WEEK_START_HOUR }, (_, i) => WEEK_START_HOUR + i);
  // 07시 초기 스크롤은 **한 번만** — ref 콜백은 렌더마다 다시 붙고 이 화면은 2초 주기로
  // 폴링하므로, 조건만 보고 옮기면 사용자가 스크롤해도 계속 끌려온다(같은 형태를 이미 한 번 밟았다).
  const gridScrolledRef = useRef(false);
  const bodyH = hours.length * WEEK_HOUR_PX;

  return (
    <div className="min-w-0 flex-1 overflow-x-auto">
      <div className="min-w-[38rem]">
        {/* 요일 머리 */}
        <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-b border-hairline dark:border-white/10">
          <span />
          {days.map((d) => {
            const isToday = calendarSameDay(d, today);
            const wd = d.getDay();
            return (
              <button
                key={toDateKey(d)}
                type="button"
                onClick={() => onSelectDate(d)}
                aria-pressed={calendarSameDay(d, selected)}
                className="flex flex-col items-center gap-0.5 py-1.5 transition hover:bg-surface-strong dark:hover:bg-white/10"
              >
                <span className={`text-[10px] font-semibold ${wd === 0 ? "text-red-500" : wd === 6 ? "text-blue-600" : "text-muted dark:text-on-dark-soft"}`}>
                  {CALENDAR_WEEKDAYS[wd]}
                </span>
                {/* 선택 날짜도 표시한다 — 미니 달력과 같은 규칙(선택=푸른 채움이 우선, 오늘=반투명).
                    없으면 미니 달력에서 같은 주의 날짜를 골랐을 때 메인이 안 따라온 것처럼 보인다(2026-08-27 실측).
                    오늘을 선택하면 반투명 → 푸른 채움으로 바뀐다(사용자 결정). */}
                <span
                  className={[
                    "grid h-6 w-6 place-items-center rounded-full text-xs tabular-nums",
                    calendarSameDay(d, selected)
                      ? "bg-primary font-bold text-on-primary"
                      : isToday
                        ? "bg-primary-subtle font-semibold text-primary"
                        : "font-semibold text-ink dark:text-on-dark",
                  ].join(" ")}
                >
                  {d.getDate()}
                </span>
              </button>
            );
          })}
        </div>

        {/* 여러 날 일정 — **가로 색상줄**. 주 경계에서 잘라 이 주에 걸치는 부분만 그린다.
            겹치면 세로로 쌓는다(구글 캘린더와 같은 방식). 색은 라벨 태그 그대로. */}
        {(() => {
          const weekKeys = days.map((d) => toDateKey(d));
          const spans = Object.values(eventsByDate)
            .flat()
            .filter(isSpanEvent)
            .map((e) => ({ e, at: spanInWeek(e, weekKeys) }))
            .filter((x): x is { e: CalendarEvent; at: NonNullable<ReturnType<typeof spanInWeek>> } => x.at !== null)
            // 같은 일정이 여러 날짜 키에 들어 있을 수 있어 id 로 접는다.
            .filter((x, i, arr) => arr.findIndex((y) => y.e.id === x.e.id) === i)
            .sort((a, b) => a.at.startIdx - b.at.startIdx || b.at.endIdx - a.at.endIdx);
          if (spans.length === 0) return null;
          return (
            <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-b border-hairline dark:border-white/10">
              <span className="py-1 pr-1 text-right text-[9px] leading-5 text-muted dark:text-on-dark-soft">기간</span>
              <div className="col-span-7 space-y-0.5 py-1">
                {spans.map(({ e, at }) => {
                  const color = findLabelDef(labels, e.labelId).color;
                  return (
                    <div key={e.id} className="grid grid-cols-7 gap-0">
                      <button
                        type="button"
                        onClick={() => onOpenEvent(e)}
                        title={`${e.title} · ${e.dateKey} ~ ${e.endDateKey ?? e.dateKey}`}
                        // 라벨 색 그대로 — `band` 는 이 용도로 이미 있는 토큰이다(새 색을 만들지 않는다).
                        className={`flex min-w-0 items-center gap-1 truncate rounded border px-1.5 py-0.5 text-left text-[10px] font-semibold ${LABEL_COLOR_META[color].band}`}
                        style={{
                          gridColumnStart: at.startIdx + 1,
                          gridColumnEnd: at.endIdx + 2,
                          borderTopLeftRadius: at.openStart ? 0 : undefined,
                          borderBottomLeftRadius: at.openStart ? 0 : undefined,
                          borderTopRightRadius: at.openEnd ? 0 : undefined,
                          borderBottomRightRadius: at.openEnd ? 0 : undefined,
                        }}
                      >
                        <ScheduleLabelDot color={color} className="h-1.5 w-1.5 shrink-0" />
                        <span className="min-w-0 truncate">
                          {at.openStart ? "◀ " : ""}
                          {e.title.trim()}
                          {at.openEnd ? " ▶" : ""}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* 종일 띠 — ① **종일 일정**(시각 없음) ② 촬영 시각을 못 읽은 사진.
            ⚠ 둘 다 시각이 없어 시간 칸에 못 놓는다. 여기가 없으면 저장은 되는데 **화면에서 사라진다**
              (종일 토글을 넣으며 실제로 그 상태였다 — 2026-08-20). */}
        <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-b border-hairline dark:border-white/10">
          <span className="py-1 pr-1 text-right text-[9px] leading-5 text-muted dark:text-on-dark-soft">종일</span>
          {days.map((d) => {
            const key = toDateKey(d);
            // 종일 일정 = 시각이 없고 기간도 아닌 것(기간은 위 `기간` 줄이 담는다).
            const allDayEvents = (eventsByDate[key] ?? []).filter(
              (e) => !hhmmToMinutes(e.startTime) && !isSpanEvent(e),
            );
            // ⚠ 계획 변경(2026-08-20 사용자 지시) — 사진은 **촬영 시각 위치**에 놓는다.
            //   종일 띠에는 시각을 못 읽은 것만 남는다(그것도 안 버린다 — 버리면 조용히 사라진다).
            const n = (mediaByDate[key] ?? []).filter((m) => mediaMinutes(m) === null).length;
            return (
              <div key={key} className="min-h-[1.75rem] space-y-0.5 border-l border-hairline px-1 py-1 dark:border-white/10">
                {allDayEvents.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onOpenEvent(e)}
                    title={`${e.title} · 종일`}
                    className={`flex w-full min-w-0 items-center gap-1 truncate rounded border px-1 py-0.5 text-[10px] font-semibold ${LABEL_COLOR_META[findLabelDef(labels, e.labelId).color].band}`}
                  >
                    <ScheduleLabelDot color={findLabelDef(labels, e.labelId).color} className="h-1.5 w-1.5 shrink-0" />
                    <span className="min-w-0 truncate">{e.title.trim()}</span>
                  </button>
                ))}
                {n > 0 && (
                  <button
                    type="button"
                    onClick={() => onSelectDate(d)}
                    title={`촬영 시각을 못 읽은 현장 이미지/스캔 ${n}건 — 우측에서 확인`}
                    className="flex w-full min-w-0 items-center gap-1 truncate rounded bg-primary-subtle px-1.5 py-0.5 text-[10px] font-semibold text-primary transition hover:brightness-95 dark:text-on-dark"
                  >
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                    시각미상 {n}건
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* 시간 격자 — 24시간이라 **이 영역만** 스크롤한다(그대로 두면 페이지가 통째로 길어진다).
            첫 렌더에서 07시로 내려 둔다 — 전부 보여주되 눈은 주간 근무대에서 시작한다. */}
        <div
          ref={(el) => {
            if (el && !gridScrolledRef.current) {
              gridScrolledRef.current = true;
              el.scrollTop = 7 * WEEK_HOUR_PX;
            }
          }}
          className="max-h-[28rem] overflow-y-auto overscroll-contain"
        >
        <div className="relative grid grid-cols-[3rem_repeat(7,minmax(0,1fr))]">
          {/* 시간축 */}
          <div className="relative" style={{ height: bodyH }}>
            {hours.map((h, i) => (
              <span
                key={h}
                className="absolute right-1 -translate-y-1/2 text-[9px] tabular-nums text-muted dark:text-on-dark-soft"
                style={{ top: i * WEEK_HOUR_PX }}
              >
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((d) => {
            const key = toDateKey(d);
            const dayEvents = eventsByDate[key] ?? [];
            // 빈 칸 판정에는 **걸치는 일정까지** 본다 — `eventsByDate[key]` 만 보면 기간 일정이 빠진다.
            const dayAll = eventsOnDate(eventsByDate, key);
            return (
              <div key={key} className="relative border-l border-hairline dark:border-white/10" style={{ height: bodyH }}>
                {/* 시간 칸 — **비어 있을 때만** 등록 폼을 연다(사용자 지시 2026-08-20).
                    이미 일정이 있는 칸을 누르면 그 일정을 우측 사이드바에 띄운다.
                    ⚠ 종전엔 무조건 등록 폼이라, 기간·종일 일정이 있는 날을 눌러도 폼이 떠서
                      **사이드바에 뜬 상세를 폼이 덮었다**(사용자 실측 — 8/18 행안부 공모전 기간).
                    ★ 등록 경로는 안 없어진다 — 사이드바 `+ 일정 추가` 가 그대로 있다.
                      잃는 것은 "그 칸을 눌러 시각이 자동 입력되는" 편의뿐이다. */}
                {hours.map((h, i) => {
                  const occupied = eventOccupyingSlot(dayAll, h);
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() =>
                        occupied ? onOpenEvent(occupied) : onCreateAt(d, `${String(h).padStart(2, "0")}:00`)
                      }
                      aria-label={
                        occupied
                          ? `${d.getMonth() + 1}월 ${d.getDate()}일 ${h}시 — ${occupied.title.trim()} 보기`
                          : `${d.getMonth() + 1}월 ${d.getDate()}일 ${h}시 일정 추가`
                      }
                      className="absolute left-0 right-0 border-t border-hairline/60 transition hover:bg-primary-subtle/40 dark:border-white/5"
                      style={{ top: i * WEEK_HOUR_PX, height: WEEK_HOUR_PX }}
                    />
                  );
                })}
                {/* 일정 블록 */}
                {dayEvents.map((e) => {
                  const startMin = hhmmToMinutes(e.startTime);
                  if (startMin === null) return null; // 종일 일정은 위 띠 소관
                  const endMin = hhmmToMinutes(e.endTime);
                  // ⚠ 종료가 없으면 기본 1시간 — 실측 50%가 그렇다.
                  const dur = endMin !== null && endMin > startMin ? endMin - startMin : 60;
                  const top = ((startMin - WEEK_START_HOUR * 60) / 60) * WEEK_HOUR_PX;
                  if (top + 2 < 0 || top > bodyH) return null; // 창 밖 시각은 안 그린다
                  const color = findLabelDef(labels, e.labelId).color;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => onOpenEvent(e)}
                      title={`${e.title}${formatScheduleTime(e) ? ` · ${formatScheduleTime(e)}` : ""}`}
                      className="absolute left-0.5 right-0.5 overflow-hidden rounded-md px-1 py-0.5 text-left"
                      style={{ top: Math.max(0, top), height: Math.max(18, (dur / 60) * WEEK_HOUR_PX - 2) }}
                    >
                      <span className="pointer-events-none absolute inset-0 rounded-md bg-primary-subtle ring-1 ring-primary-ring" />
                      <span className="relative flex min-w-0 items-center gap-1">
                        <ScheduleLabelDot color={color} className="h-1.5 w-1.5 shrink-0" />
                        <span className="min-w-0 truncate text-[10px] font-semibold text-ink dark:text-on-dark">{e.title.trim()}</span>
                      </span>
                      {formatScheduleTime(e) && (
                        <span className="relative block truncate text-[9px] text-muted dark:text-on-dark-soft">{formatScheduleTime(e)}</span>
                      )}
                    </button>
                  );
                })}
                {/* 현장 이미지/스캔 — **촬영 시각 위치**에 놓는다(2026-08-20 사용자 지시).
                    ⚠ 표기는 **건수로 통일한다** — 1건이어도 `이미지 1건`(사용자 지시 2026-08-20).
                      종전엔 1건일 때 시각을 보여줬는데, 같은 칸이 상황에 따라 다른 것을 말해
                      읽는 규칙이 둘이 됐다. 시각·도로명은 우측 사이드바가 담는다.
                      (실측 = 시간대 최대 4건·같은 분 중복 있음 · 56%가 1건) */}
                {(() => {
                  const timed = (mediaByDate[key] ?? [])
                    .map((m) => ({ m, min: mediaMinutes(m) }))
                    .filter((x): x is { m: CalendarMedia; min: number } => x.min !== null)
                    .sort((a, b) => a.min - b.min);
                  const byHour = new Map<number, { m: CalendarMedia; min: number }[]>();
                  for (const x of timed) {
                    const h = Math.floor(x.min / 60);
                    const arr = byHour.get(h);
                    if (arr) arr.push(x);
                    else byHour.set(h, [x]);
                  }
                  return [...byHour.entries()].map(([hour, group]) => {
                    const head = group[0];
                    if (!head) return null;
                    const top = ((hour * 60 - WEEK_START_HOUR * 60) / 60) * WEEK_HOUR_PX;
                    if (top < -WEEK_HOUR_PX || top > bodyH) return null;
                    const many = group.length > 1;
                    const isDoc = !many && head.m.mediaType !== "image";
                    return (
                      <button
                        key={`m${hour}`}
                        type="button"
                        onClick={() => onOpenMedia(head.m)}
                        // 툴팁에는 시각·도로명을 남긴다 — 라벨이 건수로 통일돼 구별 정보가 여기로 온다.
                        title={
                          many
                            ? `${String(hour).padStart(2, "0")}시 현장 이미지/스캔 ${group.length}건 — 우측에서 확인`
                            : `${head.m.capturedAt?.slice(11, 16) ?? ""} ${head.m.roadAddress ?? head.m.title ?? "현장 이미지"} — 우측에서 확인`
                        }
                        className="absolute left-0.5 right-0.5 overflow-hidden rounded px-1 text-left"
                        style={{ top: Math.max(0, top) + 2, height: WEEK_HOUR_PX - 6 }}
                      >
                        <span className="pointer-events-none absolute inset-0 rounded bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:ring-emerald-500/30" />
                        <span className="relative flex min-w-0 items-center gap-0.5">
                          <span aria-hidden="true" className="shrink-0 text-[9px]">{isDoc ? "📄" : "📷"}</span>
                          <span className="min-w-0 truncate text-[9px] font-semibold text-emerald-700 dark:text-emerald-300">
                            이미지 {group.length}건
                          </span>
                        </span>
                      </button>
                    );
                  });
                })()}
              </div>
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
}

function HeaderCalendarPopup({
  open,
  onClose,
  lat,
  lon,
  workerCount,
  variant = "popup",
  active = false,
  workerAliases,
  unseenMedia,
  onSeeMedia,
  onSeeAllMedia,
}: {
  open: boolean;
  onClose: () => void;
  lat?: number;
  lon?: number;
  workerCount: number;
  variant?: "popup" | "inline";
  /** 미확인 새 현장 사진 — inline 주간 모드에서 미니 달력 아래 리스트로 그린다(2026-08-26). */
  unseenMedia?: CalendarUnseenMedia[];
  /** 리스트 항목 클릭 → 그 항목을 봄 처리(부모의 미확인 집합이 원천 — 여기서 직접 지우지 않는다). */
  onSeeMedia?: (id: string) => void;
  onSeeAllMedia?: () => void;
  // 탭 활성 여부. 페이저가 **모든 페이지를 마운트 유지**하므로, 이게 없으면 다른 탭에서도
  // 우측 고정 사이드바가 화면에 남는다.
  active?: boolean;
  // 로그인 ID → 사번(secondary→primary). 댓글 작성자 표기를 위쪽 `작업자 EMP-6861` 과
  // 같은 식별자로 맞추는 데만 쓴다. ★ 권한 판정에는 안 쓴다(그건 서버가 author_id 로 한다).
  workerAliases?: Record<string, string>;
}) {
  const inline = variant === "inline";
  // ★ 조회·폴링의 게이트는 `open` 이 아니라 **이것**이다.
  //   페이저가 모든 페이지를 마운트 유지하고 탭은 `open` 을 항상 참으로 넘기므로, `open` 만 보면
  //   **다른 탭에 있어도 60초마다 캘린더 조회가 돈다.** 실제로 그 부하가 DB 풀 타임아웃을
  //   되살렸다(2026-08-20 실측 — 00299 4시간 0건 vs 00300 45분 11건 ·
  //   실패 라우트가 calendar/events·media·labels 였다).
  const visible = inline ? active : open;
  // 포털은 클라이언트에서만 — SSR 에는 document 가 없다.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => setPortalReady(true), []);
  const [viewDate, setViewDate] = useState(() => new Date());
  // 주/월 전환(2026-08-20 사용자 결정 — 월간을 버리지 않는다). 팝업(580px)은 주간이 안 들어가
  // 항상 월간이다. `inline` 일 때만 전환이 뜬다.
  const [weekMode, setWeekMode] = useState(true);
  // 주 이동 — 종전엔 미니 월간에서 날짜를 골라야만 주가 바뀌어 불편했다(사용자 지적 2026-08-20).
  // ★ viewDate 도 함께 옮긴다 — 안 옮기면 주는 넘어갔는데 미니 월간이 다른 달을 비춘다.
  const shiftWeek = useCallback((delta: number) => {
    setSelected((prev) => {
      const next = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + delta * 7);
      setViewDate(new Date(next.getFullYear(), next.getMonth(), 1));
      return next;
    });
  }, []);
  // 주간 격자에서 고른 사진 — 우측 사이드바에서 그 카드로 스크롤·강조한다.
  const [focusMediaId, setFocusMediaId] = useState<string | null>(null);
  // 초점당 한 번만 스크롤하기 위한 기록 — 위 ref 콜백 주석 참조.
  const scrolledForRef = useRef<string | null>(null);
  // 주간 격자에서 고른 **일정** — 사진과 같은 규칙으로 사이드바에서 그 행을 강조·스크롤한다.
  // ⚠ 종전엔 일정만 수정 팝업을 열었다. 같은 격자에서 사진은 사이드바, 일정은 팝업이라
  //   **클릭 규칙이 둘**이었고(사용자 실측 2026-08-20), 수정은 사이드바 ✏️ 로 이미 갈 수 있어
  //   중복 경로이기도 했다. 읽으려던 클릭이 편집 모드를 여는 것은 되돌릴 것을 만든다.
  const [focusEventId, setFocusEventId] = useState<string | null>(null);
  const eventScrolledForRef = useRef<string | null>(null);
  const [selected, setSelected] = useState(() => new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [labels, setLabels] = useState<ScheduleLabelDef[]>(DEFAULT_LABELS);
  // 라벨 편집 권한(총괄 관리자 또는 admin_access 보유자) — 서버(/api/calendar/labels GET)가
  // 내려주는 값을 그대로 쓴다. 기본은 감춤(모르면 안 보인다).
  const [labelsCanEdit, setLabelsCanEdit] = useState(false);
  const [formDate, setFormDate] = useState<Date | null>(null);
  // 모달을 편집 모드로 열 때 대상 일정 id — 목록의 [수정] 이 형식 모달을 그 일정으로 채워 연다.
  const [formEditId, setFormEditId] = useState<string | null>(null);
  // 삭제 확인 대기 중인 일정 — 즉시 삭제 + 낙관적 반영이라 오클릭 시 복구가 불가능했다.
  const [pendingDelete, setPendingDelete] = useState<CalendarEvent | null>(null);
  // 서버가 쓰기를 거부한 사유(주로 권한 부족) — 조용히 되돌리면 사용자는 고장으로 읽는다.
  const [writeError, setWriteError] = useState<string | null>(null);
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
  // 첫 미디어 조회가 끝났는가 — 일정(hydrated)과 함께 로딩 화면의 종료 조건이다.
  // ★ 둘을 함께 기다린다. 일정만 보고 열면 격자가 먼저 뜨고 사진 칩이 뒤늦게 튀어 들어온다.
  const [mediaHydrated, setMediaHydrated] = useState(false);
  // 플로팅 창 드래그 위치(기본 위치 대비 translate 오프셋). null = 기본(우상단). 열 때마다 리셋.
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<
    { px: number; py: number; x: number; y: number; baseLeft: number; baseTop: number; w: number; h: number } | null
  >(null);

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
      type RawMedia = Record<string, string | null> & {
        comments?: RawComment[];
        canDelete?: boolean; // 서버가 계산한 항목별 삭제 권한
      };
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
          coordGapM: r.coord_gap_m != null ? Number(r.coord_gap_m) : null,
          coordRefAccuracyM:
            r.coord_ref_accuracy_m != null ? Number(r.coord_ref_accuracy_m) : null,
          // 서버 판정을 그대로 쓴다. 없으면 false — 판정을 못 받았는데 버튼을 보이면
          // 눌렀을 때 실패한다(모르면 감춘다).
          canDelete: r.canDelete === true,
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
    } finally {
      // ⚠ 성공·실패·무시(옛 달 응답) 어느 경로로 빠져나가도 반드시 내린다 —
      //   한 갈래라도 빠뜨리면 로딩 화면이 영원히 걸린 채로 남는다.
      setMediaHydrated(true);
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
      const lbJson = (await lbRes.json()) as {
        ok?: boolean;
        labels?: unknown[];
        canEdit?: boolean;
      };
      if (!evJson.ok || !Array.isArray(evJson.events) || !lbJson.ok || !Array.isArray(lbJson.labels)) {
        return null;
      }
      const serverEvents = calendarEventsFromServer(evJson.events);
      const serverLabels = calendarLabelsFromServer(lbJson.labels);
      const inspByDate = inspRes && inspRes.ok ? await inspectionMapFromResponse(inspRes) : null;
      if (seq === scheduleFetchSeqRef.current) {
        setEvents(serverEvents);
        setLabels(serverLabels.length > 0 ? serverLabels : DEFAULT_LABELS);
        // 라벨 편집(전체교체 PUT) 권한 — 서버 판정을 받아쓴다.
        setLabelsCanEdit(lbJson.canEdit === true);
        if (inspByDate) setInspectionByDate(inspByDate);
      }
      return { labelCount: serverLabels.length };
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    fetchMedia(viewDate);
  }, [visible, viewDate, fetchMedia]);

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
    if (!visible) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchMedia(viewDate);
      fetchSchedule(viewDate);
    }, 60000);
    return () => clearInterval(id);
  }, [visible, viewDate, fetchMedia, fetchSchedule]);

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
        // 토큰 동봉 — 서버가 세션이 있을 때만 이력 저장·환경 알림을 수행한다(BE-AUTHZ-02).
        const wxToken = getSessionToken();
        const res = await fetch(
          `/api/weather?lat=${lat}&lon=${lon}&workers=${workerCount}`,
          {
            cache: "no-store",
            headers: wxToken ? { Authorization: `Bearer ${wxToken}` } : undefined,
          },
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
        // 토큰 동봉 — 바로 위 형제 weather 호출에는 붙었는데 여기만 빠져 있었다(감사 DLT-FE-3).
        const kmaToken = getSessionToken();
        const res = await fetch(`/api/kma-warning?lat=${lat}&lon=${lon}`, {
          cache: "no-store",
          headers: kmaToken ? { Authorization: `Bearer ${kmaToken}` } : undefined,
        });
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
    // 조회이므로 `visible` 게이트 — 안 보이는 탭에서 도는 것을 막는다(위 주석 참조).
    // ⚠ 아래 `let active` 는 이 이펙트의 취소 플래그이고 컴포넌트 프롭 `active` 와 다른 것이다.
    if (!visible) return;
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
          // 403 = 옮길 권한이 없다(남의 일정 id·라벨 편집 불가) = 옮길 필요도 없다.
          // 여기서 throw 하면 플래그가 안 찍혀 팝업을 열 때마다 영원히 재시도한다.
          let uploaded = false;
          for (const ev of localEvents) {
            const res = await fetch("/api/calendar/events", {
              method: "POST",
              headers: jsonHeaders,
              body: JSON.stringify(ev),
            });
            if (!res.ok && res.status !== 403) throw new Error("migrate failed");
            if (res.ok) uploaded = true;
          }
          // 라벨은 전체교체(PUT)라 다른 관리자가 저장한 서버 라벨을 덮지 않게 서버가 비어 있을 때만.
          if (hadLocalLabels && result.labelCount === 0) {
            const res = await fetch("/api/calendar/labels", {
              method: "PUT",
              headers: jsonHeaders,
              body: JSON.stringify({ labels: loadCalendarLabels() }),
            });
            if (!res.ok && res.status !== 403) throw new Error("migrate failed");
            if (res.ok) uploaded = true;
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
  }, [visible, viewDate, fetchSchedule]);

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
    setFormEditId(null);
    setPendingDelete(null);
    setPlanOpen(false);
    setHoverDateKey(null);
    setDragPos(null); // 열 때마다 기본 위치로 리셋
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // 삭제 확인이 떠 있으면 그것부터 닫는다(가장 위 레이어 우선).
        if (pendingDelete) setPendingDelete(null);
        else if (formDate) {
          // ⚠ 둘을 **함께** 지운다 — `formEditId` 만 남으면 다음에 새 일정으로 연 모달이
          //   그 옛 일정의 편집 모드로 열린다(2026-08-27 실측: 처음부터 「일정 수정」 ·
          //   목록의 수정 버튼이 무반응으로 보임 · 저장하면 옛 일정을 덮어쓴다).
          setFormDate(null);
          setFormEditId(null);
        } else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, formDate, pendingDelete]);

  // 헤더 드래그 — 플로팅 창 자유 이동(pointer capture). 버튼 위 클릭은 드래그 시작 안 함(액션 보존).
  const onDragPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const base = dragPos ?? { x: 0, y: 0 };
    const rect = panelRef.current?.getBoundingClientRect();
    dragStart.current = {
      px: e.clientX,
      py: e.clientY,
      x: base.x,
      y: base.y,
      baseLeft: (rect?.left ?? 0) - base.x,
      baseTop: (rect?.top ?? 0) - base.y,
      w: rect?.width ?? 580,
      h: rect?.height ?? 500,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDragPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStart.current;
    if (!s) return;
    let nx = s.x + (e.clientX - s.px);
    let ny = s.y + (e.clientY - s.py);
    // 화면 밖으로 완전히 못 나가게 clamp — 좌우 최소 160px·헤더(상단 48px)는 항상 보이게.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = s.baseLeft + nx;
    const top = s.baseTop + ny;
    const clampedLeft = Math.min(vw - 160, Math.max(160 - s.w, left));
    const clampedTop = Math.min(vh - 48, Math.max(8, top));
    nx += clampedLeft - left;
    ny += clampedTop - top;
    setDragPos({ x: nx, y: ny });
  };
  const onDragPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 이미 해제됨 */
    }
  };

  // 탭 본문은 페이저가 이미 표시 여부를 정하므로 open 게이트를 타지 않는다.
  if (!inline && !open) return null;

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

  // 선택 날짜의 일정 = 그날 시작하는 것 + **그날에 걸친 기간 일정**.
  // ⚠ 기간 일정은 `date_key`(시작일) 한 곳에만 저장되므로, 그대로 쓰면 **시작일에만 보이고
  //   나머지 날에는 "등록된 일정이 없습니다" 가 뜬다**(사용자 실측 2026-08-20 — 8/10 은 보이는데
  //   8/11~31 은 안 보였다). 미니 월간 밑줄은 걸침을 따로 계산해서 맞았고, 여기만 안 썼다.
  const selectedEvents = eventsOnDate(eventsByDate, toDateKey(selected));
  const selectedMedia = mediaByDate[toDateKey(selected)] ?? [];
  const selectedKey = toDateKey(selected);
  // 기간 일정이 걸친 날짜 → 라벨 색. 미니 월간이 이걸 밑줄로 그린다.
  // ⚠ 겹치면 먼저 만난 것을 쓴다 — 미니에서 색을 겹쳐 봐야 읽히지 않는다.
  const spanDayLanes = useMemo<SpanDayLanes>(() => {
    const out: SpanDayLanes = new Map();
    // ① 기간 일정만 모은다(같은 일정이 여러 날짜키에 들어 있어 id 로 접는다) + 시작일 순 정렬 —
    //    정렬해야 레인 배정이 안정적이다(같은 데이터면 항상 같은 줄).
    const seen = new Set<string>();
    const spans = Object.values(eventsByDate)
      .flat()
      .filter((e) => {
        if (!isSpanEvent(e) || seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      })
      .sort(
        (a, b) =>
          a.dateKey.localeCompare(b.dateKey) ||
          (b.endDateKey ?? b.dateKey).localeCompare(a.endDateKey ?? a.dateKey),
      );
    // ② 레인 배정 — 겹치지 않는 일정끼리는 같은 줄을 재사용한다(구간 그리디).
    //    ★ 색이 아니라 **일정**이 줄의 단위다. 같은 파란색 두 일정도 서로 다른 줄을 갖는다.
    const laneLastEnd: number[] = []; // 레인별 마지막 점유일(ms)
    for (const e of spans) {
      const from = dateFromKey(e.dateKey).getTime();
      const to = dateFromKey(e.endDateKey ?? e.dateKey).getTime();
      let lane = laneLastEnd.findIndex((end) => end < from);
      if (lane < 0) lane = laneLastEnd.length;
      laneLastEnd[lane] = to;
      const color = findLabelDef(labels, e.labelId).color;
      for (let d = new Date(from); d.getTime() <= to; d.setDate(d.getDate() + 1)) {
        const k = toDateKey(d);
        const lanes = out.get(k) ?? [];
        // 앞·뒤로 **같은 일정**이 이어지는지 — 띠를 끊지 않고 잇는 근거다.
        lanes[lane] = {
          color,
          contPrev: d.getTime() > from,
          contNext: d.getTime() < to,
        };
        out.set(k, lanes);
      }
    }
    return out;
  }, [eventsByDate, labels]);
  // 날짜가 바뀌면 초점을 푼다 — 안 풀면 다른 날의 카드가 강조된 채로 남는다.
  // ⚠ 무조건 풀면 안 된다 — 주간 격자에서 **다른 날** 사진을 누르면 날짜가 함께 바뀌므로,
  //   그 자리에서 초점이 즉시 사라져 클릭이 아무 일도 안 한 것처럼 보인다.
  //   그래서 "고른 항목이 새 날짜에 없을 때만" 푼다.
  useEffect(() => {
    setFocusMediaId((prev) => {
      const keep = prev && (mediaByDate[selectedKey] ?? []).some((m) => m.id === prev) ? prev : null;
      if (!keep) scrolledForRef.current = null;
      return keep;
    });
  }, [selectedKey, mediaByDate]);
  // 일정 초점도 같은 규칙 — 고른 일정이 새 날짜에 없을 때만 푼다.
  // ⚠⚠ 판정 기준이 `eventsByDate[selectedKey]` 가 아니라 **`selectedEvents`** 다.
  //    기간 일정은 시작일 키에만 들어 있어서, 사진 쪽 이펙트를 그대로 복사하면
  //    **걸친 날에서 초점이 즉시 풀린다**(8/16~8/22 일정을 8/20 에서 누르면 아무 일도 안 한 것처럼 보인다).
  // ⚠ deps 는 배열이 아니라 **id 서명 문자열**이다 — `selectedEvents` 는 매 렌더 새 배열이라
  //   그대로 넣으면 이펙트가 매 렌더 돈다.
  const selectedEventIds = selectedEvents.map((e) => e.id).join("|");
  useEffect(() => {
    setFocusEventId((prev) => {
      const keep = prev && selectedEventIds.split("|").includes(prev) ? prev : null;
      if (!keep) eventScrolledForRef.current = null;
      return keep;
    });
  }, [selectedEventIds]);
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
  // 서버 거부 사유를 그대로 보여준다 — 권한 부족(403)을 조용히 되돌리면 사용자는 고장으로 읽는다.
  const reportWriteFailure = async (res: Response, fallback: string) => {
    const message = await res
      .json()
      .then((j: { error?: unknown }) => (typeof j.error === "string" ? j.error : fallback))
      .catch(() => fallback);
    setWriteError(message);
  };

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
          await reportWriteFailure(res, "일정을 저장하지 못했습니다");
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

  const handleAddEvent = (draft: Omit<CalendarEvent, "id" | "dateKey">, dateKey: string) => {
    const event: CalendarEvent = {
      ...draft,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${dateKey}`,
      dateKey,
      // 방금 내가 만든 일정이므로 확정 응답 전까지 편집 가능으로 둔다(버튼 깜빡임 방지).
      // 서버 확정 행이 도착하면 그 판정으로 치환된다.
      canEdit: true,
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
      .then(async (res) => {
        if (!res.ok) {
          await reportWriteFailure(res, "일정을 삭제하지 못했습니다");
          fetchSchedule(viewDate);
        }
      })
      .catch(() => fetchSchedule(viewDate));
  };

  // dateKey 를 draft 에 포함해 받는다 — 수정 시 다른 날짜로 옮길 수 있어야 한다.
  const handleUpdateEvent = (
    id: string,
    draft: Omit<CalendarEvent, "id" | "dateKey">,
    dateKey: string,
  ) => {
    const current = events.find((event) => event.id === id);
    if (!current) return;
    const updated = { ...current, ...draft, dateKey };
    setEvents((prev) => prev.map((event) => (event.id === id ? updated : event)));
    persistEvent(updated);
  };

  return (
    <div className={inline ? "" : "pointer-events-none fixed inset-0 z-50"}>
      <div
        ref={panelRef}
        className={
          inline
            // ★ 탭 본문에는 높이 상한을 두지 않는다 — 페이지가 이미 스크롤한다.
            //   상한을 두면 패널 안에 두 번째 스크롤바가 생겨 하단(`선택 날짜 일정`)이 잘린다.
            ? "flex w-full flex-col rounded-2xl border border-hairline-strong bg-canvas dark:border-white/10 dark:bg-surface-dark"
            : "pointer-events-auto absolute right-4 top-[4.5rem] flex max-h-[calc(100dvh-6rem)] w-full max-w-[580px] flex-col overflow-hidden rounded-2xl border border-hairline-strong bg-canvas shadow-2xl dark:border-white/10 dark:bg-surface-dark sm:top-20"
        }
        style={!inline && dragPos ? { transform: `translate(${dragPos.x}px, ${dragPos.y}px)` } : undefined}
        role={inline ? undefined : "dialog"}
        aria-label="일정 캘린더"
      >
        <div
          className={
            inline
              ? "flex shrink-0 items-center justify-between rounded-t-2xl border-b border-hairline bg-surface-soft px-4 py-3 dark:border-white/10 dark:bg-surface-dark-elevated"
              : "flex shrink-0 cursor-grab touch-none select-none items-center justify-between rounded-t-2xl border-b border-hairline bg-surface-soft px-4 py-3 active:cursor-grabbing dark:border-white/10 dark:bg-surface-dark-elevated"
          }
          onPointerDown={inline ? undefined : onDragPointerDown}
          onPointerMove={inline ? undefined : onDragPointerMove}
          onPointerUp={inline ? undefined : onDragPointerUp}
          onPointerCancel={inline ? undefined : onDragPointerUp}
        >
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
          {/* 탭 본문에는 닫기가 없다 — 페이지 자체가 캘린더라 닫을 대상이 아니다. */}
          {!inline && (
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
          )}
          </div>
        </div>

        {/* 팝업은 떠 있는 패널이라 자체 스크롤이 필요하지만, 탭 본문은 페이지 스크롤을 쓴다.
            inline 에서 자체 스크롤을 두면 스크롤바가 둘이 되고 하단이 잘린다. */}
        <div
          className={
            inline
              ? "flex-1 overflow-visible"
              : "wx-cards-scroll flex-1 overflow-y-auto overscroll-y-contain"
          }
          onWheel={inline ? undefined : (e) => e.stopPropagation()}
        >
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
          {/* 주/월 전환 — 탭에서만. 팝업(580px)은 주간 격자가 안 들어간다. */}
          {inline && (
            <div className="mb-2 flex justify-end px-1">
              <div className="inline-flex overflow-hidden rounded-lg border border-hairline text-[11px] font-semibold dark:border-white/10">
                {([["주", true], ["월", false]] as const).map(([label, w]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setWeekMode(w)}
                    aria-pressed={weekMode === w}
                    className={
                      weekMode === w
                        ? "bg-primary px-3 py-1 text-on-primary"
                        : "px-3 py-1 text-muted transition hover:bg-surface-strong dark:text-on-dark-soft dark:hover:bg-white/10"
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
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

          {/* 첫 조회가 끝나기 전에는 빈 격자 대신 로더를 보여준다(2026-08-27 사용자 요청) —
              안전관리비·공단 보조금 검증 보드와 같은 표현(QuantumPulseLoader).
              ⚠ 일정과 미디어를 **함께** 기다린다. 한쪽만 보면 격자가 먼저 뜨고 나머지가 튀어 들어온다. */}
          {!(hydrated && mediaHydrated) ? (
            <QuantumPulseLoader text="일정 불러오는 중" />
          ) : inline && weekMode ? (
            // 구글 캘린더식 — 좌상단 미니 월간(날짜 이동) + 메인 주간 일정표.
            <div className="flex items-start gap-3">
              <div className="flex w-[13.5rem] shrink-0 flex-col gap-3">
                <MiniMonth
                  viewDate={viewDate}
                  selected={selected}
                  today={today}
                  spanDays={spanDayLanes}
                  onSelect={setSelected}
                  onPrev={goPrevMonth}
                  onNext={goNextMonth}
                />
                {/* 미확인 사진 리스트 — 탭 배지의 그 숫자를 목록으로 푼다. 항목 클릭 = 주간 격자
                    사진 클릭과 같은 이동 규칙(선택 날짜 + 사이드바 초점) + 그 항목만 봄 처리.
                    ⚠ viewDate 도 함께 옮긴다 — 미디어 조회 범위가 viewDate 의 달이라, 다른 달
                      사진이면 안 옮기면 사이드바에 그 항목이 없다. */}
                {unseenMedia && (
                  <div className="rounded-xl border border-hairline bg-surface-soft p-2 dark:border-white/10 dark:bg-surface-dark-elevated">
                    <div className="mb-1 flex items-center justify-between px-1">
                      <p className="text-[11px] font-bold text-ink dark:text-on-dark">
                        미확인 사진 <span className="tabular-nums text-primary">{unseenMedia.length}</span>
                      </p>
                      {unseenMedia.length > 0 && (
                        <button
                          type="button"
                          onClick={() => onSeeAllMedia?.()}
                          className="text-[10px] font-semibold text-muted transition hover:text-ink dark:text-on-dark-soft dark:hover:text-on-dark"
                        >
                          모두 확인
                        </button>
                      )}
                    </div>
                    {/* 0건이어도 박스는 남긴다 — 조건부로 통째로 숨기면 기능이 있는지조차 안 보인다
                        (2026-08-26 실측: 구 로직이 전부 봄 처리해 둔 상태에서 "리스트가 없다"로 읽힘). */}
                    {unseenMedia.length === 0 && (
                      <p className="px-1 pb-1 text-[10px] text-muted dark:text-on-dark-soft">
                        새 현장 사진이 도착하면 여기에 쌓입니다.
                      </p>
                    )}
                    <ul className="flex max-h-52 flex-col gap-0.5 overflow-y-auto">
                      {unseenMedia.map((m) => {
                        // 실제 사진 미리보기 — 썸네일 → (이미지일 때만) 원본 순 폴백. 아이콘은 최후 수단.
                        const thumb = m.thumbnailUrl ?? (m.mediaType !== "video" ? m.mediaUrl : null);
                        return (
                        <li key={m.id}>
                          <button
                            type="button"
                            onClick={() => {
                              const d = dateFromKey(m.dateKey);
                              setSelected(d);
                              setViewDate(new Date(d.getFullYear(), d.getMonth(), 1));
                              scrolledForRef.current = null; // 같은 항목을 다시 눌러도 다시 스크롤한다
                              setFocusMediaId(m.id);
                              onSeeMedia?.(m.id);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg p-1 text-left transition hover:bg-surface-strong dark:hover:bg-white/10"
                          >
                            {thumb ? (
                              <img src={thumb} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" />
                            ) : (
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#0052ff]/10 text-primary dark:bg-[#0052ff]/25">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
                                  <circle cx="12" cy="13" r="3" />
                                </svg>
                              </span>
                            )}
                            <span className="min-w-0">
                              <span className="block truncate text-[11px] font-semibold text-ink dark:text-on-dark">
                                {m.title ?? "현장 사진"}
                              </span>
                              <span className="block truncate text-[10px] tabular-nums text-muted dark:text-on-dark-soft">
                                {m.dateKey.slice(5).replace("-", "/")}
                                {m.uploader ? ` · ${m.uploader}` : ""}
                              </span>
                            </span>
                          </button>
                        </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => shiftWeek(-1)}
                aria-label="이전 주"
                title="이전 주"
                className="mt-7 grid h-8 w-7 shrink-0 place-items-center rounded-lg border border-hairline text-muted transition hover:bg-surface-strong hover:text-ink dark:border-white/10 dark:hover:bg-white/10 dark:hover:text-on-dark"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <WeekGrid
                weekStart={startOfWeek(selected)}
                today={today}
                selected={selected}
                eventsByDate={eventsByDate}
                mediaByDate={mediaByDate}
                labels={labels}
                onSelectDate={setSelected}
                onCreateAt={(d) => {
                  setSelected(d);
                  // ⚠ 새 일정으로 여는 자리다 — 남아 있던 편집 대상을 반드시 끊는다.
                  //   안 끊으면 모달이 그 일정의 **수정 모드**로 열린다(위 ESC 주석과 같은 사고).
                  setFormEditId(null);
                  setFormDate(d);
                }}
                onOpenEvent={(e) => {
                  // 우측 사이드바에서 그 일정을 보여준다 — 사진과 같은 규칙. 수정은 사이드바 ✏️ 로.
                  // ⚠ 기간 띠를 눌렀을 때 **선택 날짜를 시작일로 옮기지 않는다** — 8/16~8/22 일정을
                  //   8/20 에서 누르면 화면이 8/16 으로 튄다. 이미 걸친 날이면 그대로 둔다.
                  setSelected((prev) => {
                    const k = toDateKey(prev);
                    const covers = e.dateKey <= k && (e.endDateKey ?? e.dateKey) >= k;
                    return covers ? prev : dateFromKey(e.dateKey);
                  });
                  eventScrolledForRef.current = null; // 같은 일정을 다시 눌러도 다시 스크롤한다
                  setFocusEventId(e.id);
                }}
                onOpenMedia={(m) => {
                  // 우측 사이드바에서 그 항목을 보여준다 — 날짜를 맞추고 초점을 준다.
                  setSelected(dateFromKey(m.dateKey));
                  scrolledForRef.current = null; // 같은 항목을 다시 눌러도 다시 스크롤한다
                  setFocusMediaId(m.id);
                }}
              />
              <button
                type="button"
                onClick={() => shiftWeek(1)}
                aria-label="다음 주"
                title="다음 주"
                className="mt-7 grid h-8 w-7 shrink-0 place-items-center rounded-lg border border-hairline text-muted transition hover:bg-surface-strong hover:text-ink dark:border-white/10 dark:hover:bg-white/10 dark:hover:text-on-dark"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            </div>
          ) : (
          <>
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

          {/* `auto-rows-fr` — 주(週) 행이 같은 높이로 균등 분배된다. 없으면 일정이 많은 주만
              길어져 격자가 들쭉날쭉해진다(구글 캘린더는 항상 균등하다). */}
          {/* ★ 주 단위로 나눠 그린다 — 각 주 **위에** 그 주의 기간 띠를 놓기 위해서다.
              종전엔 격자 하나에 셀을 쭉 깔고 띠를 별도 블록으로 얹어, 띠가 해당 주가 아니라
              **격자 맨 위에 몰려** 있었다(사용자 실측 2026-08-20).
              ⚠ 셀 본문은 한 줄도 안 옮긴다 — 반복 구조만 바꾼다. */}
          {(() => {
            const spanEvents = Object.values(eventsByDate).flat().filter(isSpanEvent)
              .filter((e, i, arr) => arr.findIndex((y) => y.id === e.id) === i);
            const renderCell = (day: number | null, idx: number) => {
              if (day === null) {
                return <div key={`empty-${idx}`} className={inline ? "min-h-[7rem]" : "min-h-[4.5rem]"} />;
              }
              const cellDate = new Date(year, month, day);
              const dateKey = toDateKey(cellDate);
              // ⚠ 기간 일정은 **위 띠가 이미 말한다** — 시작일 셀에 칩으로 또 그리면 같은 일정을
              //   두 번 말한다(사용자 실측 2026-08-20 — 8/10 칸에 띠와 칩이 함께 떴다).
              //   셀에는 하루짜리만 남긴다. 기간은 띠를 눌러 연다.
              const dayEvents = (eventsByDate[dateKey] ?? []).filter((e) => !isSpanEvent(e));
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
                    // 구글 캘린더식 — 선택은 **셀을 통째로 칠하지 않고 날짜 숫자에 원형**으로 준다.
                    // 종전엔 셀 전체가 파랗게 차서 그 안의 일정 칩·배지가 전부 흰 글자 분기를
                    // 따로 가져야 했고(10곳), 하루치 정보가 색으로 뭉개졌다.
                    "relative flex flex-col rounded-lg p-1 text-left transition",
                    inline ? "min-h-[7rem]" : "min-h-[4.5rem]",
                    isSelected
                      ? "bg-primary-subtle ring-1 ring-primary-ring"
                      : "hover:bg-surface-strong dark:hover:bg-white/10",
                  ].join(" ")}
                  aria-label={`${year}년 ${month + 1}월 ${day}일`}
                  aria-pressed={isSelected}
                >
                  {dayWeatherCode !== undefined && (
                    <span
                      className={[
                        "pointer-events-none absolute right-0.5 top-0.5 z-10 text-muted dark:text-on-dark-soft",
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
                        "bg-primary-subtle text-primary dark:text-on-dark",
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
                        dayHazardSev === "danger"
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
                  {holiday ? (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-100 px-0.5 text-[11px] font-semibold tabular-nums text-red-600 dark:bg-red-500/20 dark:text-red-400">
                      {day}
                    </span>
                  ) : (
                    // 선택 = 푸른 채움 원 · 오늘(미선택) = 반투명 파랑 원 — 미니 달력·주간 헤더와 같은
                    // 규칙. 오늘을 클릭하면 반투명이 푸른 채움으로 바뀐다(2026-08-27 사용자 결정 —
                    // 종전 "원형은 오늘 전용" 원칙을 이 결정이 대체한다).
                    <span
                      className={[
                        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                        isSelected
                          ? "bg-primary font-bold text-on-primary"
                          : isToday
                            ? "bg-primary-subtle font-bold text-primary"
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
                        "truncate px-0.5 text-[7px] font-medium leading-tight text-red-500 dark:text-red-400",
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
                          dayInspSev === "danger"
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
                        inverted={false}
                      />
                    ))}
                    {dayEvents.length > 2 && (
                      <span
                        className={[
                          "px-0.5 text-[8px] font-medium text-muted dark:text-on-dark-soft",
                        ].join(" ")}
                      >
                        +{dayEvents.length - 2}
                      </span>
                    )}
                  </div>
                </button>
              );
            };
            const weeks: number[][] = [];
            const allIdx = cells.map((_, k) => k);
            for (let i = 0; i < allIdx.length; i += 7) weeks.push(allIdx.slice(i, i + 7));
            return weeks.map((wkIdx, wi) => {
              const wkKeys = wkIdx.map((k) => {
                const d = cells[k];
                return d === null || d === undefined ? "" : toDateKey(new Date(year, month, d));
              });
              const present = wkKeys.filter(Boolean);
              const lead = Math.max(0, wkKeys.findIndex(Boolean));
              const bars = spanEvents
                .map((e) => ({ e, at: spanInWeek(e, present) }))
                .filter((x): x is { e: CalendarEvent; at: NonNullable<ReturnType<typeof spanInWeek>> } => x.at !== null);
              return (
                <div key={`wk-${wi}`} className="mb-0.5">
                  {bars.length > 0 && (
                    <div className="mb-0.5 space-y-0.5">
                      {bars.map(({ e, at }) => (
                        <div key={e.id} className="grid grid-cols-7 gap-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              setFormEditId(e.id);
                              setFormDate(dateFromKey(e.dateKey));
                            }}
                            title={`${e.title} · ${e.dateKey} ~ ${e.endDateKey ?? e.dateKey}`}
                            className={`flex min-w-0 items-center gap-1 truncate rounded border px-1.5 py-0.5 text-left text-[10px] font-semibold ${LABEL_COLOR_META[findLabelDef(labels, e.labelId).color].band}`}
                            style={{
                              gridColumnStart: lead + at.startIdx + 1,
                              gridColumnEnd: lead + at.endIdx + 2,
                            }}
                          >
                            <ScheduleLabelDot color={findLabelDef(labels, e.labelId).color} className="h-1.5 w-1.5 shrink-0" />
                            <span className="min-w-0 truncate">
                              {at.openStart ? "◀ " : ""}
                              {e.title.trim()}
                              {at.openEnd ? " ▶" : ""}
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-7 gap-0.5 overflow-visible">
                    {wkIdx.map((k) => renderCell(cells[k] ?? null, k))}
                  </div>
                </div>
              );
            });
          })()}
          </>
          )}

          {/* 선택 날짜 상세(일정·현장 이미지) — 탭에서는 **화면 우측 끝 고정 사이드바**다.
              ① 카드 안 컬럼으로 두면 메인(주간 일정표) 공간을 먹는다(사용자 지시 2026-08-20).
              ② 자체 스크롤이라 **이 패널만 스크롤**한다 — 이미지가 쌓여도 페이지가 길어지지 않는다.
              ★ createPortal(body) 필수 — 페이저 트랙이 `translateX` 로 슬라이드해 그 안의 `fixed` 는
                뷰포트가 아니라 트랙 기준이 된다(AssignmentChatWidget 이 같은 이유로 포털을 쓴다).
              ★ 본문은 한 벌이다 — 감싸기만 바꾼다. 두 벌이면 한쪽만 고쳐 화면이 갈린다.
              ⚠ lg 미만에서는 안 띄운다 — 좁은 화면에서 본문을 덮는다(좌측 패널과 같은 규칙). */}
          {((node) =>
            inline && active && portalReady
              ? createPortal(
                  <aside
                    aria-label="선택 날짜 상세"
                    className="fixed right-0 top-44 z-40 hidden max-h-[calc(100vh-13rem)] w-[21rem] overflow-y-auto overscroll-contain rounded-l-2xl border border-r-0 border-hairline-strong bg-canvas p-3 shadow-xl lg:block dark:border-white/10 dark:bg-surface-dark"
                  >
                    {node}
                  </aside>,
                  document.body,
                )
              : node)(
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
                  onClick={() => {
                    setFormEditId(null);
                    setFormDate(selected);
                  }}
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
                    const focused = focusEventId === event.id;
                    return (
                      <div
                        key={event.id}
                        // 주간 격자에서 고른 일정으로 스크롤·강조한다 — 클릭의 목적이 그것이다.
                        // ⚠⚠ **초점당 한 번만** 스크롤한다. 이 화면은 2초 주기로 폴링하므로 조건만
                        //    보고 스크롤하면 사용자가 아래로 내려도 계속 위로 끌려 올라간다
                        //    (사진 쪽에서 실제로 겪은 버그 — 같은 함정을 두 번 파지 않는다).
                        ref={(el) => {
                          if (el && focused && eventScrolledForRef.current !== event.id) {
                            eventScrolledForRef.current = event.id;
                            el.scrollIntoView({ block: "nearest", behavior: "smooth" });
                          }
                        }}
                        className={[
                          "space-y-0.5 rounded-lg border p-1 transition",
                          focused ? "border-primary ring-2 ring-primary-ring" : "border-transparent",
                        ].join(" ")}
                      >
                        {/* 수정·삭제는 서버가 내려준 canEdit 로만 노출한다(작성자 본인·총괄 관리자). */}
                        <div className="flex items-center gap-1">
                          <div className="min-w-0 flex-1">
                            <CalendarEventChip
                              event={event}
                              color={findLabelDef(labels, event.labelId).color}
                            />
                          </div>
                          {event.canEdit && (
                            <div className="flex shrink-0 items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setFormEditId(event.id);
                                  setFormDate(dateFromKey(event.dateKey));
                                }}
                                aria-label={`${event.title} 일정 수정`}
                                title="수정"
                                className="grid h-6 w-6 place-items-center rounded-lg text-muted transition hover:bg-surface-strong hover:text-ink dark:hover:bg-white/10 dark:hover:text-on-dark"
                              >
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M12 20h9" />
                                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDelete(event)}
                                aria-label={`${event.title} 일정 삭제`}
                                title="삭제"
                                className="grid h-6 w-6 place-items-center rounded-lg text-muted transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                              >
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M3 6h18" />
                                  <path d="M8 6V4h8v2" />
                                  <path d="M19 6l-1 14H6L5 6" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>
                        {focused && <ScheduleDetail event={event} labels={labels} />}
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
                              aria-label="사진 크게 보기 닫기"
                              title="닫기"
                              className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-white/15 text-white transition hover:bg-white/25"
                            >
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                                <path d="M18 6 6 18M6 6l12 12" />
                              </svg>
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
                      // 주간 격자에서 고른 항목으로 스크롤·강조한다 — 클릭의 목적이 그것이다.
                      // ⚠⚠ **초점당 한 번만** 스크롤한다. ref 콜백은 렌더마다 다시 붙는데 이 화면은
                      //    2초 주기로 폴링하므로, 조건만 보고 스크롤하면 사용자가 아래로 내려도
                      //    계속 위로 끌려 올라간다(사용자 실측 2026-08-20 — 14:07 선택 후 스크롤 불가).
                      ref={(el) => {
                        if (el && focusMediaId === m.id && scrolledForRef.current !== m.id) {
                          scrolledForRef.current = m.id;
                          el.scrollIntoView({ block: "nearest", behavior: "smooth" });
                        }
                      }}
                      className={[
                        "rounded-lg border bg-canvas p-2 transition dark:bg-surface-dark",
                        focusMediaId === m.id
                          ? "border-primary ring-2 ring-primary-ring"
                          : "border-hairline dark:border-white/10",
                      ].join(" ")}
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
                        {/* 삭제 불가 사유를 구분해 보여준다 — 버튼이 그냥 사라지면 고장으로 읽힌다.
                            다만 "남의 사진"일 때는 아무것도 띄우지 않는다(설명할 일이 아니다).
                            사번이 비어 주인을 특정할 수 없는 과거 사진만 안내한다. */}
                        {!m.canDelete && !m.workerId && (
                          <span
                            title="업로드 당시 작업자 사번이 기록되지 않아 소유자를 확인할 수 없습니다. 삭제는 최고관리자에게 요청하세요."
                            className="h-fit shrink-0 rounded-lg px-2 py-1 text-[10px] font-medium text-muted dark:text-on-dark-soft"
                          >
                            작업자 정보 없음
                          </span>
                        )}
                        {m.canDelete && (
                          // 일정 카드의 휴지통과 같은 아이콘 버튼 — 문자 버튼 금지(2026-08-27 사용자 결정).
                          <button
                            type="button"
                            onClick={() => deleteMedia(m.id)}
                            aria-label="사진 삭제"
                            title="삭제"
                            className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                          >
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M3 6h18" />
                              <path d="M8 6V4h8v2" />
                              <path d="M19 6l-1 14H6L5 6" />
                            </svg>
                          </button>
                        )}
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
                                {/* 작성자 식별자 — 같은 카드 위쪽 메타데이터가 `작업자 … · EMP-6861`
                                    을 쓰므로 여기도 **사번으로 맞춘다**. 저장값은 로그인 ID(`sub`)라
                                    `worker_alias`(secondary→primary)로 접어 사번을 얻는다.
                                    ★ 표시만 접는다. 값 자체를 사번으로 바꾸면 안 된다 — 댓글 수정·삭제
                                      권한이 저장된 `author_id` 대조로 판정되므로 사번을 넣으면 자기 댓글을
                                      자기가 못 고친다(`api/calendar/media/comment/route.ts` commentScope).
                                    ⚠ 접히지 않는 계정(별칭 미등록)은 `ID` 로 정직하게 쓴다 — 로그인 ID 를
                                      `사번` 이라 부르면 한 화면에서 같은 사람이 두 사번을 가진 것처럼
                                      읽힌다(2026-08-20 실측 — `사번 admin6861` vs `EMP-6861`). */}
                                {c.authorId && (
                                  <span className="font-normal text-muted dark:text-on-dark-soft">
                                    {workerAliases?.[c.authorId]
                                      ? ` · 사번 ${workerAliases[c.authorId]}`
                                      : ` · ID ${c.authorId}`}
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
                                {/* 원문과 같거나 비어 있으면 **흰 바탕 + 반투명**(잠김) →
                                    고치면 **살짝 진한 회색 + 불투명**(2026-08-27 사용자 결정).
                                    ⚠ 빨강은 이 화면에서 삭제 계열이 쓰고 있어 저장에 쓰지 않는다. */}
                                <button
                                  type="button"
                                  onClick={saveCommentEdit}
                                  disabled={
                                    !editingComment.body.trim() ||
                                    editingComment.body.trim() === c.body.trim()
                                  }
                                  className="shrink-0 rounded-lg border border-hairline bg-surface-strong px-2 py-1.5 text-[10px] font-semibold text-ink transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-canvas disabled:opacity-40 dark:border-white/10 dark:bg-white/15 dark:text-on-dark dark:disabled:bg-surface-dark"
                                >
                                  수정
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
                          {/* 원형 전송 버튼(위 화살표) — 입력이 비어 있으면 반투명(잠김) → 입력하면
                              불투명(2026-08-27 사용자 결정). 문자 라벨을 쓰지 않으므로
                              「한국어 단독·영문 라벨 금지」 규칙과도 충돌하지 않는다. */}
                          <button
                            type="button"
                            onClick={() => addComment(m.id)}
                            disabled={!(commentDraft[m.id] ?? "").trim()}
                            aria-label="댓글 등록"
                            title="댓글 등록"
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-on-primary transition hover:bg-primary-active disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 19V5" />
                              <path d="m5 12 7-7 7 7" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}
        </div>
        </div>

        {/* ★ 탭에서는 두 모달을 body 로 포털한다 — 페이저 트랙의 `translateX` 안에서는
            좌표 기준이 트랙이 되어 화면 밖·낮은 z 로 그려진다(사이드바와 같은 이유). */}
        {((node) => (inline && portalReady ? createPortal(node, document.body) : node))(
          <>
        {formDate && (
          <ScheduleEventFormModal
            floating={inline}
            dateKey={toDateKey(formDate)}
            events={eventsByDate[toDateKey(formDate)] ?? []}
            labels={labels}
            labelsCanEdit={labelsCanEdit}
            initialEditId={formEditId}
            onLabelsChange={handleLabelsChange}
            onAdd={handleAddEvent}
            onUpdate={handleUpdateEvent}
            onClose={() => {
              setFormDate(null);
              setFormEditId(null);
            }}
          />
        )}

        {pendingDelete && (
          <ScheduleDeleteConfirm
            floating={inline}
            event={pendingDelete}
            label={findLabelDef(labels, pendingDelete.labelId)}
            onCancel={() => setPendingDelete(null)}
            onConfirm={() => {
              handleDeleteEvent(pendingDelete.id);
              setPendingDelete(null);
            }}
          />
        )}
          </>,
        )}

        {writeError && (
          <div className="absolute inset-x-0 bottom-0 z-20 border-t border-red-200 bg-red-50 px-4 py-2.5 dark:border-red-500/30 dark:bg-red-950/80">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-[11px] leading-snug text-red-700 dark:text-red-300">
                {writeError}
              </p>
              <button
                type="button"
                onClick={() => setWriteError(null)}
                className="shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-semibold text-red-700 transition hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-500/20"
              >
                닫기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 일정 삭제 확인 — 삭제는 낙관적 반영 후 서버 요청이라 되돌릴 수 없다. 한 단계를 둔다.
function ScheduleDeleteConfirm({
  floating = false,
  event,
  label,
  onCancel,
  onConfirm,
}: {
  /** 탭(inline)에서 body 로 포털돼 뜨는가. 위 폼 모달과 같은 이유. */
  floating?: boolean;
  event: CalendarEvent;
  label: ScheduleLabelDef;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      // 위 폼 모달과 같은 이유로 탭에서는 fixed + 포털. 삭제 확인은 폼보다 위여야 한다.
      className={
        floating
          ? "fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          : "absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
      }
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="일정 삭제 확인"
    >
      <div
        className="w-full max-w-[320px] rounded-2xl border border-hairline-strong bg-canvas p-4 dark:border-white/10 dark:bg-surface-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-bold text-ink dark:text-on-dark">일정을 삭제할까요?</p>
        <div className="mt-2.5 rounded-xl border border-hairline bg-surface-soft px-2.5 py-2 dark:border-white/10 dark:bg-surface-dark-elevated">
          <CalendarEventChip event={event} color={label.color} />
          <p className="mt-1 px-2 text-[10px] text-muted dark:text-on-dark-soft">
            {formatDateKeyLabel(event.dateKey)}
          </p>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted dark:text-on-dark-soft">
          삭제하면 되돌릴 수 없습니다.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-surface-strong dark:hover:bg-white/10"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700"
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}

// 문자열을 글자 단위 span 으로 렌더 — key 에 글자값을 넣어 바뀐 글자만 remount 되어
// 롤링(슬라이드업) 애니메이션이 돈다. 헤더 시계와 같은 `.clock-roll-char` 를 공유한다.
// ⚠ 한때 헤더 부제 전용이라 보고 지웠다가 되살렸다(2026-08-28) — 부제를 없애면서 사용처가
//   0 이 됐지만, 하단 누적 스트립도 같은 롤링을 쓰기로 했다.
function RollingChars({ text }: { text: string }) {
  return (
    <>
      {text.split("").map((ch, i) => (
        <span key={`${i}-${ch}`} className="clock-roll-char">
          {ch === " " ? " " : ch}
        </span>
      ))}
    </>
  );
}

// 헤더 중앙 라이브 시계 — yyyy/mm/dd(요일) hh:mm:ss. 매초 갱신, 바뀐 글자만 롤링(슬라이드업) 애니메이션.
// `part` 로 갈라 **다른 자리에** 렌더한다(2026-08-28 사용자 지시) — date 는 브랜드(VitAlGuard)
// 옆, time 은 헤더 정중앙. 한 덩어리로 두면 둘이 함께 오른쪽으로 밀려 중앙에 못 온다.
// ⚠ 두 번 쓰므로 타이머도 둘이다. 상위에서 now 를 만들어 내려보내면 매초 DemoDashboard 전체가
//   리렌더된다 — 시계가 이 컴포넌트로 격리돼 있는 이유가 그것이다. 초당 setState 2회가 훨씬 싸다.
function HeaderClock({ part }: { part: "date" | "time" }) {
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
  const text = `${now.getFullYear()}/${p2(now.getMonth() + 1)}/${p2(now.getDate())}(${dow})`;
  const time = `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;

  // 날짜 — 브랜드 옆. 글꼴 그대로 둔다: 한글 요일과 괄호는 5×7 도트 글리프로 못 그린다
  // (한글은 5열에 안 들어가고, 늘리면 자릿수 규칙이 깨진다).
  // 각 글자를 개별 span 으로 — 바뀐 글자만 key 변경으로 remount 되어 롤링 애니메이션이 돈다.
  if (part === "date") {
    return (
      <span
        aria-label={`현재 날짜 ${text}`}
        className="hidden select-none whitespace-nowrap font-mono text-[15px] font-semibold tabular-nums tracking-[0.04em] text-ink dark:text-on-dark lg:inline"
      >
        {text.split("").map((ch, i) => (
          <span key={`${i}-${ch}`} className="clock-roll-char">
            {ch === " " ? " " : ch}
          </span>
        ))}
      </span>
    );
  }

  // 시:분:초만 도트(2026-08-28 사용자 지시).
  // ⚠ 초는 매초 바뀌는 자리라 롤링(위로 슬라이드)이 아니라 뒤집기가 맞다 — 롤링은 글자가
  //   위아래로 흘러 읽는 동안 시선이 따라가지만, 뒤집기는 제자리에서 값만 갈린다.
  // ★ 7-세그먼트가 아니라 도트다(사용자 결정) — 세그먼트는 dim(꺼진 획)까지 켜서 이 크기에서
  //   획이 흐릿하게 뭉쳐 보였다. 도트는 켜진 점만 그려 또렷하다.
  // ⚠ digitsOnly — 콜론까지 도트로 그리면 숫자와 무게가 같아져 시·분·초의 경계가 흐려진다.
  //   구분자는 글꼴로 두어 덩어리를 갈라 준다.
  return <DotMatrix text={time} size={3} gap={1} digitsOnly label={`시각 ${time}`} />;
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
  // 상단 페이저 활성 페이지 — ERP: 스마트경리 활성 시 하단 부속 UI(DB 스트립) 숨김.
  // ⚠️ 탭을 추가·재배열하면 이 인덱스가 밀린다. 매직넘버 2 를 쓰다 '안전뉴스' 탭 삽입으로
  //    한 칸 밀려서 상수로 뽑았다(pages 배열 순서와 반드시 함께 본다).
  const [pagerIdx, setPagerIdx] = useState(0);
  const MONITOR_PAGE_IDX = 0; // pages 배열의 '실시간 현장 관제' 위치
  const CALENDAR_PAGE_IDX = 2; // pages 배열의 '일정 캘린더' 위치(안전뉴스 다음)
  // 캘린더 탭으로 보내는 신호 — 헤더 아이콘·팝업을 걷어낸 뒤(2026-08-20 사용자 결정)
  // 새 현장 사진 토스트와 오늘 위험작업 칩이 여기로 보낸다. seq 로 매번 재발동.
  const [calendarJump, setCalendarJump] = useState<{ idx: number; seq: number } | undefined>();
  const jumpSeqRef = useRef(0);
  const goCalendarTab = useCallback(() => {
    jumpSeqRef.current += 1;
    setCalendarJump({ idx: CALENDAR_PAGE_IDX, seq: jumpSeqRef.current });
  }, [CALENDAR_PAGE_IDX]);

  // 캘린더 탭에서는 우하단 배치 어시스턴트(LLM) 위젯을 띄우지 않는다(2026-08-20 사용자 결정).
  // ⚠ 위젯은 body 로 포털돼 이 컴포넌트 밖에 있고, 그것을 렌더하는 page.tsx 는 서버 컴포넌트라
  //   프롭으로 상태를 못 내린다. body 표식 + globals.css 로 잇는다.
  // 정리(cleanup)에서 표식을 지운다 — 안 지우면 로그아웃·언마운트 후에도 위젯이 숨은 채 남는다.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const hide = pagerIdx === CALENDAR_PAGE_IDX;
    if (hide) document.body.dataset.hideAssistant = "1";
    else delete document.body.dataset.hideAssistant;
    return () => {
      delete document.body.dataset.hideAssistant;
    };
  }, [pagerIdx, CALENDAR_PAGE_IDX]);
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
  // 좌표 품질 요약 — 서버가 **솎기 전** 점으로 계산해 준다(점별이 아니라 구간 하나에 한 벌).
  const [trailQuality, setTrailQuality] = useState<TrackQuality | null>(null);
  const [trailCoarse, setTrailCoarse] = useState<TrackCoarsePoint[] | null>(null);
  const [sirenEnabled, setSirenEnabled] = useState(true);
  const [audioArmed, setAudioArmed] = useState(false); // 오디오 컨텍스트 running 여부(브라우저 제스처 unlock)
  const [slots, setSlots] = useState<SlotAssignments>(() => Array(SLOT_COUNT).fill(null));
  const [queueModalSlot, setQueueModalSlot] = useState<number | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  // 종 아이콘 미확인 배지 — 대응 확인(ack)이 안 된 알림이 하나라도 있으면 빨간 점을 띄운다.
  // 이력 모달이 열릴 때가 아니라 헤더에서 따로 세어야 모달을 안 열어도 알 수 있다.
  const [unackedAlerts, setUnackedAlerts] = useState(0);
  // 미확인 알림 집계 — 60초마다, 그리고 이력 모달을 닫을 때(대응 확인 반영) 다시 센다.
  useEffect(() => {
    let alive = true;
    const count = async () => {
      const token = getSessionToken();
      try {
        const res = await fetch("/api/alerts", {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { alerts?: { ack_at?: string | null }[] };
        if (alive) setUnackedAlerts((data.alerts ?? []).filter((a) => !a.ack_at).length);
      } catch {
        // 집계 실패는 화면을 막지 않는다 — 배지만 안 뜬다.
      }
    };
    count();
    const id = setInterval(count, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [alertsOpen]);

  // 팝업을 걷어낸 뒤(2026-08-20) "캘린더가 열려 있다" = "캘린더 탭이 활성이다".
  // 위험작업 재집계가 이 값을 본다. (미확인 배지 즉시 해소는 2026-08-26 에 걷어냈다 —
  // 확인의 단위가 "탭 열기"에서 "리스트 항목 클릭/[모두 확인]"으로 바뀌었기 때문.)
  const calendarOpen = pagerIdx === CALENDAR_PAGE_IDX;
  // 캘린더 배지·토스트 — 새 현장 사진(앱 업로드 미디어) 미확인 개수 배지 + 도착 알림 토스트.
  const [calendarNewCount, setCalendarNewCount] = useState(0);
  // 미확인 사진 목록 — 미니 달력 아래 리스트가 이것을 그린다. 배지 숫자와 같은 원천을 공유한다
  // (따로 세면 배지 10 · 리스트 8 같은 어긋남이 난다).
  const [calendarUnseenList, setCalendarUnseenList] = useState<CalendarUnseenMedia[]>([]);
  const [calendarToast, setCalendarToast] = useState<{ count: number; key: number } | null>(null);
  const calendarSeenRef = useRef<Set<string>>(new Set());
  const calendarRecentIdsRef = useRef<string[]>([]);
  const calendarSeenExistedRef = useRef(false);
  const calendarFirstPollRef = useRef(true);
  const calendarToastKeyRef = useRef(0);

  // 현재 조회된 미디어 전부를 '봄' 처리 → 배지 0. 미확인 리스트의 [모두 확인]이 호출한다.
  const markCalendarSeen = useCallback(() => {
    const seen = calendarSeenRef.current;
    calendarRecentIdsRef.current.forEach((id) => seen.add(id));
    saveCalendarSeen([...seen]);
    setCalendarNewCount(0);
    setCalendarUnseenList([]);
    setCalendarToast(null);
  }, []);

  // 항목 하나를 '봄' 처리 — 미확인 리스트에서 클릭할 때. 배지도 함께 준다.
  const markCalendarMediaSeen = useCallback((id: string) => {
    const seen = calendarSeenRef.current;
    if (seen.has(id)) return;
    seen.add(id);
    saveCalendarSeen([...seen]);
    setCalendarUnseenList((prev) => prev.filter((m) => m.id !== id));
    setCalendarNewCount((prev) => Math.max(0, prev - 1));
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
      const json = (await res.json()) as {
        ok?: boolean;
        media?: (Record<string, string | null> & { id?: string | null })[];
      };
      if (!json.ok || !Array.isArray(json.media)) return;
      const items: CalendarUnseenMedia[] = [];
      for (const m of json.media) {
        if (!m.id || !m.date_key) continue;
        items.push({
          id: m.id,
          dateKey: m.date_key,
          capturedAt: m.captured_at ?? null,
          mediaType: m.media_type ?? "image",
          title: m.title ?? null,
          uploader: m.uploader ?? null,
          thumbnailUrl: m.thumbnail_url ?? null,
          mediaUrl: m.media_url ?? null,
        });
      }
      const ids = items.map((m) => m.id);
      const seen = calendarSeenRef.current;
      const wasFirst = calendarFirstPollRef.current;
      calendarFirstPollRef.current = false;

      // 첫 폴이고 저장된 seen 이 없으면 baseline(현재 전부 봄) → 배지 0.
      // ⚠ 종전의 "캘린더 열려 있으면 즉시 봄 처리" 분기는 제거했다(2026-08-26) —
      //   확인 단위가 항목 클릭/[모두 확인]으로 바뀌어, 열려 있다는 이유로 폴이 지우면
      //   미확인 리스트가 60초 안에 증발한다.
      if (wasFirst && !calendarSeenExistedRef.current) {
        ids.forEach((id) => seen.add(id));
        saveCalendarSeen([...seen]);
        calendarRecentIdsRef.current = ids;
        setCalendarNewCount(0);
        setCalendarUnseenList([]);
        return;
      }

      const prevIds = new Set(calendarRecentIdsRef.current);
      const unseenItems = items.filter((m) => !seen.has(m.id));
      // 최신 도착이 위로 — 촬영시각이 없으면 날짜키로 대신 정렬한다.
      unseenItems.sort((a, b) => (b.capturedAt ?? b.dateKey).localeCompare(a.capturedAt ?? a.dateKey));
      const arrived = unseenItems.filter((m) => !prevIds.has(m.id)); // 직전 조회엔 없던 새 도착분
      calendarRecentIdsRef.current = ids;
      setCalendarNewCount(unseenItems.length);
      setCalendarUnseenList(unseenItems);
      // 새로 도착한 사진이 있고 첫 폴이 아니면 토스트(초기 로드 스팸 방지).
      if (arrived.length > 0 && !wasFirst) {
        calendarToastKeyRef.current += 1;
        setCalendarToast({ count: unseenItems.length, key: calendarToastKeyRef.current });
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
  // 사용자 관리(가입 승인) 권한 — owner 또는 관리 권한을 받은 VitAlGuard 관리자.
  // 판정은 서버(/api/admin/profile)가 내려준 값을 그대로 쓴다(게이트와 동일 규칙 보장).
  const [canManageUsers, setCanManageUsers] = useState(false);
  // 로그인 상태 칩 표시용 — 이름/직책/사번/아이디. 환경 관리자(owner)도 '내 정보'로 등록한 값이 온다
  // (미등록이면 필드가 null → 칩은 "관리자"로 표시).
  const [loginInfo, setLoginInfo] = useState<{
    name: string | null;
    jobTitle: string | null;
    employeeId: string | null;
    username: string | null;
    guardianName: string | null;
    guardianPhone: string | null;
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
          setCanManageUsers(!!j.canManageUsers);
          const p = j.profile;
          setLoginInfo(
            p
              ? {
                  name: p.name ?? null,
                  jobTitle: p.job_title ?? null,
                  employeeId: p.employee_id ?? null,
                  username: p.username ?? null,
                  guardianName: p.guardian_name ?? null,
                  guardianPhone: p.guardian_phone ?? null,
                }
              : null,
          );
        }
      })
      .catch(() => {});
  }, []);
  const canAdminMenu = role === "owner" || adminAccess;
  // 내 정보에 등록한 본인 보호자 — 알람 작업자 사번(employeeId)이 로그인 회원 본인 사번과
  // 일치하고 샘플에 보호자가 없을 때만 채운다. 폰 발신값·데모 목록은 그대로 우선하며,
  // 본인 계정 등록값만 쓰므로 다른 작업자·회원의 보호자는 노출되지 않는다.
  const withMyGuardian = useCallback(
    (sample: VitalSample): VitalSample => {
      const myEmp = loginInfo?.employeeId?.trim();
      const gName = loginInfo?.guardianName?.trim();
      if (!myEmp || !gName) return sample;
      if (sample.guardianName) return sample;
      if ((sample.employeeId ?? "").trim() !== myEmp) return sample;
      const gPhone = loginInfo?.guardianPhone?.trim();
      return { ...sample, guardianName: gName, guardianPhone: gPhone || undefined };
    },
    [loginInfo],
  );
  const [siteInfo, setSiteInfo] = useState<SiteInfo>(DEFAULT_SITE_INFO);
  const [lastAccidentTs, setLastAccidentTs] = useState<string | null>(null);
  // 작업자 표 슬라이딩 모드 — auto: 세로 자동 슬라이딩 / manual: 정지 + 드래그 정렬
  const [slideMode, setSlideMode] = useState<"auto" | "manual">("auto");
  // 작업자 뷰 — table: 기존 표 / map: GPS 위성지도(마커 호버 시 생체 툴팁). 세션 한정(영속 없음).
  const [workerView, setWorkerView] = useState<"table" | "map">("table");
  // 국내 재해사례 데이터 출처 — 캐러셀 헤더 배지(좌측 화살표 우측)로 표시. 카드가 fetch 후 통지.

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
        const response = await fetch("/api/monitor/vital", {
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
      setTrailQuality(null);
      setTrailCoarse(null);
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
        const j = (await res.json()) as {
          ok?: boolean;
          points?: TrackPoint[];
          coarse?: TrackCoarsePoint[];
          quality?: TrackQuality;
        };
        if (alive && res.ok && j.ok && Array.isArray(j.points)) {
          setTrailPoints(j.points);
          // 요약이 없으면 옛 서버다 — 비워서 화면이 "모름" 으로 그리게 한다(0 으로 위장 금지).
          setTrailQuality(j.quality ?? null);
          setTrailCoarse(Array.isArray(j.coarse) ? j.coarse : null);
        }
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

  // 팝업 '확인'을 서버 알림 이력에도 기록(공유 ack) — 로컬 localStorage 억제와 별개로, 알림 이력의
  // 대응 상태에 반영된다. fire-and-forget(dismiss 를 네트워크로 막지 않음). 인증은 세션 Bearer.
  function persistAlertAck(workerId: string, type: "sos" | "fall") {
    const token = getSessionToken();
    void fetch("/api/alerts/ack", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ workerId, type }),
    }).catch(() => {});
  }

  function dismissSos() {
    if (activeSos) {
      setAcknowledgedSosTs((prev) => ({ ...prev, [activeSos.workerId]: activeSos.ts }));
      appendAckedAlertKey(`sos|${activeSos.workerId}|${activeSos.ts}`); // 새로고침 재팝업 방지 영속
      persistAlertAck(activeSos.workerId, "sos"); // 서버 공유 ack
    }
    setActiveSos(null);
  }

  function dismissFallAlert() {
    if (activeFallAlert) {
      setAcknowledgedFallTs((prev) => ({ ...prev, [activeFallAlert.workerId]: activeFallAlert.ts }));
      appendAckedAlertKey(`fall|${activeFallAlert.workerId}|${activeFallAlert.ts}`); // 새로고침 재팝업 방지 영속
      persistAlertAck(activeFallAlert.workerId, "fall"); // 서버 공유 ack
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
    type: "sos" | "fall" | "vital" | "geofence",
  ) {
    // 확인 즉시 자연키 영속 — 닫기 전에 새로고침해도 재팝업 안 함
    // (vital·geofence 는 레벨형이라 복귀 시 ack 해제 → localStorage 영속 제외).
    if (type !== "vital" && type !== "geofence")
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

  // 작업자 관제에는 실측 스트림만 사용한다. 목업은 data_mockup 전용 섹션에만 표시한다.
  const allLatest = useMemo(() => data.latest, [data.latest]);

  const latestMap = useMemo(() => {
    return new Map(allLatest.map((sample) => [sample.workerId, sample]));
  }, [allLatest]);

  // 이벤트 시각 추적 — store 의 manualSos/fallDetected 는 비-sticky 라
  // 마지막 발생 시각은 recent 스트림을 스캔해서 계산.
  const lastSosByWorker = useMemo(() => {
    const map = new Map<string, string>();
    const freshAfter = Date.now() - ALARM_FRESH_MS;
    for (const s of data.recent) {
      if (s.manualSos !== true) continue;
      if (new Date(s.ts).getTime() < freshAfter) continue; // 신선도 게이트 — stale 이벤트 재팝업 차단
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
    const freshAfter = Date.now() - ALARM_FRESH_MS;
    for (const s of data.recent) {
      if (s.fallDetected !== true) continue;
      if (new Date(s.ts).getTime() < freshAfter) continue; // 신선도 게이트 — stale 낙상 재팝업 차단
      const existing = map.get(s.workerId);
      if (!existing || s.ts > existing) map.set(s.workerId, s.ts);
    }
    return map;
  }, [data.recent]);

  // 낙상 "확인 중"(pending) — 워치가 프롬프트 표시 중인 fall 후보(에스컬레이션 전). 워치·웹 동기화용.
  // 결과(해제/moved_cancelled) 샘플은 ring 에 없으므로 창 기반 근사: FALL_PENDING_MS 지나면 자연 만료.
  const fallPendingByWorker = useMemo(() => {
    const map = new Map<string, string>();
    const freshAfter = Date.now() - FALL_PENDING_MS;
    for (const s of data.recent) {
      if (s.fallCandidate !== true || s.fallDecision !== "fall") continue;
      if (new Date(s.ts).getTime() < freshAfter) continue;
      const existing = map.get(s.workerId);
      if (!existing || s.ts > existing) map.set(s.workerId, s.ts);
    }
    // 이미 에스컬레이션된(=발생) 워커는 pending 아님 — 표에 "발생"으로 표시된다.
    for (const [workerId, escTs] of lastFallByWorker) {
      const p = map.get(workerId);
      if (p !== undefined && escTs >= p) map.delete(workerId);
    }
    return map;
  }, [data.recent, lastFallByWorker]);

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
  // ★ 신선한 칼만만 내보낸다(2026-08-26). 서버는 심박이 끊겨도 마지막 추정치를 계속 준다 —
  //   그날 실측에서 EMP-6861 은 **심박이 32분째 없는데 행(피부온·배터리)은 3분 전까지** 왔다.
  //   행 신선도로는 안 걸리므로 여기서 막는다. 낡으면 `undefined` → 판정도 표시도 "모름" 이 된다.
  //   ⚠ 판정뿐 아니라 **표시·PSI 도 함께** 막힌다. 그게 맞다 — 32분 전 값을 현재값으로 보여주는
  //     것이 이 레포가 반복해 고쳐 온 형태다(하트비트 12시간·sticky 병합·지도 고스트).
  const freshCoreTemp = (workerId: string): number | undefined => {
    const est = data.coreTempEst?.[workerId];
    if (!est) return undefined;
    const ageMs = now - Date.parse(est.lastHrTs);
    if (!Number.isFinite(ageMs) || ageMs > CORE_TEMP_EST_MAX_AGE_MIN * 60_000) return undefined;
    return est.tempC;
  };

  const dangerVitalWorkers = useMemo(() => {
    const out: VitalSample[] = [];
    for (const s of data.latest) {
      if (s.manualSos === true || s.fallDetected === true) continue;
      const danger =
        heartRateStatus(s.heartRate, workActivity(s)) === "danger" ||
        // SpO₂ 는 신선한 측정(30분 이내)만 — 낡은 저산소 값이 경보를 계속 발화시키는 오탐 방지.
        spo2Status(freshSpo2(s, now)) === "danger" ||
        coreTempStatusC(freshCoreTemp(s.workerId)) === "danger";
      if (danger) out.push(s);
    }
    return out;
  }, [data.latest, now]);

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
        // 날씨 이력 저장·환경 알림은 서버가 세션이 있을 때만 수행한다(BE-AUTHZ-02) — 토큰 동봉 필수.
        fetch(`/api/weather?lat=${effLat}&lon=${effLon}&workers=${fieldCoords.count}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/kma-warning?lat=${effLat}&lon=${effLon}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        }),
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

  // calendarOpen(=캘린더 탭 활성) 을 deps 에 포함 — 탭에서 일정을 편집하고 나오면 즉시 재집계.
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
  // hrvBacked = 이 지수에 HRV(심박과 독립인 유일한 신호)가 실제로 들어갔는가.
  //   화면 문구를 산출 근거에 맞추려고 함께 계산한다 — 없으면 계산식에서 zHrv 항이 0 이 되고
  //   활동 보정 초과심박만 남아, 지수가 사실상 **심박의 단조 변환**이 된다.
  //   ⚠ 상시 워크아웃 구조에서는 대개 없다 — watchOS 가 워크아웃 중 심호흡 세션을 거부하고
  //     배경 HRV 측정도 일어나지 않는다(2026-08-13 실기기 실증). 그래도 앱이 꺼진 사이 측정분이
  //     앵커로 들어오는 경우가 있어 고정 문구가 아니라 샘플별 조건부로 둔다.
  const stressByWorker = useMemo(() => {
    const map = new Map<string, { result: StressResult; hrvBacked: boolean }>();
    for (const { workerId } of filledSlots) {
      const inputs = stressInputsFromSample(latestMap.get(workerId) ?? {});
      map.set(workerId, { result: computeStressIndex(inputs), hrvBacked: inputs.hrvSdnnMs !== undefined });
    }
    return map;
  }, [filledSlots, latestMap]);

  // 표 행이 쓰는 진입점 — 캐시에 없으면(슬롯 밖 표시 등) 그 자리에서 계산한다.
  // 호출부가 둘(자동 슬라이딩 복제본)이라 폴백을 인라인으로 두면 같은 식이 두 벌 생긴다.
  const stressFor = (workerId: string) => {
    const hit = stressByWorker.get(workerId);
    if (hit) return hit;
    const inputs = stressInputsFromSample(latestMap.get(workerId) ?? {});
    return { result: computeStressIndex(inputs), hrvBacked: inputs.hrvSdnnMs !== undefined };
  };

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
        const status = workerStatus(s, now, freshCoreTemp(s.workerId));
        const ageMs = now - Date.parse(s.ts);
        const ageSec = Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 1000)) : null;
        // 문턱(애플 60초·갤럭시 150초) 초과 미수신 = 표의 "연결끊김" 강등과 동일 기준 —
        // 지도도 마지막 상태색(false-OK) 대신 고스트(마지막 확인 위치)로 강등한다.
        const stale = ageSec !== null && ageSec * 1000 >= staleThresholdMs(s.dataOrigin);
        // 미착용 표식 — 라벨을 가르고 고스트(마지막 위치)로 강등한다. 워치 위치는 사람 위치가 아니다.
        const offBody = s.worn === false;
        // ★ 좌표 나이는 생체 나이와 **다른 축**이다(2026-08-20).
        //   서버 sticky merge 가 좌표를 직전 값에서 이어 주므로(store.ts `{...older, ...newer}` —
        //   좌표 없는 샘플엔 키 자체가 없어 older 가 살아남는다), 심박이 5초 전이어도 좌표는
        //   40분 전 것일 수 있다. 그 사실을 화면이 말하지 않으면 **작업자가 지금 거기 있다고**
        //   읽힌다. 폰이 정지 중이면 실제로 좌표가 5분마다 끊긴다(같은 날 실측 커버리지 25.1%).
        //   그래서 이어 주는 것 자체는 유지하고, **나이를 함께 실어** 판단은 사람에게 남긴다.
        const fixMs = s.locationTimestamp ? now - Date.parse(s.locationTimestamp) : NaN;
        const fixAgeSec = Number.isFinite(fixMs) ? Math.max(0, Math.round(fixMs / 1000)) : null;
        // 마지막 정확 fix 폴백(2026-08-31 사용자 결정 ①) — 최신 좌표가 부정확(> R-33 상한)이고
        // 최근 창(트레일 창과 동일 30분) 안에 정확 fix 가 있으면 **마커만** 그 위치를 우선한다.
        // 구획 판정 effect 는 여전히 원좌표(pt.lat/lon)를 본다 — 게이트가 걸러서 동작 불변.
        const rawCoarse =
          s.locationAccuracyMeters != null && s.locationAccuracyMeters > TRACK_LINE_ACC_MAX_M;
        const goodTsMs = s.lastAccurateTs ? Date.parse(s.lastAccurateTs) : NaN;
        const goodAgeSec = Number.isFinite(goodTsMs)
          ? Math.max(0, Math.round((now - goodTsMs) / 1000))
          : null;
        const useGoodFix =
          rawCoarse &&
          typeof s.lastAccurateLat === "number" &&
          typeof s.lastAccurateLon === "number" &&
          goodAgeSec !== null &&
          goodAgeSec <= TRACK_WINDOW_MIN * 60;
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
          // ★ 여기는 **행 ts 기준**이라 stale 이면 실제로 "샘플이 안 온다" 뿐이다 —
          //   그래서 종류를 재지 않고 disconnected 로 고정한다(리터럴 대신 라벨 정본을 쓴다).
          //   ⚠ 표(`isStale`)는 심박 시각 기준이라 이 둘은 **같은 기준이 아니다**(위 주석의
          //     "동일 기준"은 부정확하다). 표에서 심박끊김인 작업자가 지도에선 정상색이다.
          //     판정 기준을 맞추는 것은 이 트랙(라벨 분리) 밖이라 손대지 않았다.
          statusLabel: offBody ? OFF_BODY_LABEL : stale ? STALE_LABEL.disconnected : status.label,
          tone: stale || offBody ? "idle" : status.tone,
          ageSec,
          stale: stale || offBody,
          fixAgeSec,
          // 측위 정확도(m) — 실내 셀/와이파이 폴백(±100m 등급) 마커가 정밀한 점으로 위장하지
          // 않게 지도에 전달(2026-08-31 · R-33 의 현재 위치 확장). 미보고는 null 그대로.
          accM: s.locationAccuracyMeters ?? null,
          goodLat: useGoodFix ? s.lastAccurateLat : null,
          goodLon: useGoodFix ? s.lastAccurateLon : null,
          goodAccM: useGoodFix ? (s.lastAccurateAccM ?? null) : null,
          goodAgeSec: useGoodFix ? goodAgeSec : null,
        });
      } else {
        // ⚠ 사유 문구를 실제 원인에 맞춘다(2026-08-20). 종전 문구는 "위치 권한·로그인 게이트"만
        //   가리켰는데, 실측된 주 원인은 둘 다 아니었다 — 폰이 정지하면 좌표가 5분마다 끊기고
        //   (`distanceFilter` 100m × `maxFixAgeSec` 300초), 서버 재기동은 이어 주던 좌표를
        //   메모리 링과 함께 지운다. 권한만 보라고 안내하면 멀쩡한 권한을 계속 확인하게 된다.
        const reason = !s
          ? "미접속 — 수신 샘플 없음"
          : typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)
              ? "좌표 미수신 — 폰 정지 중이면 수 분 내 갱신 · 계속되면 위치 권한 확인"
              : "한국 범위 밖 좌표 — 표시 제외";
        excluded.push({ workerId, name: s?.workerName ?? workerId, reason });
      }
    }
    return { pts, excluded };
  }, [filledSlots, latestMap, data.workerProfiles, now]);

  // ── 현장 구획(반경 100m) 이탈 알림 ──────────────────────────────────────────
  // 지도 원과 동일 중심·반경으로 히스테리시스 판정. 워커별 상태 + 마지막 관측 ts(같은 샘플 재관측 시
  // 상태머신을 전진시키지 않아 이상치 1건이 틱 반복으로 이탈 확정되는 것을 방지).
// 이탈 streak 이 살아 있는 한계(ms) — **판정 신선도와 다른 축이다**(2026-08-27).
//
// 왜 나눠야 하나. 이탈 확정은 `GEOFENCE_EXIT_STREAK`(연속 3회)가 필요한데, 종전에는 상태 보존을
// 판정 게이트(60초)에 묶어 두었다. 그래서 **전송 주기가 60초보다 느린 기기는 streak 이 절대
// 3에 도달하지 못한다** — 새 표본이 오기 전에 상태가 지워져 1로 되돌아간다.
//
//   실측(2026-08-27 · 프로덕션 하루)
//     장우진 watchOS  전송 간격 중앙값   5.0초 · 60초 이상 간격   0.1% → 이탈 알림 1건
//     김태곤 WearOS   전송 간격 중앙값 120.6초 · 60초 이상 간격 100.0% → 이탈 알림 **0건**
//     같은 날 김태곤은 3연속 이상 이탈 구간이 2개 있었다(23/97 표본이 반경 밖 · 최대 482m).
//     이 effect 를 실제 타임스탬프로 재현하니 **상태 삭제 96회 / 표본 97개**, 최대 streak 1/3.
//
// 그래서 둘을 분리한다 — **낡은 좌표로 판정하지는 않되(게이트 유지), 상태까지 지우지는 않는다.**
//
// 20분은 손으로 고른 값이 아니라 **분포에서 나온 값**이다(GPS 동반 표본 7일 · 초).
//     watchos  p50   5.0 · p95   5.1
//     wearos   p50 120.7 · p95 **982.1** · p99 11,990
//   보존을 p95(≈16.4분) 위로 올려야 정상 전송이 몇 번 걸러져도 streak 이 살아남는다.
//   실데이터 재현에서 발화 수가 **p95 이상에서 2회로 안정**됐다(10분은 3회 — 상태 리셋이 한
//   이탈 구간을 둘로 쪼갠 과다 발화다). 20분·30분·60분 결과가 같아 **평탄 구간의 하단**을 골랐다.
//   p99(3.3시간)까지 덮지 않는 이유 = 그 간격은 근무 중이 아니다(야간·기기 꺼짐).
//
// ⚠ 이 값을 판정 게이트와 같은 숫자로 되돌리지 말 것 — 그 순간 느린 기기가 다시 조용해진다.
const GEOFENCE_STATE_KEEP_MS = 20 * 60_000;

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
    // ★ 두 집합을 나눈다 — `keep` 은 **상태를 살려 둘 대상**, 판정은 그중 신선한 것만.
    //   종전에는 하나였고, 그래서 전송이 느린 기기는 streak 이 못 쌓였다(GEOFENCE_STATE_KEEP_MS 주석).
    const keep = new Set<string>();
    for (const pt of workerMapData.pts) {
      const ageMs = pt.ageSec === null ? Number.POSITIVE_INFINITY : pt.ageSec * 1000;
      // 오래 사라진 것이 아니면 상태를 보존한다(미수신 ≠ 복귀).
      if (ageMs < GEOFENCE_STATE_KEEP_MS) keep.add(pt.workerId);
      // 판정은 신선한 좌표로만 — 낡은 좌표로 이탈을 선언하지 않는다.
      if (pt.ageSec === null || pt.ageSec >= 60) continue;
      // 부정확 측위(> R-33 상한)로는 판정하지 않는다 — 실내 셀/와이파이 폴백(±100m)이
      // "현장에 있는데 이탈 +140m" 오탐 경보를 만들었다(2026-08-31 실사고).
      if (!fixUsableForJudgment(pt.accM)) continue;
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
    // 오래(GEOFENCE_STATE_KEEP_MS) 사라진 워커만 상태 제거 — 재수신 시 초기 상태부터 다시 판정.
    // ⚠ 조건을 판정 게이트(60초)로 되돌리면 느린 기기의 streak 이 매번 초기화된다.
    for (const id of Array.from(states.keys())) {
      if (!keep.has(id)) states.delete(id);
    }
    const outs = new Set<string>();
    for (const [id, entry] of states) if (entry.st.outside) outs.add(id);
    setOutsideWorkers((prev) => {
      if (prev.size === outs.size && Array.from(outs).every((id) => prev.has(id))) return prev;
      return outs;
    });
  }, [workerMapData, siteCircleCenter, latestMap, recordGeofenceAlert]);

  // 지도 마커용 파생 — 생체 톤에 구획 이탈을 얹는다.
  // workerMapData 자체에 넣으면 구획 판정(위 effect)의 입력이라 순환 의존이 되므로 별도 파생으로 둔다.
  const workerMapPoints = useMemo(
    () =>
      workerMapData.pts.map((p) =>
        outsideWorkers.has(p.workerId)
          ? {
              ...p,
              tone: effectiveTone(p.tone, { stale: p.stale, outside: true }),
              statusLabel: p.stale ? p.statusLabel : "구획이탈",
            }
          : p,
      ),
    [workerMapData, outsideWorkers],
  );

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
      const status = overallStatus(latestMap.get(slot.workerId), now, freshCoreTemp(slot.workerId));
      if (status === "caution" || status === "danger") return pos;
    }
    return -1;
  }, [filledSlots, latestMap, now]);

  // 통합 안전 신호등용 — 등록 슬롯 작업자 worst-of status(낙상·SOS 포함) + 이상 상세.
  const workerSignal = useMemo<WorkerSignal>(() => {
    const rank: Record<VitalStatus, number> = { idle: 0, normal: 1, caution: 2, danger: 3 };
    let sev: VitalStatus = "idle";
    let count = 0;
    const issues: { name: string; metrics: string }[] = [];
    // 생체 미수신이라 **판정 자체가 불가능했던** 작업자 — 등록 인원에는 들어가지만 "정상"이 아니다.
    // 이 분리가 없으면 이상 0명일 때 대기 인원까지 "정상 N명 · 전 작업자 정상 범위"로 나간다.
    const waitingNames: string[] = [];
    // 수신 중·이상 없음 — 종전엔 아무 데도 안 실려서, 이상자가 하나라도 있으면 신호등이
    // 정상 수신 중인 사람을 통째로 침묵했다(2026-08-26 사용자 제보).
    const normalNames: string[] = [];
    for (const slot of filledSlots) {
      if (!slot) continue;
      count += 1;
      const sample = latestMap.get(slot.workerId);
      // 연결끊김은 생체 상태보다 우선 — stale 이면 주의(caution)로 강등하고 이상으로 집계.
      // sticky 직전값이 "정상"이어도 끊긴 작업자를 정상으로 보고하는 false-OK 를 막는다.
      const stale = isStale(sample, now);
      // 구획 이탈 — 워치는 작업 중에만 착용하므로 "착용 중 + 구획 밖"은 근무지 이탈로 본다.
      // stale 이면 위치 판정을 신뢰하지 않는다(미수신 ≠ 이탈, effectiveTone 내부 규칙).
      const outside = outsideWorkers.has(slot.workerId);
      // 가공하지 않은 생체 톤을 넘긴다 — 과거 여기서만 stale 을 미리 caution 으로 강등해
      // 표 행(원 톤 전달)과 결과가 갈렸다(감사 DLT-LIB-014).
      // 온열 경고(온열 ③·사용자 결정 08-13) — warning 단계만 신호등을 최소 주의로 올린다.
      // caution 단계는 텔레그램·표시 전용(신호등 불변). 생체 판정(workerStatus)은 건드리지 않고
      // 톤 합성에만 얹는다 — stale 이면 온열 판정도 낡은 데이터라 얹지 않는다.
      const heatWarning = !stale && data.heatStage?.[slot.workerId] === "warning";
      const baseTone = effectiveTone(workerStatus(sample, now, freshCoreTemp(slot.workerId)).tone, {
        stale,
        outside,
      });
      const tone: WorkerStatus["tone"] = heatWarning ? worseTone(baseTone, "caution") : baseTone;
      if (rank[tone] > rank[sev]) sev = tone;
      const name = sample?.workerName?.trim() || sample?.employeeId?.trim() || slot.workerId;
      if (stale) {
        // 구획 밖에서 끊긴 것은 마지막 확인 위치가 작업구역 밖이라는 뜻 — 수색 시작점이 달라진다.
        issues.push({ name, metrics: disconnectMetric(outside) });
      } else if (tone === "caution" || tone === "danger") {
        const ms: string[] = [];
        if (sample?.manualSos) ms.push("SOS");
        if (sample?.fallDetected) ms.push("낙상");
        const hr = heartRateStatus(sample?.heartRate, workActivity(sample ?? {}));
        if (hr === "caution" || hr === "danger") ms.push("심박");
        const sp = spo2Status(freshSpo2(sample, now));
        if (sp === "caution" || sp === "danger") ms.push("SpO₂");
        const tp = coreTempStatusC(freshCoreTemp(slot.workerId));
        if (tp === "caution" || tp === "danger") ms.push("체온");
        if (heatWarning) ms.push("온열 경고");
        const withLoc = withOutsideMetric(ms, outside);
        issues.push({ name, metrics: withLoc.length ? withLoc.join("·") : "이상" });
      } else if (tone === "idle") {
        // 생체 샘플이 없어 판정 자체를 못 한 작업자. stale 이면 effectiveTone 이 caution 으로
        // 올리므로 여기 오지 않는다 — 즉 이 목록은 순수한 '수신 대기'다.
        waitingNames.push(name);
      } else {
        // 남는 것은 tone === "normal" — 수신 중이고 생체도 정상 범위. 여기까지 온 사람만
        // "지금 감시되고 있다" 고 말할 수 있다(stale·이상은 위 분기가 이미 걷어 갔다).
        normalNames.push(name);
      }
    }
    // 문구 산출은 순수 함수에 위임 — 등록 인원과 **판정된 인원**을 분리해 적는다(가드 테스트로 고정).
    const copy = workerSignalCopy({
      count,
      evaluated: count - waitingNames.length,
      issues,
      waitingNames,
      normalNames,
    });
    return {
      sev,
      summary: copy.summary,
      short: copy.short,
      detail: {
        title: copy.title,
        location: "작업자 GPS · 작업자 모니터링 표 참조",
        lines: copy.lines,
      },
    };
  }, [filledSlots, latestMap, now, outsideWorkers, data.heatStage]);

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
      <header className="relative flex min-h-16 flex-wrap items-center justify-between gap-4 rounded-xl border border-hairline-strong bg-canvas px-6 py-3 dark:border-white/10 dark:bg-surface-dark">
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
            {/* 부제("관제 · 실시간 수집 · DB 영속 N건 누적")는 뺐다(2026-08-28 사용자 지시).
                같은 누적 수치는 관제 탭 하단 스트립이 그대로 말한다(`formatPersisted(data.totalPersisted)`).
                ★ 평시에는 h1 하나만 남아 로고와 세로 가운데로 맞는다 — 부모가 items-center 라
                  줄이 하나면 정렬이 저절로 성립한다(별도 정렬 클래스가 필요 없다).
                ⚠ DB 조회 실패 경고는 **남긴다.** 장식이 아니라 운영 정보다 — 지우면 누적 집계가
                  비어 있는 이유를 화면 어디서도 알 수 없다. 평시엔 렌더되지 않아 정렬도 안 깨진다. */}
            <p className="mt-1 truncate text-xs text-body empty:hidden dark:text-on-dark-soft">
              {/* DB 조회 실패를 화면이 말한다 — `—` 만 보면 "값이 원래 없다"로 읽힌다.
                  실시간 감시(latest)는 메모리라 계속 도는 중이므로 그 점도 함께 밝힌다. */}
              {data.degraded && data.degraded.length > 0 && (
                <span
                  title={`DB 조회 실패: ${data.degraded.join(" · ")}\n실시간 수신·판정은 계속 동작합니다. 누적 집계·직급 등 DB 기반 표시만 비어 있습니다.`}
                  className="ml-2 whitespace-nowrap rounded-pill bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-400/15 dark:text-amber-300"
                >
                  ⚠ DB 조회 실패 — 표시 불완전
                </span>
              )}
            </p>
          </div>
          {/* 날짜는 브랜드 옆에 붙인다(2026-08-28 사용자 지시) — 도트 시계가 중앙으로 빠지면서
              혼자 남으면 헤더 오른쪽이 비어 보인다. */}
          <HeaderClock part="date" />
        </div>

        {/* 도트 시계 — 헤더 **정중앙**(2026-08-28 사용자 지시).
            ★ justify-between 으로는 중앙이 안 맞는다 — 좌우 블록 폭이 다르면 가운데 칸이 그만큼
              밀린다. 헤더 폭 기준의 절대 중앙이어야 하므로 absolute + -translate-x-1/2 로 못박는다.
            ⚠ pointer-events-none — 절대 배치라 좌우 블록 위를 덮을 수 있는데 시계는 클릭 대상이
              아니다. 아래 버튼의 클릭을 가로채면 안 된다.
            ⚠ 래퍼는 **flex 여야 한다.** `block` 으로 두면 DotMatrix 가 인라인 라인박스에 놓이고,
              `inline-grid` 의 baseline 이 **마지막 도트 행**에 맞춰지면서 위쪽에 여백이 생긴다
              — 래퍼는 중앙인데 시계만 7.3px 아래로 쏠린다(2026-08-28 실측). flex 는 baseline
              정렬을 쓰지 않으므로 래퍼 높이가 곧 시계 높이가 되고 -translate-y-1/2 가 맞아떨어진다. */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center lg:flex">
          <HeaderClock part="time" />
        </div>

        <div className="flex min-w-0 items-center gap-2">
          {/* 로그인 상태 칩 — 표시 전용(클릭 없음). 접속점 + 이름/직책만(사번·아이디 비노출).
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
                  {/* 이름·직책은 owner 도 '내 정보'에서 등록한다 — 미등록이면 종전대로 "관리자". */}
                  <span className="shrink-0 truncate font-semibold text-ink dark:text-on-dark">
                    {loginInfo?.name ?? "관리자"}
                    {loginInfo?.jobTitle ? ` ${loginInfo.jobTitle}` : ""}
                  </span>
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
                tooltip:
                  unackedAlerts > 0
                    ? `SOS·낙상 알림 이력 — 미확인 ${unackedAlerts}건`
                    : "SOS·낙상 알림 이력 (발생/대응 시각)",
                onSelect: () => setAlertsOpen(true),
                icon: (
                  // 미대응 알림이 있으면 종 우상단에 빨간 점 — 개수는 툴팁과 이력 모달이 말한다.
                  <span className="relative inline-flex">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                    {unackedAlerts > 0 && (
                      <span
                        className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#ef4444] ring-2 ring-canvas dark:ring-surface-dark"
                        aria-label={`미확인 알림 ${unackedAlerts}건`}
                      />
                    )}
                  </span>
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
              // owner(env 관리자) 또는 관리 권한을 받은 VitAlGuard 관리자만 노출 — 가입 신청 승인/거절.
              ...(role === "owner" || canManageUsers
                ? [
                    {
                      title: "사용자 관리",
                      tooltip: "가입 신청 승인/거절 (owner·VitAlGuard 관리자)",
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
              // 로그인 계정 본인 정보 수정 — env 관리자(owner)도 포함(2026-08-04).
              // owner 는 users 행이 없어 빠져 있었는데, 그 계정에만 내 정보가 없는 상태였다.
              ...(role === "admin" || role === "owner"
                ? [
                    {
                      title: "내 정보",
                      tooltip:
                        role === "owner"
                          ? "내 관리자 정보 수정 (이름·회사·연락처·부서/직책·사번)"
                          : "내 가입 정보 수정 (이름·회사·연락처·비밀번호)",
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
        gotoSignal={calendarJump}
        onPageChange={setPagerIdx}
        pages={[
          {
            title: "실시간 현장 관제",
            content: (
              <div className="flex flex-col gap-4">
      {/* 공정률·무사고 — 탭 바로 아래 전체 폭 가로 바(사용자 요청). */}
      <GaugePanel siteInfo={siteInfo} nowMs={now} lastAccidentTs={lastAccidentTs} />

      <section className="overflow-hidden rounded-xl border border-hairline-strong bg-canvas px-6 py-4 text-ink dark:border-white/10 dark:bg-surface-dark dark:text-on-dark max-[640px]:px-5">
        {/* 좌:우 = 746:420 (64:36). 우측은 정사각 지도(레이더·태풍)가 주인공이라
            지도 변 = min(우측 폭, 우측 높이) 다 — 폭만 넓히면 지도는 그대로고 여백만 커진다
            (실측 폭 420→660 에서 지도 213 고정 · 여백 104→224). 그래서 폭은 420 으로 두고
            아래 캐러셀 높이를 420 으로 올려 폭≈높이를 맞춘다(지도 213→418). */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-stretch">
          {/* 좌측 — 안전 신호등 + 오늘 위험작업 칩.
              ★ lg 에서는 내용을 absolute 로 띄워 이 칸이 행 높이를 정하지 못하게 한다.
              in-flow 로 두면 신호등 행을 펼칠 때(가스 140px·AED 154px) 좌측이 우측을 넘어서고,
              items-stretch 라 우측 레이더 패널과 바깥 박스까지 함께 커진다(실측 300→326px).
              행 높이는 우측 캐러셀이 정하고, 좌측은 넘치면 자기 안에서 스크롤한다. */}
          <div className="relative flex min-w-0 flex-col gap-4">
            <div className="flex min-w-0 flex-1 flex-col lg:absolute lg:inset-0 lg:overflow-y-auto">
              <div className="flex-1">
                <SafetySignalBoard lat={effLat} lon={effLon} worker={workerSignal} />
              </div>
              {/* 오늘 위험작업 요약 칩 — 캘린더 안 열어도 관제 화면에서 확인, 클릭 = 캘린더 열기 */}
              {todayHazard.total > 0 && (
                <button
                  type="button"
                  // 캘린더만 연다 — 사진 확인은 미확인 리스트의 항목 클릭/[모두 확인]으로(2026-08-26).
                  onClick={goCalendarTab}
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
            {/* 현장정보 카드는 상단 게이지 바의 '현장정보' 펼침으로 일원화(사용자 요청) — GaugePanel 참조. */}
          </div>

          {/* 우측 — 그룹 캐러셀(실시간 레이더·태풍 진로·특보영상·인근 병원). 자동회전 없음·수동 전환만.
              '현황 요약'(공정률·무사고 + 수신 요약)은 삭제 — 게이지는 상단 가로 바로, 수신 요약은 폐기(사용자 요청). */}
          <WidgetCarousel
            // 277 = 좌측 신호등의 최대 높이(가스·AED 펼침 실측)와 정확히 같은 값 —
            // 그 상태에서 우측 하단선이 신호등 하단선과 딱 맞는다(사용자 요청).
            // 펼친 행에 따라 높이를 따라가게 하면 우측·바깥 박스가 같이 움직여 앞서 고친
            // 흔들림이 재발하므로 최대값으로 고정한다.
            // ⚠ 신호등 펼침 문구가 바뀌어 높이가 달라지면 이 값도 다시 재야 한다.
            className="min-h-[277px]"
            autoRotate={false}
            pages={[
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

      {/* 현장 환경 가로 스트립은 좌측 고정 패널로 대체(사용자 요청) — SiteSidePanels 의 pinned="env". */}

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
                  {/* 작업자 수 — 배지(알약 배경)는 풀어 둔 채다(2026-08-28 사용자 지시).
                      ⚠ 색을 text-ink 로 맞춘다 — 값과 단위가 다른 색이면 한 값인데 둘로 갈려 보인다.
                      ★ 게이지 값과 같은 표기 체계(AnimateNumber)를 쓴다. 크기만 이 툴바에 맞춰
                        한 단계 작다 — 여기는 라벨이 아니라 툴바 안의 보조 수치다. */}
                  <span className="inline-flex items-baseline text-xs font-semibold text-ink dark:text-on-dark">
                    <span className="mr-1">총</span>
                    <AnimateNumber
                      value={filledSlots.length}
                      duration={380}
                      blur={6}
                      className="font-mono text-[15px] font-semibold leading-none"
                    />
                    <span className="ml-1">명</span>
                  </span>
                  <div className="flex items-center gap-2">
            {/* 등록 버튼은 표 보기에서만 — 지도 모드에는 슬롯(등록 대상)이 안 보여 눌러도 결과가 화면에 없다(2026-09-09 사용자 지시). */}
            {workerView === "table" && (
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
            )}
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
                {/* 자물쇠로 상태를 말한다(2026-08-28 사용자 지시) — 흐르는 중이면 열린 자물쇠,
                    멈춰서 드래그로 정렬하는 중이면 잠긴 자물쇠. 라벨은 '슬라이딩' 하나로 고정하고
                    켜짐/꺼짐은 아이콘과 색이 말한다(라벨까지 바뀌면 무엇을 누르는 버튼인지 흔들린다).
                    ⚠ 몸통(rect)은 두 상태가 같고 고리(path)만 다르다 — 그래야 전환이 자물쇠가
                    열리는 동작으로 읽힌다. 아이콘 크기·굵기는 옆 '지도' 버튼과 맞췄다. */}
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
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  {slideMode === "auto" ? (
                    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                  ) : (
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  )}
                </svg>
                슬라이딩
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
                      points={workerMapPoints}
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
                      trail={
                        trailWorkerId
                          ? {
                              workerId: trailWorkerId,
                              name:
                                latestMap.get(trailWorkerId)?.workerName ?? trailWorkerId,
                              windowMin: TRACK_WINDOW_MIN,
                              points: trailPoints ?? [],
                              coarse: trailCoarse ?? undefined,
                              quality: trailQuality,
                              seq:
                                trailPoints && trailCoarse && trailCoarse.length > 0
                                  ? mergeTrackSeq(trailPoints, trailCoarse)
                                  : undefined,
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
                          outside={outsideWorkers.has(entry.workerId)}
                          signal={signalLevel(latestMap.get(entry.workerId), now)}
                          nowMs={now}
                          coreTempEstC={freshCoreTemp(entry.workerId)}
                          coreTempWarmup={data.coreTempWarmup?.[entry.workerId]}
                          heatPattern={data.heatPattern?.[entry.workerId]}
                          offWrist={data.offWrist?.[entry.workerId]}
                          stress={stressFor(entry.workerId)}
                          isAnomaly={pos === anomalyPos}
                          fallTs={lastFallByWorker.get(entry.workerId)}
                          fallPending={fallPendingByWorker.has(entry.workerId)}
                          count={data.countsByWorker?.[entry.workerId]}
                          isVirtual={false}
                          jobTitle={
                            data.workerProfiles?.[entry.workerId] ??
                            latestMap.get(entry.workerId)?.jobTitle
                          }
                          nameFallback={data.workerNames?.[entry.workerId]}
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
                          outside={outsideWorkers.has(entry.workerId)}
                          signal={signalLevel(latestMap.get(entry.workerId), now)}
                          nowMs={now}
                          coreTempEstC={freshCoreTemp(entry.workerId)}
                          coreTempWarmup={data.coreTempWarmup?.[entry.workerId]}
                          heatPattern={data.heatPattern?.[entry.workerId]}
                          offWrist={data.offWrist?.[entry.workerId]}
                          stress={stressFor(entry.workerId)}
                          isAnomaly={pos === anomalyPos}
                          fallTs={lastFallByWorker.get(entry.workerId)}
                          fallPending={fallPendingByWorker.has(entry.workerId)}
                          count={data.countsByWorker?.[entry.workerId]}
                          isVirtual={false}
                          jobTitle={
                            data.workerProfiles?.[entry.workerId] ??
                            latestMap.get(entry.workerId)?.jobTitle
                          }
                          nameFallback={data.workerNames?.[entry.workerId]}
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
            // 안전뉴스 — 재난문자·산업재해 속보·국내 재해사례·산업 안전뉴스를 한 화면에 모았다.
            // 좌측 캐러셀(재해사례·뉴스)과 하단 상시 티커(속보)를 여기로 이관 — docs/safety-news-tab/.
            title: "안전뉴스",
            content: <SafetyNewsPage lat={effLat} lon={effLon} />,
          },
          {
            // 일정 캘린더 — 헤더 아이콘(떠 있는 패널)과 **같은 컴포넌트**를 탭 본문으로 연다.
            // 아이콘은 그대로 두었다(빠른 확인용). 본문을 복제하지 않으므로 두 자리가 갈리지 않는다.
            title: "일정 캘린더",
            // 새 현장 사진 미확인 배지 — 헤더 아이콘을 걷어내며 여기로 옮겼다(2026-08-20).
            // ⚠ 아이콘만 지우고 이걸 안 옮기면 **미확인 개수가 화면 어디에도 안 남는다**
            //   (실제로 lint 가 `calendarNewCount` 미사용으로 잡아 드러났다).
            badge: calendarNewCount,
            content: (
              <HeaderCalendarPopup
                open
                onClose={() => {}}
                lat={effLat}
                lon={effLon}
                workerCount={fieldCoords.count}
                variant="inline"
                // 페이저가 모든 페이지를 마운트 유지하므로, 우측 고정 사이드바가 다른 탭에
                // 남지 않도록 활성 여부를 넘긴다.
                active={pagerIdx === CALENDAR_PAGE_IDX}
                workerAliases={data.workerAliases}
                unseenMedia={calendarUnseenList}
                onSeeMedia={markCalendarMediaSeen}
                onSeeAllMedia={markCalendarSeen}
              />
            ),
          },
          {
            title: "안전관리비 검증",
            content: <SafetyVerificationTabs />,
          },
          {
            // 공단 보조금 정합 검증 — /subsidy-audit 단독 라우트와 동일 컴포넌트를 탭으로 열람.
            title: "공단 보조금 검증",
            content: <SubsidyAuditBoard />,
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

      {/* 하단 차트 2종(설비·작업자 생체)은 관제 탭(0) 전용이다.
          여는 표(가스·AED·작업자 모니터링)가 전부 관제 탭 안에 있는데 패널만 페이저 바깥이라,
          탭을 옮겨도 selection/siteChart 가 살아 있으면 안전뉴스·안전관리비 검증·ERP 화면
          맨 아래에 그대로 따라붙었다(2026-08-13 제보). 상태는 지우지 않고 렌더만 막는다 —
          관제 탭으로 돌아오면 보던 차트가 그대로 있다. */}
      {pagerIdx === MONITOR_PAGE_IDX && siteChart && (
        <SiteMetricChartPanel metric={siteChart} onClose={() => setSiteChart(null)} />
      )}

      {/* 산업재해 사망 속보 티커는 '안전뉴스' 탭 목록으로 이관(docs/safety-news-tab N-03). */}

      {/* 좌측 사이드 패널 — 관제 탭(0)은 현장 환경 하나만 늘 펼쳐 두고(가로 스트립을 대체),
          그 외 탭(안전뉴스·안전관리비 검증·ERP)은 6종을 손잡이로 열고 닫는다. */}
      <SiteSidePanels
        lat={effLat}
        lon={effLon}
        workerCount={fieldCoords.count}
        coordSource={coordSource}
        refreshNonce={weatherRefreshNonce}
        worker={workerSignal}
        region={siteRegion}
        pinned={
          // 생 리터럴 0 을 쓰던 유일한 자리였다 — 탭을 추가·재배열하면 조용히 밀린다(파일 상단 경고).
          // '일정 캘린더' 탭 삽입(2026-08-20)을 계기로 나머지와 같은 상수로 통일했다.
          pagerIdx === MONITOR_PAGE_IDX ? "env" : undefined
        }
        onRefresh={refreshFieldWeather}
        refreshing={locRefreshing}
      />

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
          sample={withMyGuardian(activeSos)}
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
          sample={withMyGuardian(activeFallAlert)}
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
          sample={withMyGuardian(activeVitalAlert)}
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

      {activeGeofenceAlert &&
        !activeSos &&
        !activeFallAlert &&
        !activeVitalAlert && (
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

      {/* 새 현장 사진 도착 알림 토스트 — 클릭 시 캘린더 열림, 6초 후 자동 사라짐.
          확인 처리는 여기서 하지 않는다 — 미확인 리스트에서 항목을 하나씩 확인한다(2026-08-26). */}
      {calendarToast && (
        <button
          type="button"
          aria-live="polite"
          onClick={() => {
            goCalendarTab();
            setCalendarToast(null);
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

      {/* 관제 탭(0) 전용 — 위 siteChart 와 같은 이유(다른 탭에 따라붙는 것을 막는다). */}
      {pagerIdx === MONITOR_PAGE_IDX && selection && (
        <VitalHistoryPanel
          selection={selection}
          workerName={latestMap.get(selection.workerId)?.workerName}
          employeeId={latestMap.get(selection.workerId)?.employeeId}
          hasLiveData={hasLiveMetric(
            latestMap.get(selection.workerId),
            selection.metric,
            lastFallByWorker.get(selection.workerId),
            data.coreTempEst?.[selection.workerId]?.tempC,
          )}
          liveValue={(() => {
            // 선택 작업자·메트릭의 현재 라이브 값 — 2초 폴 리렌더마다 갱신 → 그래프 24시간 뷰 마지막 점 실시간 반영.
            if (selection.metric === "fall") return null;
            // 활동 = 버킷 합이라 순간값으로 마지막 점을 덮지 않는다(단위 불일치).
            if (selection.metric === "activity") return null;
            // 수집 커버리지 = 하루 집계(분)라 순간값으로 덮을 대상이 없다(히트맵이라 마지막 점 개념도 없다).
            if (selection.metric === "coverage") return null;
            if (selection.metric === "coreTempEst") {
              return data.coreTempEst?.[selection.workerId]?.tempC ?? null;
            }
            // 배터리 — 메트릭 키와 필드명이 다르다(battery ↔ batteryPct). 아래 일반 색인에 안 걸린다.
            if (selection.metric === "battery") {
              const pct = latestMap.get(selection.workerId)?.batteryPct;
              return typeof pct === "number" ? pct : null;
            }
            const v = latestMap.get(selection.workerId)?.[selection.metric];
            return typeof v === "number" && Number.isFinite(v) ? v : null;
          })()}
          onMetricChange={(metric) =>
            setSelection({ workerId: selection.workerId, metric })
          }
          onClose={() => setSelection(null)}
        />
      )}

      {/* 실시간 수집 · DB 영속 스트립(+ data_mockup) — 관제 탭(0)에서만 노출.
          ERP: 스마트경리 = 별개 시스템을 한 화면에 최대한 보여주려 숨김.
          안전뉴스 = 탭 주제(재난·재해 정보)와 무관해 제외(사용자 결정 2026-07-31).
          안전관리비 검증 = 계상·집행 검증 화면이라 생체 수집 로그와 무관해 제외
          (사용자 결정 2026-08-13 — 같은 날 하단 차트 2종을 관제 전용으로 좁힌 것과 같은 정리). */}
      {pagerIdx === MONITOR_PAGE_IDX && (
      <>
      <section className="overflow-hidden rounded-xl border border-hairline bg-canvas dark:border-white/10 dark:bg-surface-dark-elevated">
        <button
          type="button"
          onClick={() => setLogExpanded((prev) => !prev)}
          aria-expanded={logExpanded}
          className={`flex w-full items-center justify-between gap-3 border-b border-hairline px-6 py-4 text-sm font-semibold text-ink active:bg-surface-strong dark:border-white/10 dark:text-on-dark ${FOCUS_CLASS}`}
        >
          <span>
            실시간 수집 · DB 영속{" "}
            <span className="font-mono">
              <RollingChars text={formatPersisted(data.totalPersisted)} />
            </span>
            건 누적
            {(() => {
              // 충격 판정 행이 섞이는 날(08-31 실측 3.4배)엔 구성비를 헤더에서 바로 보인다.
              const impacts = data.recent.filter(isImpactSample).length;
              return (
                <span
                  className="ml-2 text-xs font-normal text-muted dark:text-on-dark-soft"
                  title="충격 판정 = 워치 낙상 모듈이 기록한 판정 행(생체 측정 아님) — DB 누적에 포함"
                >
                  (화면 표시 최근 {data.recent.length}건
                  {impacts > 0 ? ` · 생체 ${data.recent.length - impacts} · 충격 판정 ${impacts}` : ""})
                </span>
              );
            })()}
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
                  {/* 출처 열 → 활동 에너지(08-13 사용자 결정) — 전 행 동일한 dataOrigin 은 시간 셀
                      툴팁으로 격하하고, 행별로 변하는 실데이터(5초 소모 증분)를 올린다.
                      빈 칸("--")이 잦은 것이 정상 — 정지 상태는 증분 0.01kcal 미만이라 항목이 없다. */}
                  <th className="px-4 py-3" title="직전 5초 구간의 활동 에너지 소모(워치 실측 증분) — 빈 칸=저활동 또는 미수집(구 앱)">
                    활동 (kcal)
                  </th>
                  <th className="px-4 py-3">작업자</th>
                  <th className="px-4 py-3">심박 (bpm)</th>
                  <th className="px-4 py-3">산소포화도 (%)</th>
                  {/* ★ 2026-08-26 실측 복원. 08-13 에 손목 온도 열을 내린 근거는 "Apple 실시간
                      미개방이라 상시 --" 였는데, 갤럭시(Wear OS) 온도 센서가 행마다 실측을 보내면서
                      그 전제가 깨졌다. 이제 이 열은 **행 자신의 측정값**을 먼저 보여준다 —
                      추정은 워커 단위 1분 해상도라 같은 워커의 여러 행에 같은 값이 반복됐다. */}
                  {/* ★ `체온` → `손목온도` (2026-08-26 · 같은 날 오전 내가 `체온 추정`→`체온` 으로
                      바꿨던 것을 되돌린다). 이 열의 값은 손목 피부온이고 체온이 아니다 —
                      실측 240점 중 3%가 35.0℃ 미만, 최저 34.12℃ 다. "체온 34.1" 은 저체온증으로
                      읽히고, 같은 시각 칼만 심부체온은 37.3℃ 로 정상이었다.
                      ⚠ 행 단위라 칼만을 못 만든다(30분 심박 이력이 필요) — 그래서 이 표에는
                        체온 열을 만들지 않고 손목온도만 둔다. 체온은 작업자 표·카드에서 본다. */}
                  <th
                    className="px-4 py-3"
                    title="워치 온도 센서가 잰 손목 피부온(행별 실측) — 체온이 아니다. 기기 발열이 섞이고 30℃대 중반까지 내려간다. 실측이 없는 행은 워커 단위 심박 기반 추정치를 ≈ 로 표시"
                  >
                    손목온도 (℃)
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((sample, index) => {
                  // 충격 판정(낙상 섀도)·낙상 행 — 생체 행이 아니므로 생체 칸(`--` 넷·`≈` 추정)을
                  // 그리지 않고 한 줄 요약으로 가른다(2026-08-31 · 문구 A · 색 ③ · 배치 1).
                  // 서버·링은 그대로 — 후보 행을 링에서 빼면 낙상 "확인 중"(fallPendingByWorker)이 죽는다.
                  const impact = impactRowView(sample, workerCell(sample));
                  if (impact) {
                    const tone = IMPACT_TONE[impact.tone];
                    return (
                      <tr
                        key={`${sample.workerId}-${sample.ts}-${index}`}
                        className="border-t border-hairline dark:border-white/5"
                        title={impact.title}
                      >
                        <td className="px-4 py-3 font-mono" title={`출처 ${sample.dataOrigin ?? "legacy_unclassified_vitalguard"}`}>
                          {formatTime(sample.ts)}
                        </td>
                        <td colSpan={5} className={`px-4 py-3 text-xs ${tone.text}`}>
                          <span className={`mr-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${tone.chip}`}>
                            {impact.chip}
                          </span>
                          {impact.text}
                          {impact.hint ? (
                            <span className="ml-1 text-muted dark:text-on-dark-soft">{impact.hint}</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={`${sample.workerId}-${sample.ts}-${index}`} className="border-t border-hairline dark:border-white/5">
                      <td className="px-4 py-3 font-mono" title={`출처 ${sample.dataOrigin ?? "legacy_unclassified_vitalguard"}`}>
                        {formatTime(sample.ts)}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {sample.activeEnergyKcal == null ? "--" : sample.activeEnergyKcal.toFixed(2)}
                      </td>
                      <td className="px-4 py-3">{workerCell(sample)}</td>
                      <td className="px-4 py-3 font-mono">{formatInt(sample.heartRate)}</td>
                      <td className="px-4 py-3 font-mono">{formatInt(sample.spo2)}</td>
                      {/* 실측 우선. 값의 성격이 다르므로 **한 칸에 섞지 않고 표기로 가른다** —
                          실측은 그대로, 추정은 `≈` 를 붙인다. 마크를 떼면 센서가 죽은 구간이
                          측정된 것처럼 보인다(이 레포가 반복해 고쳐 온 false-OK 형태). */}
                      <td className="px-4 py-3 font-mono text-body dark:text-on-dark-soft">
                        {(() => {
                          if (sample.skinTempC != null) return formatTemp(sample.skinTempC);
                          // 폴백 = 워커 단위 1분 해상도 추정치라 같은 워커의 여러 행에 같은 값이 붙는다.
                          const primary = data.workerAliases?.[sample.workerId] ?? sample.workerId;
                          const est = data.coreTempEst?.[primary]?.tempC;
                          return est == null ? "--" : `≈${formatTemp(est)}`;
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="overflow-hidden rounded-xl border border-dashed border-amber-300 bg-amber-50/40 dark:border-amber-500/40 dark:bg-amber-500/5">
        <div className="flex items-center justify-between gap-3 px-6 py-4 text-sm text-amber-950 dark:text-amber-100">
          <div>
            <span className="font-mono font-semibold">data_mockup</span>
            <span className="ml-2 text-xs font-normal text-amber-800 dark:text-amber-200">
              실데이터 집계·경보·작업자 관제에서 제외된 iPhone/Watch 목업
            </span>
          </div>
          <span className="shrink-0 font-mono text-xs">
            {formatPersisted(data.dataMockupPersisted)}건
          </span>
        </div>
        {logExpanded && (
          <div className="wx-cards-scroll max-h-64 overflow-auto border-t border-amber-200/80 dark:border-amber-500/30">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-amber-100/80 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
                <tr>
                  <th className="px-4 py-3">시간</th>
                  <th className="px-4 py-3">출처</th>
                  <th className="px-4 py-3">작업자</th>
                  <th className="px-4 py-3">심박 (bpm)</th>
                  <th className="px-4 py-3">산소포화도 (%)</th>
                </tr>
              </thead>
              <tbody>
                {(data.dataMockup ?? []).map((sample, index) => (
                  <tr key={`mockup-${sample.workerId}-${sample.ts}-${index}`} className="border-t border-amber-200/70 dark:border-amber-500/20">
                    <td className="px-4 py-3 font-mono">{formatTime(sample.ts)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{sample.dataOrigin}</td>
                    <td className="px-4 py-3">{workerCell(sample)}</td>
                    <td className="px-4 py-3 font-mono">{formatInt(sample.heartRate)}</td>
                    <td className="px-4 py-3 font-mono">{formatInt(sample.spo2)}</td>
                  </tr>
                ))}
                {(data.dataMockup ?? []).length === 0 && (
                  <tr><td className="px-4 py-3 text-sm text-amber-800 dark:text-amber-200" colSpan={5}>현재 저장된 목업 데이터가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </>
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

// DB 누적 집계 표기 — 값이 없으면(`null`) 0 이 아니라 `—`.
// 0 으로 채우면 "한 건도 안 쌓였다"로 읽히는데 실제로는 **조회를 못 한 것**이다.
// 이 레포가 반복해 고쳐 온 계열(미수신인데 준수율 100% · 한 번도 안 받았는데 정상 4명).
function formatPersisted(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString();
}

// 작업자 표 헤더 — 14열 라벨. 수동 모드일 때만 첫 열에 "정렬" 라벨.
function WorkerTableHeader({ manual }: { manual: boolean }) {
  // ★ "체온" → "손목온도" (2026-08-26 · 사용자 지시). 이 열의 주값은 **손목 피부온**이고
  //   그것은 체온이 아니다 — 실측 240점 중 8점(3%)이 35.0℃ 미만으로 내려가고 최저가 34.12℃ 다.
  //   "체온 34.1" 로 읽히면 **저체온증 오인**이고, 멀쩡한 작업자를 후송시킬 수 있다.
  //   같은 시각 칼만 심부체온은 37.34~37.36℃ 로 전부 정상이었다(심박 70~101bpm).
  //   ⚠ 고열 오독(38.9)보다 이쪽이 나쁘다 — 고열은 "덥나 보다" 로 끝나지만 저체온은 조치를 부른다.
  // ⚠ 순서·개수가 TABLE_GRID 의 열 정의와 **한 칸이라도 어긋나면** 라벨이 통째로 밀린다.
  //   배터리는 신호 뒤·상태 앞이다(2026-09-03).
  const cols = ["", "작업자", "직급", "심박", "SpO₂", "손목온도", "낙상", "스트레스", "신호", "배터리", "상태", "수신", "누적", ""];
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
  // 신선도 판정·SpO₂ 측정 경과 표기용 현재 시각(부모의 1초 틱과 동일 시계)
  nowMs: number;
  // 심박 기반 심부체온 추정값(℃) — 실측(skinTempC) 없을 때만 표시 폴백. 판정 미주입.
  coreTempEstC?: number;
  // 저활동·고심박 패턴(온열 ②) — 있으면 flagged 상태. 체온 추정 셀의 주석(툴팁·라벨)에만 쓴다.
  heatPattern?: { hrAvg: number; aeKcalPerMin: number; coveredMinutes: number };
  // 워밍업 진행률 — 칼만이 아직 값을 못 낼 때 사유·진행률 라벨에만 쓴다. 판정 미주입.
  coreTempWarmup?: { buckets: number; needed: number };
  offWrist?: OffWristSuspect;
  /** hrvBacked = 이 지수에 HRV 가 실제로 들어갔는가(칩 문구를 산출 근거에 맞추는 데 쓴다). */
  stress: { result: StressResult; hrvBacked: boolean };
  isAnomaly: boolean;
  // 구획(근무지) 이탈 중 — 생체와 별개로 신호등을 주의로 올린다(감사 후속·위치 연동).
  outside?: boolean;
  fallTs?: string;
  fallPending?: boolean; // 워치 낙상 확인 프롬프트 진행 중(에스컬레이션 전) — "확인 중" 표시.
  /** DB 조회 실패 시 undefined — 셀이 `—` 를 찍는다(0 으로 채우면 '수집 0건'으로 읽힌다). */
  count?: number;
  isVirtual: boolean;
  /** 링 버퍼 밖 작업자의 이름 폴백 — 없으면 사번이 이름 자리에 뜬다(표시 전용). */
  nameFallback?: string;
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
  nowMs,
  coreTempEstC,
  coreTempWarmup,
  heatPattern,
  offWrist,
  stress,
  isAnomaly,
  outside,
  fallTs,
  fallPending,
  count,
  isVirtual,
  jobTitle,
  nameFallback,
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
  const overallVital = overallStatus(sample, nowMs, coreTempEstC);
  const wstatus = workerStatus(sample, nowMs, coreTempEstC);
  // 연결끊김 — sample 존재 + 신호 문턱 초과(signal===0). sticky 직전값을 "정상"으로 오인하는 false-OK 차단.
  // 문턱은 배칭 주기의 함수라 출처마다 다르다(애플 60초·갤럭시 150초 — lib/vital-age.ts 참조).
  // 미착용 — 워치가 손목 이탈 순간 보낸 표식(worn:false · 갤럭시). 값 게이트·톤 강등은 끊김과 같이 타되
  // 라벨은 "미착용" 으로 갈라 고장(연결끊김)과 구분한다(2026-08-31 사용자 지시). 애플은 이 표식이 없다.
  const offBody = sample?.worn === false;
  const stale = sample !== undefined && (signal === 0 || offBody);
  // ★ 끊김의 **종류** — 라벨만 가른다. 판정(stale)·게이트(gateStaleVitals)·톤(effectiveTone)은
  //   이 값을 안 본다. 근거와 실측은 lib/vital-age.ts 의 staleKind 주석.
  const kind: StaleKind | undefined =
    stale && sample !== undefined ? staleKind(sample, nowMs, sample.dataOrigin) : undefined;
  const staleLabel = offBody ? OFF_BODY_LABEL : kind !== undefined ? STALE_LABEL[kind] : "";
  // ★ 무동작 — 라벨만. `수신 중` 자리만 대신하고 톤·게이트·집계는 이 값을 모른다(2026-08-28).
  //   벗음도 응급도 단정하지 않는다 — 심박은 착용의 증거가 아니라서(lib/vital-still.ts).
  const still = stillLabel(sample ?? {}, stale, wstatus.tone);
  // ★ 벗음 의심 — 라벨만. `무동작` 이 떠 있을 때만(평평 ∧ 정지) 그 아래 한 줄. 서버가 15분 심박으로
  //   계산하고 톤·게이트·집계·경보는 이 값을 모른다(lib/vital-offwrist.ts · docs/vital-offwrist-suspect).
  const suspect = still ? offWrist : undefined;
  // 신호등·좌측 강조선에 쓰는 최종 톤 — 생체 판정에 구획 이탈을 얹는다(stale 이면 위치 무시).
  const overall = effectiveTone(overallVital, { stale, outside });
  const heading = workerHeading(sample, workerId, nameFallback);
  const tabIndex = ariaHidden ? -1 : undefined;
  const accent = stale
    ? "border-l-slate-400 dark:border-l-slate-500"
    : overall === "danger"
      ? "border-l-semantic-down"
      : overall === "caution"
        ? "border-l-amber-400"
        : "border-l-transparent";
  // 연결끊김이면 생체 3종을 비운다 — sticky 직전값을 현재값처럼 초록으로 보여주던 false-OK 차단.
  // (잠금 중에는 폰이 계속 POST 해 stale 이 아니므로 잠금 연속성은 그대로 유지된다.)
  const shown = gateStaleVitals(sample, stale);
  // 끊김 중 마지막 값 유지(2026-08-31 사용자 목표 "끊김 없는 연속 표시") — 판정·PSI·신호등은 여전히
  // `shown`(빈 값)을 쓴다. 여기서 만드는 것은 **회색 숫자 + "끊김 전 값 · 나이" 라벨**뿐이라, 옛 값이
  // 정상색으로 현재값처럼 보이던 false-OK(2026-08-15 가드)는 그대로 막혀 있고 상태 강등(연결끊김)도 그대로다.
  // ⚠ 상한 30분 — 그 뒤엔 종전대로 비운다. 미착용 90분 자동 로그아웃(wear ae33048) 이후엔 서버가 완전 무음이라
  //   야간 충전이면 아침까지 이어지는데, 10시간 전 심박을 회색으로라도 밤새 띄워 두는 것은 정보가 아니라 소음이다.
  const heldAgeMs = sample !== undefined ? vitalAgeMs(sample, nowMs) : NaN;
  const held =
    stale && !offBody && sample !== undefined && Number.isFinite(heldAgeMs) && heldAgeMs <= HELD_VALUE_MAX_MS
      ? { s: sample, ageLabel: `끊김 전 값 · ${formatElapsed(heldAgeMs)}` }
      : null;
  // (종전 여기서 `손목+0.5` 를 '추정' 으로 만들어 카드에 적었다. 2026-08-26 에 그 표기를
  //  칼만(coreTempEstC)으로 바꾸면서 이 파생값은 쓰이는 곳이 없어졌다 — 지운다.)
  // 생리적 부담 지수(PSI · Moran 1998) — 추정 체온 + 심박. 표시 전용이라 판정·경보에 넣지 않는다.
  // 안정심박은 sticky 병합값이라 stale 게이트 밖이지만, 표시 자체가 !stale 분기 안에서만 일어난다.
  const psi = computePsi({
    coreTempC: coreTempEstC,
    heartRate: shown.heartRate,
    restingHeartRate: sample?.restingHeartRate,
  });
  const fallRecent =
    fallTs !== undefined && Date.now() - new Date(fallTs).getTime() < ALARM_FRESH_MS;

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
        <TrafficLight status={overall} stale={stale} staleLabel={staleLabel} offBody={offBody} />
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
        held && typeof held.s.heartRate === "number" ? (
          // 끊김 중 — 마지막 심박을 회색으로 유지 + 나이. 판정색(STATUS_CLASS)은 걸지 않는다.
          <span className="leading-tight">
            <span className="font-mono text-sm tabular-nums text-muted">
              {formatInt(held.s.heartRate)}
              <span className="ml-0.5 text-[10px]">bpm</span>
            </span>
            <span className="block text-[9px] leading-none text-muted">{held.ageLabel}</span>
          </span>
        ) : (
          <span className="font-mono text-sm tabular-nums">
            <span className={STATUS_CLASS[heartRateStatus(shown.heartRate, workActivity(sample ?? {}))]}>
              {formatInt(shown.heartRate)}
            </span>
            <span className="ml-0.5 text-[10px] text-muted">bpm</span>
          </span>
        ),
        "심박 — 클릭 시 누적 추세",
      )}

      {/* 5 SpO₂ — 기회 측정: 새 측정 때만 값이 바뀌고, 측정 경과를 병기한다(갱신 구조).
          30분 초과는 판정 제외(freshSpo2 → idle 회색) + "오래됨" 라벨 — sticky 값의 현재값 오독 방지. */}
      {metricCell(
        "spo2",
        (() => {
          if (held && typeof held.s.spo2 === "number") {
            // 끊김 중 — 마지막 SpO₂ 를 회색으로 유지. 나이는 SpO₂ 자체의 측정 경과(기회 측정이라 심박보다 오래됐을 수 있다).
            const heldAge = spo2AgeMs(held.s, nowMs);
            return (
              <span className="leading-tight">
                <span className="font-mono text-sm tabular-nums text-muted">
                  {formatInt(held.s.spo2)}
                  <span className="ml-0.5 text-[10px]">%</span>
                </span>
                <span className="block text-[9px] leading-none text-muted">
                  {heldAge !== null ? `끊김 전 값 · ${formatSpo2Age(heldAge)}` : held.ageLabel}
                </span>
              </span>
            );
          }
          // 나이는 원본 sample(측정 시각 보유)로 재고, 연결끊김 게이트(shown)가 값을 지웠으면 표기도 접는다.
          const gatedOut = typeof shown.spo2 !== "number";
          const age = gatedOut ? null : spo2AgeMs(sample, nowMs);
          const isFresh = !gatedOut && freshSpo2(sample, nowMs) !== undefined;
          return (
            <span className="leading-tight">
              <span className="font-mono text-sm tabular-nums">
                <span className={STATUS_CLASS[spo2Status(isFresh ? shown.spo2 : undefined)]}>
                  {formatInt(shown.spo2)}
                </span>
                <span className="ml-0.5 text-[10px] text-muted">%</span>
              </span>
              {age !== null && (
                <span className="block text-[9px] leading-none text-muted">
                  {formatSpo2Age(age)}
                  {isFresh ? "" : " · 오래됨"}
                </span>
              )}
            </span>
          );
        })(),
        "산소포화도 — 새 측정 때만 갱신(측정 경과 병기) · 클릭 시 누적 추세",
      )}

      {/* 6 체온 — 손목 + 추정 (미수신 시 명시) */}
      {metricCell(
        "coreTempEst",
        held && typeof held.s.skinTempC === "number" ? (
          // 끊김 중 — 마지막 손목온도를 회색으로 유지 + 나이(주값은 원래 중립색이라 판정색 문제 없음).
          <span className="leading-tight">
            <span className="font-mono text-sm tabular-nums text-muted">
              {formatTemp(held.s.skinTempC)}
              <span className="ml-0.5 text-[10px]">℃</span>
            </span>
            <span className="block text-[9px] leading-none text-muted">{held.ageLabel}</span>
          </span>
        ) : shown.skinTempC == null ? (
          // 실측 손목온도 없음 — 심박 기반 추정이 있고 연결이 살아 있으면 그것을 폴백 표시.
          // "추정" 표기·판정 미주입은 의료 판정 아님 원칙(문헌 오차 ±0.3℃ 내외·선별 참고).
          !stale && coreTempEstC != null ? (
            <span
              className="leading-tight"
              title={
                "심박 기반 심부체온 추정(문헌 오차 ±0.3℃ 내외) — 의료 판정 아님·열 스트레스 참고. 심박 억제 약물 복용자는 과소추정될 수 있음" +
                (heatPattern
                  ? `\n⚠ 저활동·고심박 ${heatPattern.coveredMinutes}분 지속(평균 ${heatPattern.hrAvg}bpm · ${heatPattern.aeKcalPerMin}kcal/분) — 열 축적·탈수 또는 긴장·카페인 가능. 추정치가 과대일 수 있어 휴식·수분 확인 권장`
                  : "") +
                (psi
                  ? `\nPSI ${psi.value.toFixed(1)}/10 — 생리적 부담 지수(Moran 1998). 6 이상 높은 부담·7.5 이상 열손상 고위험. 기준 심박 ${psi.personalized ? "= 개인 안정심박" : "60(개인 안정심박 미수신)"}. 추정 체온이 입력이라 판정·경보에는 쓰지 않음. ⚠ 집단 평균 반응에 기반한 지수라 개인의 열 내성 한계를 식별하는 용도로는 신뢰할 수 없다는 후속 연구가 있다(2021) — 개인 판정이 아니라 참고값으로 본다`
                  : "")
              }
            >
              <span className="font-mono text-sm tabular-nums text-body dark:text-on-dark-soft">
                ≈{formatTemp(coreTempEstC)}
                <span className="ml-0.5 text-[10px] text-muted">℃</span>
              </span>
              {heatPattern ? (
                // 저활동·고심박 주석(온열 ②) — 표시 라벨만 바꾼다. 상태색·판정·경보는 불변(판정 미주입).
                <span className="block text-[9px] leading-none text-amber-600 dark:text-amber-300">
                  ⚠ 저활동·고심박
                </span>
              ) : psi ? (
                // PSI 표기 — 문헌 임계(6·7.5)로 색만 바꾼다. 신호등·경보 경로는 건드리지 않는다.
                <span
                  className={`block text-[9px] leading-none ${
                    psiBand(psi.value) === "critical"
                      ? "text-red-600 dark:text-red-300"
                      : psiBand(psi.value) === "high"
                        ? "text-amber-600 dark:text-amber-300"
                        : "text-muted"
                  }`}
                >
                  PSI {psi.value.toFixed(1)} · 추정
                </span>
              ) : (
                <span className="block text-[9px] leading-none text-muted">심박 추정</span>
              )}
            </span>
          ) : (
            <span
              className="leading-tight"
              title={
                stale && kind !== undefined
                  ? tempStaleTitle(vitalAgeMs(sample, nowMs), kind)
                  : // ★ 워밍업 중을 "미수신" 으로 적지 않는다(2026-09-08). 심박은 오고 있는데
                    //   칼만이 아직 30버킷을 못 채운 것이라 조치가 정반대다 — 기기를 보는 게
                    //   아니라 계속 차고 있으면 된다. 종전 문구는 센서 고장으로 읽혔다.
                    !stale && coreTempWarmup !== undefined
                    ? coreTempWarmupTitle(coreTempWarmup)
                    : TEMP_UNAVAILABLE_TITLE
              }
            >
              <span className="font-mono text-sm tabular-nums text-muted">
                --<span className="ml-0.5 text-[10px]">℃</span>
              </span>
              <span className="block whitespace-nowrap text-[9px] leading-none text-muted">
                {stale
                  ? staleLabel
                  : coreTempWarmup !== undefined
                    ? `${CORE_TEMP_WARMUP_LABEL} ${coreTempWarmup.buckets}/${coreTempWarmup.needed}`
                    : "미수신"}
              </span>
            </span>
          )
        ) : (
          <span className="leading-tight">
            {/* ★ 주값 = 손목 실측. **중립색이다**(2026-08-26 · 사용자 지시).
                판정색을 이 숫자에 걸면 34.8℃ 가 빨갛게 떠서 라벨을 고쳐도 저체온 오독이 난다.
                손목 피부온은 실측 240점 중 3%가 35.0℃ 미만이고 최저 34.12℃ 인데, 같은 시각
                칼만은 37.34~37.36℃ 로 정상이었다. 손목값은 참고값이지 체온이 아니다. */}
            <span className="font-mono text-sm tabular-nums text-body dark:text-on-dark-soft">
              {formatTemp(shown.skinTempC)}
              <span className="ml-0.5 text-[10px] text-muted">℃</span>
            </span>
            {/* ★ 부값 = **체온**(심박 기반 칼만). 판정색은 여기에만 건다 — 표시와 판정이
                같은 줄에 있어야 색이 무엇을 말하는지 어긋나지 않는다.
                종전엔 이 자리에 `손목+0.5` 를 "추정" 으로 적었는데, 그건 차트의
                '체온(심박 추정)' 탭과 **다른 값**이라 같은 이름이 두 값을 가리켰다.
                ⚠ 워밍업 전(칼만 없음)에는 빈칸 대신 사유를 적는다 — 빈칸은 "센서 고장" 으로 읽힌다. */}
            <span className="block whitespace-nowrap text-[9px] leading-none">
              <span className="text-muted">체온 </span>
              {coreTempEstC == null ? (
                // 같은 사유를 두 분기가 **같은 문구**로 말한다(라벨은 CORE_TEMP_WARMUP_LABEL 한 곳).
                // 진행률이 붙어야 "누적 중" 과 "멈춤" 이 구분된다 — 숫자가 안 늘면 착용이 끊긴 것이다.
                <span className="text-muted" title={coreTempWarmup ? coreTempWarmupTitle(coreTempWarmup) : undefined}>
                  {CORE_TEMP_WARMUP_LABEL}
                  {coreTempWarmup ? ` ${coreTempWarmup.buckets}/${coreTempWarmup.needed}` : ""}
                </span>
              ) : (
                <span className={STATUS_CLASS[coreTempStatusC(coreTempEstC)]}>
                  {formatTemp(coreTempEstC)}℃
                </span>
              )}
            </span>
          </span>
        ),
        "위 = 손목 피부온 실측(참고값 · 체온 아님 — 기기 발열이 섞이고 30℃대 중반까지 내려간다). " +
          "아래 = 심박 기반 심부체온 추정(칼만) — 판정은 이 값으로만 한다. 클릭 시 누적 추세",
      )}

      {/* 7 낙상 — 발생(에스컬레이션) / 확인 중(워치 프롬프트 진행) / 감지안됨 */}
      {metricCell(
        "fall",
        <span
          className={`text-xs font-medium ${
            fallRecent
              ? "text-semantic-down vital-blink-danger"
              : fallPending
                ? "text-amber-600 dark:text-amber-400 vital-blink-caution"
                : "text-muted"
          }`}
        >
          {fallRecent ? "발생" : fallPending ? "확인 중" : "감지안됨"}
        </span>,
        "낙상 감지 — 클릭 시 누적 추세",
      )}

      {/* 8 스트레스 */}
      <div className="flex items-center justify-center">
        <StressChip result={stress.result} hrvBacked={stress.hrvBacked} />
      </div>

      {/* 9 신호 */}
      <div className="flex items-center justify-center">
        <SignalBars level={signal} />
      </div>

      {/* 10 배터리 — 잔량 % · 충전 중이면 아래 줄. 클릭 → 하단 추세 차트(충전 구간 음영).
          ⚠ 끊김이어도 회색으로 죽이지 않는다. 단말 상태는 착용·생체와 별개 축이고, 오히려
            "끊겼는데 배터리가 몇 %였나" 가 방전인지 앱 종료인지를 가르는 신호다(08-18 근거). */}
      {metricCell(
        "battery",
        sample?.batteryPct == null ? (
          <span className="font-mono text-xs text-muted dark:text-on-dark-soft">--%</span>
        ) : (
          <span className="flex flex-col items-center leading-tight">
            <span className={`font-mono text-xs font-semibold ${batteryTone(sample.batteryPct)}`}>
              {sample.batteryPct}%
            </span>
            {isCharging(sample.batteryStatus) ? (
              <span className="whitespace-nowrap text-[10px] text-semantic-up">충전</span>
            ) : null}
          </span>
        ),
        sample?.batteryPct == null
          ? "배터리 잔량 미수신 — 클릭하면 누적 추세를 봅니다"
          : `배터리 잔량 ${sample.batteryPct}%${
              isCharging(sample.batteryStatus) ? " · 충전 중" : ""
            } — 클릭하면 누적 추세와 충전 구간을 봅니다`,
      )}

      {/* 11 상태 — 연결끊김이면 생체 상태보다 우선 표시(false-OK 차단) */}
      <div className="flex items-center justify-center">
        {stale ? (
          // ★ 경과를 함께 적는다 — 라벨만 있으면 1분 끊김과 12시간 끊김이 같은 화면이라
          //   관제자가 둘 다 "곧 돌아오겠지" 로 읽는다(2026-08-18 12.9시간 무경보 사고).
          <span className="flex flex-col items-center leading-tight text-slate-500 dark:text-slate-300">
            <span className="whitespace-nowrap text-xs font-semibold">{staleLabel}</span>
            <span className="whitespace-nowrap font-mono text-[10px]">
              {formatElapsed(vitalAgeMs(sample, nowMs))}
            </span>
          </span>
        ) : still ? (
          // 무동작 — `수신 중` 자리에서만. 경과를 함께 적어 5분과 40분이 다른 화면이 되게 한다.
          <span
            className="flex flex-col items-center leading-tight text-slate-500 dark:text-slate-300"
            title={`${formatElapsed(still.elapsedMs)}째 움직임 없음${suspect ? " · 심박도 15분째 평평합니다 — 벗어 둔 워치일 수 있습니다" : ""}. 착용 중인지·의식이 있는지 확인하세요`}
          >
            <span className="whitespace-nowrap text-xs font-semibold">{still.label}</span>
            <span className="whitespace-nowrap font-mono text-[10px]">{formatElapsed(still.elapsedMs)}</span>
            {suspect ? <span className="whitespace-nowrap text-[10px]">{suspect.label}</span> : null}
          </span>
        ) : (
          <span className={`whitespace-nowrap text-xs font-semibold ${WSTATUS_TONE[wstatus.tone]}`}>
            {wstatus.label}
          </span>
        )}
      </div>

      {/* 12 수신시각 */}
      <div className="text-center font-mono text-[11px] text-muted dark:text-on-dark-soft">
        {formatTime(sample?.ts)}
      </div>

      {/* 13 누적 건수 */}
      <div
        className="text-center font-mono text-[11px] font-semibold text-body dark:text-on-dark"
        title={isVirtual ? "가상(테스트) 작업자" : "실시간 수집 DB 누적 건수"}
      >
        {isVirtual ? "가상" : formatPersisted(count)}
      </div>

      {/* 14 해제 */}
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
        className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-hairline-strong bg-canvas dark:border-white/10 dark:bg-surface-dark"
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
};
// 미대응 알림 카드/아이콘 톤 — SOS 레드 / 낙상 앰버 / 생체 위험 로즈 / 구획 이탈 오렌지.
const ALERT_UNACK_CARD: Record<string, string> = {
  sos: "border-[#dc2626]/30 bg-[#dc2626]/[0.06] dark:border-[#dc2626]/40 dark:bg-[#dc2626]/[0.10]",
  fall: "border-[#f59e0b]/35 bg-[#f59e0b]/[0.08] dark:border-[#f59e0b]/40 dark:bg-[#f59e0b]/[0.10]",
  vital: "border-[#e11d48]/30 bg-[#e11d48]/[0.06] dark:border-[#e11d48]/40 dark:bg-[#e11d48]/[0.10]",
  geofence: "border-[#f97316]/35 bg-[#f97316]/[0.08] dark:border-[#f97316]/40 dark:bg-[#f97316]/[0.10]",
};
const ALERT_UNACK_ICON: Record<string, string> = {
  sos: "text-semantic-down",
  fall: "text-amber-600 dark:text-amber-400",
  vital: "text-rose-600 dark:text-rose-400",
  geofence: "text-orange-600 dark:text-orange-400",
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

// 일괄 확인 진행 아이콘 — 원형 스피너(회전하는 호). 붙여주신 SuccessIcon 의 로딩 단계를
// framer-motion 없이 SVG + CSS 회전으로 옮긴 것이다(신규 패키지 미추가 원칙).
function AckProgressIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="14 43"
        className="origin-center animate-spin"
      />
    </svg>
  );
}

// 일괄 확인 완료 아이콘 — 초록 원 + 그려지는 체크(스피너가 체크로 바뀌는 SuccessIcon 의 완료 단계).
function AckDoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.35" />
      <path
        d="m7.5 12.4 3.1 3.1L16.6 8.6"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="ack-check-path"
      />
    </svg>
  );
}

function AlertHistoryModal({ onClose }: { onClose: () => void }) {
  const [alerts, setAlerts] = useState<ClientAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmAll, setConfirmAll] = useState(false); // 일괄 확인 2단계 — 첫 클릭은 되묻기
  const [ackingAll, setAckingAll] = useState(false);
  const [ackDone, setAckDone] = useState(0); // 진행 표시 — 스피너 옆에 n/전체 로 보여준다
  const [ackTotal, setAckTotal] = useState(0);
  const [ackSuccess, setAckSuccess] = useState(0); // 완료 표시(처리 건수) — 2.4초 뒤 사라진다

  // 되묻기 상태는 4초 뒤 스스로 풀린다 — 그냥 두면 다음에 눌렀을 때 되묻기 없이 바로 실행돼 위험하다.
  useEffect(() => {
    if (!confirmAll) return;
    const id = setTimeout(() => setConfirmAll(false), 4000);
    return () => clearTimeout(id);
  }, [confirmAll]);

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

  // 미대응 건 일괄 확인 — 되돌릴 수 없으므로 버튼을 두 번 눌러야 실행된다(첫 클릭은 확인 문구로 바뀜).
  // 개별 ack 를 순차 호출한다. 전용 벌크 API 가 없고, 원장(alerts)은 ON CONFLICT DO NOTHING 이라
  // 같은 건을 여러 번 눌러도 이력이 중복되지 않는다.
  async function ackAll() {
    const targets = alerts.filter((a) => !a.ack_at);
    if (targets.length === 0) return;
    setAckTotal(targets.length);
    setAckDone(0);
    setAckingAll(true);
    const token = getSessionToken();
    for (const a of targets) {
      try {
        await fetch("/api/alerts/ack", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ id: a.id, ackBy: "관제자" }),
        });
      } catch (e) {
        console.error("[알림 일괄 대응 확인 오류]", e);
      }
      setAckDone((n) => n + 1);
    }
    setAckingAll(false);
    setConfirmAll(false);
    // 완료 체크를 잠깐 띄운다 — load() 로 미대응이 0 이 되면 버튼이 사라지므로,
    // 이 값이 있는 동안은 버튼을 남겨 둔다(아래 렌더 조건).
    setAckSuccess(targets.length);
    setTimeout(() => setAckSuccess(0), 2400);
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
          <div className="flex items-center gap-2">
            {(unacked > 0 || ackSuccess > 0) && (
              <button
                type="button"
                onClick={() => (confirmAll ? ackAll() : setConfirmAll(true))}
                disabled={ackingAll || ackSuccess > 0}
                className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-100 ${
                  ackSuccess > 0
                    ? "border-[#10b981]/40 bg-[#10b981]/10 text-semantic-up"
                    : confirmAll
                      ? "border-semantic-down bg-semantic-down text-on-primary"
                      : "border-hairline-strong text-body hover:bg-surface-strong dark:border-white/20 dark:text-on-dark-soft dark:hover:bg-white/10"
                }`}
              >
                {ackSuccess > 0 ? (
                  // 완료는 초록 체크만 — 건수는 방금 누른 버튼에 이미 적혀 있었다.
                  <span className="flex items-center justify-center" aria-label={`${ackSuccess}건 확인 완료`}>
                    <AckDoneIcon />
                  </span>
                ) : ackingAll ? (
                  // 스피너가 체크로 바뀌는 상태 아이콘(붙여주신 SuccessIcon 형태) — framer-motion 없이
                  // SVG stroke-dasharray 회전 + 체크 그리기로 같은 동작을 낸다.
                  <span className="flex items-center gap-1.5">
                    <AckProgressIcon />
                    <span>{ackDone}/{ackTotal}</span>
                  </span>
                ) : confirmAll ? (
                  `${unacked}건 모두 확인할까요?`
                ) : (
                  "미대응 모두 확인"
                )}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="알림 이력 닫기"
              title="닫기"
              className="rounded-md p-1.5 text-muted transition hover:bg-surface-strong hover:text-ink dark:hover:bg-white/10 dark:hover:text-on-dark"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
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
                          className="inline-flex items-center gap-1 rounded-lg bg-semantic-down px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
                        >
                          <AlertCheckIcon />
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

// 스트레스 칩 — 표시가 **실제 산출 근거**와 어긋나지 않게 한다.
//
// ⚠️ HRV 가 없으면 지수는 심박의 단조 변환에 가깝다. 계산식에서 HRV 항(zHrv)과 호흡 항(zRr)이
//    0 이 되고 활동 보정 초과심박만 남기 때문이다. 그런데 상시 워크아웃 구조에서는 HRV 가
//    거의 안 들어온다 — watchOS 가 워크아웃 중 심호흡 세션을 거부하고 배경 측정도 일어나지
//    않는다(2026-08-13 실기기 실증. 수집 코드는 정상이며 세션을 끄면 즉시 도착한다).
//    종전 툴팁은 조건 없이 "활동 보정 초과심박 + HRV" 라고 적어 **없는 근거를 있다고 말했다**.
//    관제자가 심박과 독립인 신호가 반영된 줄로 오독하면 같은 정보를 두 번 세는 셈이 된다.
// 그래서 고정 문구가 아니라 그 샘플에 HRV 가 실렸는지로 갈라 쓴다(앱이 꺼진 사이 측정분이
//    앵커로 들어오는 경우가 있어 "항상 없다"고 단정할 수도 없다).
function StressChip({ result, hrvBacked }: { result: StressResult; hrvBacked: boolean }) {
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
  const title = hrvBacked
    ? "스트레스 지수 0~100 — 활동 보정 초과심박 + HRV · 참고용 추정 · 의료 진단 아님"
    : "스트레스 지수 0~100 — 활동 보정 초과심박 기반(심박 파생) · HRV 미반영이라 심박과 독립인 신호는 없다 · 참고용 추정 · 의료 진단 아님";
  return (
    <span
      title={title}
      className={`shrink-0 whitespace-nowrap rounded-pill border px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${STRESS_CLASS[result.level]}`}
    >
      스트레스 {result.index}
      {/* 심박 파생임을 칩에서도 드러낸다 — 툴팁은 호버해야 보이고, 호버하지 않는 관제자가 다수다. */}
      {!hrvBacked && <span className="ml-1 font-sans font-normal opacity-70">· 심박 기반</span>}
    </span>
  );
}

// 작업자 카드 헤더의 종합 상태 인디케이터 — 신호등 (녹/주/빨). 정상은 정적, 주의/위험은 블링크.
function TrafficLight({
  status,
  stale,
  /** 끊김 종류별 라벨(lib/vital-age.ts `STALE_LABEL`). 색·점멸은 종류를 안 탄다 — 글자만 다르다. */
  staleLabel,
  /** 미착용 — 슬레이트는 같되 점멸하지 않는다(점멸은 고장 신호다 · 2026-08-31). */
  offBody,
}: {
  status: VitalStatus;
  stale?: boolean;
  staleLabel?: string;
  offBody?: boolean;
}) {
  const map: Record<VitalStatus, string> = {
    idle: "bg-muted-soft",
    normal: "bg-semantic-up",
    caution: "bg-amber-400 vital-blink-caution",
    danger: "bg-semantic-down vital-blink-danger",
  };
  // 연결끊김은 어떤 생체 상태보다 우선 — 슬레이트 점멸로 "정상 녹색" false-OK 차단.
  const cls = offBody
    ? "bg-slate-400 dark:bg-slate-500"
    : stale
      ? "bg-slate-400 dark:bg-slate-500 animate-pulse"
      : map[status];
  // 라벨이 안 넘어오면 종전 문구로 떨어진다 — 다른 호출부가 생겨도 빈 글자가 뜨지 않게.
  const label = stale ? (staleLabel || STALE_LABEL.disconnected) : STATUS_LABEL[status];
  return (
    <span
      aria-label={`종합 상태 ${label}`}
      title={`종합 상태: ${label}`}
      className={`inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-hairline dark:ring-white/20 ${cls}`}
    />
  );
}
