// WBGT(습구흑구온도) 산출 — Liljegren et al. (2008) 물리 모델. 표준 기상 관측만으로 계산한다.
//
// 출처 = Liljegren, Carhart, Lawday, Tschopp, Sharp,
//        "Modeling the Wet Bulb Globe Temperature Using Standard Meteorological Measurements",
//        Journal of Occupational and Environmental Hygiene 5(10):645-655, 2008.
//        OSHA 공식 WBGT 계산기가 채택한 모델이고, 표준 기상 입력 기반 방법 중 가장 검증됐다
//        (문헌 정확도 95% 확률로 ±1.8℃).
// 수식 대조 = anacv/HeatStress R 구현(원 Fortran → VBA → R 이식)의 fTg·fTnwb·calZenith.
//
// 습구·흑구 '센서'의 에너지 균형을 각각 풀어 자연습구온도(Tnwb)·흑구온도(Tg)를 구하고 합친다.
//   WBGT = 0.7·Tnwb + 0.2·Tg + 0.1·Ta   (실외 · 일사 있음)
//
// ⚠ 한국 법정 기준이 아니다. 폭염작업 판정은 체감온도(기상청 식)이고 이 값은 국제 표준 참고
//    지표다 — 법정 판정을 대체하지 않는다. 결정·검증 = docs/wbgt/context-notes.md

/** Stefan-Boltzmann 상수 W/(m²·K⁴) */
const STEFAN_BOLTZMANN = 5.6696e-8;
/** 건조 공기 정압비열 J/(kg·K) */
const CP = 1003.5;
const M_AIR = 28.97;
const M_H2O = 18.015;
const R_GAS = 8314.34;
const R_AIR = R_GAS / M_AIR;
/** 열·물질 전달 비 — 습구식의 evap 항에 쓰인다. */
const RATIO = (CP * M_AIR) / M_H2O;
/** Prandtl 수 */
const PR = CP / (CP + 1.25 * R_AIR);

/**
 * 지표면 상수. 알베도 0.45 는 **OSHA 계산기 구현값**이다(참조 R 은 0.4 를 기본값으로 두지만
 * 대조에서 그 차이가 흑구 복사항에 그대로 드러났다 — 2026-08-14 5케이스 실측).
 */
const EMIS_SFC = 0.999;
const ALB_SFC = 0.45;
/** 흑구 센서 — 표준 50mm 검은 구. */
const EMIS_GLOBE = 0.95;
const ALB_GLOBE = 0.05;
const DIAM_GLOBE = 0.05;
/** 습구 심지 센서 */
const EMIS_WICK = 0.95;
const ALB_WICK = 0.4;
const DIAM_WICK = 0.007;
const LEN_WICK = 0.0254;

/**
 * 풍속 하한 m/s — OSHA 구현값 1 mph. 0 이면 대류 계산의 거듭제곱이 무너진다.
 * 종전 0.1 m/s 는 저풍속 케이스에서 대류 방출을 과소평가해 흑구온도가 과대로 튀었다.
 */
const MIN_WIND_MS = 0.44704;
/**
 * 10m 관측 풍속 → 센서 높이(2m) 환산 계수.
 *
 * Liljegren 은 **센서 높이 풍속**을 전제하는데 우리 입력(Open-Meteo `wind_speed_10m`)은 10m 다.
 * 보정 없이 넣으면 대류 방출이 과대평가돼 흑구온도가 낮게 나온다. 0.67959 는 OSHA 계산기가
 * 쓰는 고정 계수로, 표준 멱법칙(0.7944)이 아니라 로그 프로파일 기반이다 — 대조로 확인했다.
 */
const WIND_10M_TO_2M = 0.67959;
/** 고정점 반복 상한·허용 오차 */
const MAX_ITER = 200;
const TOLERANCE = 1e-4;
/**
 * 반복 감쇠 계수 — 원 Liljegren Fortran 이 쓰는 `prev = 0.9·prev + 0.1·next`.
 *
 * 없으면 **발산한다**(실측). 에너지 균형식의 대류 항 계수가 `h/(ε·σ)` = 10⁸ 규모라 직전 추정이
 * 조금만 어긋나도 우변이 크게 튄다. 참조 R 구현이 고정점 대신 `optimize()` 로 |f(x)−x| 를
 * 최소화한 것도 같은 이유로 보인다. 감쇠를 넣으면 원본대로 수렴한다.
 */
