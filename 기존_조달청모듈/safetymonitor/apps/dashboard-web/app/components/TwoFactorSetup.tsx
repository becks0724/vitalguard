// 2단계 인증 등록·해제 — '내 정보' 안의 한 절(2026-08-28 사용자 결정).
//
// ★ 등록 방식이 둘이고 **기본은 문자열 직접 입력**이다(사용자 지시). QR 은 선택이다.
//   근거 = 대상이 소수(최고관리자·관리자메뉴 권한자·담당관)라 손으로 옮겨 적는 부담이 작고,
//   문자열은 폰 카메라가 없거나 화면을 공유 중일 때도 통한다. QR 은 편의로 얹는다.
//
// ⚠ 시크릿은 **등록 중에만** 화면에 온다. 활성화된 뒤에는 서버가 다시 주지 않는다
//   (세션을 훔친 쪽이 자기 앱에 같은 계정을 등록해 버리는 것을 막는다 — api/admin/totp GET).
"use client";

import { useCallback, useEffect, useState } from "react";

import { getSessionToken } from "./session-token";

type TotpState = {
  required: boolean;
  enabled: boolean;
  pending: boolean;
  secret?: string;
  uri?: string;
  qrDataUri?: string;
};

const FIELD =
  "w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none transition hover:border-primary/50 focus:border-primary dark:border-white/15 dark:bg-surface-dark dark:text-on-dark";

