// Tailwind 3.x — Expo-inspired editorial design tokens
import type { Config } from "tailwindcss";

// ★ 색 토큰은 반드시 이 헬퍼로 등록한다. `"var(--color-x)"` 를 그대로 쓰면 투명도 수식
// (`bg-ink/20` 등)이 조용히 클래스를 만들지 않고 기본값으로 폴백한다 — 전역 71건이 이렇게 죽어 있었다(2026-08-25).
// 수식이 없으면 `--color-*`(알파가 배어 있는 hairline·primary-subtle 포함)를 그대로 쓰고,
// 있으면 `--color-*-rgb` 채널값에 알파를 얹는다. 채널 변수는 globals.css 가 짝으로 정의한다.
// 수식 없는 유틸(`bg-canvas`)에도 Tailwind 는 `var(--tw-bg-opacity)` 를 opacityValue 로 넘긴다.
// 그래서 `var(` 포함 여부로 갈라야 한다 — 안 그러면 알파가 배어 있는 토큰(다크 hairline = 흰색 8%,
// primary-subtle = 파랑 8%)이 불투명해져 다크 UI 전체가 흰 격자로 뒤덮인다.
// 캐스팅은 Tailwind 3.x 타입 정의가 함수형 색상값을 색 자리에 허용하지 않아서다(런타임은 공식 지원).
const token = (name: string) =>
  (({ opacityValue }: { opacityValue?: string }) =>
    opacityValue === undefined || opacityValue.includes("var(")
      ? `var(--color-${name})`
      : `rgb(var(--color-${name}-rgb) / ${opacityValue})`) as unknown as string;

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: token("primary"),
        "primary-active": token("primary-active"),
        "primary-disabled": token("primary-disabled"),
        "primary-subtle": token("primary-subtle"),
        "primary-ring": token("primary-ring"),
        "brand-accent": token("brand-accent"),
        "text-link": token("text-link"),
        canvas: token("canvas"),
        "canvas-soft": token("canvas-soft"),
        "surface-soft": token("surface-soft"),
        "surface-card": token("surface-card"),
        "surface-strong": token("surface-strong"),
        "surface-dark": token("surface-dark"),
        "surface-dark-elevated": token("surface-dark-elevated"),
        hairline: token("hairline"),
        "hairline-soft": token("hairline-soft"),
        "hairline-strong": token("hairline-strong"),
        ink: token("ink"),
        body: token("body"),
        "body-strong": token("body-strong"),
        muted: token("muted"),
        "muted-soft": token("muted-soft"),
        "on-primary": token("on-primary"),
        "on-dark": token("on-dark"),
        "on-dark-soft": token("on-dark-soft"),
        "semantic-up": token("semantic-up"),
        "semantic-down": token("semantic-down"),
        warning: token("warning"),
      },
      borderRadius: {
        pill: "9999px",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      boxShadow: {
        card: "none",
        "card-hover": "0 4px 12px rgba(0, 0, 0, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
