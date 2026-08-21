// 관제웹 의존성 그래프·순환 검사 설정 — 이 레포의 실제 경로에 맞춘 것(생성 기본값 아님).
//
// 범위 = `apps/dashboard-web` 안의 소스만. 워크스페이스 패키지(@safetymonitor/analyzers·schemas)는
// pnpm 심링크라 해석하면 `packages/*/dist` 를 가리키는데 그건 빌드 산출물이라 그래프가 소스를
// 안 보여준다. 그래서 **외부 모듈로 접어서** 잎 노드로 둔다 — 패키지 내부까지 보려면
// 워크스페이스 루트에서 따로 돌리는 편이 낫다.
//
// ⚠ 테스트를 뺀 이유 = `lib/` 183개 중 **120개가 가드 테스트**다. 넣으면 그래프가 테스트로 덮인다.
//   가드가 소스를 읽기만 하고 import 하지 않으므로 구조 판단에도 기여하지 않는다.
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "순환 의존은 초기화 순서를 정의 불가로 만들고 트리셰이킹을 막는다.",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment: "해석되지 않는 import — 오타이거나 지워진 모듈이다.",
      from: {},
      to: {
        couldNotResolve: true,
        // ★ `server-only`·`client-only` 은 **레지스트리에 설치되지 않는다.**
        //   Next 가 `next/dist/compiled/server-only` 스텁으로 webpack 별칭을 걸어 해석한다
        //   (실측 2026-08-20 — node_modules 어디에도 없는데 소스 21곳이 쓰고 빌드·배포는 통과한다).
        //   dependency-cruiser 는 그 별칭을 모르므로 여기서만 면제한다.
        //   ⚠ 규칙 자체를 끄지 않는 이유 = **다른 오타는 계속 잡혀야 한다.**
        //   ⚠ `enhancedResolveOptions.alias` 로 알려주는 방법은 안 된다 —
        //     스키마가 그 키를 거부한다(`must NOT have additional properties`).
        pathNot: "^(server-only|client-only)$",
      },
    },
    {
      name: "not-to-dev-dep",
      severity: "error",
      comment:
        "런타임 코드가 devDependency 를 쓰면 로컬에서만 돌고 컨테이너에서 죽는다. " +
        "이 설정 파일과 scripts/ 는 빌드타임 전용이라 제외한다.",
      from: {
        path: "^(app|lib)/",
        pathNot: "\\.(test|spec)\\.(ts|tsx)$",
      },
      to: { dependencyTypes: ["npm-dev"] },
    },
    {
      // ── 이 레포 고유 규칙 ─────────────────────────────────────────────
      // 서버 라우트가 클라이언트 컴포넌트를 끌어오면 번들 경계가 무너진다.
      // 도입 시점(2026-08-20) 위반 0건임을 확인하고 넣었다 — 통제군으로 `app/` 전체를
      // 같은 정규식으로 재니 7건이 잡혀 검사 자체는 눈멀지 않았다.
      name: "api-not-to-components",
      severity: "error",
      comment: "API 라우트는 app/components 를 import 하지 않는다(서버·클라이언트 경계).",
      from: { path: "^app/api/" },
      to: { path: "^app/components/" },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment:
        "아무도 안 부르는 모듈. ⚠ Next App Router 는 page/layout/route 를 **규약으로** 부르므로 " +
        "그것들은 고아가 아니다. 설정·타입 선언도 마찬가지라 함께 뺀다.",
      from: {
        orphan: true,
        // ⚠ 여기 정규식에 **중첩 수량자를 쓰면 안 된다** — dependency-cruiser 가 safe-regex 로
        //   검사해 `([^/]+/)*` 같은 형태를 ReDoS 위험으로 판정하고 실행 자체를 중단한다.
        //   그래서 경로 전체를 훑지 않고 **마지막 segment 만** 앵커로 잡는다.
        pathNot: [
          "(^|/)(page|layout|route|loading|error|not-found|template|default)\\.(ts|tsx)$",
          "(^|/)(sitemap|robots|manifest|opengraph-image|icon|apple-icon)\\.(ts|tsx)$",
          "^(next|eslint|postcss|tailwind)\\.config\\.(ts|js|mjs|cjs)$",
          "^\\.dependency-cruiser\\.cjs$",
          "^scripts/",
          "\\.d\\.ts$",
        ],
      },
      to: {},
    },
  ],

  options: {
    // 워크스페이스 패키지와 npm 의존은 잎에서 멈춘다 — 그래프의 주제가 아니다.
    doNotFollow: { path: "node_modules" },

    exclude: {
      path: [
        "^\\.next/",
        "node_modules",
        "\\.(test|spec)\\.(ts|tsx)$", // 가드 테스트 141개
        "^docs/",
        "^public/",
        "^scripts/", // 빌드·운영 스크립트(.mjs) — 앱 런타임 그래프가 아니다
      ],
    },

    // `@/*` 별칭이 tsconfig 에만 있어서 이걸 안 주면 절반이 unresolvable 로 뜬다.
    tsConfig: { fileName: "./tsconfig.json" },

    // 타입 전용 import 도 센다. 컴파일 후엔 사라지지만 **구조적 결합은 실재**하고,
    // 순환도 타입 경유로 생긴다.
    tsPreCompilationDeps: true,

    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
      mainFields: ["module", "main", "types"],
    },

    reporterOptions: {
      dot: {
        // ⚠ **여기서 접지 않는다.** 접으면 `lib/db.ts → lib/telegram.ts` 같은 **폴더 안 순환이
        //   자기 화살표가 되어 그림에서 사라진다**(실측 — 접었더니 빨간 엣지 0건).
        //   전체 그래프는 286 노드로 크지만 그것이 이 파일의 용도다. 읽는 용은 `archi` 쪽.
        theme: {
          // 배경을 투명으로 두면 다크 모드 뷰어에서 검은 엣지가 안 보인다. 커밋되는 산출물이라 고정한다.
          graph: { rankdir: "LR", splines: "ortho", fontname: "Helvetica", bgcolor: "white" },
          node: { fontname: "Helvetica", fontsize: 10, shape: "box", style: "rounded,filled" },
          edge: { arrowhead: "normal", penwidth: 1 },
          modules: [
            { criteria: { source: "^app/api/" }, attributes: { fillcolor: "#dbeafe" } },
            { criteria: { source: "^app/components/" }, attributes: { fillcolor: "#fef3c7" } },
            { criteria: { source: "^app/hooks/" }, attributes: { fillcolor: "#fce7f3" } },
            { criteria: { source: "^lib/" }, attributes: { fillcolor: "#dcfce7" } },
            { criteria: { source: "^app/" }, attributes: { fillcolor: "#f1f5f9" } },
            { criteria: { coreModule: true }, attributes: { fillcolor: "#e2e8f0" } },
          ],
          dependencies: [
            { criteria: { circular: true }, attributes: { color: "#dc2626", penwidth: 2 } },
            { criteria: { "rules[0].severity": "error" }, attributes: { color: "#dc2626" } },
          ],
        },
      },
      // 폴더 단위 축약 — 모듈 그래프가 200 노드라 사람이 읽으려면 이 층이 필요하다.
      archi: {
        collapsePattern:
          "^(app/api/[^/]+|app/components|app/hooks|app/lib|app/[^/]+|lib)",
        theme: {
          graph: { rankdir: "TB", splines: "ortho", fontname: "Helvetica", bgcolor: "white" },
          node: { fontname: "Helvetica", fontsize: 11, shape: "box", style: "rounded,filled" },
          modules: [
            { criteria: { source: "^app/api/" }, attributes: { fillcolor: "#dbeafe" } },
            { criteria: { source: "^app/components" }, attributes: { fillcolor: "#fef3c7" } },
            { criteria: { source: "^lib" }, attributes: { fillcolor: "#dcfce7" } },
          ],
        },
      },
    },
  },
};
