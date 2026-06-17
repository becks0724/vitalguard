"use client";
// AED NFC 점검 기록 페이지 — 장비별 NFC 태그(URL)의 도착지. 점검자 이름·교체 항목 입력 후 관제 웹으로 전송.
import { useEffect, useState } from "react";

import { findAedDevice } from "../../../lib/aed-devices";

type Phase = "loading" | "form" | "sending" | "done" | "error";

export default function AedInspectPage() {
  const [aedId, setAedId] = useState("");
  const [sig, setSig] = useState("");
  const [loc, setLoc] = useState<string | null>(null);
  const [known, setKnown] = useState(false);
  const [inspector, setInspector] = useState("");
  const [battery, setBattery] = useState(false);
  const [pad, setPad] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("id")?.trim() ?? "";
    setAedId(id);
    setSig(q.get("sig")?.trim() ?? "");
    const d = findAedDevice(id);
    setLoc(d?.loc ?? null);
    setKnown(Boolean(d));
    setPhase("form");
  }, []);

  const submit = async () => {
    if (!inspector.trim()) {
      setMsg("점검자 이름을 입력하세요.");
      return;
    }
    setPhase("sending");
    setMsg("");
    const items = [...(battery ? ["battery"] : []), ...(pad ? ["pad"] : [])];
    try {
      const res = await fetch("/api/aed/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aedId, sig, inspector: inspector.trim(), items, ts: new Date().toISOString() }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && j.ok) {
        setPhase("done");
      } else {
        setPhase("error");
        setMsg(j.error ?? "전송에 실패했습니다.");
      }
    } catch {
      setPhase("error");
      setMsg("네트워크 오류 — 다시 시도하세요.");
    }
  };

  const itemsLabel = [...(battery ? ["배터리"] : []), ...(pad ? ["전극패드"] : [])].join(" · ") || "점검만(교체 없음)";

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-8 dark:bg-surface-dark">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-hairline bg-surface-soft shadow-xl dark:border-white/10 dark:bg-surface-dark-elevated">
        <div className="bg-primary px-5 py-4 text-white">
          <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">VitAlGuard · AED 점검</div>
          <div className="mt-0.5 text-lg font-bold">제세동기 점검 기록</div>
        </div>

        {phase === "loading" ? (
          <div className="px-5 py-8 text-center text-sm text-muted dark:text-on-dark-soft">불러오는 중…</div>
        ) : !known ? (
          <div className="px-5 py-8 text-center text-sm text-semantic-down">
            알 수 없는 장비입니다{aedId ? ` (${aedId})` : ""}.
            <br />
            NFC 태그를 다시 확인하세요.
          </div>
        ) : phase === "done" ? (
          <div className="px-5 py-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#05b169]/15 text-semantic-up">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 13 4 4L19 7" />
              </svg>
            </div>
            <div className="text-sm font-bold text-ink dark:text-on-dark">점검 기록 완료</div>
            <div className="mt-1 text-xs text-body dark:text-on-dark-soft">
              {loc} · {itemsLabel}
              <br />
              점검자 {inspector} · 관제 웹에 반영되었습니다.
            </div>
          </div>
        ) : (
          <div className="px-5 py-5">
            <div className="mb-4 rounded-lg bg-canvas px-3 py-2 text-xs dark:bg-surface-dark">
              <div className="text-muted dark:text-on-dark-soft">제세동기 위치</div>
              <div className="text-sm font-semibold text-ink dark:text-on-dark">{loc}</div>
              <div className="mt-0.5 font-mono text-[10px] text-muted dark:text-on-dark-soft">{aedId}</div>
            </div>

            <label className="mb-1 block text-xs font-semibold text-body dark:text-on-dark-soft">점검자 이름</label>
            <input
              value={inspector}
              onChange={(e) => setInspector(e.target.value)}
              placeholder="예) 홍길동"
              maxLength={40}
              className="mb-4 w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-primary dark:border-white/10 dark:bg-surface-dark dark:text-on-dark"
            />

            <div className="mb-1 block text-xs font-semibold text-body dark:text-on-dark-soft">교체 항목 (해당 시 선택)</div>
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setBattery((v) => !v)}
                aria-pressed={battery}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${battery ? "border-primary bg-[#0052ff]/10 text-primary" : "border-hairline text-body dark:border-white/10 dark:text-on-dark-soft"}`}
              >
                배터리 교체
              </button>
              <button
                type="button"
                onClick={() => setPad((v) => !v)}
                aria-pressed={pad}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${pad ? "border-primary bg-[#0052ff]/10 text-primary" : "border-hairline text-body dark:border-white/10 dark:text-on-dark-soft"}`}
              >
                전극패드 교체
              </button>
            </div>
            <p className="mb-4 text-[11px] text-muted dark:text-on-dark-soft">
              교체 항목을 선택하면 해당 교환 주기가 갱신됩니다. 선택 없이 제출하면 점검(교체 없음)으로 기록됩니다.
            </p>

            {msg && <p className="mb-3 text-xs text-semantic-down">{msg}</p>}

            <button
              type="button"
              onClick={submit}
              disabled={phase === "sending"}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {phase === "sending" ? "전송 중…" : "점검 기록 전송"}
            </button>
            <p className="mt-3 text-center text-[10px] text-muted dark:text-on-dark-soft">
              점검 시각은 전송 시점으로 자동 기록됩니다.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
