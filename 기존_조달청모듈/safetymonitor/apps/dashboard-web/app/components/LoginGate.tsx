// 관제 대시보드 진입 게이트 — 세션 토큰 없으면 로그인 화면, 있으면 자식(대시보드) 렌더. 토큰 키는 관리자 export 모달과 분리.
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

// 대시보드 보기 권한 토큰 — 관리자 export(safetymonitor.admin.token.v1)와 별도 키로 보기/내보내기 권한 분리.
const SESSION_KEY = "safetymonitor.session.v1";

// 보호된 API 호출(예: PII 포함 GET) 시 Authorization 헤더로 동봉할 로그인 세션 토큰을 읽는다.
export function getSessionToken(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

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

  useEffect(() => {
    try {
      setAuthed(Boolean(window.sessionStorage.getItem(SESSION_KEY)));
    } catch {
      setAuthed(false);
    }
  }, []);

  const logout = useCallback(() => {
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // sessionStorage 불가 환경은 메모리 상태만 초기화
    }
    setAuthed(false);
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
        onLogin={(token) => {
          try {
            window.sessionStorage.setItem(SESSION_KEY, token);
          } catch {
            // sessionStorage 불가 환경은 메모리 상태로만 진입 유지
          }
          setAuthed(true);
        }}
      />
    );
  }

  return (
    <SessionContext.Provider value={{ logout }}>
      {children}
    </SessionContext.Provider>
  );
}
