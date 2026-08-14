// 기상청 초단기실황 클라이언트 테스트 — 격자 변환과 조회 기준 시각을 고정한다.
// 둘 다 틀리면 "다른 지역"이나 "아직 없는 시각"을 조회해 조용히 폴백된다(에러가 안 난다).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { toKmaGrid, baseDateTime, fetchKmaObservation } from "./kma-observation";

test("격자 변환 — 광주는 (58, 74)", () => {
  // 실측 확인값(2026-08-14 · 초단기실황 조회 성공). 이 값이 바뀌면 다른 격자를 조회하게 된다.
  assert.deepEqual(toKmaGrid(35.16, 126.85), { nx: 58, ny: 74 });
});

test("격자 변환 — 알려진 지점들", () => {
  // 기상청 공개 격자표 기준.
  assert.deepEqual(toKmaGrid(37.5665, 126.978), { nx: 60, ny: 127 }); // 서울시청
  assert.deepEqual(toKmaGrid(35.1796, 129.0756), { nx: 98, ny: 76 }); // 부산시청
});

test("★ 조회 기준 시각 — 45분 전 정시(실황은 매시 40분 후 제공)", () => {
  // 16:14 KST 에는 아직 16시 실황이 없다 → 15시를 조회해야 한다.
  const at1614 = new Date("2026-08-14T07:14:00Z"); // 16:14 KST
  const r1 = baseDateTime(at1614);
  assert.equal(r1.baseDate, "20260814");
  assert.equal(r1.baseTime, "1500");

  // 16:45 KST 면 16시 실황이 올라와 있다.
  const at1645 = new Date("2026-08-14T07:45:00Z");
  assert.equal(baseDateTime(at1645).baseTime, "1600");
});

test("조회 기준 시각 — 자정 경계에서 날짜가 전날로 넘어간다", () => {
  const at0010 = new Date("2026-08-14T15:10:00Z"); // 00:10 KST (8/15)
  const r = baseDateTime(at0010);
  assert.equal(r.baseDate, "20260814", "전날 23시를 조회해야 한다");
  assert.equal(r.baseTime, "2300");
});

test("관측 시각은 조회한 정시를 가리킨다", () => {
  const r = baseDateTime(new Date("2026-08-14T07:14:00Z"));
  // 15:00 KST = 06:00 UTC
  assert.equal(r.observedAt.toISOString(), "2026-08-14T06:00:00.000Z");
});

test("키가 없으면 null — 목업을 만들지 않는다(법정 판정 입력)", async () => {
  const saved = { kma: process.env.KMA_SERVICE_KEY, kosha: process.env.KOSHA_SERVICE_KEY };
  delete process.env.KMA_SERVICE_KEY;
  delete process.env.KOSHA_SERVICE_KEY;
  try {
    assert.equal(await fetchKmaObservation(35.16, 126.85), null);
  } finally {
    if (saved.kma !== undefined) process.env.KMA_SERVICE_KEY = saved.kma;
    if (saved.kosha !== undefined) process.env.KOSHA_SERVICE_KEY = saved.kosha;
  }
});
