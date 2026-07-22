// 위험작업 × 기상 예보 충돌 판정 단위 테스트 — 유형별 임계 경계·결측 입력·worst-of 합성.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evaluateHazardWeather,
  HAZARD_TYPE_IDS,
  hazardTypeName,
  kmhToMs,
} from "./calendar-hazard";

test("hazardTypeName — 5종 이름·불명 null", () => {
  assert.equal(HAZARD_TYPE_IDS.length, 5);
  assert.equal(hazardTypeName("crane"), "크레인 양중");
  assert.equal(hazardTypeName("confined"), "밀폐공간");
  assert.equal(hazardTypeName("unknown"), null);
  assert.equal(hazardTypeName(null), null);
});

test("kmhToMs — Open-Meteo kmh 돌풍 환산", () => {
  assert.equal(kmhToMs(36), 10);
  assert.equal(kmhToMs(54), 15);
});

test("결측·불명 입력 — 판정 없음(null)", () => {
  assert.equal(evaluateHazardWeather(null, { windGustMs: 20 }), null);
  assert.equal(evaluateHazardWeather("crane", null), null);
  assert.equal(evaluateHazardWeather("crane", {}), null);
  assert.equal(evaluateHazardWeather("unknown_type", { windGustMs: 20 }), null);
  // NaN 은 판정 축 자체를 건너뜀
  assert.equal(evaluateHazardWeather("crane", { windGustMs: Number.NaN }), null);
});

test("크레인 양중 — 돌풍 10/15m/s 경계", () => {
  assert.equal(evaluateHazardWeather("crane", { windGustMs: 9.9 }), null);
  assert.equal(evaluateHazardWeather("crane", { windGustMs: 10 })?.severity, "caution");
  assert.equal(evaluateHazardWeather("crane", { windGustMs: 14.9 })?.severity, "caution");
  const danger = evaluateHazardWeather("crane", { windGustMs: 15 });
  assert.equal(danger?.severity, "danger");
  assert.ok(danger?.messages[0]?.includes("15m/s"));
});

test("고소작업 — 강풍·강수 각각과 worst-of 합성", () => {
  assert.equal(evaluateHazardWeather("high_place", { windGustMs: 5, precipSumMm: 3 }), null);
  assert.equal(
    evaluateHazardWeather("high_place", { precipSumMm: 10 })?.severity,
    "caution",
  );
  // 강풍 danger + 미끄럼 caution → 종합 danger, 사유 2건
  const both = evaluateHazardWeather("high_place", { windGustMs: 16, precipSumMm: 12 });
  assert.equal(both?.severity, "danger");
  assert.equal(both?.messages.length, 2);
});

test("화기작업 — 돌풍만 판정(강수·기온 무시)", () => {
  assert.equal(evaluateHazardWeather("hot_work", { precipSumMm: 100, tMaxC: 40 }), null);
  assert.equal(evaluateHazardWeather("hot_work", { windGustMs: 11 })?.severity, "caution");
  assert.equal(evaluateHazardWeather("hot_work", { windGustMs: 20 })?.severity, "danger");
});

test("굴착 — 일 강수량 30/50mm 경계(돌풍 무시)", () => {
  assert.equal(evaluateHazardWeather("excavation", { precipSumMm: 29.9, windGustMs: 20 }), null);
  assert.equal(evaluateHazardWeather("excavation", { precipSumMm: 30 })?.severity, "caution");
  assert.equal(evaluateHazardWeather("excavation", { precipSumMm: 50 })?.severity, "danger");
});

test("밀폐공간 — 일 최고기온 33/35℃ 경계(돌풍·강수 무시)", () => {
  assert.equal(evaluateHazardWeather("confined", { tMaxC: 32.9, windGustMs: 20 }), null);
  assert.equal(evaluateHazardWeather("confined", { tMaxC: 33 })?.severity, "caution");
  assert.equal(evaluateHazardWeather("confined", { tMaxC: 35 })?.severity, "danger");
});
