"use client";
// 안전조달 보드 — 조달 공사 공고를 사전 위험도 순으로 보여주고, 선택 시 상세 리스크 카드를 표시.
// 데이터: /api/g2b/notices (목록) → 각 공고 /api/g2b/notice/:id (안전관리비+태그+위험도).
// 색은 기존 대시보드 디자인 토큰을 따르되, 위험도/판정은 의미색(semantic-up/down·amber)으로 가시성을 준다.
import { useEffect, useState } from "react";
import ProcureRiskCard, { type ProcureRiskDetail } from "./ProcureRiskCard";

function won(n: number | null | undefined): string {
  return n == null ? "-" : `${Math.round(n).toLocaleString("ko-KR")}원`;
}
// 위험도 막대 배경색
function barTone(score: number): string {
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
// 판정 칩 톤(가시성)
function verdictChip(v: string): string {
  if (v === "과소계상_의심") return "bg-[#cf202f]/12 text-semantic-down dark:bg-[#cf202f]/25";
  if (v === "검토필요") return "bg-amber-400/20 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300";
  return "bg-[#05b169]/12 text-semantic-up dark:bg-[#05b169]/25";
}
const VERDICT_SHORT: Record<string, string> = { "과소계상_의심": "과소계상 의심", "검토필요": "검토 필요", "정상": "정상" };

export default function ProcureRiskBoard() {
  const [items, setItems] = useState<ProcureRiskDetail[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"live" | "mock">("mock");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const listRes = await fetch("/api/g2b/notices?kind=공사");
        if (!listRes.ok) throw new Error(`목록 조회 실패 (${listRes.status})`);
        const list = (await listRes.json()) as { source: "live" | "mock"; items: { id: string }[] };
        const details = await Promise.all(
          list.items.map(async (n) => {
            const r = await fetch(`/api/g2b/notice/${encodeURIComponent(n.id)}`);
            if (!r.ok) return null;
            return (await r.json()) as ProcureRiskDetail;
          }),
        );
        if (!alive) return;
        const valid = details.filter((d): d is ProcureRiskDetail => !!d && !!d.risk);
        valid.sort((a, b) => b.risk.score - a.risk.score);
        setItems(valid);
        setSource(list.source);
        setSelected(valid[0]?.notice.id ?? null);
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

  const current = items.find((d) => d.notice.id === selected) ?? null;

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink dark:text-on-dark">안전조달 · 발주 단계 안전 리스크</h2>
          <p className="text-xs text-body dark:text-on-dark-soft">나라장터 조달 공고를 AI로 분석해 착공 전 위험을 선별합니다.</p>
        </div>
        <span className={`shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-semibold ${source === "live" ? "bg-[#0052ff]/10 text-primary dark:bg-[#0052ff]/20" : "bg-surface-strong text-body dark:bg-white/10 dark:text-on-dark-soft"}`}>
          {source === "live" ? "G2B 실시간" : "샘플 데이터"}
        </span>
      </div>

      {loading && <p className="py-10 text-center text-xs text-muted">분석 중…</p>}
      {error && <p className="py-10 text-center text-xs text-semantic-down">{error}</p>}

      {!loading && !error && (
        <div className="grid gap-3 lg:grid-cols-2">
          {/* 목록(위험도 순) */}
          <ul className="space-y-2">
            {items.map((d) => {
              const isSel = d.notice.id === selected;
              return (
                <li key={d.notice.id}>
                  <button
                    onClick={() => setSelected(d.notice.id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      isSel
                        ? "border-primary bg-[#0052ff]/[0.08] ring-1 ring-primary dark:bg-[#0052ff]/20"
                        : "border-hairline bg-canvas hover:border-muted-soft dark:border-white/10 dark:bg-surface-dark dark:hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-ink dark:text-on-dark">{d.notice.title}</span>
                      <span className={`shrink-0 text-base font-extrabold tabular-nums ${scoreText(d.risk.score)}`}>{d.risk.score}</span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-strong dark:bg-white/10">
                      <div className={`h-full rounded-full ${barTone(d.risk.score)}`} style={{ width: `${d.risk.score}%` }} />
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted dark:text-on-dark-soft">
                      <span className="truncate">{d.notice.agency}</span>
                      <span>·</span>
                      <span>{won(d.notice.estimatedPrice)}</span>
                      <span className={`ml-auto rounded-pill px-1.5 py-0.5 font-semibold ${verdictChip(d.safetyCost.verdict)}`}>{VERDICT_SHORT[d.safetyCost.verdict]}</span>
                    </div>
                  </button>
                </li>
              );
            })}
            {items.length === 0 && <li className="text-xs text-muted">표시할 공고가 없습니다.</li>}
          </ul>

          {/* 선택 카드 */}
          <div>{current && <ProcureRiskCard data={current} />}</div>
        </div>
      )}
    </section>
  );
}
