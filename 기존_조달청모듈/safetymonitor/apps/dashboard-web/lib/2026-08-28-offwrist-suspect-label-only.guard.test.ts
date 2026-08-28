// 벗음 의심 라벨 가드 — "표시만, 판정 불변" 계약이 코드에서 지켜지는가
//
// ★ 왜 필요한가. 2026-08-28 에 `무동작` 아래 `벗음 의심` 을 붙였다. 서버가 15분 심박의 평평함으로 계산하고
//   화면은 글자로만 쓴다. 이 경계는 코드에 자연스럽게 남지 않는다 — 다음 사람이 "벗음 의심이면 경보지" 하고
//   톤·경보에 흘려 넣으면, 착용한 채 쉬는 창의 29% 가 벗음처럼 보이는 축(전수검사)이 경보 기준으로 승격된다.
//
// ★ 이 가드가 초록일 때 보장하는 것(한 문장) —
//   **벗음 의심은 서버 맵 → 화면 `무동작` 분기 안의 글자에만 닿고, 판정 함수 다섯과 경보 경로는 그 값을 모르며,
//   문턱은 전수검사 범위 안에 있다.** 보장하지 않는 것 = 문턱이 현장에서 옳은가(미탐 축 분모 7 · 방향값).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OFFWRIST_LABEL,
  OFFWRIST_MASD_MAX,
  OFFWRIST_MIN_SAMPLES,
  OFFWRIST_SD_MAX,
  OFFWRIST_WINDOWS,
  OFFWRIST_WINDOW_MS,
} from "./vital-offwrist";
import { STILL_LABEL } from "./vital-still";
import { STALE_LABEL } from "./vital-age";
import { stripComments } from "./test-support/strip-comments";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (...p: string[]) => stripComments(readFileSync(join(here, ...p), "utf8"));

const board = read("..", "app", "components", "DemoDashboard.tsx");
const signal = read("worker-signal.ts");
const store = read("..", "app", "api", "app", "vital", "store.ts");
const route = read("..", "app", "api", "app", "vital", "route.ts");

/** 인자 목록의 닫는 소괄호 — 대응으로(타입 리터럴의 중괄호에 안 속는다 · still-label 가드 #9 교훈). */
function sigEnd(src: string, at: number): number {
  let i = src.indexOf("(", at);
  let paren = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") paren++;
    else if (src[i] === ")" && --paren === 0) return i;
  }
  assert.fail("인자 목록의 끝을 못 찾았다");
}
function signatureOf(src: string, decl: string): string {
  const at = src.indexOf(decl);
  assert.notEqual(at, -1, `${decl} 를 못 찾았다 — 이름이 바뀌었으면 이 가드도 따라가야 한다`);
  return src.slice(at, sigEnd(src, at) + 1);
}
function bodyOf(src: string, decl: string): string {
  const at = src.indexOf(decl);
  assert.notEqual(at, -1, `${decl} 를 못 찾았다 — 이름이 바뀌었으면 이 가드도 따라가야 한다`);
  const open = src.indexOf("{", sigEnd(src, at));
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(open, j + 1);
  }
  assert.fail(`${decl} 본문의 끝을 못 찾았다`);
}

const LEAK = /offWrist|OFFWRIST|flatWindow|suspect/i;

// ── ① 판정은 이 값을 모른다 ─────────────────────────────────────────────────
test("★★ 판정 함수 다섯이 벗음 의심을 읽지 않는다 — 읽는 순간 신호등·집계·경보가 평평함을 판정한다", () => {
  const targets: Array<[string, string]> = [
    [board, "function workerStatus("],
    [board, "function overallStatus("],
    [board, "function signalLevel("],
    [signal, "export function effectiveTone("],
    [signal, "export function gateStaleVitals("],
  ];
  for (const [src, decl] of targets) {
    assert.doesNotMatch(bodyOf(src, decl), LEAK, `${decl} 가 벗음 의심을 읽는다`);
    assert.doesNotMatch(signatureOf(src, decl), LEAK, `${decl} 인자에 벗음 의심이 들어갔다`);
  }
});

