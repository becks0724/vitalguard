// 워치 QR 로그인 승인 화면(폰) — 관제웹 로그인 화면과 같은 레이아웃(셰이더 배경·글래스 카드·로고·글래스 입력·LiquidMetal 버튼)
"use client";

import { useState } from "react";

import { LiquidMetalButton } from "./LiquidMetalButton";
import { LoginShaderBackground } from "./LoginShaderBackground";
import { FIELD_BASE, INPUT_CLASS, LABEL_PHONE_HIDDEN } from "./login-styles";

// 로그인 화면(LoginScreen)과 같은 카피 — 같은 카드처럼 보여야 한다.
const LINE1 = "보이지 않는 위험은 없습니다.\n혼자가 아니기 때문입니다.";

const ERROR_TEXT: Record<string, string> = {
  invalid_credentials: "아이디 또는 비밀번호가 올바르지 않습니다.",
  not_approved: "승인 대기 중인 계정입니다. 관리자 승인 후 다시 시도하세요.",
  code_invalid: "코드가 만료됐거나 올바르지 않습니다. 워치에서 새 QR 을 띄운 뒤 다시 스캔하세요.",
  invalid_request: "입력을 확인하세요.",
  app_auth_not_configured: "서버에 앱 인증이 설정되지 않았습니다.",
};

/** 코드 표시용 — 입력을 대문자·XXXX-XXXX 로 정리(서버가 다시 정규화하므로 관대하게). */
function tidyCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

export function PairApprove({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(tidyCode(initialCode));
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ name: string | null; id: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/app-auth/device/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, id, password }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        retryAfterSec?: number;
        user?: { id: string; name: string | null };
      };
      if (res.ok && j.ok && j.user) {
        setDone({ name: j.user.name, id: j.user.id });
        setPassword("");
      } else if (j.error === "too_many_attempts") {
        setError(`시도 횟수를 초과했습니다. ${j.retryAfterSec ?? 300}초 후 다시 시도하세요.`);
      } else {
        setError(ERROR_TEXT[j.error ?? ""] ?? "승인에 실패했습니다. 잠시 후 다시 시도하세요.");
      }
    } catch {
      setError("서버에 연결할 수 없습니다. 네트워크를 확인하세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4 py-8 text-ink dark:bg-surface-dark dark:text-on-dark">
      <LoginShaderBackground />

      {/* 글래스 카드 — 로그인 카드와 같은 재질. 사진 컬럼은 뺀다(폰 세로 화면 · 승인 한 가지 일). */}
      <div className="relative z-10 flex w-full max-w-md flex-col items-center rounded-3xl border border-white/15 bg-white/5 px-6 py-8 shadow-2xl backdrop-blur-md">
        <div className="logo3d-stage">
          <img src="/brand/vitalguard-logo-dark.png" alt="VitAlGuard Industrial Safety OS" className="logo3d-badge !h-16 !w-16" />
        </div>
        <h1
          className="mt-4 flex min-h-[30px] flex-col items-center justify-center whitespace-pre-line text-center text-[22px] leading-snug tracking-[-0.4px] text-white drop-shadow-lg"
          style={{ fontFamily: "'Archivo Black', 'Do Hyeon', system-ui, sans-serif" }}
        >
          {LINE1}
        </h1>

        {done ? (
          <div className="mt-6 w-full max-w-sm space-y-3">
            <p className="rounded-xl border border-emerald-300/50 bg-emerald-500/25 px-3 py-3 text-center text-sm text-emerald-50 backdrop-blur-md">
              승인 완료 — {done.name ?? done.id} 계정으로 워치가 곧 로그인됩니다.
              <br />
              <span className="text-xs text-emerald-100/80">워치 화면이 바뀌면 이 창은 닫아도 됩니다.</span>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 w-full max-w-sm space-y-3">
            <p className="text-center text-xs font-semibold uppercase tracking-wider text-white/75 drop-shadow">
              워치 로그인 승인
            </p>
            <label className="block">
              <span className={LABEL_PHONE_HIDDEN}>워치 코드</span>
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                value={code}
                onChange={(e) => setCode(tidyCode(e.target.value))}
                placeholder="워치에 표시된 코드"
                required
                className={`mt-1 w-full ${FIELD_BASE} text-center text-2xl font-bold tracking-[0.3em]`}
              />
            </label>
            <p className="text-center text-[11px] text-white/70 drop-shadow">
              워치 화면의 코드와 같은지 확인하세요. 다른 코드를 승인하면 다른 워치가 로그인됩니다.
            </p>
            <label className="block">
              <span className={LABEL_PHONE_HIDDEN}>관리자 ID</span>
              <input
                type="text"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="관리자 ID"
                autoComplete="username"
                required
                className={INPUT_CLASS}
              />
            </label>
            <label className="block">
              <span className={LABEL_PHONE_HIDDEN}>비밀번호</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호"
                autoComplete="current-password"
                required
                className={INPUT_CLASS}
              />
            </label>
            {error && (
              <p className="rounded-xl border border-red-300/50 bg-red-500/25 px-3 py-2 text-xs text-red-50 backdrop-blur-md">
                {error}
              </p>
            )}
            <LiquidMetalButton
              type="submit"
              disabled={submitting || !password || code.length < 9}
              label={submitting ? "승인 중…" : "워치 로그인 승인"}
              className="w-full"
            />
          </form>
        )}
      </div>
    </div>
  );
}
