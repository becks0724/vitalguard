// 내 정보 수정 진입 전 비밀번호 재확인(step-up 인증) 모달 — 공용 관제 화면 무단 접근 방지.
"use client";

import { useEffect, useState } from "react";

import { getSessionToken } from "./session-token";

export function ProfileGateModal({
  onClose,
  onVerified,
}: {
  onClose: () => void;
  onVerified: () => void;
}) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 배경(관제웹) 스크롤 잠금.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const submit = async () => {
    if (!pw) {
      setErr("비밀번호를 입력해주세요.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/verify-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${getSessionToken() ?? ""}`,
        },
        body: JSON.stringify({ password: pw }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setErr(j.error || "비밀번호가 일치하지 않습니다.");
        return;
      }
      onVerified();
    } catch {
      setErr("네트워크 오류로 확인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      {/* 낮은 화면에서 확인 버튼이 잘려 도달 불가였다 — 바깥 p-4(상하 2rem)를 뺀 높이로 상한 + 스크롤. */}
      <div
        className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-hairline-strong bg-canvas p-5 dark:border-white/10 dark:bg-surface-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-bold text-ink dark:text-on-dark">비밀번호 확인</h2>
        <p className="mt-1 text-xs text-muted dark:text-on-dark-soft">
          내 정보 수정 진입 전 본인 확인이 필요합니다.
        </p>
        {err && (
          <p className="mt-3 rounded-lg border border-red-300/50 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/30 dark:bg-red-500/15 dark:text-red-200">
            {err}
          </p>
        )}
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="현재 비밀번호"
          autoComplete="current-password"
          autoFocus
          className="mt-3 w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-primary dark:border-white/10 dark:bg-surface-dark-elevated dark:text-on-dark"
        />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-pill bg-surface-strong py-2 text-sm font-semibold text-body active:scale-95 dark:bg-surface-dark-elevated dark:text-on-dark-soft"
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="flex-1 rounded-pill bg-primary py-2 text-sm font-semibold text-on-primary active:scale-95 disabled:opacity-40"
          >
            {busy ? "확인 중…" : "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}
