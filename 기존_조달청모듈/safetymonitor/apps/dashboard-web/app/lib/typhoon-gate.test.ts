// 태풍 영향권 판정 단위 테스트 — 기상청 구역·반경 하이브리드 합성·예보점 선행 경보·리드타임·worst-of.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyKmaZone,
  computeGate,
  EMPTY_GATE,
  haversineKm,
  isBelowTyphoonStrength,
  parseRadiusKm,
  pickWorst,
  tmToMs,
  TYPHOON_MIN_WIND_MS,
  type GateResult,
} from "./typhoon-gate";

const SITE = { lat: 35.15, lon: 126.92 }; // 광주 근사

test("parseRadiusKm — 문자열/빈값/0 처리", () => {
  assert.equal(parseRadiusKm("300"), 300);
  assert.equal(parseRadiusKm("0"), 0);
  assert.equal(parseRadiusKm(""), 0);
  assert.equal(parseRadiusKm(undefined), 0);
});

test("computeGate — 현장 기준 폭풍역/강풍역/접근/밖", () => {
  // 현장 바로 위 태풍(거리 0) + 폭풍반경 120 → storm
  const storm = computeGate(
    [{ tm: "t", lat: SITE.lat, lon: SITE.lon, rad15: "300", rad25: "120" }],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(storm.zone, "storm");
  assert.equal(storm.tracking, true);

  // 현장에서 ~430km(제주 남쪽 해상) + 강풍반경 500 → gale
  const gale = computeGate([{ tm: "t", lat: 31.3, lon: 126.9, rad15: "500", rad25: "0" }], 0, SITE.lat, SITE.lon);
  assert.equal(gale.zone, "gale");

  // 같은 위치(현장 ~428km) + 강풍반경 300 → 강풍역 밖·300+300(접근 마진) 안 = approach
  const appr = computeGate([{ tm: "t", lat: 31.3, lon: 126.9, rad15: "300", rad25: "0" }], 0, SITE.lat, SITE.lon);
  assert.equal(appr.zone, "approach");
  assert.equal(appr.forecast, false);

  // 원거리(하이선 실측 13.3,134.1) → 반경 축은 none 이지만 구역 축이 감시(watch)로 받친다.
  const far = computeGate([{ tm: "t", lat: 13.3, lon: 134.1, rad15: "200" }], 0, SITE.lat, SITE.lon);
  assert.equal(far.radiusZone, "none");
  assert.equal(far.zone, "watch");
  assert.equal(far.tracking, true);
});

test("computeGate — 현장 GPS 없으면 국토 중앙점 근사, 반경 미제공은 고정거리 폴백", () => {
  // 국토 기준: 한국 중앙에서 ~600km + 강풍반경 300(+버퍼 400) → gale
  const korea = computeGate([{ tm: "t", lat: 30.8, lon: 126.5, rad15: "300" }], 0);
  assert.equal(korea.zone, "gale");
  assert.equal(korea.siteKm, null);

  // 반경 미제공(0) + 현장 500km 이내 → approach 폴백
  const fb = computeGate([{ tm: "t", lat: 33.5, lon: 126.5, rad15: "0" }], 0, SITE.lat, SITE.lon);
  assert.equal(fb.zone, "approach");
});

test("computeGate — 예보점 선행 경보(바비 패턴): 현재는 반경 밖, 예보 진로가 현장 강풍권 → gale(진로 예보)", () => {
  // 현재 중국 내륙(현장 ~870km → 반경 none, 구역은 비상)이고 예보점이 현장 인근(~74km ≤ 250) → 강풍역 예보.
  const g = computeGate(
    [
      { tm: "202607130900", lat: 33.5, lon: 117.7, rad15: "300" }, // 현재(관측)
      { tm: "202607140900", lat: 35.8, lon: 127.1, rad15: "250" }, // 예보 — 현장 ~74km ≤ 250
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(g.radiusZone, "none"); // 현재 위치 반경 축은 밖
  assert.equal(g.kmaZone, "emergency"); // 현재 위치 구역 축은 비상
  assert.equal(g.zone, "gale"); // 예보가 이겨 강풍역 선행 점등
  assert.equal(g.forecast, true);
  assert.equal(g.tracking, true);
  assert.equal(g.leadHours, 24); // 07-13 09시 → 07-14 09시

  // 예보점 rad15 가 명시 "0"(강풍역 소멸 예보)이면 현장 코앞이라도 반경 축 미점등(KMA 예보 존중).
  // 구역 축(위경도)은 그대로 산출되므로 현재와 동률인 emergency 에 머문다.
  const weakened = computeGate(
    [
      { tm: "1", lat: 33.5, lon: 117.7, rad15: "300" }, // 현재 = 반경 none · 구역 emergency
      { tm: "2", lat: 35.2, lon: 126.9, rad15: "0" }, // 예보 — 현장 인근이지만 강풍역 소멸 예보
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(weakened.zone, "emergency");
  assert.equal(weakened.forecast, false);

  // 예보점 rad15 미제공(undefined)은 현재 반경 폴백으로 판정 — 현장 ~6km ≤ 300 이라 강풍역.
  const noRad = computeGate(
    [
      { tm: "1", lat: 33.5, lon: 117.7, rad15: "300" },
      { tm: "2", lat: 35.2, lon: 126.9 },
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(noRad.zone, "gale");
  assert.equal(noRad.forecast, true);

  // 예보점이 있어도 전부 반경 밖이면 구역 축(감시)만 남는다.
  const far = computeGate(
    [
      { tm: "1", lat: 13.3, lon: 134.1, rad15: "200" },
      { tm: "2", lat: 15.0, lon: 132.0, rad15: "220" },
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(far.zone, "watch");
  assert.equal(far.forecast, false);
  assert.equal(far.leadHours, null);
});

test("classifyKmaZone — 구역 경계값(포함 경계·중첩 포함 구조)", () => {
  // 비상구역 = 28°N 북쪽 AND 132°E 서쪽 (경계선 포함)
  assert.equal(classifyKmaZone(28, 132), "emergency");
  assert.equal(classifyKmaZone(35.15, 126.92), "emergency"); // 한반도 상공
  // 위도만 미달 / 경도만 초과 → 경계구역으로 내려앉는다(사각지대 없음)
  assert.equal(classifyKmaZone(27.9, 132), "alert");
  assert.equal(classifyKmaZone(30, 133), "alert");
  assert.equal(classifyKmaZone(25, 135), "alert");
  // 경계구역 밖은 전부 감시 — 발효 중인 태풍은 최소 watch 라 none 이 나오지 않는다
  assert.equal(classifyKmaZone(24.9, 135), "watch");
  assert.equal(classifyKmaZone(30, 140), "watch");
  assert.equal(classifyKmaZone(13.3, 134.1), "watch"); // 하이선 발생 초기
});

test("isBelowTyphoonStrength — 기상청 태풍 기준 17m/s 경계, 값 없으면 강등하지 않는다", () => {
  assert.equal(TYPHOON_MIN_WIND_MS, 17);
  assert.equal(isBelowTyphoonStrength({ tm: "t", lat: 30, lon: 128, maxWindMs: 15 }), true);
  assert.equal(isBelowTyphoonStrength({ tm: "t", lat: 30, lon: 128, maxWindMs: 16.9 }), true);
  // 경계값 17 은 태풍이다(미달 아님).
  assert.equal(isBelowTyphoonStrength({ tm: "t", lat: 30, lon: 128, maxWindMs: 17 }), false);
  assert.equal(isBelowTyphoonStrength({ tm: "t", lat: 30, lon: 128, maxWindMs: 43 }), false);
  // 미제공은 '약화'가 아니라 '모름' — 강등하면 상류 파싱 실패가 곧 경보 소등이 된다.
  assert.equal(isBelowTyphoonStrength({ tm: "t", lat: 30, lon: 128 }), false);
});

test("★ computeGate — 실측이 태풍 강도 미달이면 구역 축을 뺀다 (제13호 돌핀 오탐 회귀 방지)", () => {
  // 2026-08-11 실데이터 — 돌핀은 중국 내륙(30.7N/115.1E)에서 15m/s 로 약화했고 예보점이 없다(기상청 예보 종료).
  // 구역 정의에 서쪽 한계가 없어 위경도만으로는 비상구역이라, 강등 전에는 이 태풍이 최고 등급 대표를 차지했다.
  const dolphin = { tm: "202608110900", lat: 30.7, lon: 115.1, maxWindMs: 15 };
  const g = computeGate([dolphin], 0, SITE.lat, SITE.lon);
  assert.equal(g.kmaZone, "none"); // 구역 축 제외
  assert.equal(g.radiusZone, "none"); // 강풍반경 없음 + 현장 1,208km → 폴백도 밖
  assert.equal(g.zone, "none");
  assert.equal(g.tracking, false);

  // 같은 좌표라도 태풍 강도(17m/s 이상)면 구역 축이 그대로 산출된다 — 강등은 강도로만 판단한다.
  const alive = computeGate([{ ...dolphin, maxWindMs: 20 }], 0, SITE.lat, SITE.lon);
  assert.equal(alive.kmaZone, "emergency");
  assert.equal(alive.zone, "emergency");

  // 최대풍속 미제공(구 데이터·파싱 실패)은 강등하지 않는다 — 기존 동작 그대로.
  const unknown = computeGate([{ tm: "202608110900", lat: 30.7, lon: 115.1 }], 0, SITE.lat, SITE.lon);
  assert.equal(unknown.kmaZone, "emergency");
  assert.equal(unknown.zone, "emergency");
});

test("★ computeGate — 강등은 실측에만 적용한다(예보점은 강등하지 않는다)", () => {
  // A안의 핵심. 실측 약화는 사실이지만 예보 약화는 추정이라, 추정으로 경보를 끄면 예보가 빗나갈 때 공백이 된다.
  // 현재는 강도 미달로 구역 축이 빠졌지만, 예보점이 강도 미달이어도 그 구역 축은 그대로 산출돼 선행 점등한다.
  const g = computeGate(
    [
      { tm: "202608110900", lat: 30.7, lon: 115.1, maxWindMs: 15 }, // 현재 = 강등 → none
      { tm: "202608120900", lat: 30.0, lon: 128.0, rad15: "0", maxWindMs: 15 }, // 예보 = 강도 미달이지만 비상구역
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(g.kmaZone, "none");
  assert.equal(g.zone, "emergency"); // 예보 구역 축이 살아 선행 점등
  assert.equal(g.forecast, true);
  assert.equal(g.leadHours, 24);
});

test("computeGate — 강도 미달이어도 현장에 가까우면 반경 축이 점등한다(안전 손실 없음)", () => {
  // 강등은 구역 축만 뺀다. 열대저압부라도 강풍반경 안에 현장이 들어오면 현장 실거리로 그대로 점등한다.
  const g = computeGate(
    [{ tm: "1", lat: 35.2, lon: 126.9, rad15: "300", maxWindMs: 15 }],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(g.kmaZone, "none"); // 구역 축은 빠졌지만
  assert.equal(g.radiusZone, "gale"); // 반경 축이 살아 있다
  assert.equal(g.zone, "gale");
  assert.equal(g.tracking, true);
});

test("★ pickWorst — 소멸 태풍이 대표를 차지하지 않는다 (2026-08-11 돌핀·찬홈·페이러우 실데이터)", () => {
  // 강등 전에는 돌핀(emergency)이 찬홈(alert)을 이겨 화면을 독점했다. 강등 후 대표는 실제 접근 중인 찬홈이어야 한다.
  const dolphin = computeGate(
    [{ tm: "202608110900", lat: 30.7, lon: 115.1, maxWindMs: 15 }],
    0,
    SITE.lat,
    SITE.lon,
  );
  const chanhom = computeGate(
    [
      { tm: "202608110900", lat: 36.8, lon: 143.6, rad15: "340", maxWindMs: 24 },
      { tm: "202608122100", lat: 35.7, lon: 132.5, rad15: "0", radPr: "110", maxWindMs: 15 },
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  const peilou = computeGate(
    [{ tm: "202608110900", lat: 24.3, lon: 155.6, rad15: "260", maxWindMs: 24 }],
    0,
    SITE.lat,
    SITE.lon,
  );

  assert.equal(dolphin.zone, "none");
  assert.equal(chanhom.zone, "alert"); // 36시간 뒤 경계구역 진입 예보
  assert.equal(chanhom.forecast, true);
  assert.equal(chanhom.leadHours, 36);
  assert.equal(peilou.zone, "watch"); // 북동진 이탈 — 감시만

  assert.equal(pickWorst([dolphin, chanhom, peilou]), 1);
});

test("computeGate — 하이브리드 worst-of: 소형 태풍이 비상구역이면 반경 밖이어도 emergency", () => {
  // 강풍반경 100km 소형 태풍이 현장 ~580km — 반경 축은 none, 구역 축은 비상 → 구역이 이긴다.
  const g = computeGate([{ tm: "1", lat: 30, lon: 128, rad15: "100" }], 0, SITE.lat, SITE.lon);
  assert.equal(g.radiusZone, "none");
  assert.equal(g.kmaZone, "emergency");
  assert.equal(g.zone, "emergency");
  assert.equal(g.forecast, false);

  // 반대 — 대형 태풍이 경계구역(25°N 남쪽 아님)에 있어도 강풍역이 국토에 닿으면 반경이 이긴다.
  const big = computeGate([{ tm: "1", lat: 30.8, lon: 126.5, rad15: "300" }], 0);
  assert.equal(big.kmaZone, "emergency");
  assert.equal(big.zone, "gale");
});

test("★ computeGate — 예보 스캔은 현재가 영향권 밖이 아니어도 실행된다(구역 도입 회귀 방지)", () => {
  // 과거 구현은 `zone === "none"` 일 때만 예보를 스캔했다. 구역 축 도입 후 발효 태풍은 늘 watch 이상이라
  // 그 조건을 남겨두면 선행 경보가 영영 실행되지 않는다 — 타입 오류도 런타임 오류도 없이 조용히 죽는다.
  const g = computeGate(
    [
      { tm: "202608010900", lat: 30.0, lon: 125.0, rad15: "150" }, // 현재 = 반경 none · 구역 emergency
      { tm: "202608030300", lat: 32.0, lon: 126.5, rad15: "150" }, // 예보 — 현장 ~352km(150~450) = approach
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(g.radiusZone, "none");
  assert.equal(g.kmaZone, "emergency");
  assert.equal(g.zone, "approach"); // emergency(3) < approach(4) → 예보가 이김
  assert.equal(g.forecast, true);
  assert.equal(g.leadHours, 42); // 08-01 09시 → 08-03 03시 = 42시간(월·자정 경계 통과)
});

test("computeGate — 예보점 폭풍반경(rad25)까지 판정한다", () => {
  const g = computeGate(
    [
      { tm: "202608010000", lat: 20.0, lon: 130.0, rad15: "300", rad25: "100" }, // 현재 = 감시구역
      { tm: "202608040000", lat: SITE.lat, lon: SITE.lon, rad25: "120" }, // 예보 — 현장 직격
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(g.kmaZone, "watch");
  assert.equal(g.zone, "storm"); // 예보 진로가 폭풍역으로 현장을 덮는다
  assert.equal(g.forecast, true);
  assert.equal(g.leadHours, 72);
});

test("computeGate — 확률반경(radPr)은 예보 영향권을 넓힌다(강풍반경 대체가 아니라 가산)", () => {
  // 예보점이 현장 ~688km · 강풍반경 300 → 300+300(접근 마진) = 600 < 688 이라 radPr 없으면 미점등.
  const base = { tm: "202608010900", lat: 30.0, lon: 125.0, rad15: "150" };
  const far = { tm: "202608030900", lat: 29.0, lon: 126.0, rad15: "300" };
  const noPr = computeGate([base, far], 0, SITE.lat, SITE.lon);
  assert.equal(noPr.zone, "emergency"); // 예보가 못 이겨 현재 구역 등급 유지
  assert.equal(noPr.forecast, false);

  // 같은 예보점에 확률반경 200 → 강풍역이 500 으로 넓어져 approach 진입.
  const withPr = computeGate([base, { ...far, radPr: "200" }], 0, SITE.lat, SITE.lon);
  assert.equal(withPr.zone, "approach");
  assert.equal(withPr.forecast, true);

  // 강풍반경이 0(소멸 예보)이면 확률반경을 더해도 영향권을 만들지 않는다.
  const dead = computeGate(
    [base, { tm: "202608030900", lat: 35.2, lon: 126.9, rad15: "0", radPr: "300" }],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(dead.forecast, false);
});

test("tmToMs — KST 통보문 시각 파싱(형식 이상은 null)", () => {
  assert.equal(tmToMs("202608010900"), Date.UTC(2026, 7, 1, 0, 0)); // KST 09시 = UTC 00시
  assert.equal(tmToMs("202601010000") !== null, true);
  assert.equal(tmToMs("샘플-1"), null);
  assert.equal(tmToMs(""), null);
  // 리드타임은 두 tm 의 차이로만 계산한다(브라우저 시계 미사용) — 자정·월 경계에서도 정확해야 한다.
  const a = tmToMs("202607312100");
  const b = tmToMs("202608010900");
  assert.equal(a !== null && b !== null ? (b - a) / 3_600_000 : null, 12);
});

test("computeGate — 현재 위치가 이미 영향권이면 forecast 플래그 없이 현재 기준 우선", () => {
  const g = computeGate(
    [
      { tm: "1", lat: 31.3, lon: 126.9, rad15: "500" }, // 현재 = gale
      { tm: "2", lat: 35.2, lon: 126.9, rad15: "300" }, // 예보(현장 직격)
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(g.zone, "gale");
  assert.equal(g.forecast, false);
});

test("pickWorst — 존 등급 우선, 동률이면 최근접(배열 첫 원소가 아니어도 선택)", () => {
  const mk = (zone: GateResult["zone"], siteKm: number | null, koreaKm: number | null): GateResult => ({
    ...EMPTY_GATE,
    zone,
    tracking: zone !== "none",
    siteKm,
    koreaKm,
  });
  // 두 번째가 등급 상위 → 1
  assert.equal(pickWorst([mk("approach", 400, null), mk("gale", 900, null)]), 1);
  // 등급 동률 → 최근접(두 번째)
  assert.equal(pickWorst([mk("gale", 400, null), mk("gale", 200, null)]), 1);
  // siteKm 없으면 koreaKm 폴백으로 tie-break
  assert.equal(pickWorst([mk("none", null, 2601), mk("none", null, 950)]), 1);
  // 단일 원소
  assert.equal(pickWorst([mk("storm", 10, null)]), 0);
});

test("haversineKm — 실측 검산(하이선-광주 ≈ 2,540km 급)", () => {
  const d = haversineKm(13.3, 134.1, SITE.lat, SITE.lon);
  assert.ok(d > 2400 && d < 2700, `expected ~2540, got ${d}`);
});
