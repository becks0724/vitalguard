// 안전관리비 주간 검증 보고서 — 서버 종합 로직.
//   4축(①계상·②사용·③실집행·④증액) + 4중 교차대조(장부·돈·사람·증빙)를 서버에서 계산한다.
//   실데이터: 계상액·worker-day·실측인원(조달 계약 + 워치 출역 DB).
//   시공사 제출분: weekly_report_inputs(DB) — 없으면 데모 기본값. (실서비스: 세금계산서 파싱/오픈뱅킹/대장·사진 업로드)
import "server-only";
import { getNoticeDetail } from "./g2b";
import { buildExecutionAudit } from "./safety-execution";
import { auditWorkerDays, getReportInputs } from "../../lib/db";
import { countPhotos } from "./photo-store";

const PER_PERSON_KIT = 85000; // 안전모 25,000 + 안전화 60,000 (1인분)

// 시공사 제출 데이터가 DB에 없을 때 쓰는 데모 기본값.
const DEFAULT_INPUTS = {
  supplier: "대한안전산업(주)",
  supplierBno: "124-81-00998",
  claimedHeadcount: 10,
  invoiceTotal: 850000,
  paidTotal: 595000,
  ledgerHeadcount: 7,
  photoCount: 5,
};

export type ReportInputsResolved = typeof DEFAULT_INPUTS;
export type ReportCheck = { label: string; detail: string; ok: boolean; note: string };

export type WeeklyReport = {
  notice: { id: string; title: string; agency: string; region?: string };
  requiredCost: number;
  totalWorkerDays: number;
  distinctWorkers: number;
  safetyWorkerDays: number;
  days: number;
  inputs: ReportInputsResolved;
  inputsSource: "submitted" | "default";
  checks: ReportCheck[];
  verdict: "이상 없음" | "검토 필요";
  suspect: number;
  overclaimQty: number;
  overclaimAmt: number;
  unpaid: number;
};

function won(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

export async function buildWeeklyReport(contractId: string): Promise<WeeklyReport | null> {
  const detail = await getNoticeDetail(contractId);
  if (!detail.notice) return null;

  const now = new Date();
  const from = new Date(now.getTime() - 90 * 86400000).toISOString();
  const to = now.toISOString();
  const wd = await auditWorkerDays({ from, to });
  const audit = buildExecutionAudit(detail.notice, wd);

  const saved = await getReportInputs(contractId);
  const uploadedPhotos = countPhotos(contractId); // 실제 업로드된 사진 파일 수(있으면 우선)
  const inputs: ReportInputsResolved = {
    supplier: saved?.supplier ?? DEFAULT_INPUTS.supplier,
    supplierBno: saved?.supplierBno ?? DEFAULT_INPUTS.supplierBno,
    claimedHeadcount: saved?.claimedHeadcount ?? DEFAULT_INPUTS.claimedHeadcount,
    invoiceTotal: saved?.invoiceTotal ?? DEFAULT_INPUTS.invoiceTotal,
    paidTotal: saved?.paidTotal ?? DEFAULT_INPUTS.paidTotal,
    ledgerHeadcount: saved?.ledgerHeadcount ?? DEFAULT_INPUTS.ledgerHeadcount,
    photoCount: uploadedPhotos > 0 ? uploadedPhotos : saved?.photoCount ?? DEFAULT_INPUTS.photoCount,
  };

  const N = wd.distinctWorkers;
  const overclaimQty = Math.max(0, inputs.claimedHeadcount - N);
  const overclaimAmt = overclaimQty * PER_PERSON_KIT;
  const unpaid = Math.max(0, inputs.invoiceTotal - inputs.paidTotal);
  const ledgerMatch = inputs.ledgerHeadcount === N;
  const hasPhoto = inputs.photoCount > 0;

  const checks: ReportCheck[] = [
    {
      label: "장부 ↔ 사람",
      detail: `세금계산서 청구 ${inputs.claimedHeadcount}명분 vs 워치 실측 ${N}명`,
      ok: overclaimQty === 0,
      note: overclaimQty > 0 ? `과다 ${overclaimQty}명분 (${won(overclaimAmt)})` : "부합",
    },
    {
      label: "돈 ↔ 장부",
      detail: `세금계산서 ${won(inputs.invoiceTotal)} vs 계좌이체 ${won(inputs.paidTotal)}`,
      ok: unpaid === 0,
      note: unpaid > 0 ? `미지급 ${won(unpaid)}` : "일치",
    },
    {
      label: "사람 ↔ 대장",
      detail: `워치 실측 ${N}명 vs 근로자 대장 ${inputs.ledgerHeadcount}명`,
      ok: ledgerMatch,
      note: ledgerMatch ? "일치" : "불일치",
    },
    {
      label: "증빙(사진대지)",
      detail: `현장 사진 ${inputs.photoCount}장`,
      ok: hasPhoto,
      note: hasPhoto ? "제출됨" : "미제출",
    },
  ];
  const suspect = checks.filter((c) => !c.ok).length;

  return {
    notice: {
      id: detail.notice.id,
      title: detail.notice.title,
      agency: detail.notice.agency,
      region: detail.notice.region,
    },
    requiredCost: audit.requiredCost,
    totalWorkerDays: audit.totalWorkerDays,
    distinctWorkers: N,
    safetyWorkerDays: audit.safetyWorkerDays,
    days: audit.days,
    inputs,
    inputsSource: saved ? "submitted" : "default",
    checks,
    verdict: suspect === 0 ? "이상 없음" : "검토 필요",
    suspect,
    overclaimQty,
    overclaimAmt,
    unpaid,
  };
}
