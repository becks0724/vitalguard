// 신호등 톤 합성 단위 테스트 — 구획 이탈이 생체 판정 위에 얹히는 규칙의 회귀 방지
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { effectiveTone, withOutsideMetric, worseTone } from "./worker-signal";

test("worseTone — 더 위험한 쪽을 남긴다", () => {
  assert.equal(worseTone("normal", "caution"), "caution");
  assert.equal(worseTone("danger", "caution"), "danger");
  assert.equal(worseTone("idle", "normal"), "normal");
});

test("구획 이탈은 정상 작업자를 주의로 올린다", () => {
  assert.equal(effectiveTone("normal", { outside: true }), "caution");
});

test("구획 이탈이어도 생체 위험은 위험으로 유지된다(worst-of)", () => {
  assert.equal(effectiveTone("danger", { outside: true }), "danger");
});

test("구획 안이면 생체 판정을 그대로 쓴다", () => {
  assert.equal(effectiveTone("normal", { outside: false }), "normal");
  assert.equal(effectiveTone("caution", {}), "caution");
});

// 미수신을 이탈로 오인하지 않는다 — 연결끊김이면 위치 판정을 신뢰하지 않는다.
test("연결끊김이면 이탈 여부와 무관하게 주의(연결끊김 사유)로 처리된다", () => {
  assert.equal(effectiveTone("normal", { stale: true, outside: true }), "caution");
  assert.equal(effectiveTone("normal", { stale: true, outside: false }), "caution");
  assert.equal(effectiveTone("danger", { stale: true }), "danger");
});

test("이상 사유에 구획이탈이 덧붙는다", () => {
  assert.deepEqual(withOutsideMetric(["심박"], true), ["심박", "구획이탈"]);
  assert.deepEqual(withOutsideMetric([], true), ["구획이탈"]);
  assert.deepEqual(withOutsideMetric(["심박"], false), ["심박"]);
});
