"use client";
// 안전관리비 주간 검증 보고서(감독관 제출본) — 서버(/api/weekly-report)가 4축+4중대조를 종합한다.
//   제출 시 /api/weekly-report/submit 으로 제출 이력을 DB에 영속. (검증자는 청구 수치 수정 불가 — 시공사 제출분)
import { useEffect, useState } from "react";

import { getSessionToken } from "./session-token";

import { QuantumPulseLoader } from "./ui/quantum-pulse-loader";
type Check = { label: string; detail: string; ok: boolean; note: string };
type Report = {
  notice: { id: string; title: string; agency: string; region?: string };
  requiredCost: number;
  totalWorkerDays: number;
  distinctWorkers: number;
  safetyWorkerDays: number;
  days: number;
  inputs: {
    supplier: string;
    supplierBno: string;
    claimedHeadcount: number;
    invoiceTotal: number;
    paidTotal: number;
    ledgerHeadcount: number;
    photoCount: number;
  };
  inputsSource: "submitted" | "default";
  checks: Check[];
  verdict: "이상 없음" | "검토 필요";
  suspect: number;
  overclaimQty: number;
  overclaimAmt: number;
  unpaid: number;
};
type Submission = { id: number; submitted_at: string; verdict: string | null; suspect_count: number | null };

const PERIOD = "2026-06-13 ~ 2026-06-19";
const SUBMIT_DATE = "2026-06-19";

