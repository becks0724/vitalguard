// WBGT(Liljegren 2008) 단위 테스트 — 물리 성질과 경계를 고정한다.
//
// ⚠ 아래 수치 스냅샷은 **우리 구현의 현재 값**이지 검증된 기준값이 아니다. OSHA 공식 계산기
//    대조(Phase 1 잔여)가 끝나기 전까지는 "회귀 감지"용이며, 대조 후 기준값으로 승격한다.
//    이 구분을 지우지 말 것 — 검증 안 된 값을 기준처럼 쓰면 그게 곧 근거 없는 판정이 된다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { computeWbgt, solarZenithRad } from "./wbgt";

const GWANGJU = { lat: 35.16, lon: 126.85 };
const noon = new Date("2026-08-14T03:00:00Z"); // 12:00 KST
const night = new Date("2026-08-14T15:00:00Z"); // 24:00 KST

function wbgtAt(o: {
  tempC: number;
  humidityPct: number;
  windKmh: number;
  direct: number;
  diffuse: number;
  at?: Date;
}) {
  return computeWbgt({
    tempC: o.tempC,
    humidityPct: o.humidityPct,
    windKmh: o.windKmh,
    directRadiation: o.direct,
    diffuseRadiation: o.diffuse,
    at: o.at ?? noon,
    ...GWANGJU,
  });
}

test("일사가 없으면 흑구온도가 기온에 수렴한다", () => {
  const r = wbgtAt({ tempC: 26, humidityPct: 85, windKmh: 3.6, direct: 0, diffuse: 0, at: night })!;
  assert.ok(Math.abs(r.globeTemp - 26) < 1.5, `야간 Tg ${r.globeTemp} 가 기온에서 너무 멀다`);
  assert.equal(r.propDirect, 0);
});

test("★ 일사가 강할수록 흑구온도가 오른다 — 복사 흡수 항", () => {
  const dull = wbgtAt({ tempC: 33, humidityPct: 60, windKmh: 7.2, direct: 7, diffuse: 180 })!;
  const bright = wbgtAt({ tempC: 33, humidityPct: 60, windKmh: 7.2, direct: 700, diffuse: 150 })!;
  assert.ok(bright.globeTemp > dull.globeTemp + 8, "맑은 날 흑구온도 상승이 너무 작다");
  assert.ok(bright.wbgt > dull.wbgt, "일사가 WBGT 에 반영되지 않음");
});

test("바람이 세면 흑구온도 상승이 억제된다 — 대류 방출 항", () => {
  const calm = wbgtAt({ tempC: 35, humidityPct: 40, windKmh: 3.6, direct: 650, diffuse: 120 })!;
  const windy = wbgtAt({ tempC: 35, humidityPct: 40, windKmh: 29, direct: 650, diffuse: 120 })!;
  assert.ok(windy.globeTemp < calm.globeTemp, "풍속이 흑구온도에 반영되지 않음");
});

test("습도가 높으면 자연습구온도가 올라 WBGT 가 오른다", () => {
  const dry = wbgtAt({ tempC: 33, humidityPct: 40, windKmh: 7.2, direct: 600, diffuse: 150 })!;
  const humid = wbgtAt({ tempC: 33, humidityPct: 85, windKmh: 7.2, direct: 600, diffuse: 150 })!;
  assert.ok(humid.naturalWetBulb > dry.naturalWetBulb + 3, "습도 반영이 약하다");
  assert.ok(humid.wbgt > dry.wbgt, "습도가 WBGT 에 반영되지 않음");
});

test("자연습구온도 ≤ 기온 · 흑구온도 ≥ 기온(일사 있을 때)", () => {
  const r = wbgtAt({ tempC: 33, humidityPct: 60, windKmh: 7.2, direct: 700, diffuse: 150 })!;
  assert.ok(r.naturalWetBulb <= 33, "습구가 기온을 넘었다");
  assert.ok(r.globeTemp >= 33, "일사가 있는데 흑구가 기온보다 낮다");
  // 조합식 검산 — 0.7/0.2/0.1
  const expected = 0.7 * r.naturalWetBulb + 0.2 * r.globeTemp + 0.1 * 33;
  assert.ok(Math.abs(r.wbgt - expected) < 1e-9, "조합 가중치가 바뀜");
});

test("★ 직달 비율은 가정이 아니라 실측 — 총량이 같아도 결과가 갈린다", () => {
  // 총 일사 850 으로 동일하되 직달/산란 구성만 다르게.
  const mostlyDirect = wbgtAt({ tempC: 33, humidityPct: 60, windKmh: 7.2, direct: 700, diffuse: 150 })!;
  const mostlyDiffuse = wbgtAt({ tempC: 33, humidityPct: 60, windKmh: 7.2, direct: 150, diffuse: 700 })!;
  assert.ok(Math.abs(mostlyDirect.propDirect - 700 / 850) < 1e-9);
  assert.ok(Math.abs(mostlyDiffuse.propDirect - 150 / 850) < 1e-9);
  assert.notEqual(mostlyDirect.globeTemp, mostlyDiffuse.globeTemp);
});

test("입력 결측·범위 밖은 null(판정 불가)", () => {
  assert.equal(wbgtAt({ tempC: NaN, humidityPct: 60, windKmh: 7, direct: 100, diffuse: 100 }), null);
  assert.equal(wbgtAt({ tempC: 30, humidityPct: 0, windKmh: 7, direct: 100, diffuse: 100 }), null);
  assert.equal(wbgtAt({ tempC: 30, humidityPct: 120, windKmh: 7, direct: 100, diffuse: 100 }), null);
  assert.equal(wbgtAt({ tempC: 30, humidityPct: 60, windKmh: NaN, direct: 100, diffuse: 100 }), null);
});

test("태양 천정각 — 정오가 자정보다 작다(광주 기준)", () => {
  const zNoon = solarZenithRad(noon, GWANGJU.lat, GWANGJU.lon);
  const zNight = solarZenithRad(night, GWANGJU.lat, GWANGJU.lon);
  assert.ok(zNoon < zNight, "천정각이 시각을 반영하지 않음");
  assert.ok(zNoon < Math.PI / 4, `8월 광주 정오 천정각 ${(zNoon * 180) / Math.PI}° 가 너무 크다`);
  assert.ok(zNight > Math.PI / 2, "자정인데 태양이 지평선 위");
});

test("스냅샷(⚠ 미검증 — OSHA 대조 전) — 조용한 수식 변경을 잡는다", () => {
  const r = wbgtAt({ tempC: 27.9, humidityPct: 74, windKmh: 5.8, direct: 7.1, diffuse: 179.9 })!;
  assert.ok(Math.abs(r.wbgt - 26.66) < 0.05, `WBGT ${r.wbgt.toFixed(2)} — 스냅샷에서 벗어남`);
  assert.ok(Math.abs(r.globeTemp - 31.92) < 0.05, `Tg ${r.globeTemp.toFixed(2)} — 스냅샷에서 벗어남`);
});
