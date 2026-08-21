// Graphviz DOT 을 SVG 로 렌더한다 — 시스템 `dot` 을 쓴다.
//
// ★ 왜 시스템 설치인가 (2026-08-21 결정 · 처음엔 wasm 이었고 실측 후 뒤집었다).
//   `@hpcc-js/wasm` 을 devDependency 로 두면 **배포 빌드가 그걸 매번 내려받는다** —
//   Dockerfile 이 `pnpm install --frozen-lockfile` 을 `--prod` 없이 돌리고
//   Cloud Build 에는 스토어 캐시가 없다(빌드 로그 `reused 0`).
//   그 패키지는 36MB 인데 그중 29MB 가 duckdb 이고 우리가 쓰는 graphviz 는 800KB 다.
//   ⟹ 그림 한 장 때문에 모든 배포에 36MB 를 영구히 얹는 교환이라 물렀다.
//   개발자 한 명이 `brew install graphviz` 를 한 번 하는 쪽이 싸다.
//
// ⚠ CI 는 이 스크립트를 안 쓴다 — 게이트(`pnpm graph:check`)는 JSON 만 읽으므로
//   graphviz 없이 돈다. 여기서 죽어도 CI 는 영향받지 않는다.
//
// 사용.  depcruise ... --output-type dot | node scripts/render-dot-svg.mjs - <출력.svg>
//        node scripts/render-dot-svg.mjs <입력.dot> <출력.svg>
//
// ⚠ 표준입력(`-`)을 쓰는 이유 = 임시 `.dot` 파일을 만들면 **실패했을 때 남는다**
//   (`a && b && rm` 체인은 b 가 죽으면 rm 이 안 돈다 · 실측으로 112KB 가 남았다).
//   파이프면 정리할 것이 없다.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("사용: node scripts/render-dot-svg.mjs <입력.dot|-> <출력.svg>");
  process.exit(2);
}

const dot = readFileSync(input === "-" ? 0 : input, "utf8");
// ⚠ 빈 입력을 그냥 렌더하면 빈 SVG 가 조용히 나온다 — "그래프가 없다" 와 구별되지 않는다.
if (!dot.trim()) {
  console.error(`입력이 비었다: ${input} — depcruise 가 실패했을 수 있다.`);
  process.exit(1);
}

let svg;
try {
  svg = execFileSync("dot", ["-T", "svg"], {
    input: dot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (error) {
  if (error.code === "ENOENT") {
    console.error("graphviz(`dot`)가 없다. 그림을 만들려면 설치가 필요하다:");
    console.error("    brew install graphviz          (macOS)");
    console.error("    apt-get install -y graphviz    (Debian/Ubuntu)");
    console.error("");
    console.error("⚠ 순환 검사·CI 게이트는 graphviz 없이 돈다 — `pnpm graph:cycles` · `pnpm graph:check`.");
    process.exit(127);
  }
  throw error;
}

// ⚠ `dot` 이 빈 출력을 내고도 0 으로 끝나는 경우가 있다. 파일을 쓰기 전에 확인한다 —
//   빈 SVG 를 써 두면 다음 사람이 "그래프가 비었다" 로 읽는다.
if (!svg.includes("<svg")) {
  console.error("dot 이 SVG 를 내지 않았다 — 입력 DOT 을 확인하라.");
  process.exit(1);
}

writeFileSync(output, svg, "utf8");
const nodes = (svg.match(/class="node"/g) ?? []).length;
const edges = (svg.match(/class="edge"/g) ?? []).length;
console.log(`${output} — 노드 ${nodes} · 엣지 ${edges} · ${(svg.length / 1024).toFixed(1)}KB`);
