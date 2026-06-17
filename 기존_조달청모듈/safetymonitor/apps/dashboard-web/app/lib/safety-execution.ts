// 안전관리비 실집행 감사 — ①계상(조달 입찰공고+요율) × ③실집행(워치 출역 worker-day) 교차.
// VitAlGuard 핵심: 계상된 안전예산이 실제 작업자 출역(=현장 도달)에 얼마나 대응됐는지를 정량화한다.
import "server-only";
import { classifyConstructionType, computeRequiredSafetyCost } from "./safety-cost";
import type { NoticeDetail } from "./safeprocure-types";
import type { WorkerDayAudit } from "../../lib/db";

export type SafetyExecutionAudit = {
  // ① 계상(예산)
  requiredCost: number; // 법정 계상 기준 안전관리비(원)
  estimatedPrice: number | null; // 추정가격(대상액 근사)
  constructionType: string;
  classifyReason: string;
  formula: string;
  // ③ 실집행(물증)
  totalWorkerDays: number; // 누적 출역 worker-day
  safetyWorkerDays: number; // 안전관리 인력 worker-day
  distinctWorkers: number;
  days: number;
  byDay: { day: string; workers: number; safetyWorkers: number }[];
  // 교차 지표
  perWorkerDay: number | null; // 계상액 ÷ worker-day = 1인·1일당 명목 안전예산(원)
  safetyRatio: number | null; // 안전인력 worker-day 비율(0~1)
  note: string;
};

export function buildExecutionAudit(notice: NoticeDetail, wd: WorkerDayAudit): SafetyExecutionAudit {
  const { type, reason } = classifyConstructionType(notice.licenses, notice.taskText);
  const baseAmount = (notice.targetAmount ?? notice.estimatedPrice ?? 0) as number;
  const calc = computeRequiredSafetyCost(type, baseAmount);

  const perWorkerDay = wd.totalWorkerDays > 0 ? Math.round(calc.requiredCost / wd.totalWorkerDays) : null;
  const safetyRatio = wd.totalWorkerDays > 0 ? wd.safetyWorkerDays / wd.totalWorkerDays : null;

  const note =
    wd.totalWorkerDays === 0
      ? "워치 출역 데이터 없음 — 작업자 워치 연결 시 실집행 검증이 활성화됩니다."
      : `계상 기준액 ${calc.requiredCost.toLocaleString("ko-KR")}원 ÷ 누적 출역 ${wd.totalWorkerDays} worker-day = 1인·1일당 ${perWorkerDay?.toLocaleString("ko-KR")}원`;

  return {
    requiredCost: calc.requiredCost,
    estimatedPrice: notice.estimatedPrice,
    constructionType: type,
    classifyReason: reason,
    formula: calc.formula,
    totalWorkerDays: wd.totalWorkerDays,
    safetyWorkerDays: wd.safetyWorkerDays,
    distinctWorkers: wd.distinctWorkers,
    days: wd.days,
    byDay: wd.byDay,
    perWorkerDay,
    safetyRatio,
    note,
  };
}
