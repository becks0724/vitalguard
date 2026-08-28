// 로그인 2단계 인증 — 로그인 카드 위에 떠오르는 패널(2026-08-28 사용자 지시 "호버링").
//
// ★ 이 화면은 로그인 카드를 **교체하지 않고 덮는다.** 뒤가 흐릿하게 남아 있어야
//   "로그인이 취소된 게 아니라 한 단계가 더 남았다"로 읽힌다 — 화면이 통째로 갈리면
//   사람은 처음부터 다시 하는 줄 알고 뒤로 가기를 누른다.
//
// ⚠ 코드는 붙여넣기가 잦다(앱에서 복사). 그래서 6칸을 따로 두지 않고 한 칸으로 받는다 —
//   칸을 쪼개면 붙여넣기가 첫 칸에만 들어가고 나머지가 빈다.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { LiquidMetalButton } from "./LiquidMetalButton";

export function TwoFactorPrompt({
  onSubmit,
  onCancel,
  error,
  submitting,
}: {
  /** 6자리를 상위(로그인 폼)로 올린다 — 비밀번호를 여기까지 내리지 않기 위해서다. */
  onSubmit: (code: string) => void;
  onCancel: () => void;
  error: string | null;
  submitting: boolean;
}) {
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 뜨자마자 입력칸에 초점 — 사람은 이미 앱에서 코드를 읽고 온 상태다.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc 로 닫기 — 떠 있는 패널의 기본 기대. 갇혔다고 느끼지 않게 한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = useCallback(() => {
    const clean = code.replace(/\D/g, "");
    if (clean.length === 6 && !submitting) onSubmit(clean);
  }, [code, onSubmit, submitting]);

  // 6자리가 차면 곧바로 보낸다 — 확인 버튼을 한 번 더 누르게 할 이유가 없다.
  // ⚠ 이미 보낸 값과 같으면 다시 보내지 않는다(오류 후 그대로 두면 무한 재전송이 된다).
  const sentRef = useRef<string | null>(null);
  useEffect(() => {
    const clean = code.replace(/\D/g, "");
    if (clean.length === 6 && !submitting && sentRef.current !== clean) {
      sentRef.current = clean;
      onSubmit(clean);
    }
  }, [code, onSubmit, submitting]);

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="2단계 인증"
    >
      {/* 뒤 카드를 흐린다 — 덮은 것이지 갈아치운 것이 아님을 보이게. 클릭하면 취소. */}
      <button
        type="button"
        aria-label="2단계 인증 취소"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-sm"
      />

      <div className="relative w-full max-w-[340px] rounded-2xl border border-white/15 bg-black/55 p-6 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.75)] backdrop-blur-xl">
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          {/* 잠긴 자물쇠 — 한 단계가 더 남았다는 신호. */}
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-white/85"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <h2 className="text-base font-bold text-white drop-shadow">2단계 인증</h2>
          <p className="text-[11px] leading-relaxed text-white/70">
            인증 앱에 표시된 6자리 숫자를 입력하세요.
          </p>
        </div>

        <input
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          aria-label="인증 코드 6자리"
          disabled={submitting}
          className="w-full rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] text-white placeholder-white/30 outline-none backdrop-blur-md transition hover:border-white/40 hover:bg-white/15 focus:border-white/60 focus:bg-white/15 disabled:opacity-60"
        />

        {/* 오류 자리를 늘 비워 둔다 — 메시지가 뜰 때 패널이 튀지 않게. */}
        <p className="mt-2 min-h-[16px] text-center text-[11px] font-semibold text-rose-300">
          {error ?? ""}
        </p>

        <div className="mt-3 flex flex-col items-center gap-3">
          <LiquidMetalButton
            label={submitting ? "확인 중…" : "확인"}
            onClick={submit}
            disabled={submitting || code.replace(/\D/g, "").length !== 6}
            className="w-full"
          />
          <button
            type="button"
            onClick={onCancel}
            className="text-[11px] font-semibold text-white/60 underline-offset-2 transition hover:text-white hover:underline"
          >
            취소하고 처음으로
          </button>
        </div>

        <p className="mt-4 text-center text-[10px] leading-relaxed text-white/45">
          앱을 쓸 수 없으면 관리자에게 2단계 인증 초기화를 요청하세요.
        </p>
      </div>
    </div>
  );
}
