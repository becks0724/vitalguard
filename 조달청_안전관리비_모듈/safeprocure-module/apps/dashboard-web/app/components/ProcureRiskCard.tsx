// 사전 안전 리스크 카드 — 한 공고의 안전관리비 예비검증 + 위험작업 태그 + 위험도 분해를 표시.
// 표현용(presentational): 데이터는 prop 으로 받는다.
import type { RiskProfile, SafetyCostCheck, RiskTag } from "../lib/safeprocure-types";

export type ProcureRiskDetail = {
  source: "live" | "mock";
  notice: {
    id: string;
    title: string;
    agency: string;
    region?: string;
    estimatedPrice: number | null;
    startDate?: string;
    endDate?: string;
    licenses: string[];
  };
  safetyCost: SafetyCostCheck;
  tags: RiskTag[];
  risk: Pick<RiskProfile, "score" | "breakdown" | "topFactors" | "recommendations">;
  note?: string;
};

function won(n: number | null | undefined): string {
  return n == null ? "-" : `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function scoreTone(score: number): string {
  if (score >= 70) return "bg-red-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-emerald-500";
}

function verdictBadge(v: SafetyCostCheck["verdict"]): { label: string; cls: string } {
  if (v === "과소계상_의심") return { label: "과소계상 의심", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" };
  if (v === "검토필요") return { label: "검토 필요", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" };
  return { label: "정상", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" };
}

const SEV_LABEL = ["", "낮음", "보통", "높음"];
const BREAKDOWN_LABEL: Record<string, string> = {
  위험작업: "위험작업",
  안전관리비의심: "안전관리비",
  낙찰공기: "낙찰/공기",
  공종재해통계: "공종 재해",
};
const BREAKDOWN_CAP: Record<string, number> = { 위험작업: 40, 안전관리비의심: 25, 낙찰공기: 15, 공종재해통계: 20 };

export default function ProcureRiskCard({ data }: { data: ProcureRiskDetail }) {
  const { notice, safetyCost, tags, risk } = data;
  const vb = verdictBadge(safetyCost.verdict);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">{notice.title}</h3>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {notice.agency}
            {notice.region ? ` · ${notice.region}` : ""} · 추정가격 {won(notice.estimatedPrice)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
            data.source === "live"
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
              : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          }`}
        >
          {data.source === "live" ? "G2B 실시간" : "샘플"}
        </span>
      </div>

      {/* 위험도 */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold">사전 위험도</span>
          <span className="text-2xl font-extrabold tabular-nums">{risk.score}<span className="text-sm font-normal text-slate-400">/100</span></span>
        </div>
        <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className={`h-full rounded-full ${scoreTone(risk.score)}`} style={{ width: `${risk.score}%` }} />
        </div>
        {risk.topFactors.length > 0 && (
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">주요 요인: {risk.topFactors.join(" · ")}</p>
        )}
        {/* 기여도 분해 */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(risk.breakdown) as (keyof typeof risk.breakdown)[]).map((k) => (
            <div key={k} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{BREAKDOWN_LABEL[k]}</div>
              <div className="text-sm font-semibold tabular-nums">
                {risk.breakdown[k]}<span className="text-[11px] font-normal text-slate-400">/{BREAKDOWN_CAP[k]}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 안전관리비 예비검증 */}
      <div className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">안전관리비 예비검증</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${vb.cls}`}>{vb.label}</span>
        </div>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">공사종류</dt><dd>{safetyCost.constructionType}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">기준 안전관리비</dt><dd className="font-semibold">{won(safetyCost.requiredCost)}</dd></div>
          {safetyCost.declaredCost != null && (
            <div className="flex justify-between"><dt className="text-slate-500 dark:text-slate-400">명시 안전관리비</dt><dd>{won(safetyCost.declaredCost)}</dd></div>
          )}
        </dl>
        <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">산정식: {safetyCost.formula}</p>
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{safetyCost.rateNote}</p>
      </div>

      {/* 위험작업 태그 */}
      <div className="mt-4">
        <span className="text-sm font-semibold">위험작업 태그 ({tags.length})</span>
        <ul className="mt-2 space-y-2">
          {tags.map((t, i) => (
            <li key={i} className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
              <div className="flex items-center gap-2">
                <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-semibold dark:bg-slate-700">{t.tag}</span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">위험도 {SEV_LABEL[t.severity]}</span>
                <span className="ml-auto text-[10px] uppercase text-slate-400">{t.source === "ai" ? "AI" : t.source === "rule" ? "규칙" : "샘플"}</span>
              </div>
              {t.evidence && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">“{t.evidence}”</p>}
            </li>
          ))}
          {tags.length === 0 && <li className="text-xs text-slate-400">식별된 위험작업 태그 없음</li>}
        </ul>
      </div>

      {/* 권고 */}
      <div className="mt-4">
        <span className="text-sm font-semibold">안전 권고</span>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
          {risk.recommendations.map((r, i) => <li key={i}>{r}</li>)}
        </ol>
      </div>

      <p className="mt-4 text-[11px] text-slate-400">
        ※ 본 결과는 공개 조달데이터 기반 <b>예비검증</b>으로, 법적 위반 확정 판정이 아닙니다. 상세 검토는 원가명세서·현장자료 확인이 필요합니다.
      </p>
    </div>
  );
}
