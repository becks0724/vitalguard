"use client";
// ④증액축 — 계약 후 안전관리비 증액 청구의 타당성 검증 (읽기 전용 대조).
// 핵심: 청구 내역은 시공사(피검증자)가 제출한 데이터 → 검증자(조달청)는 수정 불가, 웨어러블 실측과 대조만.
//   사진 증빙은 같은 사람을 갈아입혀 속일 수 있으나, 개인 식별 생체신호는 '인원수'를 못 속인다.
//   과다액 = Σ max(0, 청구수량 − 실측인원) × 단가.
//   (세금계산서 세목을 주는 공개 OpenAPI는 없음 → 시공사 제출/업로드 또는 전자세금계산서 본인인증 연동[상용화].
//    적정성의 최종 판정은 발주처·감독기관 권한.)
import { useEffect, useMemo, useState } from "react";

type Item = { name: string; qty: number; unit: number };
type Verdict = "정상" | "주의" | "의심" | "검증불가";

type SubmittedClaim = { supplier: string; invoiceNo: string; items: Item[]; hasEvidence: boolean };

// 현장 id별 시공사 제출 청구 내역 — 현장 성격·규모에 맞게 품목·수량·공급사를 차별화. 전부 [데모값].
// 실제로는 시공사 업로드/전자세금계산서 연동으로 현장별 수신. 판정 = 청구수량 ÷ 워치 실측인원 비율.
const CLAIMS_BY_SITE: Record<string, SubmittedClaim> = {
  "SITE-SMARTHRD-2026": {
    supplier: "대한안전산업(주)",
    invoiceNo: "전자세금계산서 2026-0617-014",
    items: [
      { name: "안전모", qty: 14, unit: 25000 },
      { name: "안전화", qty: 12, unit: 60000 },
      { name: "안전대", qty: 20, unit: 80000 },
    ],
    hasEvidence: true,
  },
  "SITE-GWANGJU-LOGI": {
    supplier: "호남세이프티(주)",
    invoiceNo: "전자세금계산서 2026-0614-022",
    items: [
      { name: "안전모", qty: 11, unit: 25000 },
      { name: "안전화", qty: 9, unit: 60000 },
      { name: "보안경", qty: 10, unit: 12000 },
    ],
    hasEvidence: true,
  },
  "SITE-PYEONGTAEK-FAB": {
    supplier: "대성안전산업(주)",
    invoiceNo: "전자세금계산서 2026-0612-118",
    items: [
      { name: "안전모", qty: 22, unit: 25000 },
      { name: "안전화", qty: 20, unit: 60000 },
      { name: "방진마스크", qty: 22, unit: 5000 },
    ],
    hasEvidence: true,
  },
  "SITE-BUSAN-RESI": {
    supplier: "부산종합안전(주)",
    invoiceNo: "전자세금계산서 2026-0610-070",
    items: [
      { name: "안전모", qty: 16, unit: 25000 },
      { name: "안전대", qty: 24, unit: 80000 },
      { name: "안전화", qty: 15, unit: 60000 },
    ],
    hasEvidence: true,
  },
  "SITE-INCHEON-OFFICE": {
    supplier: "송도안전기술(주)",
    invoiceNo: "전자세금계산서 2026-0609-045",
    items: [
      { name: "안전모", qty: 14, unit: 25000 },
      { name: "안전화", qty: 12, unit: 60000 },
      { name: "안전조끼", qty: 13, unit: 18000 },
    ],
    hasEvidence: true,
  },
  "SITE-SEJONG-APT": {
    supplier: "세종건설안전(주)",
    invoiceNo: "전자세금계산서 2026-0604-031",
    items: [
      { name: "안전모", qty: 17, unit: 25000 },
      { name: "안전화", qty: 16, unit: 60000 },
      { name: "각반", qty: 18, unit: 15000 },
    ],
    hasEvidence: true,
  },
};

const DEFAULT_CLAIM: SubmittedClaim = {
  supplier: "—",
  invoiceNo: "청구 내역 미제출",
  items: [],
  hasEvidence: false,
};

function claimFor(noticeId?: string): SubmittedClaim {
  return (noticeId && CLAIMS_BY_SITE[noticeId]) || DEFAULT_CLAIM;
}

// 경리시스템(스마트경리 데모 /erp → /api/tax-invoice) 수신 계산서 — 있으면 내장 데모값 대신 사용.
type ReceivedInvoice = { approval_no: string; supplier_name: string; items_json: string };

function claimFromReceived(rows: ReceivedInvoice[]): SubmittedClaim | null {
  if (rows.length === 0) return null;
  const items: Item[] = [];
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.items_json) as { name: string; qty: number; unit: number }[];
      for (const i of parsed) items.push({ name: i.name, qty: Number(i.qty) || 0, unit: Number(i.unit) || 0 });
    } catch {
      // 항목 파싱 실패 건은 건너뜀
    }
  }
  if (items.length === 0) return null;
  const first = rows[0]!;
  return {
    supplier: rows.length > 1 ? `${first.supplier_name} 외 ${rows.length - 1}` : first.supplier_name,
    invoiceNo: `전자세금계산서 승인 ${first.approval_no}${rows.length > 1 ? ` 외 ${rows.length - 1}건` : ""}`,
    items,
    hasEvidence: true,
  };
}

