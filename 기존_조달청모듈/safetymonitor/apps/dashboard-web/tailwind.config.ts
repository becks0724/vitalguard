// Tailwind 3.x — Expo-inspired editorial design tokens
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
        "primary-subtle": "var(--color-primary-subtle)",
        "primary-ring": "var(--color-primary-ring)",
        "brand-accent": "var(--color-brand-accent)",
        "text-link": "var(--color-text-link)",
        canvas: "var(--color-canvas)",
        "canvas-soft": "var(--color-canvas-soft)",
        "surface-soft": "var(--color-surface-soft)",
        "surface-card": "var(--color-surface-card)",
        "surface-strong": "var(--color-surface-strong)",
        "surface-dark": "var(--color-surface-dark)",
        "surface-dark-elevated": "var(--color-surface-dark-elevated)",
        hairline: "var(--color-hairline)",
        "hairline-soft": "var(--color-hairline-soft)",
        "hairline-strong": "var(--color-hairline-strong)",
        ink: "var(--color-ink)",
        body: "var(--color-body)",
        "body-strong": "var(--color-body-strong)",
        muted: "var(--color-muted)",
        "muted-soft": "var(--color-muted-soft)",
        "on-primary": "var(--color-on-primary)",
        "on-dark": "var(--color-on-dark)",
        "on-dark-soft": "var(--color-on-dark-soft)",
        "semantic-up": "var(--color-semantic-up)",
        "semantic-down": "var(--color-semantic-down)",
        warning: "var(--color-warning)",
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
