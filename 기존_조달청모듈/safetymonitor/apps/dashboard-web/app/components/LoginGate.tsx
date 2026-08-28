// 관제 대시보드 진입 게이트 — 세션 토큰 없으면 로그인 화면, 있으면 자식(대시보드) 렌더. 토큰 키는 관리자 export 모달과 분리.
// 토큰·역할 접근자는 ./session-token 에 있다 — SessionKeeper 와의 순환을 끊으려고 뗀 것이다(2026-08-22).
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { LoginScreen } from "./LoginScreen";
import { SessionKeeper } from "./SessionKeeper";
import { getSessionOrgType, ROLE_KEY, SESSION_KEY } from "./session-token";

// 로그인 후 자식(대시보드)에서 로그아웃을 호출하기 위한 컨텍스트.
type SessionContextValue = { logout: () => void };
const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession 은 LoginGate 내부(로그인 후)에서만 사용 가능합니다.");
  }
  return ctx;
}

export function LoginGate({ children }: { children: ReactNode }) {
  // null = 판정 전(스플래시), false = 미인증, true = 인증
  const [authed, setAuthed] = useState<boolean | null>(null);

  // ★ 시공사 세션은 제출 화면(/contractor)으로만 들어간다(2026-08-27 역할 설계 — 시공사는
  //   근거 문서 제출까지). 서버는 verifyBasicAuth 가 기본 거부하므로 이 리다이렉트는 UX 용이고,
  //   우회해도 관제 API 가 401 을 준다. orgType 은 토큰 클레임에서 읽는다(경로 셋 공통).
  const contractorMisrouted =
    authed === true &&
    getSessionOrgType() === "contractor" &&
    typeof window !== "undefined" &&
    !window.location.pathname.startsWith("/contractor");
  useEffect(() => {
    if (contractorMisrouted) window.location.replace("/contractor");
  }, [contractorMisrouted]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // 구글 로그인 콜백 핸드오프 — httpOnly 쿠키의 세션 토큰을 sessionStorage 로 옮긴 뒤 입장.
    if (params.get("gauth") === "1") {
      fetch("/api/auth/handoff")
        .then((r) => r.json())
        .then((j: { ok?: boolean; token?: string; role?: string }) => {
          try {
            if (j.ok && j.token) {
              window.sessionStorage.setItem(SESSION_KEY, j.token);
              if (j.role) window.sessionStorage.setItem(ROLE_KEY, j.role);
            }
          } catch {
            // sessionStorage 불가 환경 무시
          }
          window.history.replaceState({}, "", "/");
          setAuthed(Boolean(j.ok && j.token));
        })
        .catch(() => {
          window.history.replaceState({}, "", "/");
          setAuthed(false);
        });
      return;
    }
    try {
      setAuthed(Boolean(window.sessionStorage.getItem(SESSION_KEY)));
    } catch {
      setAuthed(false);
    }
  }, []);

  const logout = useCallback(() => {
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
      window.sessionStorage.removeItem(ROLE_KEY);
    } catch {
      // sessionStorage 불가 환경은 메모리 상태만 초기화
    }
    setAuthed(false);
  }, []);

  // 세션 연장(refresh)으로 받은 새 JWT 저장 — SessionKeeper 가 호출.
  const saveSessionToken = useCallback((token: string) => {
    try {
      window.sessionStorage.setItem(SESSION_KEY, token);
    } catch {
      // sessionStorage 불가 환경 무시
    }
  }, []);

  // 판정 전 — 로그인↔대시보드 깜빡임 방지용 중립 스플래시
  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas dark:bg-surface-dark">
        <div className="relative h-16 w-16 overflow-hidden rounded-xl opacity-80">
          <img
            src="/brand/vitalguard-logo-light.png"
            alt=""
            className="h-full w-full object-cover dark:hidden"
          />
          <img
            src="/brand/vitalguard-logo-dark.png"
            alt=""
            className="hidden h-full w-full object-cover dark:block"
          />
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <LoginScreen
        onLogin={(token, role) => {
          try {
            window.sessionStorage.setItem(SESSION_KEY, token);
            if (role) window.sessionStorage.setItem(ROLE_KEY, role);
          } catch {
            // sessionStorage 불가 환경은 메모리 상태로만 진입 유지
          }
          setAuthed(true);
        }}
      />
    );
  }

  // 시공사 오라우팅 — 이동이 끝날 때까지 관제 화면을 렌더하지 않는다(순간 노출 방지).
  if (contractorMisrouted) return null;

  return (
    <SessionContext.Provider value={{ logout }}>
      <SessionKeeper onExtended={saveSessionToken} onExpire={logout} />
      {children}
    </SessionContext.Provider>
  );
}
