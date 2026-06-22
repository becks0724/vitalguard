// 현장별 가상 출역(③ 실집행) — 현장별 격리 데모용.
// 메인 관제 현장(스마트인재개발원)은 실 워치 데이터(vital_samples)를 쓰고,
// 그 외 mock 공고는 현장 규모에 맞춘 "현장별 가상 worker-day"로 격리 검증을 보여준다.
// ⚠ SITE_PLANS 값은 전부 [가상 데모값]. 실제로는 각 현장에 워치를 배포하면
//    vital_samples 의 site 귀속 데이터로 자동 대체된다(현재는 단일 현장만 실측).
import type { WorkerDayAudit } from "../../lib/db";

// 실 워치 데이터를 쓰는 메인 관제 현장 id (g2b-mock.ts 의 우리 현장과 일치).
export const MAIN_SITE_ID = "SITE-SMARTHRD-2026";

// 현장 id → 가상 출역 계획. 현장마다 다른 규모를 줘서 격리가 눈에 보이게 한다.
type SitePlan = { workers: number; days: number; safetyWorkers: number };

const SITE_PLANS: Record<string, SitePlan> = {
  "SITE-GWANGJU-LOGI": { workers: 8, days: 14, safetyWorkers: 2 }, // 광주 물류센터(중규모)
  "SITE-PYEONGTAEK-FAB": { workers: 20, days: 30, safetyWorkers: 5 }, // 평택 반도체 FAB(초대형)
  "SITE-BUSAN-RESI": { workers: 14, days: 22, safetyWorkers: 3 }, // 부산 주상복합(대형)
  "SITE-INCHEON-OFFICE": { workers: 11, days: 18, safetyWorkers: 3 }, // 인천 오피스타워
  "SITE-SEJONG-APT": { workers: 16, days: 20, safetyWorkers: 4 }, // 세종 공동주택
};

const EMPTY: WorkerDayAudit = {
  totalWorkerDays: 0,
  safetyWorkerDays: 0,
  distinctWorkers: 0,
  days: 0,
  byDay: [],
};

// 표시용 일자 — 결정적(고정 시작일 + offset). 집계 숫자엔 영향 없음(표시 전용).
function dayStr(offset: number): string {
  const d = new Date("2026-06-01T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

// 현장별 가상 WorkerDayAudit. SITE_PLANS 에 없으면 빈 출역(검증 비활성).
export function mockWorkerDayAudit(siteId: string): WorkerDayAudit {
  const plan = SITE_PLANS[siteId];
  if (!plan) return EMPTY;
  const byDay = Array.from({ length: plan.days }, (_, i) => ({
    day: dayStr(i),
    workers: plan.workers,
    safetyWorkers: plan.safetyWorkers,
  }));
  return {
    totalWorkerDays: plan.workers * plan.days,
    safetyWorkerDays: plan.safetyWorkers * plan.days,
    distinctWorkers: plan.workers,
    days: plan.days,
    byDay,
  };
}
