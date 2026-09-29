// 기상청 초단기실황 클라이언트 — 법정 폭염 판정의 입력을 '관측값'으로 만든다.
//
// 왜 필요한가. 법령은 폭염작업 기준으로 **"기상청이 측정한 체감온도"**를 지정한다. 산출식은
// 2026-08-14 오전에 기상청 식으로 교체했으나 **입력은 여전히 Open-Meteo** 였다 — 그쪽은 관측이
// 아니라 수치예보 모델의 격자 분석값이라 실측과 구조적으로 벌어진다.
//   실측 대조(2026-08-14 16:14 광주) — 관측소 30.2℃/67% vs Open-Meteo 26.6℃/86% (기온 3.6℃ 차)
//   그 차이가 법정 임계 31℃ 를 사이에 두고 판정을 갈랐다(관측 = 폭염작업 / 우리 = 정상).
// 초단기실황은 AWS 관측을 격자화한 값이라 관측 기반이다(같은 시각 30.5℃ — 관측소와 0.3℃ 차).
//
// ⚠ 알려진 한계 — **갱신 지연.** 매시 정각 관측을 40분 후에 제공하므로 40분~1시간 40분 뒤처진다.
//    급변 구간에서는 이 지연이 판정을 가를 수 있다(실측: 15:00 습도 53% → 16:14 67%, 체감 30.31 →
//    31.24 로 임계 통과). 지연 없는 AWS 매분 관측은 별도 활용신청이 필요해 다음 단계로 둔다.
//    화면에는 관측 시각을 함께 표기해 값의 나이를 숨기지 않는다.

type CacheEntry<T> = { ts: number; data: T };
const g = globalThis as typeof globalThis & {
  __smKmaObsCache?: Map<string, CacheEntry<unknown>>;
};
const cache = g.__smKmaObsCache ?? (g.__smKmaObsCache = new Map());
/** 실황은 매시 갱신이라 10분 캐시로 충분하다(호출 한도 절약). */
const TTL_MS = 10 * 60 * 1000;

function getCached<T>(k: string): T | null {
  const h = cache.get(k) as CacheEntry<T> | undefined;
  return h && Date.now() - h.ts < TTL_MS ? h.data : null;
}
function setCached<T>(k: string, d: T) {
  cache.set(k, { ts: Date.now(), data: d });
}

const BASE = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0";
const TIMEOUT_MS = 8000;

// KMA 전용 키 우선, 없으면 KOSHA 키(같은 data.go.kr 계정 공통키) 폴백 — kma.ts 와 동일 규칙.
function serviceKey(): string | null {
  return (
    process.env.KMA_SERVICE_KEY?.trim() || process.env.KOSHA_SERVICE_KEY?.trim() || null
  );
}

// 기상청 격자 변환 상수(Lambert Conformal Conic) — 기상청 공개 사양 그대로. 임의 조정 금지.
const RE = 6371.00877; // 지구 반경(km)
const GRID = 5.0; // 격자 간격(km)
const SLAT1 = 30.0;
const SLAT2 = 60.0;
const OLON = 126.0;
const OLAT = 38.0;
const XO = 43;
const YO = 136;

/** 위경도 → 기상청 격자(nx, ny). 광주(35.16, 126.85) = (58, 74). */
export function toKmaGrid(lat: number, lon: number): { nx: number; ny: number } {
  const D = Math.PI / 180;
  const re = RE / GRID;
  const slat1 = SLAT1 * D;
  const slat2 = SLAT2 * D;
  const olon = OLON * D;
  const olat = OLAT * D;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (sf ** sn * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / ro ** sn;
  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5);
  ra = (re * sf) / ra ** sn;
  let theta = lon * D - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

/**
 * 조회 기준 시각 — 실황은 매시 정각 관측이 **40분 후**에 올라온다.
 * 45분을 빼면 항상 '이미 제공된 가장 최근 정시'를 가리킨다.
 */
export function baseDateTime(now: Date): { baseDate: string; baseTime: string; observedAt: Date } {
  const kst = new Date(now.getTime() + 9 * 3_600_000 - 45 * 60_000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const h = String(kst.getUTCHours()).padStart(2, "0");
  // 관측 시각(UTC 기준 Date) — 표시·나이 계산용.
  const observedAt = new Date(Date.UTC(y, kst.getUTCMonth(), kst.getUTCDate(), kst.getUTCHours()) - 9 * 3_600_000);
  return { baseDate: `${y}${m}${d}`, baseTime: `${h}00`, observedAt };
}

export type KmaObservation = {
  /** 기온 ℃ */
  temperatureC: number;
  /** 상대습도 % */
  humidityPct: number;
  /** 풍속 m/s */
  windMs: number;
  /** 초단기 강수형태 PTY. 미수신·알 수 없는 코드는 없음. */
  precipitationType?: number;
  /** 관측 시각(정시) */
  observedAt: string;
};

type NcstItem = { category: string; obsrValue: string };

/**
 * 초단기실황 조회. 키가 없거나 조회 실패면 **null** — 호출부가 Open-Meteo 로 폴백한다.
 * 목업을 만들지 않는다(법정 판정 입력이라 가짜 값이 판정에 들어가면 안 된다).
 */
export async function fetchKmaObservation(
  lat: number,
  lon: number,
  now: Date = new Date(),
): Promise<KmaObservation | null> {
  const key = serviceKey();
  if (!key) return null;

  const { nx, ny } = toKmaGrid(lat, lon);
  const { baseDate, baseTime, observedAt } = baseDateTime(now);
  const cacheKey = `${nx},${ny},${baseDate},${baseTime}`;
  const hit = getCached<KmaObservation>(cacheKey);
  if (hit) return hit;

  const url = new URL(`${BASE}/getUltraSrtNcst`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "100");
  url.searchParams.set("dataType", "JSON");
  url.searchParams.set("base_date", baseDate);
  url.searchParams.set("base_time", baseTime);
  url.searchParams.set("nx", String(nx));
  url.searchParams.set("ny", String(ny));

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      response?: { body?: { items?: { item?: NcstItem[] } } };
    };
    const items = body.response?.body?.items?.item;
    if (!Array.isArray(items)) return null;

    const v = new Map(items.map((i) => [i.category, Number(i.obsrValue)]));
    const temperatureC = v.get("T1H");
    const humidityPct = v.get("REH");
    const windMs = v.get("WSD");
    // 하나라도 비면 섞어 쓰지 않는다 — 기온만 관측이고 습도는 모델이면 체감온도가 뒤섞인다.
    if (
      !Number.isFinite(temperatureC) ||
      !Number.isFinite(humidityPct) ||
      !(humidityPct! > 0 && humidityPct! <= 100)
    ) {
      return null;
    }

    const out: KmaObservation = {
      temperatureC: temperatureC!,
      humidityPct: humidityPct!,
      windMs: Number.isFinite(windMs) ? windMs! : 0,
      observedAt: observedAt.toISOString(),
      precipitationType: parsePrecipitationType(items.find((i) => i.category === "PTY")?.obsrValue),
    };
    setCached(cacheKey, out);
    return out;
  } catch {
    // 상류 장애로 관제웹 전체가 멈추면 안 된다 — 폴백은 호출부 책임.
    return null;
  }
}

// 실황 서비스: https://www.data.go.kr/data/15084084/openapi.do
// 기상청 초단기 코드: https://data.kma.go.kr/data/rmt/rmtList.do?code=410&pgmNo=571
export function parsePrecipitationType(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^[0123567]$/.test(value.trim())) return undefined;
  return Number(value.trim());
}
