"use client";
// VitAlGuard 안전관리비 실집행 검증 — ①계상(조달)·②사용(국세청)·③실집행(워치 출역)을 한 현장에 묶는다.
// 핵심: 계상된 안전예산이 실제 작업자 출역(현장 도달)에 얼마나 대응됐는지 정량화.
import { useEffect, useState } from "react";

import BusinessVerifyCard from "./BusinessVerifyCard";
import SafetyIncreaseAuditCard from "./SafetyIncreaseAuditCard";

type Notice = { id: string; title: string; agency: string; region?: string; estimatedPrice: number | null };
type Audit = {
  requiredCost: number;
  estimatedPrice: number | null;
  constructionType: string;
  formula: string;
  totalWorkerDays: number;
  safetyWorkerDays: number;
  distinctWorkers: number;
  days: number;
  perWorkerDay: number | null;
  safetyRatio: number | null;
  byDay: { day: string; workers: number; safetyWorkers: number }[];
  note: string;
};
type AuditResp = { source: "live" | "mock"; notice: Notice; audit: Audit };

function won(n: number | null | undefined): string {
  return n == null ? "-" : `${Math.round(n).toLocaleString("ko-KR")}원`;
}

export default function SafetyCostAuditBoard() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [source, setSource] = useState<"live" | "mock">("mock");
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<AuditResp | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/g2b/contracts");
        if (!r.ok) throw new Error(`현장(계약) 목록 조회 실패 (${r.status})`);
        const j = (await r.json()) as { source: "live" | "mock"; items: Notice[] };
        if (!alive) return;
        setNotices(j.items);
        setSource(j.source);
        setSelected(j.items[0]?.id ?? null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "불러오기 실패");
      } finally {
        if (alive) setLoadingList(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setLoadingAudit(true);
    (async () => {
      try {
        const r = await fetch(`/api/safety-audit?id=${encodeURIComponent(selected)}`);
        if (!r.ok) throw new Error(`감사 실패 (${r.status})`);
        const j = (await r.json()) as AuditResp;
        if (alive) setData(j);
      } catch {
        if (alive) setData(null);
      } finally {
        if (alive) setLoadingAudit(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selected]);

  const a = data?.audit;

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink dark:text-on-dark">안전관리비 실집행 검증</h2>
          <p className="text-xs text-body dark:text-on-dark-soft">조달 계상액과 워치 출역(실집행)을 교차해 안전예산이 현장 작업자에게 실제 도달했는지 검증합니다.</p>
        </div>
        <span className={`shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-semibold ${source === "live" ? "bg-[#0052ff]/10 text-primary dark:bg-[#0052ff]/20" : "bg-surface-strong text-body dark:bg-white/10 dark:text-on-dark-soft"}`}>
          {source === "live" ? "G2B 실시간" : "샘플 데이터"}
        </span>
      </div>

      {loadingList && <p className="py-8 text-center text-xs text-muted">현장 불러오는 중…</p>}
      {error && <p className="py-8 text-center text-xs text-semantic-down">{error}</p>}

      {!loadingList && !error && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,300px)_1fr]">
          {/* 좌: 현장(공고) 목록 */}
          <ul className="space-y-2">
            {notices.map((n) => {
              const sel = n.id === selected;
              return (
                <li key={n.id}>
                  <button
                    onClick={() => setSelected(n.id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      sel
                        ? "border-primary bg-[#0052ff]/[0.08] ring-1 ring-primary dark:bg-[#0052ff]/20"
                        : "border-hairline bg-canvas hover:border-muted-soft dark:border-white/10 dark:bg-surface-dark dark:hover:border-white/20"
                    }`}
                  >
                    <div className="truncate text-sm font-semibold text-ink dark:text-on-dark">{n.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted dark:text-on-dark-soft">
                      <span className="truncate">{n.agency}</span>
                      <span>·</span>
                      <span>{won(n.estimatedPrice)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
            {notices.length === 0 && <li className="text-xs text-muted">표시할 현장이 없습니다.</li>}
          </ul>

          {/* 우: 3중 교차검증 카드 */}
          <div className="rounded-xl border border-hairline bg-surface-soft p-4 dark:border-white/10 dark:bg-surface-dark-elevated">
            {loadingAudit && <p className="py-8 text-center text-xs text-muted">감사 중…</p>}
            {!loadingAudit && a && data && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-ink dark:text-on-dark">{data.notice.title}</h3>
                  <p className="mt-0.5 text-[11px] text-body dark:text-on-dark-soft">
                    {data.notice.agency}
                    {data.notice.region ? ` · ${data.notice.region}` : ""}
                  </p>
                </div>

                {/* 3축 */}
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-hairline bg-canvas p-3 dark:border-white/10 dark:bg-surface-dark">
                    <div className="text-[10px] font-semibold text-primary">① 계상(예산)</div>
                    <div className="mt-1 text-base font-bold tabular-nums text-ink dark:text-on-dark">{won(a.requiredCost)}</div>
                    <div className="mt-0.5 text-[10px] text-muted dark:text-on-dark-soft">{a.constructionType}</div>
                  </div>
                  <BusinessVerifyCard />
                  <div className="rounded-lg border border-hairline bg-canvas p-3 dark:border-white/10 dark:bg-surface-dark">
                    <div className="text-[10px] font-semibold text-semantic-up">③ 실집행(물증)</div>
                    <div className="mt-1 text-base font-bold tabular-nums text-ink dark:text-on-dark">
                      {a.totalWorkerDays}
                      <span className="text-[10px] font-normal text-muted"> worker-day</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted dark:text-on-dark-soft">작업자 {a.distinctWorkers}명 · {a.days}일</div>
                  </div>
                </div>

                {/* 교차 결과 — 장부 대비 실제 도달 */}
                <div className="rounded-lg border border-hairline p-3 dark:border-white/10">
                  <div className="text-xs font-semibold text-ink dark:text-on-dark">장부 대비 실제 도달</div>
                  {a.totalWorkerDays > 0 ? (
                    <>
                      <div className="mt-1 text-2xl font-extrabold tabular-nums text-ink dark:text-on-dark">
                        {won(a.perWorkerDay)}
                        <span className="text-xs font-normal text-muted"> / 인·일</span>
                      </div>
                      <p className="mt-1 text-[11px] text-body dark:text-on-dark-soft">{a.formula} ÷ {a.totalWorkerDays} worker-day</p>
                      {a.safetyRatio != null && (
                        <p className="mt-1 text-[11px] text-muted dark:text-on-dark-soft">안전관리 인력 출역 비율 {(a.safetyRatio * 100).toFixed(0)}%</p>
                      )}
                    </>
                  ) : (
                    <p className="mt-1 text-[11px] text-muted dark:text-on-dark-soft">{a.note}</p>
                  )}
                </div>

                {/* ④ 증액 검증 — 실인원 대비 과다 산정 */}
                <SafetyIncreaseAuditCard distinctWorkers={a.distinctWorkers} />

                <p className="text-[10px] text-muted dark:text-on-dark-soft">
                  ※ 계상액은 추정가격×법정요율 근사이며, 실집행은 워치 출역 물증입니다. 적정성의 법적 판정은 발주처·감독기관의 권한입니다.
                </p>
              </div>
            )}
            {!loadingAudit && !a && <p className="py-8 text-center text-xs text-muted">현장을 선택하세요.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
