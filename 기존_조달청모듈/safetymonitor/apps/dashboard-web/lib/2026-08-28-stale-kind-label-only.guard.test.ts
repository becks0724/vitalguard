// 끊김 종류 분리 가드 — "라벨만 가른다" 는 계약이 코드에서 지켜지는가
//
// ★ 왜 필요한가. 2026-08-28 에 "연결끊김" 을 둘로 갈랐다(샘플이 안 옴 vs 심박만 묵음).
//   가른 것은 **관제자가 읽는 글자뿐**이고 판정·값 게이트·톤 강등·집계는 종전 boolean 하나로
//   그대로 간다. 이 경계는 코드에 자연스럽게 남지 않는다 — 다음 사람이 "이왕 종류를 아니까"
//   하고 판정이나 게이트에 흘려 넣으면 안전 동작 다섯 곳이 함께 흔들리는데 시험은 안 빨개진다.
//
// ★ 이 가드가 초록일 때 보장하는 것(한 문장) —
//   **끊김 종류는 표시 라벨에만 닿고, stale 판정과 그 뒤의 안전 동작은 종류를 모른다.**
//   보장하지 않는 것 = 라벨 문구가 관제자에게 옳은가. 그것은 사람이 화면에서 본다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 주석 제거는 정본 헬퍼로만 — 순진한 정규식은 URL 의 `//` 를 먹어 거짓 초록을 만든다([[L-119]]).
import { stripComments } from "./test-support/strip-comments";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (...p: string[]) => stripComments(readFileSync(join(here, ...p), "utf8"));

const age = read("vital-age.ts");
const board = read("..", "app", "components", "DemoDashboard.tsx");

/**
 * 함수 본문 — 괄호 대응으로 끝을 찾는다.
 *
 * ⚠ `indexOf("\n}")` 로 자르면 **다중 줄 시그니처에서 깨진다** — `function F({\n a,\n}: {\n b,\n}) {`
 *   의 `}: {` 가 먼저 걸려 본문을 한 글자도 못 읽는다(이 가드를 쓰다 실제로 밟았다).
 *   금지형 단언에서는 그것이 **거짓 초록**이 되므로 헬퍼 쪽을 견고하게 만든다([[L-119]]③ 계열).
 */
function bodyOf(src: string, decl: string): string {
  const at = src.indexOf(decl);
  assert.notEqual(at, -1, `${decl} 를 못 찾았다 — 이름이 바뀌었으면 이 가드도 따라가야 한다`);
  // ① 시그니처의 소괄호를 대응으로 지난다(인자에 구조분해·타입 리터럴이 있어도 안전).
  let i = src.indexOf("(", at);
  assert.notEqual(i, -1, `${decl} 의 인자 목록을 못 찾았다`);
  let paren = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") paren += 1;
    else if (ch === ")") {
      paren -= 1;
      if (paren === 0) break;
    }
  }
  assert.equal(paren, 0, `${decl} 의 인자 괄호가 안 닫힌다`);

  // ② 그 뒤 첫 `{` 가 본문의 시작. 거기서 중괄호 깊이를 세어 대응 지점까지 자른다.
  const open = src.indexOf("{", i);
  assert.notEqual(open, -1, `${decl} 의 본문 시작을 못 찾았다`);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    const ch = src[j];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const body = src.slice(open, j + 1);
        // 추출이 비면 아래 금지형 단언이 전부 거짓 초록이 된다 — 그 자리에서 막는다.
        assert.ok(body.length > 2, `${decl} 본문 추출이 비었다(${body.length}자)`);
        return body;
      }
    }
  }
  assert.fail(`${decl} 의 본문 끝을 못 찾았다 — 중괄호가 안 닫힌다`);
}

test("★ stale 판정이 종류를 타지 않는다 — 판정이 갈리면 안전 동작이 함께 흔들린다", () => {
  const body = bodyOf(board, "function isStale");
  assert.ok(
    !body.includes("staleKind"),
    "isStale 이 끊김 종류를 본다 — 라벨만 가르기로 한 계약이 깨졌다. " +
      "판정이 갈리면 gateStaleVitals·effectiveTone·지도 고스트·신호등·이상 집계가 함께 움직인다.",
  );
  assert.ok(
    body.includes("vitalAgeMs(") && body.includes("staleThresholdMs("),
    "판정은 '심박 나이 vs 출처별 문턱' 하나여야 한다 — 이 둘이 빠지면 기준이 바뀐 것이다",
  );
});

