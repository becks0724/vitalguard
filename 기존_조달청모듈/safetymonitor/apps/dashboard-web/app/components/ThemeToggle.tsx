// 헤더 우상단 라이트/다크 토글 — 알약형 슬라이딩 스위치 (Serenity UI / 21st.dev 디자인 이식)
// 채워진 썸이 현재 테마 아이콘을 표시하며 좌↔우로 슬라이드, 반대편엔 흐린 대체 아이콘.
// 의존성 추가 없이 인라인 SVG + Tailwind transition 으로 구현, 프로젝트 useTheme() 에 연결.
"use client";

import { useTheme } from "./ThemeProvider";

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
      title={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
      className={`flex h-8 w-16 shrink-0 cursor-pointer rounded-full p-1 transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
        isDark ? "border border-zinc-800 bg-zinc-950" : "border border-zinc-200 bg-white"
      }`}
    >
      <div className="flex w-full items-center justify-between">
        {/* 슬롯 A — 채워진 썸: 현재 테마 아이콘 */}
        <div
          className={`flex h-6 w-6 items-center justify-center rounded-full transition-transform duration-300 ${
            isDark ? "translate-x-0 bg-zinc-800" : "translate-x-8 bg-gray-200"
          }`}
        >
          {isDark ? <MoonIcon className="text-white" /> : <SunIcon className="text-gray-700" />}
        </div>
        {/* 슬롯 B — 흐린 대체 아이콘 */}
        <div
          className={`flex h-6 w-6 items-center justify-center rounded-full transition-transform duration-300 ${
            isDark ? "bg-transparent" : "-translate-x-8"
          }`}
        >
          {isDark ? <SunIcon className="text-gray-500" /> : <MoonIcon className="text-black" />}
        </div>
      </div>
    </button>
  );
}
