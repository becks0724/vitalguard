// 기상청 체감온도 산출식 단위 테스트 — 법정 폭염 판정의 입력이라 물리 성질을 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  apparentTempKma,
  apparentTempSummer,
  apparentTempWinter,
  wetBulbStull,
} from "./apparent-temp";

test("★ 여름철 체감온도는 풍속에 흔들리지 않는다 — 이번 수리의 본질", () => {
  // 종전 Open-Meteo 식은 풍속을 계수 -0.7 로 반영해 바람 부는 폭염일에 값을 낮췄다.
  // 기상청 여름철 식에는 풍속 항이 없으므로, 어떤 풍속을 줘도 결과가 같아야 한다.
  const calm = apparentTempKma(33, 60, 0);
  const breezy = apparentTempKma(33, 60, 20);
  const windy = apparentTempKma(33, 60, 60);
  assert.equal(calm, breezy);
  assert.equal(calm, windy);
});

test("습도가 오르면 체감온도가 오른다", () => {
  const dry = apparentTempSummer(33, 30);
  const humid = apparentTempSummer(33, 80);
  assert.ok(humid > dry, `습도 80%(${humid}) 가 30%(${dry}) 보다 높아야 한다`);
});

test("기온이 오르면 체감온도가 오른다", () => {
  const mild = apparentTempSummer(28, 60);
  const hot = apparentTempSummer(35, 60);
  assert.ok(hot > mild, `35℃(${hot}) 가 28℃(${mild}) 보다 높아야 한다`);
});

test("습구온도는 기온을 넘지 않는다(물리 제약) · 포화 시 기온에 수렴", () => {
  for (const t of [26, 30, 35, 40]) {
    for (const rh of [20, 50, 80, 99]) {
      assert.ok(
        wetBulbStull(t, rh) <= t + 0.5,
        `Tw(${t}℃, ${rh}%) 가 기온을 넘음`,
      );
    }
  }
  // 상대습도 100% 부근에서는 습구온도 ≈ 기온.
  assert.ok(Math.abs(wetBulbStull(30, 100) - 30) < 1.0);
});

test("겨울철은 풍속이 오르면 체감온도가 내려간다", () => {
  const calm = apparentTempWinter(-5, 5);
  const windy = apparentTempWinter(-5, 40);
  assert.ok(windy < calm, `강풍(${windy}) 이 약풍(${calm}) 보다 낮아야 한다`);
});

test("구간 분기 — 25℃ 이상은 여름식, 10℃ 이하+풍속은 겨울식, 그 사이는 기온 그대로", () => {
  assert.equal(apparentTempKma(30, 70, 10), apparentTempSummer(30, 70));
  assert.equal(apparentTempKma(-5, 70, 20), apparentTempWinter(-5, 20));
  // 두 지수 모두 부적용 구간 — 임의 보간하지 않는다.
  assert.equal(apparentTempKma(18, 70, 10), 18);
  // 겨울 구간이어도 풍속이 적용 하한(1.3m/s = 4.68km/h) 미만이면 기온 그대로.
  assert.equal(apparentTempKma(5, 70, 3), 5);
});

test("습도 결측·비정상이면 여름식을 쓰지 않는다 — 습구온도가 판정을 왜곡한다", () => {
  assert.equal(apparentTempKma(33, null, 10), 33);
  assert.equal(apparentTempKma(33, undefined, 10), 33);
  assert.equal(apparentTempKma(33, 0, 10), 33); // 0% = 결측 폴백 값
  assert.equal(apparentTempKma(33, 120, 10), 33); // 범위 밖
});

test("법정 임계 근처 실계산 — 폭염 조건에서 임계를 넘긴다", () => {
  // 기온 33℃·습도 60% 는 실제 한여름 광주 조건. 체감온도가 법정 33℃ 선에 도달해야 한다.
  const at = apparentTempKma(33, 60, 12);
  assert.ok(at >= 33 && at < 36, `체감온도 ${at.toFixed(2)}℃ 가 예상 범위를 벗어남`);
  // 습도가 높아지면 같은 기온에서 더 위험한 단계로 올라간다.
  assert.ok(apparentTempKma(33, 85, 12) > at);
});
