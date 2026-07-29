"use client";
// 세션 만료 임박 팝업 — 은행식 "세션 연장" 안내. 만료 N분 전 카운트다운 팝업 + [연장]/[로그아웃].
// 무상태 JWT 라 [연장]=새 JWT 재발급(슬라이딩). 방치해 만료되면 "다시 로그인" 안내.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getSessionToken } from "./LoginGate";

const WARN_BEFORE_MS = 3 * 60 * 1000; // 만료 3분 전부터 팝업
const TICK_MS = 1000;

// JWT payload 의 exp(초)를 읽어 만료 시각(ms)으로. 서명 검증은 서버 몫 — 여기선 표시용 디코드만.
function decodeExpMs(token: string | null): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const payload = JSON.parse(json) as { exp?: number };
    const exp = payload.exp;
    // 표시용 디코드 — 비현실적/조작 exp 는 무시(오버플로·NaN 방지). 서버가 서명·만료를 실제 강제.
    // 상한 4102444800 = 2100-01-01(초). 이 이상은 정수정밀 이탈 위험이라 미관리 처리.
    if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0 || exp > 4102444800) {
      return null;
    }
    return exp * 1000;
  } catch {
    return null;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function SessionKeeper({
  onExtended,
  onExpire,
}: {
  onExtended: (token: string) => void;
  onExpire: () => void;
}) {
  const expMsRef = useRef<number | null>(decodeExpMs(getSessionToken()));
  const [remaining, setRemaining] = useState<number | null>(
    expMsRef.current != null ? expMsRef.current - Date.now() : null,
  );
  const [extending, setExtending] = useState(false);
  const [error, setError] = useState(false);

  // 매초 남은 시간 갱신.
  useEffect(() => {
    const id = window.setInterval(() => {
      const exp = expMsRef.current;
      setRemaining(exp != null ? exp - Date.now() : null);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const extend = useCallback(async () => {
    const token = getSessionToken();
    if (!token) {
      onExpire();
      return;
    }
    setExtending(true);
    setError(false);
    try {
      const res = await fetch("/api/admin/session/refresh", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        onExpire();
        return;
      }
      const j = (await res.json()) as { ok?: boolean; token?: string };
      if (j.ok && j.token) {
        onExtended(j.token);
        expMsRef.current = decodeExpMs(j.token);
        setRemaining(expMsRef.current != null ? expMsRef.current - Date.now() : null);
      } else {
        onExpire();
      }
    } catch {
      // 네트워크 일시 실패 — 팝업 유지(재시도 가능). 만료되면 아래 만료 상태로 전환.
      setError(true);
    } finally {
      setExtending(false);
    }
  }, [onExtended, onExpire]);

  if (remaining == null) return null; // exp 미확인(비-JWT 등) — 관리 안 함
  const expired = remaining <= 0;
  if (!expired && remaining > WARN_BEFORE_MS) return null; // 아직 여유 — 팝업 없음
  if (typeof document === "undefined") return null;

  const mm = Math.max(0, Math.floor(remaining / 60000));
  const ss = Math.max(0, Math.floor((remaining % 60000) / 1000));

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="세션 만료 안내"
      className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4 backdrop-blur-[2px]"
    >
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-hairline bg-surface-card p-5 shadow-xl dark:border-white/10 dark:bg-surface-dark-elevated">
        <div className="flex items-center gap-2">
          <span
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
              expired ? "bg-semantic-down" : "bg-primary"
            }`}
            aria-hidden="true"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </span>
          <h2 className="text-sm font-semibold text-ink dark:text-on-dark">
            {expired ? "세션이 만료되었습니다" : "세션이 곧 만료됩니다"}
          </h2>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-body dark:text-on-dark-soft">
          {expired ? (
            "보안을 위해 세션이 종료되었습니다. 다시 로그인해 주세요."
          ) : (
            <>
              남은 시간{" "}
              <span className="font-mono font-semibold tabular-nums text-ink dark:text-on-dark">
                {mm}:{pad2(ss)}
              </span>
              . 계속 사용하시려면 세션을 연장하세요.
            </>
          )}
        </p>

        <div className="mt-4 flex gap-2">
          {expired ? (
            <button
              type="button"
              onClick={onExpire}
              className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition hover:opacity-90"
            >
              다시 로그인
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={extend}
                disabled={extending}
                className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary transition hover:opacity-90 disabled:opacity-60"
              >
                {extending ? "연장 중…" : "세션 연장"}
              </button>
              <button
                type="button"
                onClick={onExpire}
                className="rounded-lg border border-hairline px-3 py-2 text-sm font-medium text-body transition hover:bg-surface-strong dark:border-white/15 dark:text-on-dark-soft dark:hover:bg-white/10"
              >
                로그아웃
              </button>
            </>
          )}
        </div>
        {!expired && error && !extending && (
          <p className="mt-2 text-[11px] text-semantic-down">
            연장에 실패했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
