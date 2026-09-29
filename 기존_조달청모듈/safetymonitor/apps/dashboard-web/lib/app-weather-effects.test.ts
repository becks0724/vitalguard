import assert from "node:assert/strict";
import { test } from "node:test";
import { appWeatherEffects } from "./app-weather-effects";
import { evaluateWindKmh } from "./weather-rules";
import { parsePrecipitationType } from "../app/lib/kma-observation";

test("초단기 PTY만 비·눈·혼합 효과로 변환하며 미수신은 없음과 구별한다", () => {
  for (const [code, mode] of [[0,"none"],[1,"rain"],[2,"mixed"],[3,"snow"],[5,"rain"],[6,"mixed"],[7,"snow"]] as const) {
    const parsed = parsePrecipitationType(String(code));
    assert.equal(parsed, code);
    const actual = appWeatherEffects({ obsSource: "kma-ncst", precipitationType: parsed, windKmh: 0 });
    assert.equal(actual.precipitation, mode);
    assert.equal(actual.precipitationSource, "kma-ncst");
  }
  for (const bad of [undefined, null, "", " ", "-999", "4", "8", "NaN", "1.5", 1]) {
    assert.equal(parsePrecipitationType(bad), undefined);
  }
  assert.equal(appWeatherEffects({ windKmh: 0 }).precipitation, "unknown");
  assert.equal(appWeatherEffects({ obsSource: "open-meteo", precipitationType: 3, windKmh: 0 }).precipitationSource, null);
});

test("풍속 효과는 평균·돌풍 경계 모두 관제의 기존 판정과 일치한다", () => {
  for (const mean of [0, 35.9, 36, 53.9, 54, 108]) for (const gust of [undefined, 0, 35.9, 36, 53.9, 54, 108]) {
    assert.equal(appWeatherEffects({windKmh: mean, windGustKmh: gust}).windDanger,
      evaluateWindKmh(mean, gust).currentSeverity === "danger");
  }
  assert.equal(appWeatherEffects({windKmh: NaN}).windDanger, false);
});
