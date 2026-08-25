// 헤더 우상단 라이트/다크 토글 — 알약형 슬라이딩 스위치.
// 썸은 "속이 빈 원(테두리만)"이고 그 안에 현재 테마 아이콘이 들어간다.
//   라이트 = 썸이 좌측, 안에 해 · 다크 = 썸이 우측, 안에 달 (사용자 지정 배치)
// 반대편 아이콘은 흐리게 남겨 어느 쪽으로 가면 무엇이 되는지 보이게 한다.
// framer-motion 없이 인라인 SVG + Tailwind transition 으로 구현한다 — 이 프로젝트는 신규 패키지를
// 사전 합의 없이 추가하지 않는다(quantum-pulse-loader 도 같은 이유로 CSS 키프레임으로 만들었다).
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
      // ★ 색은 테마와 무관하게 고정한다(사용자 지정) — 토큰(bg-canvas·text-ink 등)은 다크에서 뒤집혀
      //   연한 회색 배경 위에 흰 선이 얹히므로 안 보인다. 그래서 hex 로 못박는다.
      // 값은 #d1d5db — 이전 #f0f0f3 은 밝기가 94% 라 다크 배경 위에서 흰색으로 읽혔다(사용자 지적).
      // 트랙은 좌→우 그라데이션 — 해 쪽(좌)은 흰색, 달 쪽(우)은 회색. 낮에서 밤으로 가는 결을 준다.
      // ★ 패딩은 p-1(4px) 이 아니라 3px 다 — 치수가 딱 떨어져야 중앙에 앉는다.
      //   세로: 32(h-8) − 2(테두리) − 6(패딩) = 24 = 썸/아이콘 높이(h-6). p-1 이면 속이 22px 라
      //         24px 내용이 2px 넘쳐 위아래 여백이 어긋난다(사용자 지적).
      //   가로: 64(w-16) − 2 − 6 = 56, 썸 24 → 이동거리 32 = translate-x-8 과 정확히 일치.
      //         p-1 이면 속이 54px 라 이동거리가 30px 이어야 하는데 32px 를 밀어 오른쪽으로 삐져나갔다.
      className="flex h-8 w-16 shrink-0 cursor-pointer items-center rounded-full border border-[#b9bec7] bg-gradient-to-r from-white to-[#d1d5db] p-[3px] transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <div className="relative w-full">
        {/* 바닥 — 좌측 해 · 우측 달. 썸이 없는 쪽만 흐리게 보인다 */}
        <div className="flex h-6 w-full items-center justify-between">
          <span className={`flex h-6 w-6 items-center justify-center text-[#60646c] transition-opacity duration-700 ${isDark ? "opacity-40" : "opacity-0"}`}>
            <SunIcon />
          </span>
          <span className={`flex h-6 w-6 items-center justify-center text-[#60646c] transition-opacity duration-700 ${isDark ? "opacity-0" : "opacity-40"}`}>
            <MoonIcon />
          </span>
        </div>
        {/* 썸 — 속이 빈 원(테두리만). 라이트면 좌측에서 해를, 다크면 우측에서 달을 담는다 */}
        <div
          // duration-700 + 부드러운 커브 — 300ms 는 순간이동처럼 보였다(사용자 지적).
          className={`absolute top-0 flex h-6 w-6 items-center justify-center rounded-full border border-[#171717] text-[#171717] transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
            isDark ? "translate-x-8" : "translate-x-0"
          }`}
        >
          {isDark ? <MoonIcon /> : <SunIcon />}
        </div>
      </div>
    </button>
  );
}
