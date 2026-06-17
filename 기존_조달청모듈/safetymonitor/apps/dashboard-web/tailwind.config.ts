// Tailwind 3.x 스캔 경로 설정 — App Router 디렉터리만 사용
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--color-primary)",
        "primary-active": "var(--color-primary-active)",
        "primary-disabled": "var(--color-primary-disabled)",
        canvas: "var(--color-canvas)",
        "surface-soft": "var(--color-surface-soft)",
        "surface-strong": "var(--color-surface-strong)",
        "surface-dark": "var(--color-surface-dark)",
        "surface-dark-elevated": "var(--color-surface-dark-elevated)",
        hairline: "var(--color-hairline)",
        ink: "var(--color-ink)",
        body: "var(--color-body)",
        muted: "var(--color-muted)",
        "muted-soft": "var(--color-muted-soft)",
        "on-primary": "var(--color-on-primary)",
        "on-dark": "var(--color-on-dark)",
        "on-dark-soft": "var(--color-on-dark-soft)",
        "semantic-up": "var(--color-semantic-up)",
        "semantic-down": "var(--color-semantic-down)",
      },
      borderRadius: {
        xl: "24px",
        pill: "100px",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      boxShadow: {
        coinbase: "0 4px 12px rgba(0, 0, 0, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
