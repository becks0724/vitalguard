// 캘린더 위험작업 × 일일 기상 예보 충돌 판정 — 순수 모듈(I/O 없음), 임계는 법정 기준 앵커
// 근거: 산업안전보건기준에 관한 규칙 제37조(악천후 작업중지)·제143조(타워크레인 순간풍속 10/15m/s),
// 폭염특보 기준(일 최고기온 33/35℃). 예보(Open-Meteo) 기반 참고 정보 — 작업중지 판단은 현장 책임자.

export type HazardTypeId =
  | "high_place"
  | "crane"
  | "hot_work"
  | "excavation"
  | "confined";

export const HAZARD_TYPES: { id: HazardTypeId; name: string }[] = [
  { id: "high_place", name: "고소작업" },
  { id: "crane", name: "크레인 양중" },
  { id: "hot_work", name: "화기작업" },
  { id: "excavation", name: "굴착" },
  { id: "confined", name: "밀폐공간" },
];

export const HAZARD_TYPE_IDS = HAZARD_TYPES.map((h) => h.id);

export function hazardTypeName(id: string | null | undefined): string | null {
  return HAZARD_TYPES.find((h) => h.id === id)?.name ?? null;
}

// 일일 예보 입력 — 값이 없으면(과거·예보창 밖·결측) 해당 축 판정을 건너뜀.
export type HazardDailyForecast = {
  windGustMs?: number | null; // 일 최대 돌풍(m/s) — 순간풍속 기준과 비교
  precipSumMm?: number | null; // 일 강수량 합(mm)
  tMaxC?: number | null; // 일 최고기온(℃)
};

export type HazardSeverity = "caution" | "danger";

export type HazardWarning = {
  severity: HazardSeverity;
  // 사람이 읽는 사유(예보값 + 기준 근거) — UI 경고 라인에 그대로 표시.
  messages: string[];
};

// 순간풍속 작업중지 계열(규칙 §37·§143) — 10m/s 주의 / 15m/s 위험.
const GUST_CAUTION_MS = 10;
const GUST_DANGER_MS = 15;
// 굴착 붕괴·침수(참고 기준) — 일 강수량 30mm 주의 / 50mm 위험.
const RAIN_EXCAVATION_CAUTION_MM = 30;
const RAIN_EXCAVATION_DANGER_MM = 50;
// 고소작업 미끄럼(참고 기준) — 일 강수량 10mm 주의.
const RAIN_SLIP_CAUTION_MM = 10;
// 밀폐공간 온열·질식 가중 — 폭염특보 기준 일 최고기온 33℃ 주의 / 35℃ 위험.
const HEAT_CAUTION_C = 33;
const HEAT_DANGER_C = 35;

const round1 = (v: number) => Math.round(v * 10) / 10;

function gustWarning(
  gustMs: number,
  dangerNote: string,
  cautionNote: string,
): { severity: HazardSeverity; message: string } | null {
  if (gustMs >= GUST_DANGER_MS) {
    return {
      severity: "danger",
      message: `돌풍 최대 ${round1(gustMs)}m/s 예보 — ${dangerNote}`,
    };
  }
  if (gustMs >= GUST_CAUTION_MS) {
    return {
      severity: "caution",
      message: `돌풍 최대 ${round1(gustMs)}m/s 예보 — ${cautionNote}`,
    };
  }
  return null;
}

// 위험작업 유형 × 일일 예보 → 경고(worst severity + 사유 목록) 또는 null(충돌 없음/판정 불가).
export function evaluateHazardWeather(
  hazard: string | null | undefined,
  forecast: HazardDailyForecast | null | undefined,
): HazardWarning | null {
  if (!hazard || !forecast) return null;
  if (!(HAZARD_TYPE_IDS as string[]).includes(hazard)) return null;

  const found: { severity: HazardSeverity; message: string }[] = [];
  const gust = forecast.windGustMs;
  const rain = forecast.precipSumMm;
  const tMax = forecast.tMaxC;

  if (typeof gust === "number" && Number.isFinite(gust)) {
    if (hazard === "crane") {
      const w = gustWarning(
        gust,
        "타워크레인 운전 중지 기준(순간풍속 15m/s) 초과 · 규칙 §143",
        "타워크레인 설치·수리·해체 중지 기준(순간풍속 10m/s) 초과 · 규칙 §143",
      );
      if (w) found.push(w);
    } else if (hazard === "high_place") {
      const w = gustWarning(
        gust,
        "강풍 — 고소작업 중지 검토(순간풍속 15m/s) · 규칙 §37",
        "강풍 — 고소작업 주의(순간풍속 10m/s 초과) · 규칙 §37",
      );
      if (w) found.push(w);
    } else if (hazard === "hot_work") {
      const w = gustWarning(
        gust,
        "강풍 — 불티 비산 위험 큼(순간풍속 15m/s 초과), 화기작업 중지 검토",
        "강풍 — 불티 비산 주의(순간풍속 10m/s 초과), 방화 조치 강화",
      );
      if (w) found.push(w);
    }
  }

  if (typeof rain === "number" && Number.isFinite(rain)) {
    if (hazard === "excavation") {
      if (rain >= RAIN_EXCAVATION_DANGER_MM) {
        found.push({
          severity: "danger",
          message: `일 강수량 ${round1(rain)}mm 예보 — 굴착면 붕괴·침수 위험, 작업 중지 검토(참고 기준 50mm)`,
        });
      } else if (rain >= RAIN_EXCAVATION_CAUTION_MM) {
        found.push({
          severity: "caution",
          message: `일 강수량 ${round1(rain)}mm 예보 — 굴착면 붕괴 주의·배수 점검(참고 기준 30mm)`,
        });
      }
    } else if (hazard === "high_place" && rain >= RAIN_SLIP_CAUTION_MM) {
      found.push({
        severity: "caution",
        message: `일 강수량 ${round1(rain)}mm 예보 — 발판 미끄럼 주의(참고 기준 10mm)`,
      });
    }
  }

  if (hazard === "confined" && typeof tMax === "number" && Number.isFinite(tMax)) {
    if (tMax >= HEAT_DANGER_C) {
      found.push({
        severity: "danger",
        message: `일 최고기온 ${round1(tMax)}℃ 예보 — 밀폐공간 온열·질식 위험 가중(폭염경보 기준 35℃)`,
      });
    } else if (tMax >= HEAT_CAUTION_C) {
      found.push({
        severity: "caution",
        message: `일 최고기온 ${round1(tMax)}℃ 예보 — 밀폐공간 환기·휴식 강화(폭염주의보 기준 33℃)`,
      });
    }
  }

  if (found.length === 0) return null;
  return {
    severity: found.some((f) => f.severity === "danger") ? "danger" : "caution",
    messages: found.map((f) => f.message),
  };
}

// km/h(Open-Meteo wind_speed_unit=kmh) → m/s. 환산 누락 시 3.6배 과대 경고가 나므로 단일 헬퍼로 고정.
export function kmhToMs(kmh: number): number {
  return kmh / 3.6;
}
