"use client";
// 안전관리비 **담당관 확정** 화면.
//
// ★ 이 화면의 규칙(2026-08-27 사용자 설계 결정) — 시공사는 근거 문서만 제출하고,
//   그 문서를 확인한 담당관이 값을 입력한다. 그래서 여기엔 세 층이 분리돼 있다.
//     ① 근거 문서   — 담당관이 열어 보는 원본(나라장터 첨부 링크)
//     ② 파싱 초안   — 기계가 제안한 값. **회색**으로 두고 "초안" 이라고 적는다
//     ③ 확정 입력   — 담당관이 직접 적는 칸. 이 값만 판정에 쓰인다
//   ②를 ③에 자동으로 밀어 넣지 않는다. [초안 채우기] 를 누르는 것도 사람의 행위다.
import { useCallback, useEffect, useState } from "react";

import { BRACKET_LABEL, typesMatchingRate } from "../lib/safety-cost";
import { getSessionToken } from "./session-token";
import { QuantumPulseLoader } from "./ui/quantum-pulse-loader";

type CostHit = {
  amount: number | null;
  ratePercent?: number | null;
  sheet: string;
  row: number;
  label: string;
};
type SpecCostDraft = {
  safetyCost: CostHit | null;
  material: CostHit | null;
  labor: CostHit | null;
  govSupply: CostHit | null;
  targetAmount: number | null;
  notes: string[];
};
type DraftRes = {
  source: { file: string } | null;
  draft: SpecCostDraft | null;
  note?: string;
  skipped?: string[];
};
export type CostConfirmRow = {
  id: number;
  notice_id: string;
  target_amount: number | null;
  declared_cost: number | null;
  construction_type: string | null;
  evidence_file: string | null;
  evidence_locus: string | null;
  note: string | null;
  confirmed_by: string;
  confirmed_at: string;
};

const TYPES = ["건축공사", "토목공사", "중건설공사", "특수건설공사"] as const;

function won(n: number | null | undefined): string {
  return n == null ? "-" : `${Math.round(n).toLocaleString("ko-KR")}원`;
}
function stamp(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}
/** 문서 안 위치 — 담당관이 원본에서 같은 자리를 찾을 수 있어야 한다. */
function locus(h: CostHit | null): string {
  return h ? `${h.sheet} ${h.row}행 「${h.label}」` : "";
}

