// 신호등 톤 합성 단위 테스트 — 구획 이탈이 생체 판정 위에 얹히는 규칙의 회귀 방지
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  disconnectMetric,
  effectiveTone,
  gateStaleVitals,
  withOutsideMetric,
  worseTone,
} from "./worker-signal";

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

// 감사 DLT-LIB-012 정정 — 과거 테스트는 stale/outside 분기가 같은 값을 반환하는 것을
// 몰랐고(둘 다 최소 caution) "stale 이 우선"이라는 있지도 않은 동작을 고정한다고 착각했다.
// 실제로 고정해야 할 계약은 "둘 중 하나라도 참이면 최소 caution, danger 는 유지"다.
test("stale 또는 outside 면 최소 caution 으로 올린다", () => {
  assert.equal(effectiveTone("normal", { stale: true }), "caution");
  assert.equal(effectiveTone("normal", { outside: true }), "caution");
  assert.equal(effectiveTone("normal", { stale: true, outside: true }), "caution");
  assert.equal(effectiveTone("idle", { stale: true }), "caution");
});

test("생체 danger 는 stale·outside 와 무관하게 유지된다", () => {
  assert.equal(effectiveTone("danger", { stale: true }), "danger");
  assert.equal(effectiveTone("danger", { outside: true }), "danger");
  assert.equal(effectiveTone("danger", { stale: true, outside: true }), "danger");
});

// 감사 DLT-LIB-013 — 톤은 같아도 라벨은 구별해야 한다.
// "구획 밖에서 신호 두절"은 마지막 확인 위치가 작업구역 밖이라는 뜻이라 수색 시작점이 달라진다.
test("구획 밖에서 끊긴 것과 그냥 끊긴 것을 라벨로 구별한다", () => {
  assert.equal(disconnectMetric(true), "구획밖 연결끊김");
  assert.equal(disconnectMetric(false), "연결끊김");
  assert.notEqual(disconnectMetric(true), disconnectMetric(false));
});

test("이상 사유에 구획이탈이 덧붙는다", () => {
  assert.deepEqual(withOutsideMetric(["심박"], true), ["심박", "구획이탈"]);
  assert.deepEqual(withOutsideMetric([], true), ["구획이탈"]);
  assert.deepEqual(withOutsideMetric(["심박"], false), ["심박"]);
});

// ── 연결끊김 시 생체 3종 블랭크 (false-OK 차단) ──
test("연결끊김이면 심박·SpO₂·체온을 비운다(sticky 직전값을 현재값처럼 표시 금지)", () => {
  // 실사례: 마지막 수신 6.7분 경과인데 82bpm / 92% / 35.8℃ 가 정상 색으로 계속 표시되던 행.
  const sample = { heartRate: 82, spo2: 92, skinTempC: 35.8 };
  assert.deepEqual(gateStaleVitals(sample, true), {
    heartRate: undefined,
    spo2: undefined,
    skinTempC: undefined,
  });
});

test("연결 정상이면 그대로 통과(폰 잠금 중 sticky 연속성 유지)", () => {
  // 잠금 중에도 폰은 vital 만 null 로 채워 계속 POST 하므로 stale 이 아니다 → 직전값이 살아있다.
  const sample = { heartRate: 82, spo2: 92, skinTempC: 35.8 };
  assert.deepEqual(gateStaleVitals(sample, false), {
    heartRate: 82,
    spo2: 92,
    skinTempC: 35.8,
  });
});

test("null / 미수신 메트릭은 undefined 로 정규화(호출부가 '--' 로 렌더)", () => {
  assert.deepEqual(gateStaleVitals({ heartRate: 80, spo2: null, skinTempC: undefined }, false), {
    heartRate: 80,
    spo2: undefined,
    skinTempC: undefined,
  });
});

test("샘플 자체가 없으면 stale 여부와 무관하게 전부 비운다(대기 상태)", () => {
  const empty = { heartRate: undefined, spo2: undefined, skinTempC: undefined };
  assert.deepEqual(gateStaleVitals(undefined, false), empty);
  assert.deepEqual(gateStaleVitals(undefined, true), empty);
});

test("0 은 유효값이라 보존한다(falsy 로 버리지 않음)", () => {
  assert.deepEqual(gateStaleVitals({ heartRate: 0, spo2: 0, skinTempC: 0 }, false), {
    heartRate: 0,
    spo2: 0,
    skinTempC: 0,
  });
});
