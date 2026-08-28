// 무동작 라벨 — 문턱·우선순위·결측 처리의 단위 검증.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { STILL_LABEL, STILL_LABEL_MS, stillLabel } from "./vital-still";

test("문턱 위 — 수신 중 자리에 무동작 + 경과가 나온다", () => {
  const r = stillLabel({ motionStillSec: 420 }, false, "normal");
  assert.deepEqual(r, { label: STILL_LABEL, elapsedMs: 420_000 });
});

test("문턱 양옆 — 경계는 이상(≥)이다", () => {
  const sec = STILL_LABEL_MS / 1000;
  assert.ok(stillLabel({ motionStillSec: sec }, false, "normal"), "정확히 문턱이면 낸다");
  assert.equal(stillLabel({ motionStillSec: sec - 0.1 }, false, "normal"), undefined);
});

test("★ stale 이면 내지 않는다 — 끊긴 행의 정지값은 지금을 말하지 않는다", () => {
  assert.equal(stillLabel({ motionStillSec: 9_999 }, true, "normal"), undefined);
});

test("★ normal 이 아니면 내지 않는다 — 주의·위험·대기 라벨이 더 많은 정보다", () => {
  for (const tone of ["caution", "danger", "idle"]) {
    assert.equal(stillLabel({ motionStillSec: 9_999 }, false, tone), undefined, tone);
  }
});

test("값이 없거나 NaN 이면 내지 않는다 — 0 으로 접지 않는다", () => {
  assert.equal(stillLabel({}, false, "normal"), undefined);
  assert.equal(stillLabel({ motionStillSec: Number.NaN }, false, "normal"), undefined);
});

test("라벨은 넉 자 — 상태 칸 폭이 종류마다 흔들리면 목록이 출렁인다", () => {
  assert.equal([...STILL_LABEL].length, 3);
  // `수신 중`(3자+공백) · `연결끊김`(4자) 과 같은 폭 계열이다.
});