test("★ staleKind 는 행 나이로 가른다 — 심박 나이로 재면 종류가 하나로 붙는다", () => {
  const body = bodyOf(age, "export function staleKind");
  assert.ok(
    body.includes("sample.ts"),
    "행 ts 를 안 보면 '샘플이 도착하고 있는가' 를 물을 수 없다 — 그것이 두 상태를 가르는 유일한 축이다",
  );
  assert.ok(
    !body.includes("vitalAgeMs"),
    "심박 나이로 재면 stale 인 이상 늘 문턱 초과라 **항상 disconnected** 가 되어 가른 의미가 사라진다",
  );
  assert.ok(
    body.includes("staleThresholdMs("),
    "문턱은 출처별 정본을 써야 한다 — 여기에 숫자를 박으면 갤럭시 주기 변경이 이 함수만 비켜간다",
  );
});

test("★ 값 게이트와 톤 강등에 종류가 새어 들어가지 않는다 — 표시가 아니라 동작이 바뀐다", () => {
  for (const call of ["gateStaleVitals(", "effectiveTone("]) {
    const hits = [...board.matchAll(new RegExp(call.replace("(", "\\("), "g"))];
    assert.ok(hits.length > 0, `${call} 호출이 사라졌다 — 안전 동작 지점이 옮겨졌다`);
    for (const hit of hits) {
      const at = hit.index ?? 0;
      const args = board.slice(at, board.indexOf(")", at));
      assert.ok(
        !args.includes("kind") && !args.includes("staleLabel"),
        `${call} 에 끊김 종류가 넘어간다 — 라벨만 가르기로 한 계약이 깨졌다(인자: ${args})`,
      );
    }
  }
});

test("★ 라벨은 STALE_LABEL 한 곳에서만 나온다 — 리터럴이 재등장하면 두 문구가 조용히 갈린다", () => {
  for (const lit of ['"연결끊김"', '"심박끊김"']) {
    assert.ok(
      !board.includes(lit),
      `DemoDashboard 본문에 ${lit} 리터럴이 있다 — STALE_LABEL 을 거칠 것. ` +
        "리터럴을 두면 문구를 고칠 때 한쪽만 바뀌어 같은 상태가 두 이름으로 불린다.",
    );
  }
  assert.ok(board.includes("STALE_LABEL"), "화면이 라벨 정본을 안 쓴다");

  // ★ 정본의 **값**까지 본다. 리터럴 부재만 검사하면 두 라벨을 같은 글자로 바꿔도 초록이라
  //   (변이 실측으로 확인) 트랙 전체가 무의미해진 것을 아무도 못 잡는다 — [[L-104]] 형 약한 단언.
  const block = /STALE_LABEL[^=]*=\s*\{([^}]*)\}/.exec(age)?.[1];
  assert.ok(block, "STALE_LABEL 정의 블록을 못 읽었다 — 형태가 바뀌었으면 이 가드도 따라가야 한다");
  const disconnected = /disconnected:\s*"([^"]+)"/.exec(block)?.[1];
  const hrSilent = /hrSilent:\s*"([^"]+)"/.exec(block)?.[1];
  assert.ok(disconnected && hrSilent, `라벨 두 값을 못 읽었다(블록: ${block})`);
  assert.notEqual(
    disconnected,
    hrSilent,
    "두 상태가 같은 글자로 표시된다 — 가른 의미가 사라져 화면이 종전과 똑같아진다",
  );
});

test("★ 신호등의 색·점멸은 종류를 안 탄다 — 글자만 다르다", () => {
  const body = bodyOf(board, "function TrafficLight");
  const clsAt = body.indexOf("const cls =");
  assert.notEqual(clsAt, -1, "신호등 색 결정부(const cls)를 못 찾았다");
  const clsLine = body.slice(clsAt, body.indexOf("\n", clsAt));
  assert.ok(
    !clsLine.includes("staleLabel") && !clsLine.includes("kind"),
    "신호등 색이 끊김 종류를 탄다 — 두 상태 모두 '지금 감시되지 않는다' 는 같은 무게이므로 " +
      "색으로 경중을 나누면 관제자가 한쪽을 가볍게 읽는다",
  );
});
