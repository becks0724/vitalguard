// 기상청 체감온도 산출식 — 법정 폭염 판정(31/33/35℃)의 입력을 만드는 순수 함수.
//
// 왜 직접 계산하는가. 법령(산업안전보건기준에 관한 규칙)은 "기상청이 측정한 체감온도"를
// 폭염작업 기준으로 지정한다. 종전엔 Open-Meteo 의 apparent_temperature(Steadman 식)를
// 그대로 판정에 썼는데, 그 식은 풍속을 계수 -0.7 로 반영해 **바람 부는 폭염일에 값을 낮춘다**.
// 기상청 여름철 식에는 풍속 항이 아예 없어서, 같은 날씨인데 우리 화면만 법정 임계 33℃ 를
// 안 넘은 것으로 표시했다(= 휴식 의무 미발동). 결정·근거 = docs/apparent-temp-kma/context-notes.md

/** 겨울철 식 적용 하한 풍속(m/s) — 기상청 공식 적용 조건. */
const WINTER_MIN_WIND_MS = 1.3;
/** 겨울철 식 적용 상한 기온(℃) — 기상청 공식 적용 조건. */
const WINTER_MAX_TEMP_C = 10;
/**
 * 여름철 식 적용 하한 기온(℃).
 *
 * 기상청은 여름철 지수를 5~9월로 운영해 기온 경계가 따로 없다. 월 기준을 쓰면 4월·10월
 * 폭염일이 누락되므로 기온 기준으로 두되, 법정 임계 31℃ 보다 6℃ 아래에서 시작해
 * 경계 근처에서 산출식이 바뀌는 일이 없게 한다.
 */
const SUMMER_MIN_TEMP_C = 25;

/**
 * 습구온도 추정 (Stull 2011) — 기온·상대습도만으로 산출한다.
 *
 * 기상청 여름철 체감온도가 이 값을 입력으로 받는다. atan 은 라디안.
 */
export function wetBulbStull(tempC: number, humidityPct: number): number {
  const rh = humidityPct;
  return (
    tempC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(tempC + rh) -
    Math.atan(rh - 1.67633) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    4.686035
  );
}

/**
 * 여름철 체감온도 (기상청 2022-06-02 개정식).
 *
 * ★ 인자에 풍속이 없는 것이 이 식의 핵심이다 — 넣으려 하지 말 것.
 */
export function apparentTempSummer(tempC: number, humidityPct: number): number {
  const tw = wetBulbStull(tempC, humidityPct);
  return (
    -0.2442 +
    0.55399 * tw +
    0.45535 * tempC -
    0.0022 * tw * tw +
    0.00278 * tw * tempC +
    3.0
  );
}

/**
 * 겨울철 체감온도 (JAG/TI 2001 · 기상청 채택). 풍속은 km/h.
 */
export function apparentTempWinter(tempC: number, windKmh: number): number {
  const v = Math.pow(windKmh, 0.16);
  return 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * v * tempC;
}

/**
 * 기상청 체감온도 — 구간에 맞는 식을 고른다.
 *
 * 두 지수는 각자의 적용 범위 밖에서 물리적으로 무의미하므로, 어느 쪽도 아닌 구간은
 * 기온을 그대로 돌려준다(임의 보간하지 않는다).
 * 습도가 유효 범위를 벗어나면(결측 폴백 등) 여름철 식을 쓰지 않는다 — 습구온도가
 * 실제와 무관한 값이 되어 판정을 왜곡한다.
 */
export function apparentTempKma(
  tempC: number,
  humidityPct: number | null | undefined,
  windKmh: number | null | undefined,
): number {
  const rh = humidityPct ?? NaN;
  const hasHumidity = Number.isFinite(rh) && rh > 0 && rh <= 100;
  if (tempC >= SUMMER_MIN_TEMP_C && hasHumidity) {
    return apparentTempSummer(tempC, rh);
  }

  const kmh = windKmh ?? NaN;
  const hasWind = Number.isFinite(kmh) && kmh >= WINTER_MIN_WIND_MS * 3.6;
  if (tempC <= WINTER_MAX_TEMP_C && hasWind) {
    return apparentTempWinter(tempC, kmh);
  }

  return tempC;
}
