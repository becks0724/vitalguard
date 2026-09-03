// 무동작 라벨 가드 — "라벨만 붙인다" 는 계약이 코드에서 지켜지는가
//
// ★ 왜 필요한가. 2026-08-28 에 상태 칸 `수신 중` 자리에 `무동작 N분` 을 붙였다. 워치의 정지
//   지속(motionStillSec)이 5분을 넘으면 그것을 **글자로만** 드러낸다. 판정·톤·게이트·집계는
//   이 값을 모른다. 이 경계는 코드에 자연스럽게 남지 않는다 — 다음 사람이 "정지가 5분이면
//   위험이지" 하고 톤에 흘려 넣으면 신호등·집계·경보가 함께 바뀌는데, 착용 판별이 없는 상태에서
//   그 판정은 오탐이 압도적이라(선행 트랙 §4 · Choi 2011) 첫날 경보 피로로 꺼진다.
//
// ★ 이 가드가 초록일 때 보장하는 것(한 문장) —
//   **무동작은 상태 칸의 글자에만 닿고, 판정 함수 넷과 톤·게이트는 정지값을 모르며,
//   stale 과 주의·위험이 그 글자보다 먼저이고, 문턱은 착용 중 정지 실측보다 위다.**
//   보장하지 않는 것 = 5분이 관제자에게 옳은 문턱인가. 그것은 운용에서 본다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { STILL_LABEL, STILL_LABEL_MS, stillLabel } from "./vital-still";
import { STALE_LABEL } from "./vital-age";
// 주석 제거는 정본 헬퍼로만 — 순진한 정규식은 URL 의 `//` 를 먹어 거짓 초록을 만든다([[L-119]]).
import { stripComments } from "./test-support/strip-comments";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (...p: string[]) => stripComments(readFileSync(join(here, ...p), "utf8"));

const board = read("..", "app", "components", "DemoDashboard.tsx");
const signal = read("worker-signal.ts");

/** 인자 목록의 닫는 소괄호 위치 — 대응으로 찾는다(타입 리터럴의 중괄호에 안 속는다). */
function sigEnd(src: string, at: number): number {
  let i = src.indexOf("(", at);
  let paren = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") paren++;
    else if (src[i] === ")" && --paren === 0) return i;
  }
  assert.fail("인자 목록의 끝을 못 찾았다");
}

/** 시그니처(선언부 ~ 인자 목록 끝). */
function signatureOf(src: string, decl: string): string {
  const at = src.indexOf(decl);
  assert.notEqual(at, -1, `${decl} 를 못 찾았다 — 이름이 바뀌었으면 이 가드도 따라가야 한다`);
  return src.slice(at, sigEnd(src, at) + 1);
}

/** 함수 본문 — 괄호 대응으로 끝을 찾는다(다중 줄 시그니처 안전 · stale-kind 가드와 같은 이유). */
function bodyOf(src: string, decl: string): string {
  const at = src.indexOf(decl);
  assert.notEqual(at, -1, `${decl} 를 못 찾았다 — 이름이 바뀌었으면 이 가드도 따라가야 한다`);
  const i = sigEnd(src, at);
  const open = src.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(open, j + 1);
  }
  assert.fail(`${decl} 본문의 끝을 못 찾았다`);
}

// ── ① 판정은 정지값을 모른다 ─────────────────────────────────────────────────
// 착용 판별 없이 정지를 판정에 넣으면 오탐이 압도적이다. 넷 중 하나라도 읽으면 빨간불.
test("★★ 판정 함수 넷이 motionStillSec 을 읽지 않는다 — 읽는 순간 신호등·집계·경보가 정지를 판정한다", () => {
  const targets: Array<[string, string]> = [
    // workerStatus·overallStatus 는 2026-09-03 에 worker-signal 로 옮겼다(관리자 앱이 같은
    // 판정을 써야 해서다). 가드는 **함수를 따라간다** — 파일이 바뀌었을 뿐 지키는 성질은 같다.
    [signal, "export function workerStatus("],
    [signal, "export function overallStatus("],
    [signal, "export function effectiveTone("],
    [signal, "export function gateStaleVitals("],
  ];
  for (const [src, decl] of targets) {
    const body = bodyOf(src, decl);
    assert.doesNotMatch(body, /motionStillSec|stillLabel|STILL_LABEL/, `${decl} 가 정지값을 읽는다`);
  }
  // 시그니처까지 — 인자로 넘겨도 같은 결과다.
  // ⚠ 첫 `{` 까지 자르면 안 된다 — `opts: { stale?: … }` 의 중괄호에서 잘려 변이 지점을 안 읽는다
  //   (변이 시험 첫 회차에서 실제로 뚫렸다 · [[L-104]]). 소괄호 대응으로 인자 목록 끝까지 본다.
  assert.doesNotMatch(signatureOf(signal, "export function effectiveTone("), /still/i, "effectiveTone 인자에 정지가 들어갔다 — 톤이 정지를 타게 된다");
  assert.doesNotMatch(signatureOf(signal, "export function gateStaleVitals("), /still/i, "gateStaleVitals 인자에 정지가 들어갔다");
});

