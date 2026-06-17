"use client";
// ④증액축 — 계약 후 안전관리비 증액 청구의 타당성 검증 (읽기 전용 대조).
// 핵심: 청구 내역은 시공사(피검증자)가 제출한 데이터 → 검증자(조달청)는 수정 불가, 웨어러블 실측과 대조만.
//   사진 증빙은 같은 사람을 갈아입혀 속일 수 있으나, 개인 식별 생체신호는 '인원수'를 못 속인다.
//   과다액 = Σ max(0, 청구수량 − 실측인원) × 단가.
//   (세금계산서 세목을 주는 공개 OpenAPI는 없음 → 시공사 제출/업로드 또는 전자세금계산서 본인인증 연동[상용화].
//    적정성의 최종 판정은 발주처·감독기관 권한.)
import { useMemo } from "react";

type Item = { name: string; qty: number; unit: number };
type Verdict = "정상" | "주의" | "의심" | "검증불가";

// 시공사 제출 청구 내역(데모 고정) — 실제로는 시공사 업로드/전자세금계산서 연동으로 수신.
const SUBMITTED = {
  supplier: "대한안전산업(주)",
  invoiceNo: "전자세금계산서 2026-0617-014",
  items: [
    { name: "안전모", qty: 10, unit: 25000 },
    { name: "안전화", qty: 10, unit: 60000 },
  ] as Item[],
  hasEvidence: true,
};

function won(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

export default function SafetyIncreaseAuditCard({ distinctWorkers }: { distinctWorkers: number }) {
  const calc = useMemo(() => {
    const N = Math.max(0, distinctWorkers);
    let totalClaim = 0;
    let totalLegit = 0;
    let totalExcess = 0;
    let maxRatio = 0;
    const rows = SUBMITTED.items.map((it) => {
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
    } else if (!SUBMITTED.hasEvidence) {
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
  }, [distinctWorkers]);

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
          <span>시공사 제출 청구 내역 (읽기 전용)</span>
          <span>{SUBMITTED.supplier}</span>
        </div>
        <div className="mt-1 space-y-0.5">
          {calc.rows.map((r) => (
            <div key={r.name} className="flex items-center justify-between text-[11px] text-body dark:text-on-dark-soft">
              <span>{r.name}</span>
              <span className="tabular-nums">
                {r.qty}개 × {won(r.unit)} = {won(r.qty * r.unit)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-1 text-[9px] text-muted dark:text-on-dark-soft">{SUBMITTED.invoiceNo} · 증빙 제출됨</div>
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
