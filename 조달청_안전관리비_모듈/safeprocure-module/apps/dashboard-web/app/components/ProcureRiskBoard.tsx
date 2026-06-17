"use client";
// 안전조달 보드 — 조달 공사 공고를 사전 위험도 순으로 보여주고, 선택 시 상세 리스크 카드를 표시.
// 데이터: /api/g2b/notices (목록) → 각 공고 /api/g2b/notice/:id (안전관리비+태그+위험도).
import { useEffect, useState } from "react";
import ProcureRiskCard, { type ProcureRiskDetail } from "./ProcureRiskCard";

function won(n: number | null | undefined): string {
  return n == null ? "-" : `${Math.round(n).toLocaleString("ko-KR")}원`;
}
function tone(score: number): string {
  if (score >= 70) return "bg-red-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-emerald-500";
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
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">안전조달 · 발주 단계 안전 리스크</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">나라장터 조달 공고를 AI로 분석해 착공 전 위험을 선별합니다.</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${source === "live" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
          {source === "live" ? "G2B 실시간" : "샘플 데이터"}
        </span>
      </div>

      {loading && <p className="py-10 text-center text-sm text-slate-400">분석 중…</p>}
      {error && <p className="py-10 text-center text-sm text-red-500">{error}</p>}

      {!loading && !error && (
        <div className="grid gap-4 lg:grid-cols-2">
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
                        ? "border-blue-400 bg-blue-50/60 dark:border-blue-500 dark:bg-blue-900/20"
                        : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-slate-800 dark:text-slate-100">{d.notice.title}</span>
                      <span className="shrink-0 text-sm font-extrabold tabular-nums text-slate-700 dark:text-slate-200">{d.risk.score}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className={`h-full rounded-full ${tone(d.risk.score)}`} style={{ width: `${d.risk.score}%` }} />
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="truncate">{d.notice.agency}</span>
                      <span>·</span>
                      <span>{won(d.notice.estimatedPrice)}</span>
                      <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{VERDICT_SHORT[d.safetyCost.verdict]}</span>
                    </div>
                  </button>
                </li>
              );
            })}
            {items.length === 0 && <li className="text-sm text-slate-400">표시할 공고가 없습니다.</li>}
          </ul>

          {/* 선택 카드 */}
          <div>{current && <ProcureRiskCard data={current} />}</div>
        </div>
      )}
    </section>
  );
}
