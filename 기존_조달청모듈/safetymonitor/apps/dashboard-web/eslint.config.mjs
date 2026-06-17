// dashboard ESLint flat config — de-sloppify 핵심(미사용·디버그·명백한 결함) 위주.
// any 등 스타일/취향 규칙은 경고로 두어 데모 직전 대량 수정 위험을 피한다(경고는 exit 0 유지).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "next-env.d.ts",
      "public/**",
      "*.config.js",
      "*.config.mjs",
      "*.config.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-undef": "off", // 타입스크립트가 미정의 식별자를 처리
      "no-debugger": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // 취향/대량 규칙은 경고(green 비차단)
      "@typescript-eslint/no-explicit-any": "warn",
      // de-sloppify 핵심: 미사용 변수/임포트는 에러(단 _ 접두는 의도적 미사용으로 허용)
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
);
