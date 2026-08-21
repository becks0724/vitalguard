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
      // L-51 — 캡처 단계 scroll 은 문서 안 **모든** 스크롤을 받는다. 이 앱에는 매 프레임
      // scrollLeft 를 쓰는 마퀴 티커(useMarqueeScroll)가 상시 돌아서, 오버레이를 무조건
      // 닫으면 열린 지 16ms 만에 사라진다(2026-08-11 태풍 드롭다운 실사고).
      // 정당한 사용은 disable 주석 + "무엇을 조건으로 좁혔는지" 근거를 함께 남긴다.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='addEventListener'][arguments.0.value='scroll'][arguments.2.value=true]",
          message:
            "캡처 단계 scroll 리스너는 화면 전체의 스크롤을 받는다(마퀴 티커 포함) — 오버레이를 무조건 닫으면 즉시 사라진다. 대상이 앵커를 품는지(scrollTarget.contains(anchor)) 확인하는 조건을 넣고, 근거 주석과 함께 eslint-disable 하라. lessons L-51",
        },
        {
          selector:
            "CallExpression[callee.property.name='addEventListener'][arguments.0.value='scroll'] Property[key.name='capture'][value.value=true]",
          message:
            "캡처 단계 scroll 리스너({capture:true})는 화면 전체의 스크롤을 받는다 — lessons L-51 참조.",
        },
      ],
    },
  },
  {
    // `scripts/` 는 사람이 터미널에서 돌리는 도구다 — **출력이 곧 용도**라 `no-console` 이 노이즈다.
    // 앱 런타임(`app/`·`lib/`)에는 규칙을 그대로 둔다(거기선 console 이 진짜 흔적이다).
    // ⚠ 경고 개수를 기준선으로 쓰려면 노이즈가 섞이면 안 된다 — 이 override 로 5건이 사라지고
    //   남는 1건(`lib/env-alert-notify.ts:90`)은 앱 코드라 실제로 볼 값이다.
    files: ["scripts/**/*.{js,mjs,cjs,ts}"],
    rules: {
      "no-console": "off",
    },
  },
);
