// 배포 승인 시점 고정 가드 — 배포되는 트리가 "스크립트가 시작한 시각" 이 아니라 "사용자가 승인한 시각" 인가.
//
// 무엇이 남아 있었나. [[L-116]]⑥ 의 처방은 창이 **둘**인데 2026-08-26 에는 하나만 닫혔다.
//   창 B  39행에서 $SHA 를 뜬 뒤 → 아카이브까지     닫힘(2026-08-26-deploy-archive-pinned 가드)
//   창 A  사용자가 `/deploy` 라고 말한 뒤 → 39행    ★ 열려 있었다 (이 가드)
// 창 A 에서는 옆 세션의 커밋이 승인 없이 같은 이미지로 나간다. 이 레포는 세션 셋이 한 워킹트리에
// 붙어 있어 실현 가능한 창이고, [[L-122]] 가 "적혔을 뿐 구현되지 않은 룰" 로 지목한 항목이다.
//
// 왜 검증으로 못 막나. tsc·lint·test 3종은 전부 통과한 채 화면이 깨질 수 있다 — **타입검사는
// 색을 안 본다**([[L-116]]④). 3종이 답하는 질문은 "깨진 코드인가" 이지 "보여도 되는 화면인가" 가 아니다.
//
// ★ 이 가드의 한 문장 보장.
//   "배포되는 트리·검증되는 트리·라벨이 **승인 시점 커밋 하나**에서 나온다 — 그리고 그 커밋이
//    현재 히스토리에 속한다는 것이 검사된다."
//
// ⚠ 기대값은 새 코드에서 복사해 오지 않았다([[L-123]]①). 넷 다 계약에서 온 것이다 —
//   ① 승인 값을 실제로 읽는가(문서가 아니라 코드가 · [[L-122]]② 의 코드판)
//   ② 그 값이 히스토리에 속하는가(아니면 임의 커밋 배포 도구가 된다)
//   ③ 검증 트리가 배포 트리를 따라가는가(2026-08-01 ALLOW_DIRTY 구멍과 같은 모양)
//   ④ 안 실리는 것이 눈에 보이는가(고정의 값어치가 여기서만 드러난다)
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)); // apps/dashboard-web
const sh = readFileSync(join(ROOT, "..", "..", "scripts", "deploy-dashboard.sh"), "utf8");

/** 주석을 걷은 실코드 — 근거 서술이 단언을 오염시키지 않게(옛 가드와 같은 처리). */
const code = sh
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

/** 배포 대상을 정하는 구간 — 0/5 의 HEAD_SHA 캡처부터 origin 동기 검사 직전까지. */
function targetRegion(): string {
  const i = code.indexOf("HEAD_SHA=$(git rev-parse HEAD)");
  const j = code.indexOf("BEHIND=");
  assert.ok(i >= 0 && j > i, "배포 대상 결정 구간을 못 찾았다 — 가드 재작성 필요");
  return code.slice(i, j);
}

test("① ★ 배포 대상이 승인 값에서 나온다 — 문서가 아니라 코드가 읽는다", () => {
  // 처방이 문서에만 있고 스크립트가 그 변수를 모르면 넘겨도 조용히 무시된다([[L-122]]② —
  // 성공과 무시가 같은 관측(에러 0)을 내므로 "에러가 안 났다"는 판별력이 0이다).
  const region = targetRegion();
  assert.match(
    region,
    /APPROVED_AT/,
    "배포 대상 결정부가 APPROVED_AT 을 안 읽는다 — 넘겨도 조용히 무시된다",
  );
  assert.match(
    region,
    /SHA=\$HEAD_SHA/,
    "APPROVED_AT 이 없을 때의 기본값(= HEAD)이 사라졌다 — 옵트인이 아니게 된다",
  );
});

test("② ★ 승인 값을 검증 없이 쓰지 않는다 — 오타는 멈춰야 한다", () => {
  const region = targetRegion();
  assert.match(
    region,
    /rev-parse --verify/,
    "APPROVED_AT 을 해석 검사 없이 쓴다 — 커밋이 아닌 값이 조용히 통과한다",
  );
});

test("③ ★ 승인 커밋이 현재 히스토리에 속하는지 검사하고, 아니면 멈춘다", () => {
  // 이 검사가 없으면 APPROVED_AT 은 안전장치가 아니라 **임의 커밋 배포 도구**가 된다.
  const lines = code.split("\n");
  const i = lines.findIndex((l) => /merge-base --is-ancestor "\$SHA" "\$HEAD_SHA"/.test(l));
  assert.ok(i >= 0, "승인 커밋의 조상 검사가 없다 — 히스토리 밖 커밋이 배포될 수 있다");
  // 경고로 낮추면 검사가 아니다 — 배포는 그대로 진행된다.
  assert.match(
    lines[i + 1] ?? "",
    /\bdie\b/,
    "조상 검사가 실패해도 안 멈춘다(die 가 아니다) — 경고는 배포를 막지 못한다",
  );
});

