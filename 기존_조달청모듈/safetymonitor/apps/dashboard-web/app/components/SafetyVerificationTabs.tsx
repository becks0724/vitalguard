"use client";
// 안전관리비 검증 카드 섹션 — 세 화면을 라우트 이동 없이 탭으로 전환.
// (각 화면 /weekly-report·/contractor·/safety-audit 라우트는 전체화면·공유용으로 유지)
import { useState, type FormEvent } from "react";

import ContractorSubmitForm from "./ContractorSubmitForm";
import SafetyCostAuditBoard from "./SafetyCostAuditBoard";
import WeeklyReportBoard from "./WeeklyReportBoard";

import { SlidingSegmented } from "./ui/SlidingSegmented";
type Tab = "audit" | "contractor" | "weekly";

const TABS: { id: Tab; label: string }[] = [
  { id: "weekly", label: "주간 검증 보고서" },
  { id: "contractor", label: "시공사 청구 제출" },
  { id: "audit", label: "실집행 검증" },
];

// 시공사 청구 제출 탭 진입 전 본인 재확인 — 로그인한 관리자 id/pw 를 /api/admin/login 으로 재검증.
function ContractorAuthGate({ onPass }: { onPass: () => void }) {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, password: pw }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (j.ok) onPass();
      else setError(j.error ?? "인증에 실패했습니다.");
    } catch {
      setError("인증 요청에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink dark:border-white/10 dark:bg-surface-dark dark:text-on-dark";
  return (
    <form onSubmit={submit} className="mx-auto flex max-w-xs flex-col gap-3 py-6">
      <p className="text-sm font-semibold text-ink dark:text-on-dark">시공사 청구 제출 — 본인 확인</p>
      <p className="text-xs text-muted dark:text-on-dark-soft">
        현재 로그인한 관리자 아이디·비밀번호를 다시 입력하세요.
      </p>
      <input value={id} onChange={(e) => setId(e.target.value)} placeholder="아이디" autoComplete="username" className={inputCls} />
      <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" placeholder="비밀번호" autoComplete="current-password" className={inputCls} />
      {error && <p className="text-xs text-[#cf202f]">{error}</p>}
      <button
        type="submit"
        disabled={loading || !id || !pw}
        className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition hover:bg-primary-active disabled:opacity-50"
      >
        {loading ? "확인 중…" : "확인"}
      </button>
    </form>
  );
}

export default function SafetyVerificationTabs() {
  const [tab, setTab] = useState<Tab>("audit");
  const [contractorAuthed, setContractorAuthed] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-canvas px-4 py-3 dark:border-white/10 dark:bg-surface-dark">
        <span className="mr-1 text-xs font-bold text-ink dark:text-on-dark">VitAlGuard 안전관리비 검증</span>
        {/* 감싸는 필 트랙 안에서 파란 필 하나가 옮겨 다닌다(GlassTabBar 와 같은 결의 트랙).
            ⚠ 글자색은 active 가 아니라 targeted(표시자가 지금 그 칸 위에 있는가)를 따른다 —
              followHover 로 표시자가 호버 칸에 미리 가는데 활성 칸 글자를 흰색으로 두면
              흰 바탕에 흰 글자만 남는다(2026-08-26 실집행 검증 탭에서 실측).
            ⚠ 이 줄은 flex-wrap 이라 좁은 폭에서 2행이 된다. SlidingSegmented 는 top/height 도
              함께 옮기므로 줄이 바뀌어도 표시자가 따라간다(가로만 옮기면 엉뚱한 줄에 남는다). */}
        <SlidingSegmented
          className="flex flex-wrap items-center gap-0.5 rounded-pill border border-black/5 bg-white/50 px-1 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md dark:border-white/10 dark:bg-white/[0.06] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          indicatorClassName="rounded-pill bg-primary"
          items={TABS.map((t) => ({ value: t.id, label: t.label }))}
          value={tab}
          onChange={setTab}
          followHover
          itemClassName={(_active, targeted) =>
            `rounded-pill px-3 py-1.5 text-xs font-semibold transition-colors ${
              targeted
                ? "text-on-primary"
                : "text-body hover:text-ink dark:text-on-dark-soft dark:hover:text-on-dark"
            }`
          }
        />
      </nav>

      <section className="overflow-hidden rounded-xl border border-hairline bg-canvas px-6 py-4 text-ink dark:border-white/10 dark:bg-surface-dark dark:text-on-dark max-[640px]:px-5">
        {tab === "audit" && <SafetyCostAuditBoard />}
        {tab === "contractor" &&
          (contractorAuthed ? (
            <ContractorSubmitForm />
          ) : (
            <ContractorAuthGate onPass={() => setContractorAuthed(true)} />
          ))}
        {tab === "weekly" && <WeeklyReportBoard />}
      </section>
    </div>
  );
}
