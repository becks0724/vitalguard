// 라이트/다크 테마 컨텍스트 — localStorage 영속화 + html.dark 클래스 토글
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "safetymonitor.theme.v1";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyHtmlClass(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // SSR 은 dark default — pre-hydration inline 스크립트가 mount 전에 클래스 보정
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const initial: Theme = stored === "light" ? "light" : "dark";
      setThemeState(initial);
      applyHtmlClass(initial);
    } catch {
      applyHtmlClass("dark");
    }
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyHtmlClass(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage 불가 환경은 조용히 무시
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme 은 ThemeProvider 내부에서만 사용 가능합니다.");
  }
  return ctx;
}