const DAMPING = 0.1;

/** 공기 점성 계수 Pa·s */
function viscosity(tempK: number): number {
  const omega = ((tempK / 97 - 2.9) / 0.4) * -0.034 + 1.048;
  return (0.0000026693 * Math.sqrt(28.97 * tempK)) / (3.617 ** 2 * omega);
}

/** 공기 열전도도 W/(m·K) */
function thermalCond(tempK: number): number {
  return (CP + 1.25 * R_AIR) * viscosity(tempK);
}

/** 수증기 확산계수 m²/s */
function diffusivity(tempK: number, pressureHpa: number): number {
  const pcrit13 = (36.4 * 218) ** (1 / 3);
  const tcrit512 = (132 * 647.3) ** (5 / 12);
  const tcrit12 = Math.sqrt(132 * 647.3);
  const mmix = Math.sqrt(1 / 28.97 + 1 / 18.015);
  return (
    ((0.000364 * (tempK / tcrit12) ** 2.334 * pcrit13 * tcrit512 * mmix) /
      (pressureHpa / 1013.25)) *
    0.0001
  );
}

/** 포화 수증기압 hPa (습윤 공기 보정 포함) */
function esat(tempK: number): number {
  return 1.004 * 6.1121 * Math.exp((17.502 * (tempK - 273.15)) / (tempK - 32.18));
}

/** 대기 방사율 — 수증기압의 함수 */
function emisAtm(tempK: number, rhFraction: number): number {
  return 0.575 * (rhFraction * esat(tempK)) ** 0.143;
}

/** 증발 잠열 J/kg */
function heatOfEvaporation(tempK: number): number {
  return ((313.15 - tempK) / 30) * -71100 + 2407300;
}

/** 구(球) 주위 대류 열전달계수 W/(m²·K) — 흑구 센서용 */
function hSphereInAir(tempK: number, pressureHpa: number, windMs: number): number {
  const thermCon = thermalCond(tempK);
  const density = (pressureHpa * 100) / (R_AIR * tempK);
  const speed = Math.max(windMs, MIN_WIND_MS);
  const re = (speed * density * DIAM_GLOBE) / viscosity(tempK);
  const nu = 2 + 0.6 * Math.sqrt(re) * PR ** 0.3333;
  return (nu * thermCon) / DIAM_GLOBE;
}

/** 원통 횡류 대류 열전달계수 W/(m²·K) — 습구 심지용 */
function hCylinderInAir(tempK: number, pressureHpa: number, windMs: number): number {
  const thermCon = thermalCond(tempK);
  const density = (pressureHpa * 100) / (R_AIR * tempK);
  const speed = Math.max(windMs, MIN_WIND_MS);
  const re = (speed * density * DIAM_WICK) / viscosity(tempK);
  const nu = 0.281 * re ** 0.6 * PR ** 0.44;
  return (nu * thermCon) / DIAM_WICK;
}

/**
 * 태양 천정각(라디안) — NOAA 표준 근사.
 *
 * ⚠ 참조 R 구현은 `TimeOffset = 0` 으로 두어 **경도 보정을 생략**한다(주석에 "위성용에만 필요"라
 * 적혀 있다). 우리는 표준대로 균시차와 경도를 반영한다 — 광주(126.85°E)처럼 표준시 자오선에서
 * 떨어진 곳은 보정 없이는 태양시가 수십 분 어긋나 일사 입사각이 틀어진다.
 * 검증 기준은 R 구현이 아니라 OSHA 계산기이므로 물리적으로 맞는 쪽을 택한다.
 */