// ── ② 라벨은 한 곳 ───────────────────────────────────────────────────────────
test("★ 라벨은 OFFWRIST_LABEL 한 곳 — 화면·서버·라우트에 리터럴 없음 · 기존 라벨과 다름", () => {
  for (const [name, src] of [["board", board], ["store", store], ["route", route]] as const) {
    assert.equal(src.split("\n").filter((l) => l.includes('"벗음 의심"')).length, 0, `${name} 에 "벗음 의심" 리터럴`);
  }
  assert.match(board, /\{suspect\.label\}/, "화면이 suspect.label 을 안 쓴다 — 라벨이 아예 안 뜬다");
  assert.notEqual(OFFWRIST_LABEL, STILL_LABEL);
  assert.notEqual(OFFWRIST_LABEL, STALE_LABEL.disconnected);
  assert.notEqual(OFFWRIST_LABEL, STALE_LABEL.hrSilent);
  assert.notEqual(OFFWRIST_LABEL, "수신 중");
});

// ── ③ 무동작 안에서만 (평평 ∧ 정지) ────────────────────────────────────────
test("★ 화면은 `무동작` 분기 안에서만 벗음 의심을 낸다 — 움직이면서 평평한 것은 착용 중 작업이다", () => {
  assert.match(board, /const suspect = still \? offWrist : undefined;/, "평평 ∧ 정지 배선이 아니다");
  const end = board.indexOf("WSTATUS_TONE[wstatus.tone]");
  assert.notEqual(end, -1, "상태 칸의 톤 클래스 참조를 못 찾았다");
  const cell = board.slice(Math.max(0, end - 2500), end);
  const staleAt = cell.lastIndexOf("{stale ? (");
  const stillAt = cell.lastIndexOf("still ? (");
  assert.ok(staleAt >= 0 && stillAt > staleAt, "상태 칸의 두 분기를 못 찾았다");
  assert.doesNotMatch(cell.slice(staleAt, stillAt), /suspect/, "끊긴 행(stale 분기)에 벗음 의심이 뜬다");
  assert.match(cell.slice(stillAt), /suspect/, "무동작 분기에 벗음 의심이 없다");
});

// ── ④ 문턱은 전수검사 범위 안 ─────────────────────────────────────────────
test("★ 문턱이 08-28 전수검사 범위 안이다 — 벗음 max SD 2.9 · 착용 p25 2.47 · 연속차 벗음 max 1.03", () => {
  assert.equal(OFFWRIST_WINDOW_MS, 300_000, "창이 전수검사(5분)와 다르면 표가 이 문턱을 뒷받침하지 않는다");
  assert.ok(OFFWRIST_SD_MAX >= 2.0 && OFFWRIST_SD_MAX <= 2.9, `SD 상한 ${OFFWRIST_SD_MAX} 가 범위 밖`);
  assert.ok(OFFWRIST_MASD_MAX <= 1.1, `연속차 상한 ${OFFWRIST_MASD_MAX} 가 착용 p50(1.25)에 닿는다`);
  assert.ok(OFFWRIST_WINDOWS >= 3, "15분 미만이면 착용-휴식 한 창(29%)이 그대로 라벨이 된다");
  assert.ok(OFFWRIST_MIN_SAMPLES >= 30, "표본 바닥이 낮으면 갤럭시(창당 ≤3)가 판정에 들어온다");
});

// ── ⑤ 서버는 경보 경로에 안 닿고, GET 이 싣는다 ───────────────────────────
test("★ 서버 맵은 경보·상태전이 경로를 안 부르고, vital GET 이 offWrist 로 싣는다", () => {
  const body = bodyOf(store, "export async function offWristSuspects(");
  assert.doesNotMatch(body, /recordAlert|notify|upsertEnvAlertState|telegram|sendAlert|alert\(/i, "벗음 의심이 경보 경로에 닿는다");
  assert.match(body, /offWristSuspect\(/, "서버가 정본 함수를 안 쓴다");
  assert.match(body, /recentHeartRates\(/, "심박 시계열을 DB 에서 안 읽는다");
  assert.match(route, /offWrist: await offWristSuspects\(aliasMap\)/, "GET 응답에 안 실린다");
});