test("④ ★ 고정하면 검증 트리도 함께 옮긴다 — 워킹트리는 배포될 트리가 아니다", () => {
  // 2026-08-01 ALLOW_DIRTY 가 만들었던 구멍과 완전히 같은 모양이다. 갈라지는 길이 둘로 늘었으므로
  // 분기도 둘을 다 봐야 한다. dirty 만 보면 고정 시 워킹트리(= HEAD)를 검증하고 다른 것을 배포한다.
  const gate = code.split("\n").find((l) => l.includes("VERIFY_IN_ARCHIVE=1"));
  assert.ok(gate, "검증 트리 선택 변수가 사라졌다");
  assert.match(gate, /\$DIRTY/, "검증 트리 선택이 dirty 를 안 본다");
  assert.match(gate, /\$PINNED/, "검증 트리 선택이 고정을 안 본다 — 검증한 것 ≠ 배포한 것");

  // ⚠ 창을 **검증 루트를 고르는 그 분기 한 줄**로 좁힌다. 처음엔 2/5 구간 전체에 대고
  //   `if [ -n "$DIRTY" ]` 부재를 단언했는데 위 정의 줄이 그 안에 들어와 빨간불이 났다 —
  //   부순 것이 아니라 창이 넓어서였다([[L-123]]③ · 옛 가드 ④ 가 겪은 것과 같은 모양).
  const iFrom = code.indexOf('say "2/5');
  const iTo = code.indexOf('say "3/5');
  assert.ok(iFrom >= 0 && iTo > iFrom, "선검증 구간을 못 찾았다 — 가드 재작성 필요");
  const vlines = code.slice(iFrom, iTo).split("\n");
  const iVroot = vlines.findIndex((l) => l.includes('VROOT="$TMP"'));
  assert.ok(iVroot > 0, "아카이브 검증 경로(VROOT=$TMP)를 못 찾았다 — 가드 재작성 필요");
  const branch = vlines.slice(0, iVroot).reverse().find((l) => /^\s*if \[/.test(l)) ?? "";
  assert.match(
    branch,
    /VERIFY_IN_ARCHIVE/,
    `검증 루트 분기가 통합 조건을 안 쓴다 — ${branch.trim()}`,
  );
  assert.doesNotMatch(
    branch,
    /\$DIRTY/,
    `검증 루트 분기가 dirty 를 직접 본다 — 고정 시 배포되지 않을 트리를 검증한다 — ${branch.trim()}`,
  );
});

test("⑤ 안 실리는 것을 출력한다 — 고정의 값어치는 여기서만 보인다", () => {
  const block = code.match(/if \[ -n "\$PINNED" \]; then[\s\S]*?\nfi/)?.[0] ?? "";
  assert.ok(block, "제외 범위 출력 블록이 없다");
  assert.match(
    block,
    /rev-list --count "\$\{SHA\}\.\.\$\{HEAD_SHA\}"/,
    "제외 커밋 수를 안 센다",
  );
  assert.match(block, /git log/, "제외 커밋 목록을 안 보여준다 — 숫자만으로는 판단 재료가 아니다");
});

test("⑥ 근거가 코드에 남아 있다 — 다음 사람이 HEAD 로 되돌리지 않게", () => {
  // 이유 없이 분기만 있으면 "HEAD 가 더 단순하다" 며 되돌아간다. 옛 가드 ④ 와 같은 이유다.
  const iFrom = sh.indexOf("HEAD_SHA=$(git rev-parse HEAD)");
  const iTo = sh.indexOf('if [ -n "${APPROVED_AT:-}" ]');
  assert.ok(iFrom >= 0 && iTo > iFrom, "근거 주석 구간을 못 찾았다 — 가드 재작성 필요");
  const block = sh.slice(iFrom, iTo);

  assert.match(block, /L-116/, "L-116⑥ 참조가 사라졌다");
  // 이 파일에서 유일한 문구로 앵커한다 — 창이 새도 오검출되지 않게(옛 가드 ④ 의 실측 교훈).
  assert.match(
    block,
    /승인한 시각과 스크립트가/,
    "무엇과 무엇 사이의 창인지(승인 시각 ↔ 시작 시각) 서술이 사라졌다",
  );
});