export function solarZenithRad(date: Date, lat: number, lon: number): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const doy = Math.floor((date.getTime() - start) / 86_400_000) + 1;
  const year = date.getUTCFullYear();
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInYear = isLeap ? 366 : 365;
  const utcHour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  // 연중 위치(라디안)
  const gamma = (2 * Math.PI * (doy - 1 + utcHour / 24)) / daysInYear;

  // 균시차(분)
  const equTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  // 태양 적위(라디안)
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  // 진태양시(분) — 균시차 + 경도(1° 당 4분)
  const trueSolarTime = utcHour * 60 + equTime + 4 * lon;
  const hourAngle = ((trueSolarTime / 4 - 180) * Math.PI) / 180;

  const latRad = (lat * Math.PI) / 180;
  let cosZen =
    Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngle);
  cosZen = Math.min(1, Math.max(-1, cosZen));
  return Math.acos(cosZen);
}

/** 천정각 경계 보정 — 일사가 있는데 태양이 지평선 아래면 모델이 발산한다. */
function clampZenith(zenithRad: number, radiation: number): { zenith: number; radiation: number } {
  let z = zenithRad <= 0 ? 1e-10 : zenithRad;
  let r = radiation;
  if (r > 0 && z > 1.57) z = 1.57;
  if (r > 15 && z > 1.54) z = 1.54;
  if (r > 900 && z > 1.52) z = 1.52;
  if (r < 10 && z === 1.57) r = 0;
  return { zenith: z, radiation: r };
}

type SensorInput = {
  tempC: number;
  rhFraction: number;
  pressureHpa: number;
  windMs: number;
  radiation: number;
  propDirect: number;
  zenithRad: number;
};

/**
 * 흑구온도(℃) — 복사 흡수와 대류 방출의 균형점을 고정점 반복으로 찾는다.
 * 수렴하지 못하면 null(판정 불가) — 억지로 마지막 값을 쓰지 않는다.
 */
export function globeTempC(input: SensorInput): number | null {
  const { zenith, radiation } = clampZenith(input.zenithRad, input.radiation);
  const tairK = input.tempC + 273.15;
  const tsfcK = tairK;
  const cza = Math.cos(zenith);
  const ea = emisAtm(tairK, input.rhFraction);

  let tglobe = tairK;
  for (let i = 0; i < MAX_ITER; i += 1) {
    const tref = 0.5 * (tglobe + tairK);
    const h = hSphereInAir(tref, input.pressureHpa, input.windMs);
    const next =
      (0.5 * (ea * tairK ** 4 + EMIS_SFC * tsfcK ** 4) -
        (h / (EMIS_GLOBE * STEFAN_BOLTZMANN)) * (tglobe - tairK) +
        (radiation / (2 * EMIS_GLOBE * STEFAN_BOLTZMANN)) *
          (1 - ALB_GLOBE) *
          (input.propDirect * (1 / (2 * cza) - 1) + 1 + ALB_SFC)) **
      0.25;
    if (!Number.isFinite(next)) return null;
    if (Math.abs(next - tglobe) < TOLERANCE) return next - 273.15;
    tglobe = (1 - DAMPING) * tglobe + DAMPING * next;
  }
  return null;
}

/**
 * 자연습구온도(℃) — 증발 냉각·복사 가열·대류의 균형점.
 *
 * 심리습구온도(Stull 등)와 다르다 — 자연습구는 **복사와 바람에 노출된** 젖은 심지의 온도라
 * 일사가 강하면 심리습구보다 높다. WBGT 에서 가중치 0.7 로 가장 큰 항이라 대체 근사가 안 된다.
 */