// ── ② 라벨은 한 곳 ───────────────────────────────────────────────────────────
test("★ 라벨은 STILL_LABEL 한 곳에서만 나오고, 기존 라벨과 실제로 다르다", () => {
  const lits = board.split("\n").filter((l) => l.includes('"무동작"'));
  assert.equal(lits.length, 0, `화면에 "무동작" 리터럴 ${lits.length}곳 — 정본과 조용히 갈린다`);
  assert.match(board, /stillLabel\(/, "화면이 stillLabel 을 안 부른다 — 라벨이 아예 안 뜬다");
  // 값 대조 — 리터럴 부재만 보면 "두 라벨을 같은 글자로" 변이가 뚫린다(stale-kind 가드가 밟은 자리).
  assert.notEqual(STILL_LABEL, "수신 중");
  assert.notEqual(STILL_LABEL, STALE_LABEL.disconnected);
  assert.notEqual(STILL_LABEL, STALE_LABEL.hrSilent);
});

// ── ③ stale 이 먼저 ──────────────────────────────────────────────────────────
test("★ 상태 칸에서 stale 분기가 무동작보다 먼저다 — 끊긴 행의 정지값은 지금을 말하지 않는다", () => {
  // ⚠ 앵커를 주석(`{/* 10 상태 */}`)에 걸지 않는다 — stripComments 가 지운다(첫 실행에서 밟았다).
  //   상태 칸에서만 쓰는 코드 `WSTATUS_TONE[wstatus.tone]` 을 끝점으로 잡고 그 앞을 본다.
  const end = board.indexOf("WSTATUS_TONE[wstatus.tone]");
  assert.notEqual(end, -1, "상태 칸의 톤 클래스 참조를 못 찾았다 — 가드를 다시 맞춰야 한다");
  const cell = board.slice(Math.max(0, end - 1500), end);
  const staleAt = cell.lastIndexOf("{stale ? (");
  const stillAt = cell.lastIndexOf("still ? (");
  assert.ok(staleAt >= 0 && stillAt >= 0, "상태 칸의 두 분기를 못 찾았다");
  assert.ok(staleAt < stillAt, "무동작 분기가 stale 분기보다 앞에 있다 — 끊긴 행에 무동작이 뜬다");
  // 함수 자체도 stale 에 undefined 를 낸다 — 화면 순서와 함수 둘 다 막는다.
  assert.equal(stillLabel({ motionStillSec: 9_999 }, true, "normal"), undefined);
});

// ── ④ 문턱 ───────────────────────────────────────────────────────────────────
test("★ 문턱이 착용 중 의도적 정지 실측(137.5초)보다 위다 — 아래면 앉아만 있어도 뜬다", () => {
  // 2026-08-28 실측 — 착용한 채 팔을 책상에 얹고 가만히: still 137.5초까지 단조 증가.
  // 08-18 실측 — 착용 정지 82.4초. 그보다 넉넉히 위여야 "평소 앉아 있음" 이 라벨을 안 단다.
  assert.ok(STILL_LABEL_MS > 137_500 * 1.5, `문턱 ${STILL_LABEL_MS}ms 가 착용 정지 실측에 너무 가깝다`);
  assert.ok(STILL_LABEL_MS <= 600_000, "absence-check(10분)보다 늦게 뜨면 부재 경보가 라벨보다 먼저 온다");
});

// ── ⑤ 주의·위험을 덮지 않는다 ────────────────────────────────────────────────
test("★ 주의·위험·대기 라벨을 무동작이 덮지 않는다 — 그 라벨이 더 많은 정보다", () => {
  for (const tone of ["caution", "danger", "idle"]) {
    assert.equal(stillLabel({ motionStillSec: 9_999 }, false, tone), undefined, `${tone} 에 라벨이 나왔다`);
  }
  assert.ok(stillLabel({ motionStillSec: 9_999 }, false, "normal"), "normal 에는 나와야 한다 — 통제군");
  // 화면도 톤을 넘긴다 — 함수가 옳아도 화면이 "normal" 을 고정으로 넘기면 같은 결함이다.
  assert.match(board, /stillLabel\(sample \?\? \{\}, stale, wstatus\.tone\)/, "화면이 실제 톤·stale 을 안 넘긴다");
});
