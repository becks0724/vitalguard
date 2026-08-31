// 끊김 중 "마지막 값 회색 유지" 가드(2026-08-31 · 사용자 목표 "끊김 없는 연속 표시")
//
// ★ 왜. 연결끊김이면 심박·SpO₂·손목온도 칸이 `--` 로 비어 화면이 끊겨 보였다. 값을 남기되 **회색 + "끊김 전 값 · 나이"**
//   로만 남긴다 — 2026-08-15 가드(옛 값이 정상색으로 현재값처럼 보이던 false-OK 차단)의 취지는 그대로다.
// ★ 되돌아가는 방식 = gateStaleVitals 가 값을 비우지 않게 바뀌거나(판정·PSI·신호등이 옛 값을 먹는다),
//   유지 분기에 판정색(STATUS_CLASS)이 걸리거나, 상한(30분) 없이 밤새 묵은 값이 남거나.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { gateStaleVitals } from "../lib/worker-signal";

const ROOT = join(__dirname, "..");
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const board = codeOnly(readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8"));

test("① 판정 입력은 불변 — 끊김이면 gateStaleVitals 는 여전히 3종을 비운다", () => {
  assert.deepEqual(gateStaleVitals({ heartRate: 82, spo2: 92, skinTempC: 35.8 }, true), {
    heartRate: undefined,
    spo2: undefined,
    skinTempC: undefined,
  });
});

test("② 유지 분기는 stale + 상한 안에서만 만들어지고, PSI 는 여전히 shown 을 먹는다", () => {
  assert.match(board, /stale && !offBody && sample !== undefined && Number\.isFinite\(heldAgeMs\) && heldAgeMs <= HELD_VALUE_MAX_MS/, "유지 조건(stale·상한)이 풀렸다");
  assert.match(board, /const HELD_VALUE_MAX_MS = 30 \* 60 \* 1000;/, "상한 상수가 사라지거나 값이 바뀌었다");
  assert.match(board, /heartRate: shown\.heartRate,/, "PSI 가 유지값을 먹는다 — 판정 경로 오염");
});

test("③ 유지 분기에는 판정색이 없다 — 회색(text-muted)만", () => {
  for (const key of ["heartRate", "spo2", "skinTempC"]) {
    const start = board.indexOf(`held && typeof held.s.${key} === "number"`);
    assert.ok(start > 0, `${key} 유지 분기가 없다`);
    const seg = board.slice(start, start + 700);
    const branch = seg.slice(0, seg.indexOf(key === "spo2" ? "const gatedOut" : ") : ("));
    assert.doesNotMatch(branch, /STATUS_CLASS/, `${key} 유지값에 판정색이 걸렸다 — 옛 값이 정상/위험색으로 위장`);
    assert.match(branch, /text-muted/, `${key} 유지값이 회색이 아니다`);
    assert.match(branch, /끊김 전 값|held\.ageLabel/, `${key} 유지값에 나이 라벨이 없다`);
  }
});