export function naturalWetBulbC(input: SensorInput): number | null {
  const { zenith, radiation } = clampZenith(input.zenithRad, input.radiation);
  const tairK = input.tempC + 273.15;
  const tsfcK = tairK;
  const ea = emisAtm(tairK, input.rhFraction);
  const eair = input.rhFraction * esat(tairK);
  const density = (input.pressureHpa * 100) / (tairK * R_AIR);

  let twb = tairK;
  for (let i = 0; i < MAX_ITER; i += 1) {
    const tref = 0.5 * (twb + tairK);
    // 복사 가열 항 — 직달분은 심지의 원통 기하(tan(zenith))로, 산란분은 전방위로 들어온다.
    const fatm =
      STEFAN_BOLTZMANN *
        EMIS_WICK *
        (0.5 * (ea * tairK ** 4 + EMIS_SFC * tsfcK ** 4) - twb ** 4) +
      (1 - ALB_WICK) *
        radiation *
        ((1 - input.propDirect) * (1 + (0.25 * DIAM_WICK) / LEN_WICK) +
          (Math.tan(zenith) / Math.PI + (0.25 * DIAM_WICK) / LEN_WICK) * input.propDirect +
          ALB_SFC);
    const sc = viscosity(tairK) / (density * diffusivity(tref, input.pressureHpa));
    const h = hCylinderInAir(twb, input.pressureHpa, input.windMs);
    const ewick = esat(twb);
    const evap = heatOfEvaporation(twb);
    const next =
      tairK -
      ((evap / RATIO) * (ewick - eair)) / (input.pressureHpa - ewick) * (PR / sc) ** 0.56 +
      fatm / h;
    if (!Number.isFinite(next)) return null;
    if (Math.abs(next - twb) < TOLERANCE) return next - 273.15;
    twb = (1 - DAMPING) * twb + DAMPING * next;
  }
  return null;
}

export type WbgtInput = {
  /** 기온 ℃ */
  tempC: number;
  /** 상대습도 % */
  humidityPct: number;
  /** 풍속 km/h (Open-Meteo 계약) */
  windKmh: number;
  /** 직달 일사 W/m² */
  directRadiation: number;
  /** 산란 일사 W/m² */
  diffuseRadiation: number;
  /** 관측 시각 */
  at: Date;
  lat: number;
  lon: number;
  /** 기압 hPa — 없으면 표준 대기 */
  pressureHpa?: number;
};

export type WbgtResult = {
  /** 습구흑구온도 ℃ */
  wbgt: number;
  /** 자연습구온도 ℃ */
  naturalWetBulb: number;
  /** 흑구온도 ℃ */
  globeTemp: number;
  /** 직달 비율 — 참조 구현은 0.8 고정 가정이나 우리는 실측을 쓴다. */
  propDirect: number;
};

/**
 * WBGT 산출. 수렴 실패·입력 결측이면 null(판정 불가) — 0 이나 근사값으로 때우지 않는다.
 *
 * ★ 직달 비율은 가정하지 않는다. 참조 구현은 `propDirect = 0.8` 로 고정하는데, Open-Meteo 가
 * 직달·산란을 나눠 주므로 실측 비율을 쓴다(흐린 날엔 0.04 수준까지 떨어져 가정과 크게 다르다).
 * 원 모델에서도 그 자리는 관측값을 넣는 파라미터라 표준을 벗어나는 변경이 아니다.
 */
export function computeWbgt(input: WbgtInput): WbgtResult | null {
  const { tempC, humidityPct, windKmh, directRadiation, diffuseRadiation } = input;
  if (
    !Number.isFinite(tempC) ||
    !(humidityPct > 0 && humidityPct <= 100) ||
    !Number.isFinite(windKmh) ||
    !Number.isFinite(directRadiation) ||
    !Number.isFinite(diffuseRadiation)
  ) {
    return null;
  }

  const radiation = directRadiation + diffuseRadiation;
  const propDirect = radiation > 0 ? directRadiation / radiation : 0;
  const sensor: SensorInput = {
    tempC,
    rhFraction: humidityPct / 100,
    pressureHpa: input.pressureHpa ?? 1013.25,
    windMs: windKmh / 3.6,
    radiation,
    propDirect,
    zenithRad: solarZenithRad(input.at, input.lat, input.lon),
  };
  // 센서 높이 환산은 여기서 한 번만 — 헬퍼가 아니라 입력 조립부에서 처리해야 두 센서(구·원통)가
  // 같은 값을 본다.
  sensor.windMs = Math.max(sensor.windMs * WIND_10M_TO_2M, MIN_WIND_MS);

  const tg = globeTempC(sensor);
  const tnwb = naturalWetBulbC(sensor);
  if (tg === null || tnwb === null) return null;

  return {
    wbgt: 0.7 * tnwb + 0.2 * tg + 0.1 * tempC,
    naturalWetBulb: tnwb,
    globeTemp: tg,
    propDirect,
  };
}