export default function ProcureCostConfirm({
  noticeId,
  specDocs,
  onConfirmed,
}: {
  noticeId: string;
  specDocs?: { name: string; url: string }[];
  onConfirmed?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [draftRes, setDraftRes] = useState<DraftRes | null>(null);
  const [confirmed, setConfirmed] = useState<CostConfirmRow | null>(null);
  const [history, setHistory] = useState<CostConfirmRow[]>([]);

  const [target, setTarget] = useState("");
  const [declared, setDeclared] = useState("");
  const [ctype, setCtype] = useState("");
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [d, c] = await Promise.all([
      fetch(`/api/g2b/spec-cost?id=${encodeURIComponent(noticeId)}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/g2b/cost-confirm?id=${encodeURIComponent(noticeId)}`).then((r) => (r.ok ? r.json() : null)),
    ]);
    setDraftRes(d as DraftRes | null);
    setConfirmed((c?.confirmed as CostConfirmRow | null) ?? null);
    setHistory((c?.history as CostConfirmRow[]) ?? []);
    return c?.confirmed as CostConfirmRow | null;
  }, [noticeId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setSaved(false);
    // 공고가 바뀌면 폼도 함께 비운다 — 안 그러면 앞 공고의 입력이 다음 공고에 확정된다.
    setTarget("");
    setDeclared("");
    setCtype("");
    setEvidence("");
    setNote("");
    load()
      .catch(() => {
        if (alive) setError("확정 정보를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [load]);

  const draft = draftRes?.draft ?? null;
  const draftFile = draftRes?.source?.file ?? null;

  // 초안을 폼으로 옮기는 것은 **사람이 누르는** 행위다(자동 주입 금지).
  function fillFromDraft() {
    if (!draft) return;
    if (draft.targetAmount != null) setTarget(String(draft.targetAmount));
    if (draft.safetyCost?.amount != null) setDeclared(String(draft.safetyCost.amount));
    if (draftFile) setEvidence(draftFile);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/g2b/cost-confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(getSessionToken() ? { Authorization: `Bearer ${getSessionToken()}` } : {}),
        },
        body: JSON.stringify({
          noticeId,
          targetAmount: target,
          declaredCost: declared,
          constructionType: ctype || null,
          evidenceFile: evidence,
          evidenceUrl: specDocs?.find((d) => d.name === evidence)?.url ?? null,
          evidenceLocus: locus(draft?.safetyCost ?? null) || null,
          draft,
          note: note || null,
        }),
      });
      const j = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error(j.error?.message ?? `확정 실패 (${res.status})`);
      await load();
      setSaved(true);
      onConfirmed?.();
      window.setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "확정 실패");
    } finally {
      setSaving(false);
    }
  }

  // ★ 공사종류는 담당관이 **직접 골라야** 한다(2026-08-27 사용자 결정) — 요율을 가르는 축이라
  //   자동 추정에 맡기면 틀린 요율로 판정된다(실측: 공원 리모델링을 건축 3.11% 로 추정, 문서는 2.07%).
  //   문서 요율이 있으면 어느 공종의 요율인지 역추론해 힌트로 띄운다 — 고르는 건 여전히 사람이다.
  const rateHint = (() => {
    const r = draft?.safetyCost?.ratePercent;
    if (r == null) return null;
    const base = target.trim() !== "" ? Number(target.replace(/[,\s원]/g, "")) : null;
    const cands = typesMatchingRate(r, Number.isFinite(base as number) ? (base as number) : null);
    if (cands.length === 0) return `문서 요율 ${r}% 는 별표1 어느 공종과도 일치하지 않습니다 — 원본 확인이 필요합니다.`;
    return `문서 요율 ${r}% = ${cands.map((c) => `${c.type}(${BRACKET_LABEL[c.bracket]})`).join(" 또는 ")}`;
  })();

  // 확정 버튼은 근거 문서 + 금액 하나 + **공사종류 선택**이 갖춰져야 열린다(서버도 같은 규칙으로 막는다).
  const ready = evidence.trim() !== "" && (target.trim() !== "" || declared.trim() !== "") && ctype !== "";

  if (loading) return <QuantumPulseLoader text="확정 정보 확인 중" />;

  return (
    <section className="mt-3 rounded-xl border border-hairline bg-canvas p-3 dark:border-white/10 dark:bg-surface-dark">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink dark:text-on-dark">안전관리비 담당관 확정</h3>
        {confirmed ? (
          <span className="rounded-pill bg-[#05b169]/12 px-2 py-0.5 text-[11px] font-semibold text-semantic-up dark:bg-[#05b169]/25">
            확정됨
          </span>
        ) : (
          <span className="rounded-pill bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
            미확정
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted dark:text-on-dark-soft">
        시공사는 근거 문서만 제출합니다. 아래 값은 근거 문서를 확인한 담당관이 직접 입력해야 판정에 쓰입니다.
      </p>

      {/* ① 근거 문서 */}
      <div className="mt-3">
        <p className="text-[11px] font-semibold text-body dark:text-on-dark-soft">① 근거 문서</p>
        {specDocs && specDocs.length > 0 ? (
          <ul className="mt-1 space-y-1">
            {specDocs.map((d) => (
              <li key={d.url} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEvidence(d.name)}
                  className={`shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-semibold transition ${
                    evidence === d.name
                      ? "bg-primary text-on-primary"
                      : "bg-surface-strong text-body hover:bg-muted-soft/30 dark:bg-white/10 dark:text-on-dark-soft"
                  }`}
                >
                  {evidence === d.name ? "근거로 지정됨" : "근거로 지정"}
                </button>
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-[11px] text-primary underline-offset-2 hover:underline"
                >
                  {d.name}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] text-muted dark:text-on-dark-soft">공고에 첨부된 문서가 없습니다.</p>
        )}
      </div>

      {/* ② 파싱 초안 — 회색. 판정에 안 쓰인다. */}
      <div className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-body dark:text-on-dark-soft">② 내역서 파싱 초안 (참고)</p>
          {draft && (
            <button
              type="button"
              onClick={fillFromDraft}
              className="rounded-pill bg-surface-strong px-2 py-0.5 text-[11px] font-semibold text-body transition hover:bg-muted-soft/30 dark:bg-white/10 dark:text-on-dark-soft"
            >
              초안 채우기
            </button>
          )}
        </div>
        <div className="mt-1 rounded-lg bg-surface-strong/60 p-2 text-[11px] text-muted dark:bg-white/5 dark:text-on-dark-soft">
          {draftFile && <p className="truncate">출처 · {draftFile}</p>}
          {draft ? (
            <>
              <p>
                대상액 {won(draft.targetAmount)} · 계상액 {won(draft.safetyCost?.amount)}
                {draft.safetyCost?.ratePercent != null && ` · 문서 요율 ${draft.safetyCost.ratePercent}%`}
              </p>
              {draft.safetyCost && <p>위치 · {locus(draft.safetyCost)}</p>}
              {draft.notes.map((n) => (
                <p key={n} className="mt-0.5">
                  · {n}
                </p>
              ))}
            </>
          ) : (
            <p>{draftRes?.note ?? "초안을 만들지 못했습니다."}</p>
          )}
        </div>
      </div>

      {/* ③ 확정 입력 */}
      <div className="mt-3">
        <p className="text-[11px] font-semibold text-body dark:text-on-dark-soft">③ 담당관 확정 입력</p>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          <label className="text-[11px] text-muted dark:text-on-dark-soft">
            대상액(원)
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode="numeric"
              placeholder="재료비+직접노무비+관급"
              className="mt-0.5 w-full rounded-lg border border-hairline bg-canvas px-2 py-1 text-xs text-ink dark:border-white/10 dark:bg-surface-dark dark:text-on-dark"
            />
          </label>
          <label className="text-[11px] text-muted dark:text-on-dark-soft">
            계상액(원)
            <input
              value={declared}
              onChange={(e) => setDeclared(e.target.value)}
              inputMode="numeric"
              placeholder="산업안전보건관리비"
              className="mt-0.5 w-full rounded-lg border border-hairline bg-canvas px-2 py-1 text-xs text-ink dark:border-white/10 dark:bg-surface-dark dark:text-on-dark"
            />
          </label>
          <label className="text-[11px] text-muted dark:text-on-dark-soft">
            공사종류 (필수)
            <select
              value={ctype}
              onChange={(e) => setCtype(e.target.value)}
              className="mt-0.5 w-full rounded-lg border border-hairline bg-canvas px-2 py-1 text-xs text-ink dark:border-white/10 dark:bg-surface-dark dark:text-on-dark"
            >
              <option value="" disabled>
                선택하세요
              </option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {rateHint && <span className="mt-0.5 block text-[11px] text-body dark:text-on-dark-soft">{rateHint}</span>}
          </label>
          <label className="text-[11px] text-muted dark:text-on-dark-soft">
            메모
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="확정 사유·특이사항"
              className="mt-0.5 w-full rounded-lg border border-hairline bg-canvas px-2 py-1 text-xs text-ink dark:border-white/10 dark:bg-surface-dark dark:text-on-dark"
            />
          </label>
        </div>

        {error && <p className="mt-2 text-[11px] text-semantic-down">{error}</p>}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={!ready || saving}
            className={`rounded-pill px-3 py-1 text-xs font-semibold transition ${
              saved
                ? "bg-semantic-up text-white"
                : "bg-primary text-on-primary disabled:opacity-40"
            }`}
          >
            {saved ? "✓ 확정됨" : saving ? "확정 중…" : "확정"}
          </button>
          {!ready && (
            <span className="text-[11px] text-muted dark:text-on-dark-soft">
              근거 문서 지정 · 금액 하나 이상 · 공사종류 선택이 필요합니다.
            </span>
          )}
        </div>
      </div>

      {/* 이력 — append-only 라 정정도 여기에 남는다. */}
      {history.length > 0 && (
        <div className="mt-3 border-t border-hairline pt-2 dark:border-white/10">
          <p className="text-[11px] font-semibold text-body dark:text-on-dark-soft">확정 이력</p>
          <ul className="mt-1 space-y-1">
            {history.map((h) => (
              <li key={h.id} className="text-[11px] text-muted dark:text-on-dark-soft">
                <span className="tabular-nums">{stamp(h.confirmed_at)}</span> · {h.confirmed_by} · 대상액{" "}
                {won(h.target_amount)} · 계상액 {won(h.declared_cost)}
                {h.construction_type && ` · ${h.construction_type}`}
                {h.evidence_file && <span className="block truncate">근거 · {h.evidence_file}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