export function TwoFactorSetup() {
  const [state, setState] = useState<TotpState | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // 등록 방식 — 기본은 문자열. QR 은 눌러서 편다(사용자 지시).
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);

  const call = useCallback(
    async (init?: RequestInit): Promise<TotpState | null> => {
      const res = await fetch("/api/admin/totp", {
        ...init,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${getSessionToken() ?? ""}`,
          ...(init?.headers ?? {}),
        },
      });
      const json = (await res.json()) as TotpState & { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) {
        setError(json.error ?? "처리에 실패했습니다.");
        return null;
      }
      setError(null);
      return json;
    },
    [],
  );

  const load = useCallback(async () => {
    const next = await call();
    if (next) setState(next);
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  const begin = useCallback(async () => {
    setBusy(true);
    setDone(null);
    const next = await call({ method: "POST", body: JSON.stringify({ action: "begin" }) });
    if (next) setState((s) => ({ ...(s ?? { required: true, enabled: false, pending: true }), ...next }));
    setBusy(false);
  }, [call]);

  const confirm = useCallback(async () => {
    const clean = code.replace(/\D/g, "");
    if (clean.length !== 6) return;
    setBusy(true);
    const next = await call({
      method: "POST",
      body: JSON.stringify({ action: "confirm", code: clean }),
    });
    setBusy(false);
    if (!next) return;
    setCode("");
    setDone("2단계 인증이 켜졌습니다. 다음 로그인부터 6자리를 묻습니다.");
    await load();
  }, [call, code, load]);

  const disable = useCallback(async () => {
    const clean = code.replace(/\D/g, "");
    if (state?.enabled && clean.length !== 6) {
      setError("해제하려면 인증 앱의 6자리 코드가 필요합니다.");
      return;
    }
    setBusy(true);
    const next = await call({
      method: "POST",
      body: JSON.stringify({ action: "disable", ...(clean ? { code: clean } : {}) }),
    });
    setBusy(false);
    if (!next) return;
    setCode("");
    setShowQr(false);
    setDone("2단계 인증을 해제했습니다.");
    await load();
  }, [call, code, state?.enabled, load]);

  const copySecret = useCallback(async () => {
    if (!state?.secret) return;
    try {
      // 공백은 읽기용이라 복사할 땐 뺀다 — 앱에 붙여넣을 값은 붙은 문자열이다.
      await navigator.clipboard.writeText(state.secret.replace(/\s/g, ""));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("복사에 실패했습니다. 값을 직접 선택해 복사해주세요.");
    }
  }, [state?.secret]);

  if (!state) return null;
  // 대상이 아닌 계정에는 이 절을 아예 보이지 않는다 — 못 켜는 기능을 보여줄 이유가 없다.
  if (!state.required) return null;

  const enrolling = !state.enabled && Boolean(state.secret);

  return (
    <section className="rounded-xl border border-hairline p-4 dark:border-white/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink dark:text-on-dark">
            {/* 상태를 자물쇠로 — 켜져 있으면 잠김, 아니면 열림. */}
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={state.enabled ? "text-semantic-up" : "text-muted"}
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              {state.enabled ? <path d="M7 11V7a5 5 0 0 1 10 0v4" /> : <path d="M7 11V7a5 5 0 0 1 9.9-1" />}
            </svg>
            2단계 인증
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted dark:text-on-dark-soft">
            {state.enabled
              ? "켜져 있습니다. 로그인할 때 인증 앱의 6자리를 함께 입력합니다."
              : "권한이 큰 계정이라 2단계 인증을 권합니다. 인증 앱은 아무거나 써도 됩니다 — Google Authenticator·Microsoft Authenticator·1Password, 아이폰은 내장 '암호' 앱도 됩니다."}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ${
            state.enabled
              ? "bg-semantic-up/15 text-semantic-up"
              : "bg-surface-strong text-muted dark:bg-white/10 dark:text-on-dark-soft"
          }`}
        >
          {state.enabled ? "켜짐" : "꺼짐"}
        </span>
      </div>

      {/* ── 등록 중 — 시크릿 표시(기본 문자열, QR 은 선택) ── */}
      {enrolling && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-body dark:text-on-dark-soft">
              1. 아래 키를 인증 앱에 등록하세요
            </p>
            <button
              type="button"
              onClick={() => setShowQr((v) => !v)}
              className="rounded-md border border-hairline px-2 py-1 text-[11px] font-semibold text-body transition hover:border-primary hover:bg-primary-subtle hover:text-primary dark:border-white/15 dark:text-on-dark-soft dark:hover:bg-white/10"
            >
              {showQr ? "키 문자열 보기" : "QR 코드로 보기"}
            </button>
          </div>

          {showQr ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-hairline bg-canvas p-4 dark:border-white/10 dark:bg-surface-dark">
              {state.qrDataUri ? (
                <img
                  src={state.qrDataUri}
                  alt="2단계 인증 등록 QR 코드"
                  width={168}
                  height={168}
                  className="rounded bg-white p-2"
                />
              ) : (
                <p className="py-6 text-center text-xs text-muted dark:text-on-dark-soft">
                  QR 코드를 준비하지 못했습니다. 키 문자열로 등록해주세요.
                </p>
              )}
              <p className="text-[11px] text-muted dark:text-on-dark-soft">
                인증 앱에서 스캔하세요
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={copySecret}
              title="눌러서 복사"
              className="w-full rounded-lg border border-dashed border-hairline bg-canvas px-3 py-3 text-center font-mono text-sm tracking-wider text-ink transition hover:border-primary hover:bg-primary-subtle dark:border-white/15 dark:bg-surface-dark dark:text-on-dark dark:hover:bg-white/10"
            >
              {state.secret}
              <span className="mt-1 block font-sans text-[11px] font-semibold text-muted dark:text-on-dark-soft">
                {copied ? "복사했습니다" : "눌러서 복사"}
              </span>
            </button>
          )}

          <p className="text-xs font-semibold text-body dark:text-on-dark-soft">
            2. 앱에 뜬 6자리를 입력해 확인하세요
          </p>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirm();
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-label="인증 코드 6자리"
              className={`${FIELD} text-center font-mono tracking-[0.3em]`}
            />
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy || code.replace(/\D/g, "").length !== 6}
              className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:brightness-110 disabled:opacity-50"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* ── 아직 시작 전 ── */}
      {!state.enabled && !enrolling && (
        <button
          type="button"
          onClick={() => void begin()}
          disabled={busy}
          className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary transition hover:brightness-110 disabled:opacity-50"
        >
          2단계 인증 등록하기
        </button>
      )}

      {/* ── 켜져 있음 — 해제(코드 요구) ── */}
      {state.enabled && (
        <div className="mt-4 flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            placeholder="해제하려면 6자리 입력"
            aria-label="해제 확인 코드"
            className={`${FIELD} text-center font-mono tracking-[0.2em]`}
          />
          <button
            type="button"
            onClick={() => void disable()}
            disabled={busy || code.replace(/\D/g, "").length !== 6}
            className="shrink-0 rounded-lg border border-semantic-down/40 px-4 py-2 text-sm font-semibold text-semantic-down transition hover:bg-semantic-down/10 disabled:opacity-50"
          >
            해제
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs font-semibold text-semantic-down">{error}</p>}
      {done && <p className="mt-2 text-xs font-semibold text-semantic-up">{done}</p>}

      {state.enabled && (
        <p className="mt-3 text-[11px] leading-relaxed text-muted dark:text-on-dark-soft">
          인증 앱이 든 기기를 잃어버렸다면 관리자에게 2단계 인증 초기화를 요청하세요.
        </p>
      )}
    </section>
  );
}
