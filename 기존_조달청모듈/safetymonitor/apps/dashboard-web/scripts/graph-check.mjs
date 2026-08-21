// 의존성 그래프 게이트 — CI 가 판정하는 **두 가지만** 본다 (2026-08-21 사용자 지시).
//
//   ① 순환 의존 개수가 기준선을 넘으면 실패
//   ② 경계 규칙(BOUNDARY_RULES) 위반이 하나라도 있으면 실패
//
// ★ "그래프가 바뀌면 실패" 로 만들지 않는다. 리팩터링마다 빨간불이 뜨면 사람이 곧 무시하게 되고,
//   그러면 게이트가 있으나 마나가 된다. 구조 변화 자체는 신호가 아니다.
//
// ⚠ 여기에 `not-to-unresolvable` 을 넣지 않은 것은 빠뜨린 것이 아니다 —
//   TS 의 깨진 import 는 `tsc --noEmit` 이 이미 잡으므로 게이트가 둘이 되면 같은 것을 두 번 센다.
//
// ⚠ 기준선을 올리는 것은 **눈에 보이는 행위**여야 한다. 그래서 파일 밖 상태가 아니라 이 상수다 —
//   올리려면 커밋에 남고 리뷰에 걸린다.
//
// 사용.  pnpm graph:check
import { execFileSync } from "node:child_process";

/** 현재 존재를 인정한 순환 개수. 줄이는 방향으로만 고친다.
 *  2 → 1 (2026-08-22) — LoginGate ↔ SessionKeeper 를 ./session-token 분리로 끊었다.
 *  남은 1건 = lib/db.ts ↔ lib/telegram.ts (한쪽이 type-only 라 런타임 순환은 아니다). */
const CIRCULAR_BASELINE = 1;

/** 위반이 하나라도 있으면 실패하는 경계 규칙. 규칙이 정해질 때마다 여기 추가한다. */
const BOUNDARY_RULES = ["api-not-to-components"];

let raw;
try {
  // depcruise 는 위반이 있으면 종료코드가 0 이 아니다 — 여기서는 그것이 정상이라 무시하고
  // 결과 JSON 만 읽는다. 판정은 아래에서 우리가 한다.
  raw = execFileSync(
    "npx",
    ["--no-install", "depcruise", "app", "lib", "--output-type", "json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
  );
} catch (error) {
  raw = error.stdout;
  // ⚠ 빈 출력을 "위반 없음" 으로 읽으면 안 된다 — 그건 depcruise 가 죽은 것이다.
  if (!raw || !raw.trim()) {
    console.error("depcruise 가 결과를 내지 못했다 — 설정 오류이거나 실행 실패다.");
    console.error(String(error.stderr ?? error.message).slice(0, 800));
    process.exit(2);
  }
}

const result = JSON.parse(raw);
const violations = result.summary.violations ?? [];

const circular = violations.filter((v) => v.rule.name === "no-circular");
const boundary = violations.filter((v) => BOUNDARY_RULES.includes(v.rule.name));
const other = violations.filter(
  (v) => v.rule.name !== "no-circular" && !BOUNDARY_RULES.includes(v.rule.name),
);

console.log(`모듈 ${result.summary.totalCruised} · 의존 ${result.summary.totalDependenciesCruised}`);
console.log(`순환 ${circular.length} (기준선 ${CIRCULAR_BASELINE}) · 경계 위반 ${boundary.length} · 기타 ${other.length}`);

let failed = false;

if (circular.length > CIRCULAR_BASELINE) {
  failed = true;
  console.error(`\n✗ 순환 의존이 기준선을 넘었다 — ${CIRCULAR_BASELINE} → ${circular.length}`);
  for (const v of circular) {
    console.error(`    ${v.from} → ${(v.cycle ?? []).map((c) => c.name ?? c).join(" → ")}`);
  }
} else if (circular.length < CIRCULAR_BASELINE) {
  // 줄었으면 통과시키되 눈에 띄게 남긴다 — 기준선을 안 내리면 다음 회귀를 못 잡는다.
  console.log(`\n△ 순환이 ${CIRCULAR_BASELINE} → ${circular.length} 로 줄었다. CIRCULAR_BASELINE 을 내려라.`);
}

if (boundary.length > 0) {
  failed = true;
  console.error(`\n✗ 경계 규칙 위반 ${boundary.length}건`);
  for (const v of boundary) console.error(`    [${v.rule.name}] ${v.from} → ${v.to}`);
}

// 기타(고아 경고 등)는 **판정하지 않는다.** 보이기만 한다 — 게이트를 늘리면 무시가 시작된다.
if (other.length > 0) {
  console.log(`\n· 판정 대상 아님 ${other.length}건: ${[...new Set(other.map((v) => v.rule.name))].join(", ")}`);
}

process.exit(failed ? 1 : 0);