function won(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

export default function WeeklyReportBoard() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [history, setHistory] = useState<Submission[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/weekly-report");
        if (!res.ok) throw new Error(`보고서 생성 실패 (${res.status})`);
        const j = (await res.json()) as Report;
        if (alive) setReport(j);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "불러오기 실패");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function submit() {
    if (!report) return;
    setSubmitting(true);
    setSubmitError(null);
    const token = getSessionToken();
    try {
      const res = await fetch("/api/weekly-report/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          contractId: report.notice.id,
          period: PERIOD,
          verdict: report.verdict,
          suspectCount: report.suspect,
        }),
      });
      if (!res.ok) throw new Error(`제출 실패 (${res.status})`);
      const j = (await res.json()) as { history?: Submission[] };
      setHistory(j.history ?? []);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "제출 실패");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <QuantumPulseLoader text="보고서 생성 중" />;
  if (error || !report) return <p className="py-12 text-center text-sm text-[#cf202f]">{error ?? "데이터 없음"}</p>;

  const r = report;

  return (
    <section className="rounded-2xl border border-hairline bg-canvas p-6 dark:border-white/10 dark:bg-surface-dark">
      {/* 헤더 */}
      <div className="border-b border-hairline pb-4 dark:border-white/10">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-ink dark:text-on-dark">안전관리비 집행 주간 검증 보고서</h1>
          <span
            className={`shrink-0 rounded-pill px-3 py-1 text-xs font-bold ${
              r.suspect === 0 ? "bg-[#05b169]/10 text-[#05b169]" : "bg-[#cf202f]/10 text-[#cf202f]"
            }`}
          >
            {r.verdict}
            {r.suspect > 0 ? ` · 의심 ${r.suspect}건` : ""}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted dark:text-on-dark-soft sm:grid-cols-3">
          <div>현장: {r.notice.title}</div>
          <div>발주처: {r.notice.agency}</div>
          <div>감독관: 조달청 / 발주처</div>
          <div>보고기간: {PERIOD}</div>
          <div>제출일: {SUBMIT_DATE}</div>
          <div>작성: VitAlGuard 자동</div>
        </div>
      </div>

      {/* 4축 요약 */}
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <ReportStat label="① 계상 안전관리비" value={won(r.requiredCost)} />
        <ReportStat label="② 발급처" value={r.inputs.supplier} sub={`${r.inputs.supplierBno} · 계속사업자`} />
        <ReportStat
          label="③ 실집행(워치)"
          value={`${r.totalWorkerDays} 인·일`}
          sub={`${r.distinctWorkers}명 · 안전인력 ${r.safetyWorkerDays}인·일`}
        />
        <ReportStat
          label="④ 과다 산정"
          value={won(r.overclaimAmt)}
          sub={r.overclaimQty > 0 ? `${r.overclaimQty}명분 의심` : "정상"}
          danger={r.overclaimQty > 0}
        />
      </div>

      {/* 4중 교차대조 */}
      <div className="mt-4">
        <h2 className="text-sm font-semibold text-ink dark:text-on-dark">4중 교차대조 — 장부·돈·사람·증빙</h2>
        <div className="mt-2 divide-y divide-hairline rounded-lg border border-hairline dark:divide-white/10 dark:border-white/10">
          {r.checks.map((c) => (
            <div key={c.label} className="flex items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-ink dark:text-on-dark">{c.label}</div>
                <div className="text-[11px] text-muted dark:text-on-dark-soft">{c.detail}</div>
              </div>
              <span
                className={`shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-semibold ${
                  c.ok ? "bg-[#05b169]/10 text-[#05b169]" : "bg-[#cf202f]/10 text-[#cf202f]"
                }`}
              >
                {c.ok ? "✓ " : "⚠ "}
                {c.note}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 조치 의견 */}
      {r.suspect > 0 && (
        <div className="mt-4 rounded-lg border border-[#cf202f]/30 bg-[#cf202f]/[0.05] p-3">
          <div className="text-xs font-semibold text-[#cf202f]">조치 의견</div>
          <ul className="mt-1 space-y-0.5 text-[11px] text-body dark:text-on-dark-soft">
            {r.checks
              .filter((c) => !c.ok)
              .map((c) => (
                <li key={c.label}>· {c.label} — {c.note} 소명·확인 요청</li>
              ))}
          </ul>
        </div>
      )}

      {/* 액션 */}
      <div className="mt-5 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-on-primary hover:bg-primary-active disabled:bg-primary-disabled disabled:text-muted"
        >
          {submitting ? "발송 중…" : "감독관에게 주간보고서 제출"}
        </button>
        <button
          onClick={() => window.print()}
          className="rounded-md border border-hairline px-3 py-2 text-xs font-semibold text-body dark:border-white/10 dark:text-on-dark-soft"
        >
          PDF 다운로드 / 인쇄
        </button>
      </div>

      {/* 제출 실패 안내 */}
      {submitError && (
        <div className="mt-3 rounded-lg border border-[#cf202f]/30 bg-[#cf202f]/10 px-3 py-2 text-[11px] font-semibold text-[#cf202f]">
          {submitError}
        </div>
      )}

      {/* 제출 이력 (DB 영속) */}
      {history.length > 0 && (
        <div className="mt-3 rounded-lg border border-hairline bg-surface-soft p-3 dark:border-white/10 dark:bg-surface-dark-elevated">
          <div className="text-[11px] font-semibold text-[#05b169]">감독관에게 제출 완료 — DB 기록됨 (데모)</div>
          <ul className="mt-1 space-y-0.5 text-[10px] text-muted dark:text-on-dark-soft">
            {history.map((h) => (
              <li key={h.id}>
                · #{h.id} · {h.submitted_at} · {h.verdict} · 의심 {h.suspect_count ?? 0}건
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[9px] text-muted dark:text-on-dark-soft">※ 실서비스: 주1회 자동으로 조달청·발주처 감독관 메일 발송</p>
        </div>
      )}

      <p className="mt-4 text-[9px] text-muted dark:text-on-dark-soft">
        ※ ①계상·③실집행·④과다는 조달청 계약·워치 출역 기반 산출(서버 종합). 세금계산서·계좌·대장·사진은{" "}
        {r.inputsSource === "submitted" ? "시공사 제출분" : "데모 제출분"}(실서비스: 팝빌/CODEF·오픈뱅킹·관리자앱 업로드). 최종 판정은 발주처·감독기관 권한.
      </p>
    </section>
  );
}

function ReportStat({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-soft p-3 dark:border-white/10 dark:bg-surface-dark-elevated">
      <div className="text-[10px] font-semibold text-muted dark:text-on-dark-soft">{label}</div>
      <div className={`mt-1 truncate text-sm font-bold ${danger ? "text-[#cf202f]" : "text-ink dark:text-on-dark"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted dark:text-on-dark-soft">{sub}</div>}
    </div>
  );
}
