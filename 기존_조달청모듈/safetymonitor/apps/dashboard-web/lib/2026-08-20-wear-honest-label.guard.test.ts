// 착용 정직화 가드 — 화면이 미착용 구간에 `정상` 을 단언하지 않게 못 박는다.
//
// 배경. 상시 `HKWorkoutSession` 이 watchOS 손목 감지를 우회해 **워치를 벗어도 그럴듯한 심박이
// 계속 온다**(2026-08-13 실측 — 책상 5분 반 평균 108.4bpm vs 착용 108.1, 구별 불가).
// 대리 신호로 가르는 길도 닫혔다 — 모션 변동폭 `mv` 는 착용+정지 바닥 1~5 vs 책상 1~3 으로
// 완전히 겹쳐 기각됐다(2026-08-19 통제군 실측).
//
// ⟹ 남은 길은 **문구가 착용을 암시하지 않게 하는 것**뿐이다(사용자 결정 2026-08-20).
//   `정상` 은 "이 사람이 괜찮다"로 읽히는데 우리는 그걸 모른다. `수신 중` 은 아는 것만 말한다.
//   ★ 판정은 안 바꾼다 — tone 은 `normal` 그대로라 신호등·집계가 종전과 동일하다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const dash = readFileSync(join(ROOT, "app/components/DemoDashboard.tsx"), "utf8");
// 상태 라벨 산출부는 2026-09-03 에 worker-signal 로 옮겼다(관리자 앱이 같은 판정을 써야 해서다).
// 가드는 **함수를 따라간다** — 파일만 바뀌었고 지키는 성질은 그대로다.
const signal = readFileSync(join(ROOT, "lib/worker-signal.ts"), "utf8");

test("앵커 — 상태 라벨 산출부가 실재한다", () => {
  assert.ok(signal.includes("function workerStatus("), "workerStatus 소실");
  assert.ok(signal.includes("WorkerStatus"), "WorkerStatus 타입 소실");
  // 화면이 실제로 그 함수를 쓰는지도 본다 — 옮기기만 하고 안 부르면 라벨 규칙이 죽는다.
  assert.ok(dash.includes("workerStatus("), "화면이 상태 라벨 산출부를 안 부른다");
});

test("수신 중 작업자에게 `정상` 을 단언하지 않는다", () => {
  const i = signal.indexOf("function workerStatus(");
  const body = signal.slice(i, signal.indexOf("\n}\n", i));
  assert.match(
    body,
    /overall === "normal"\) return \{ label: "수신 중", tone: "normal" \}/,
    "normal 라벨이 `수신 중` 이 아니다 — 미착용 구간에도 상태를 단언하게 된다",
  );
  assert.doesNotMatch(body, /label: "정상"/, "`정상` 단언이 되살아났다");
});

// ★ 판정 불변 — 라벨만 정직해지고 신호등·집계는 그대로다.
test("tone 은 normal 그대로다 — 판정·집계를 안 건드렸다", () => {
  const i = signal.indexOf("function workerStatus(");
  const body = signal.slice(i, signal.indexOf("\n}\n", i));
  for (const t of ['tone: "danger"', 'tone: "caution"', 'tone: "normal"', 'tone: "idle"']) {
    assert.ok(body.includes(t), `${t} 소실 — 톤 체계가 바뀌면 신호등·집계가 함께 바뀐다`);
  }
});

// 끊긴 작업자는 라벨만으로 부족하다 — 1분과 12시간이 같은 화면이면 "곧 돌아오겠지"로 읽힌다.
test("연결끊김에 경과가 함께 뜬다", () => {
  const i = dash.indexOf("{/* 10 상태");
  assert.ok(i >= 0, "상태 셀 주석 앵커 소실");
  const block = dash.slice(i, i + 900);
  assert.match(block, /연결끊김/, "연결끊김 라벨 소실");
  assert.match(block, /formatElapsed\(vitalAgeMs\(sample, nowMs\)\)/, "경과 병기가 사라졌다");
});
