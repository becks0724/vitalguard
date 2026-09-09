// 구조적 재발 방지 — 죽은 상류를 향한 무한 폴링 가드.
//
// 배경 — 2026-09-07 cctv-ai 인가가 끊긴 뒤 이 폴러가 이틀 동안 1.5초마다 403 을 받으며
// 하루 55,872건을 보냈다. 아무도 몰랐던 이유는 **403 이 실패로 세이지 않았기** 때문이다.
// `if (!res.ok) return;` 이 "이번엔 값이 없다" 와 "경로가 끊겼다" 를 같은 관측으로 만들었다.
//
// 왜 가드 테스트인가 — 이 결함은 tsc·lint·기존 테스트가 전부 통과하는 상태로 2일간 존재했다.
// 재현하려면 죽은 상류와 시간이 필요하므로 계산 함수와 소스 불변식으로 고정한다.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { pollBackoffMs } from "./cctv-fall-poller";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = readFileSync(join(ROOT, "lib", "cctv-fall-poller.ts"), "utf8");
// 주석에도 `!res.ok` 설명이 있으므로 코드만 본다.
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("성공 중에는 기본 주기를 유지한다", () => {
  assert.equal(pollBackoffMs(1500, 0), 1500);
  assert.equal(pollBackoffMs(1500, -1), 1500, "음수도 성공으로 취급");
});

test("연속 실패가 쌓이면 물러선다", () => {
  const seq = [1, 2, 3, 4].map((n) => pollBackoffMs(1500, n));
  for (let i = 1; i < seq.length; i += 1) {
    assert.ok(seq[i]! > seq[i - 1]!, `실패가 늘면 간격도 늘어야 한다: ${seq.join(",")}`);
  }
});

test("상한이 있다 — 무한히 벌어지지 않는다", () => {
  const cap = pollBackoffMs(1500, 8);
  for (const n of [9, 12, 50, 1000]) {
    assert.equal(pollBackoffMs(1500, n), cap, `연속 ${n}회에서도 상한을 넘지 않아야 한다`);
  }
  // 5분이면 죽은 상류에 하루 288건 — 종전 55,872건의 1/200 이다.
  assert.ok(cap <= 5 * 60_000, `상한이 너무 길다: ${cap}ms`);
  assert.ok(cap >= 60_000, `상한이 너무 짧다 — 물러서는 의미가 없다: ${cap}ms`);
});

test("복구는 즉시다 — 한 번 성공하면 기본 주기로 돌아온다", () => {
  // 실패가 아무리 쌓였어도 failStreak 가 0 이 되는 순간 기본 주기여야 한다.
  assert.equal(pollBackoffMs(1500, 0), 1500);
});

test("2xx 가 아닌 응답을 조용히 넘기지 않는다", () => {
  // 이 한 줄이 2일간의 무증상 고장을 만들었다.
  assert.ok(
    !/if\s*\(!res\.ok\)\s*return\s*;/.test(code),
    "!res.ok 를 그냥 return 하면 403 이 실패로 세이지 않아 영원히 재시도한다",
  );
  assert.ok(
    /if\s*\(!res\.ok\)\s*throw/.test(code),
    "2xx 가 아니면 실패 경로로 보내야 물러섬과 로그가 걸린다",
  );
});

test("간격을 바꿀 수 있어야 하므로 setInterval 을 쓰지 않는다", () => {
  assert.ok(
    !/setInterval\s*\(/.test(code),
    "고정 주기 setInterval 로는 물러설 수 없고 느린 폴이 겹친다",
  );
  assert.ok(/setTimeout\s*\(/.test(code), "매 폴마다 다시 예약해야 간격을 조절할 수 있다");
});