function won(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

// 사용계획서 수신(/api/use-plan) — '3. 개인보호구 및 안전장구 구입비' 계획액이 증액 판정 기준.
// detail = 경리시스템(스마트경리)이 동봉한 항목 3 품목별 구매계획 → 청구 내역과 품목 단위 대조.
type PlanDetailItem = { name: string; spec?: string; qty: number; unit: number };
type ReceivedPlan = { appropriated: number; items: { name: string; amount: number; detail?: PlanDetailItem[] }[] };

export default function SafetyIncreaseAuditCard({ distinctWorkers, noticeId }: { distinctWorkers: number; noticeId?: string }) {
  const [received, setReceived] = useState<SubmittedClaim | null>(null);
  const [plan, setPlan] = useState<ReceivedPlan | null>(null);
  useEffect(() => {
    if (!noticeId) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/use-plan?siteId=${encodeURIComponent(noticeId)}`);
        if (!r.ok) return;
        const j = (await r.json()) as { plan: { appropriated: number; items_json: string } | null };
        if (!alive || !j.plan) return;
        setPlan({ appropriated: j.plan.appropriated, items: JSON.parse(j.plan.items_json) as ReceivedPlan["items"] });
      } catch {
        // 미수신 → 계획 대조 생략
      }
    })();
    return () => {
      alive = false;
    };
  }, [noticeId]);
  useEffect(() => {
    if (!noticeId) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/tax-invoice?siteId=${encodeURIComponent(noticeId)}`);
        if (!r.ok) return;
        const j = (await r.json()) as { rows: ReceivedInvoice[] };
        if (alive) setReceived(claimFromReceived(j.rows));
      } catch {
        // 조회 실패 → 내장 데모 폴백
      }
    })();
    return () => {
      alive = false;
    };
  }, [noticeId]);
  const submitted = received ?? claimFor(noticeId);
  const calc = useMemo(() => {
    const N = Math.max(0, distinctWorkers);
    let totalClaim = 0;
    let totalLegit = 0;
    let totalExcess = 0;
    let maxRatio = 0;
    const rows = submitted.items.map((it) => {
      const claim = it.qty * it.unit;
      const legit = Math.min(it.qty, N) * it.unit;
      const excessQty = Math.max(0, it.qty - N);
      const excess = excessQty * it.unit;
      totalClaim += claim;
      totalLegit += legit;
      totalExcess += excess;
      const ratio = N > 0 ? it.qty / N : Infinity;
      if (ratio > maxRatio) maxRatio = ratio;
      return { name: it.name, qty: it.qty, unit: it.unit, excessQty, excess };
    });

    let verdict: Verdict;
    let reason: string;
    if (N <= 0) {
      verdict = "검증불가";
      reason = "워치 출역 실측 인원이 없습니다 (③실집행 데이터 필요)";
    } else if (!submitted.hasEvidence) {
      verdict = "검증불가";
      reason = "증빙(세금계산서) 미제출";
    } else if (maxRatio > 1.5) {
      verdict = "의심";
      reason = `청구가 실측 인원의 ${maxRatio.toFixed(1)}배 — 과다 산정 의심`;
    } else if (maxRatio > 1.2) {
      verdict = "주의";
      reason = `청구가 실측 인원의 ${maxRatio.toFixed(1)}배 — 주의`;
    } else {
      verdict = "정상";
      reason = "실측 인원과 청구 수량이 부합";
    }
    return { N, rows, totalClaim, totalLegit, totalExcess, verdict, reason };
  }, [distinctWorkers, submitted]);

  // 계획액 대비 증액 — 청구 총액이 사용계획서의 '개인보호구 및 안전장구 구입비' 계획액을 초과하면 증액 청구.
  const ppeItem = plan?.items.find((i) => i.name.includes("개인보호구")) ?? null;
  const ppePlan = ppeItem?.amount ?? null;
  const planExcess = ppePlan != null ? Math.max(0, calc.totalClaim - ppePlan) : null;
  // 품목별 계획 수량 — 청구 각 라인에 '계획 N개' 대조 칩 표시(초과분 강조).
  const planQtyByName = new Map((ppeItem?.detail ?? []).map((d) => [d.name, d.qty]));

  const badge: Record<Verdict, string> = {
    정상: "bg-[#05b169]/10 text-[#05b169]",
    주의: "bg-[#f59e0b]/10 text-[#f59e0b]",
    의심: "bg-[#cf202f]/10 text-[#cf202f]",
    검증불가: "bg-surface-strong text-muted dark:bg-white/10 dark:text-on-dark-soft",
  };

  return (
    <div className="rounded-lg border border-hairline bg-canvas p-3 dark:border-white/10 dark:bg-surface-dark">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-ink dark:text-on-dark">④ 증액 검증 — 실인원 대비 과다 산정</div>
        <span className={`shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-semibold ${badge[calc.verdict]}`}>{calc.verdict}</span>
      </div>
      <p className="mt-0.5 text-[10px] text-muted dark:text-on-dark-soft">
        2차 계약변경(증액) 청구 · 시공사 제출 내역을 웨어러블 실측 인원과 대조합니다.
      </p>

      {/* 시공사 제출 청구 내역 — 읽기 전용 (검증자 수정 불가) */}
      <div className="mt-2 rounded-md border border-hairline bg-surface-soft p-2 dark:border-white/10 dark:bg-surface-dark-elevated">
        <div className="flex items-center justify-between text-[10px] text-muted dark:text-on-dark-soft">
          <span>
            시공사 제출 청구 내역 (읽기 전용)
            {received ? (
              <span className="ml-1 rounded-pill bg-[#05b169]/10 px-1.5 py-0.5 font-semibold text-[#05b169]">경리시스템 수신</span>
            ) : (
              <span className="ml-1 rounded-pill bg-surface-strong px-1.5 py-0.5 dark:bg-white/10">내장 데모</span>
            )}
          </span>
          <span>{submitted.supplier}</span>
        </div>
        <div className="mt-1 space-y-0.5">
          {calc.rows.map((r) => {
            const planQty = planQtyByName.get(r.name);
            return (
              <div key={r.name} className="flex items-center justify-between text-[11px] text-body dark:text-on-dark-soft">
                <span>
                  {r.name}
                  {planQty != null && (
                    <span
                      className={`ml-1.5 rounded-pill px-1.5 py-0.5 text-[10px] font-semibold ${
                        r.qty > planQty
                          ? "bg-[#cf202f]/10 text-[#cf202f]"
                          : "bg-surface-strong text-muted dark:bg-white/10 dark:text-on-dark-soft"
                      }`}
                    >
                      계획 {planQty}개{r.qty > planQty ? ` → 청구 ${r.qty}개 (+${r.qty - planQty})` : ""}
                    </span>
                  )}
                </span>
                <span className="tabular-nums">
                  {r.qty}개 × {won(r.unit)} = {won(r.qty * r.unit)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-1 text-[9px] text-muted dark:text-on-dark-soft">{submitted.invoiceNo}{submitted.hasEvidence ? " · 증빙 제출됨" : ""}</div>
      </div>

      {/* 사용계획서 계획액 대조 — 경리시스템 제출 계획 대비 증액 여부 */}
      <div className="mt-2 flex items-center justify-between text-[11px] text-body dark:text-on-dark-soft">
        <span>
          사용계획서 계획액 (3. 개인보호구 및 안전장구)
          {planQtyByName.size > 0 && (
            <span className="ml-1.5 rounded-pill bg-[#05b169]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#05b169]">
              품목 상세 수신
            </span>
          )}
        </span>
        {ppePlan != null ? (
          <span className="tabular-nums">
            {won(ppePlan)}
            {planExcess != null && planExcess > 0 ? (
              <span className="ml-1.5 rounded-pill bg-[#cf202f]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#cf202f]">
                계획 대비 +{won(planExcess)} 증액 청구
              </span>
            ) : (
              <span className="ml-1.5 rounded-pill bg-[#05b169]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#05b169]">계획 내</span>
            )}
          </span>
        ) : (
          <span className="text-muted dark:text-on-dark-soft">사용계획서 미수신 — 경리시스템 제출 필요</span>
        )}
      </div>

      {/* 실측 인원 — 워치 출역 자동(편집 불가) */}
      <div className="mt-2 flex items-center justify-between text-[11px] text-body dark:text-on-dark-soft">
        <span>실측 인원 (워치 출역 · 자동)</span>
        <span className="font-semibold tabular-nums text-ink dark:text-on-dark">{calc.N}명</span>
      </div>

      {/* 결과 */}
      <div className="mt-2 rounded-lg border border-hairline p-3 dark:border-white/10">
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-[10px] text-muted dark:text-on-dark-soft">과다 산정 의심액</div>
            <div className="text-2xl font-extrabold tabular-nums text-[#cf202f]">{won(calc.totalExcess)}</div>
          </div>
          <div className="text-right text-[10px] text-muted dark:text-on-dark-soft">
            <div>청구 총 {won(calc.totalClaim)}</div>
            <div>정당 {won(calc.totalLegit)}</div>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-body dark:text-on-dark-soft">{calc.reason}</p>
        {calc.rows.some((r) => r.excessQty > 0) && (
          <ul className="mt-1 space-y-0.5 text-[10px] text-muted dark:text-on-dark-soft">
            {calc.rows
              .filter((r) => r.excessQty > 0)
              .map((r) => (
                <li key={r.name}>· {r.name} 과다 {r.excessQty}개 = {won(r.excess)}</li>
              ))}
          </ul>
        )}
      </div>
      <p className="mt-1 text-[9px] text-muted dark:text-on-dark-soft">
        ※ 청구 내역은 시공사 제출분(검증자 수정 불가) · 워치 출역은 데모데이터 · 최종 판정은 발주처·감독기관 권한.
      </p>
    </div>
  );
}
