// WBGT(Liljegren 2008) 단위 테스트 — 물리 성질과 **OSHA 대조 기준값**을 고정한다.
//
// 2026-08-14 OSHA 공식 계산기와 5케이스 대조로 검증 완료(ΔWBGT −0.032~+0.002℃).
// 대조 과정에서 3건이 어긋나 있었고 전부 이 대조로 잡혔다 — 지표 알베도 0.4→0.45,
// 풍속 하한 0.1→0.44704 m/s(1 mph), 10m→2m 환산 계수 0.67959 누락.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
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

// ★ OSHA 공식 WBGT 계산기 대조 기준값 (2026-08-14 검증).
//   조건 = 2026-08-14 12:00 EST · 40°N 75°W · 29.92 inHg.
//   fdir 은 OSHA 가 총 일사에서 내부 추정한 값을 그대로 넣어 조건을 맞춘다 — 우리 운용은
//   Open-Meteo 의 direct/diffuse 실측을 쓰므로 추정이 필요 없다(그쪽이 더 정확하다).
const OSHA_AT = new Date("2026-08-14T17:00:00Z");
const OSHA_SITE = { lat: 40, lon: -75, pressureHpa: 1013.2 };
const OSHA_CASES = [
  { name: "A 무일사", tempC: 25, rh: 70, windKmh: 5, rad: 0, fdir: 0, wbgt: 21.906, tnwb: 20.88, tg: 23.953 },
  { name: "B 약일사", tempC: 30, rh: 60, windKmh: 10, rad: 200, fdir: 0.00081, wbgt: 27.074, tnwb: 24.616, tg: 34.217 },
  { name: "C 중일사", tempC: 30, rh: 60, windKmh: 10, rad: 500, fdir: 0.21952, wbgt: 29.064, tnwb: 25.609, tg: 40.688 },
  { name: "D 강일사", tempC: 35, rh: 50, windKmh: 10, rad: 800, fdir: 0.69254, wbgt: 32.991, tnwb: 27.973, tg: 49.548 },
  { name: "E 저풍속", tempC: 33, rh: 80, windKmh: 1, rad: 600, fdir: 0.37968, wbgt: 37.29, tnwb: 33.418, tg: 52.988 },
];

test("★ OSHA 공식 계산기 대조 — 5케이스 전부 0.05℃ 이내", () => {
  for (const c of OSHA_CASES) {
    const r = computeWbgt({
      tempC: c.tempC,
      humidityPct: c.rh,
      windKmh: c.windKmh,
      directRadiation: c.rad * c.fdir,
      diffuseRadiation: c.rad * (1 - c.fdir),
      at: OSHA_AT,
      ...OSHA_SITE,
    })!;
    assert.ok(r !== null, `${c.name} 수렴 실패`);
    assert.ok(
      Math.abs(r.wbgt - c.wbgt) < 0.05,
      `${c.name} WBGT ${r.wbgt.toFixed(3)} vs OSHA ${c.wbgt}`,
    );
    assert.ok(
      Math.abs(r.naturalWetBulb - c.tnwb) < 0.05,
      `${c.name} Tnwb ${r.naturalWetBulb.toFixed(3)} vs OSHA ${c.tnwb}`,
    );
    assert.ok(
      Math.abs(r.globeTemp - c.tg) < 0.15,
      `${c.name} Tg ${r.globeTemp.toFixed(3)} vs OSHA ${c.tg}`,
    );
  }
});

test("검증 상수 3종이 그대로다 — 이게 바뀌면 OSHA 일치가 깨진다", () => {
  const src = readFileSync(new URL("./wbgt.ts", import.meta.url), "utf8");
  assert.match(src, /const ALB_SFC = 0\.45;/, "지표 알베도(OSHA 구현값)가 바뀜");
  assert.match(src, /const MIN_WIND_MS = 0\.44704;/, "풍속 하한(1 mph)이 바뀜");
  assert.match(src, /const WIND_10M_TO_2M = 0\.67959;/, "10m→2m 환산 계수가 바뀜");
});
