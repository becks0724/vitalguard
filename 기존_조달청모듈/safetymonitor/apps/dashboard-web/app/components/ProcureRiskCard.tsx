// 사전 안전 리스크 카드 — 한 공고의 안전관리비 예비검증 + 위험작업 태그 + 위험도 분해를 표시.
// 표현용(presentational): 데이터는 prop 으로 받는다. 색은 기존 대시보드 토큰 + 위험도/판정은 의미색(가시성).
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
    /** 공고 첨부 — 담당관 확정 화면이 "근거 문서"로 지정하는 대상. */
    specDocs?: { name: string; url: string }[];
  };
  safetyCost: SafetyCostCheck;
  tags: RiskTag[];
  risk: Pick<RiskProfile, "score" | "breakdown" | "topFactors" | "recommendations">;
  note?: string;
};

function won(n: number | null | undefined): string {
  return n == null ? "-" : `${Math.round(n).toLocaleString("ko-KR")}원`;
}
// 위험도 막대 배경
function scoreBar(score: number): string {
  if (score >= 70) return "bg-semantic-down";
  if (score >= 40) return "bg-amber-500";
  return "bg-semantic-up";
}
// 위험도 점수 텍스트색(가시성)
function scoreText(score: number): string {
  if (score >= 70) return "text-semantic-down";
  if (score >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-semantic-up";
}
// 위험 등급 칩(점수 옆) — 위험/주의/양호
function scoreChip(score: number): { label: string; cls: string } {
  if (score >= 70) return { label: "위험", cls: "bg-[#cf202f]/12 text-semantic-down dark:bg-[#cf202f]/25" };
  if (score >= 40) return { label: "주의", cls: "bg-amber-400/20 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300" };
  return { label: "양호", cls: "bg-[#05b169]/12 text-semantic-up dark:bg-[#05b169]/25" };
}

function verdictBadge(v: SafetyCostCheck["verdict"]): { label: string; cls: string } {
  if (v === "과소계상_의심") return { label: "과소계상 의심", cls: "bg-[#cf202f]/12 text-semantic-down dark:bg-[#cf202f]/25" };
  if (v === "과다계상_의심") return { label: "과다계상 의심", cls: "bg-[#cf202f]/12 text-semantic-down dark:bg-[#cf202f]/25" };
  if (v === "검토필요") return { label: "검토 필요", cls: "bg-amber-400/20 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300" };
  return { label: "정상", cls: "bg-[#05b169]/12 text-semantic-up dark:bg-[#05b169]/25" };
}

const SEV_LABEL = ["", "낮음", "보통", "높음"];
// 위험도 1/2/3 신호 dot — 기존 신호등 패턴과 동일하게 의미색으로 즉시성 부여.
const SEV_DOT = ["bg-muted", "bg-semantic-up", "bg-amber-500", "bg-semantic-down"];
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
  const sc = scoreChip(risk.score);

  return (
    <div className="rounded-xl border border-hairline bg-surface-soft p-4 text-ink dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink dark:text-on-dark">{notice.title}</h3>
          <p className="mt-0.5 text-[11px] text-body dark:text-on-dark-soft">
            {notice.agency}
            {notice.region ? ` · ${notice.region}` : ""} · 추정가격 {won(notice.estimatedPrice)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-semibold ${
            data.source === "live"
              ? "bg-surface-card text-ink dark:bg-white/10 dark:text-on-dark"
              : "bg-surface-strong text-body dark:bg-white/10 dark:text-on-dark-soft"
          }`}
        >
          {data.source === "live" ? "G2B 실시간" : "샘플"}
        </span>
      </div>

      {/* 위험도 */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold text-body dark:text-on-dark-soft">사전 위험도</span>
          <span className="flex items-baseline gap-2">
            <span className={`self-center rounded-pill px-2 py-0.5 text-[11px] font-bold ${sc.cls}`}>{sc.label}</span>
            <span className={`text-2xl font-extrabold tabular-nums ${scoreText(risk.score)}`}>{risk.score}<span className="text-xs font-normal text-muted">/100</span></span>
          </span>
        </div>
        <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-surface-strong dark:bg-white/10">
          <div className={`h-full rounded-full ${scoreBar(risk.score)}`} style={{ width: `${risk.score}%` }} />
        </div>
        {risk.topFactors.length > 0 && (
          <p className="mt-1.5 text-[11px] text-body dark:text-on-dark-soft">주요 요인: {risk.topFactors.join(" · ")}</p>
        )}
        {/* 기여도 분해 */}
        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(risk.breakdown) as (keyof typeof risk.breakdown)[]).map((k) => (
            <div key={k} className="rounded-lg bg-canvas p-2 dark:bg-surface-dark">
              <div className="text-[10px] text-muted dark:text-on-dark-soft">{BREAKDOWN_LABEL[k]}</div>
              <div className="text-sm font-semibold tabular-nums text-ink dark:text-on-dark">
                {risk.breakdown[k]}<span className="text-[10px] font-normal text-muted">/{BREAKDOWN_CAP[k]}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 안전관리비 예비검증 */}
      <div className="mt-3 rounded-xl border border-hairline p-3 dark:border-white/10">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-ink dark:text-on-dark">안전관리비 예비검증</span>
          <span className={`rounded-pill px-2 py-0.5 text-[11px] font-bold ${vb.cls}`}>{vb.label}</span>
        </div>
        <dl className="mt-2 space-y-1 text-xs">
          <div className="flex justify-between"><dt className="text-body dark:text-on-dark-soft">공사종류</dt><dd className="text-ink dark:text-on-dark">{safetyCost.constructionType}</dd></div>
          <div className="flex justify-between"><dt className="text-body dark:text-on-dark-soft">기준 안전관리비</dt><dd className="font-semibold text-ink dark:text-on-dark">{won(safetyCost.requiredCost)}</dd></div>
          {safetyCost.declaredCost != null && (
            <div className="flex justify-between"><dt className="text-body dark:text-on-dark-soft">명시 안전관리비</dt><dd className="text-ink dark:text-on-dark">{won(safetyCost.declaredCost)}</dd></div>
          )}
        </dl>
        <p className="mt-2 rounded bg-canvas p-2 text-[11px] text-body dark:bg-surface-dark dark:text-on-dark-soft">산정식: {safetyCost.formula}</p>
        {/* 끝수 폭 안내 — 기준액보다 몇 원 적은데 '정상'인 이유(제47조). 없으면 렌더 안 함. */}
        {safetyCost.verdictNote && (
          <p className="mt-1 rounded bg-[#05b169]/10 p-2 text-[11px] text-semantic-up dark:bg-[#05b169]/20">{safetyCost.verdictNote}</p>
        )}
        <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-300">{safetyCost.rateNote}</p>
      </div>

      {/* 위험작업 태그 */}
      <div className="mt-3">
        <span className="text-xs font-semibold text-ink dark:text-on-dark">위험작업 태그 ({tags.length})</span>
        <ul className="mt-2 space-y-1.5">
          {tags.map((t, i) => (
            <li key={i} className="rounded-lg bg-canvas p-2 dark:bg-surface-dark">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${SEV_DOT[t.severity] ?? "bg-muted"}`} />
                <span className="rounded bg-surface-strong px-1.5 py-0.5 text-[11px] font-semibold text-ink dark:bg-white/10 dark:text-on-dark">{t.tag}</span>
                <span className="text-[10px] text-muted dark:text-on-dark-soft">위험도 {SEV_LABEL[t.severity]}</span>
                <span className="ml-auto text-[10px] uppercase text-muted-soft">{t.source === "ai" ? "AI" : t.source === "rule" ? "규칙" : "샘플"}</span>
              </div>
              {t.evidence && <p className="mt-1 text-[11px] text-body dark:text-on-dark-soft">“{t.evidence}”</p>}
            </li>
          ))}
          {tags.length === 0 && <li className="text-[11px] text-muted">식별된 위험작업 태그 없음</li>}
        </ul>
      </div>

      {/* 권고 */}
      <div className="mt-3">
        <span className="text-xs font-semibold text-ink dark:text-on-dark">안전 권고</span>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-body dark:text-on-dark-soft">
          {risk.recommendations.map((r, i) => <li key={i}>{r}</li>)}
        </ol>
      </div>

      <p className="mt-3 text-[10px] text-muted dark:text-on-dark-soft">
        ※ 본 결과는 공개 조달데이터 기반 <b className="font-semibold text-body dark:text-on-dark-soft">예비검증</b>으로, 법적 위반 확정 판정이 아닙니다. 상세 검토는 원가명세서·현장자료 확인이 필요합니다.
      </p>
    </div>
  );
}
