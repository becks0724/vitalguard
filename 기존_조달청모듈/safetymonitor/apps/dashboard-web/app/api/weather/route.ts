// 위치 기반 날씨 + 대기질 — Open-Meteo (API key 불필요, 무료, CORS 허용)
import { NextResponse } from "next/server";

import { apparentTempKma } from "../../../lib/apparent-temp";
import { computeWbgt } from "../../../lib/wbgt";
import { fetchKmaObservation } from "../../lib/kma-observation";
import {
  persistWeather,
  persistWeatherDaily,
  getLatestWeatherDaily,
  type WeatherDailyRow,
} from "../../../lib/db";
import { verifyBasicAuth } from "../../../lib/admin-auth";
import { cronAuth } from "../../../lib/cron-auth";
import { notifyEnvAlerts, ruleEvalToItem } from "../../../lib/env-alert-notify";
import {
  evaluateApparentTemp,
  evaluateDiscomfortIndex,
  evaluatePM25,
  evaluatePrecipitation,
  evaluateUV,
  evaluateWindKmh,
} from "../../../lib/weather-rules";

type CacheEntry = {
  ts: number;
  data: WeatherPayload;
};

type WeatherPayload = {
  source: "open-meteo";
  lat: number;
  lon: number;
  current: {
    weatherCode: number;
    temperatureC: number;
    apparentTempC: number;
    /** 판정 입력 출처 — `kma-ncst`(기상청 초단기실황·관측 기반) 또는 `open-meteo`(폴백). */
    obsSource?: "kma-ncst" | "open-meteo";
    /** 관측 시각(정시 ISO) — 실황은 40분~1시간 40분 지연될 수 있어 값의 나이를 함께 보인다. */
    obsAt?: string;
    /** WBGT(습구흑구온도 ℃) — 국제 표준 참고 지표. 법정 판정은 체감온도가 담당한다. 산출 실패 시 없음. */
    wbgt?: number;
    humidityPct: number;
    windKmh: number;
    // 순간풍속(돌풍·km/h) — 크레인/고소 중지 임계(규칙 §37·§143)가 순간풍속 기준이라 판정에 필수.
    // 구 DB 폴백 행 등 미보유 시 undefined(평균풍속 폴백 판정).
    windGustKmh?: number;
    precipitationMm: number;
    uvIndex: number;
    pm10?: number;
    pm25?: number;
  };
  daily: {
    sunrise?: string;
    sunset?: string;
  };
  // 일주일 기상예보 — 날씨 항목 클릭 시 모달 표시용 + 캘린더 위험작업 기상 충돌 판정용
  daily7: {
    time: string[];
    weatherCode: number[];
    tMax: number[];
    tMin: number[];
    precipProbMax: (number | null)[];
    // 위험작업 판정 입력 — 일 최대 돌풍(km/h·wind_speed_unit 따름)·일 강수량 합(mm)
    windGustMaxKmh: (number | null)[];
    precipSumMm: (number | null)[];
  };
  // 현재 시각부터 24시간 시간대별 기온 — 기온 항목 클릭 시 모달 표시용
  hourly: {
    time: string[];
    temperatureC: number[];
  };
  fetchedAt: string;
};

const globalForWeatherCache = globalThis as typeof globalThis & {
  __safetyMonitorWeatherCache?: Map<string, CacheEntry>;
};

const cache =
  globalForWeatherCache.__safetyMonitorWeatherCache ??
  (globalForWeatherCache.__safetyMonitorWeatherCache = new Map());

const CACHE_TTL_MS = 5 * 60 * 1000;
// 업스트림(Open-Meteo) 단건 호출 타임아웃 — 무한 hang 방지.
const UPSTREAM_TIMEOUT_MS = 6000;

function cacheKey(lat: number, lon: number) {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

// AbortController 로 타임아웃을 건 fetch — 업스트림이 멈춰도 매달리지 않게.
async function fetchWithTimeout(url: URL, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 일시적 업스트림 장애(타임아웃·연결 실패·5xx)에 대비해 1회 재시도.
async function fetchForecast(url: URL): Promise<Response> {
  try {
    const res = await fetchWithTimeout(url, UPSTREAM_TIMEOUT_MS);
    if (res.ok || res.status < 500) return res;
  } catch {
    /* 네트워크/타임아웃 — 아래에서 1회 재시도 */
  }
  return fetchWithTimeout(url, UPSTREAM_TIMEOUT_MS);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const latParam = url.searchParams.get("lat");
  const lonParam = url.searchParams.get("lon");

  if (latParam === null || lonParam === null) {
    return NextResponse.json(
      { ok: false, error: "lat, lon query params required" },
      { status: 400 },
    );
  }

  const lat = Number(latParam);
  const lon = Number(lonParam);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      { ok: false, error: "lat, lon must be numeric" },
      { status: 400 },
    );
  }

  const key = cacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json({ ok: true, cached: true, ...cached.data });
  }

  try {
    const data = await fetchWeather(lat, lon);
    cache.set(key, { ts: Date.now(), data });

    // 캐시 미스(=5분마다 신규 fetch) 시에만 이력 저장 — 산업재해 시점 환경 근거.
    // workers 파라미터 부재 시 Number(null)===0 이 finite 라 0 으로 오기록되던 버그 → raw null 먼저 차단.
    const workersParam = url.searchParams.get("workers");
    const workerCountRaw = workersParam === null ? NaN : Number(workersParam);
    const snapshot = {
      lat,
      lon,
      workerCount: Number.isFinite(workerCountRaw) ? workerCountRaw : undefined,
      weatherCode: data.current.weatherCode,
      temperatureC: data.current.temperatureC,
      apparentTempC: data.current.apparentTempC,
      humidityPct: data.current.humidityPct,
      windKmh: data.current.windKmh,
      windGustKmh: data.current.windGustKmh,
      precipitationMm: data.current.precipitationMm,
      uvIndex: data.current.uvIndex,
      pm10: data.current.pm10,
      pm25: data.current.pm25,
      sunrise: data.daily.sunrise,
      sunset: data.daily.sunset,
    };
    // 부작용(DB 쓰기·알림)은 로그인 세션이 있을 때만 수행한다. 조회 자체는 공개로 유지한다.
    // 과거에는 무인증 GET 이 그대로 쓰기까지 했고, weather_daily 는 하루 1행 upsert 라
    // 외부인이 curl 한 번으로 폭염 기록을 덮어쓸 수 있었다(감사 BE-AUTHZ-02).
    // 로그인 세션 또는 Cloud Scheduler 크론 키. 크론은 브라우저 없이 도는 무인 24/7 경로라
    // 세션이 없다 — 여기서 인정하지 않으면 현장환경 알림이 조용히 멈춘다.
    const trusted =
      verifyBasicAuth(request) ||
      cronAuth(request.headers.get("x-cron-key"), process.env.CRON_SECRET) === "ok";
    if (!trusted) {
      console.warn("[weather] 무인증 조회 — 이력 저장·환경 알림을 건너뛴다");
    }
    if (trusted) {
      try {
        await persistWeather(snapshot); // 상세 이력(fresh fetch 마다)
        await persistWeatherDaily(snapshot); // 일별 대표 snapshot(하루 1행 upsert, 당일 마지막값 유지)
      } catch (persistError) {
        console.error("[weather] persist failed:", persistError);
      }
    }

    // 현장환경 위험 자동 텔레그램 알림(주의+위험 전이) — fresh fetch 시점 서버 판정.
    // 실패는 삼켜 날씨 응답을 막지 않는다(발송기·상태저장 모두 내부에서 예외 처리).
    if (trusted) {
      try {
        const c = data.current;
        await notifyEnvAlerts(
          [
            evaluateApparentTemp(c.apparentTempC),
            evaluateDiscomfortIndex(c.temperatureC, c.humidityPct),
            evaluatePM25(c.pm25),
            evaluateWindKmh(c.windKmh, c.windGustKmh),
            evaluateUV(c.uvIndex),
            evaluatePrecipitation(c.precipitationMm),
          ].map(ruleEvalToItem),
        );
      } catch (notifyError) {
        console.error("[weather] env alert notify failed:", notifyError);
      }
    }

    return NextResponse.json({ ok: true, cached: false, ...data });
  } catch (error) {
    // 일시적 업스트림 장애 — 직전 캐시(만료됐어도)가 있으면 그걸로 graceful degrade.
    // 24/7 관제에서 한 번의 블립이 현장환경 패널을 통째로 깨뜨리지 않게 한다.
    const stale = cache.get(key);
    if (stale) {
      return NextResponse.json({
        ok: true,
        cached: true,
        stale: true,
        ...stale.data,
      });
    }

    // 인메모리 캐시가 비었을 때(재배포·콜드스타트) DB 에 저장된 일별 대표 기상으로 폴백.
    // Open-Meteo 예보 호스트 장애 등으로 fresh fetch 가 계속 실패해도 마지막 기상으로 graceful degrade
    // (502 로 현장환경 패널을 통째로 깨뜨리지 않게). daily7/hourly(예보 모달)는 미보관이라 빈 값.
    try {
      const persisted = await getLatestWeatherDaily();
      if (persisted && persisted.temperature_c !== null) {
        return NextResponse.json({
          ok: true,
          cached: true,
          stale: true,
          persisted: true,
          ...weatherPayloadFromDaily(persisted, lat, lon),
        });
      }
    } catch (dbError) {
      console.error("[weather] DB fallback failed:", dbError);
    }

    return NextResponse.json(
      {
        ok: false,
        error: "weather upstream failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

// DB 일별 대표 기상 → WeatherPayload 재구성(폴백용). current+daily 는 복원, daily7/hourly 는 미보관→빈 값.
function weatherPayloadFromDaily(
  row: WeatherDailyRow,
  lat: number,
  lon: number,
): WeatherPayload {
  return {
    source: "open-meteo",
    lat,
    lon,
    current: {
      weatherCode: row.weather_code ?? 0,
      temperatureC: row.temperature_c ?? 0,
      apparentTempC: row.apparent_temp_c ?? 0,
      humidityPct: row.humidity_pct ?? 0,
      windKmh: row.wind_kmh ?? 0,
      windGustKmh: row.wind_gust_kmh ?? undefined,
      precipitationMm: row.precipitation_mm ?? 0,
      uvIndex: row.uv_index ?? 0,
      pm10: row.pm10 ?? undefined,
      pm25: row.pm25 ?? undefined,
    },
    daily: {
      sunrise: row.sunrise ?? undefined,
      sunset: row.sunset ?? undefined,
    },
    daily7: {
      time: [],
      weatherCode: [],
      tMax: [],
      tMin: [],
      precipProbMax: [],
      windGustMaxKmh: [],
      precipSumMm: [],
    },
    hourly: { time: [], temperatureC: [] },
    fetchedAt: row.recorded_at,
  };
}

async function fetchWeather(lat: number, lon: number): Promise<WeatherPayload> {
  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", lat.toString());
  forecastUrl.searchParams.set("longitude", lon.toString());
  forecastUrl.searchParams.set(
    "current",
    // apparent_temperature 는 받지 않는다 — 체감온도는 기상청 식으로 자체 산출한다(아래 주석).
    // direct/diffuse 일사는 WBGT(Liljegren) 복사 항의 입력 — 기상청 초단기실황엔 일사량이 없다.
    "weather_code,temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation,uv_index,direct_radiation,diffuse_radiation",
  );
  forecastUrl.searchParams.set(
    "daily",
    "sunrise,sunset,weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_gusts_10m_max,precipitation_sum",
  );
  forecastUrl.searchParams.set("hourly", "temperature_2m");
  forecastUrl.searchParams.set("forecast_days", "7");
  forecastUrl.searchParams.set("timezone", "auto");
  forecastUrl.searchParams.set("wind_speed_unit", "kmh");

  const airUrl = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  airUrl.searchParams.set("latitude", lat.toString());
  airUrl.searchParams.set("longitude", lon.toString());
  airUrl.searchParams.set("current", "pm10,pm2_5");
  airUrl.searchParams.set("timezone", "auto");

  const [forecastRes, airRes] = await Promise.all([
    fetchForecast(forecastUrl),
    // 대기질은 보조 항목 — 실패해도 전체를 깨뜨리지 않게 best-effort.
    fetchWithTimeout(airUrl, UPSTREAM_TIMEOUT_MS).catch(() => null),
  ]);

  if (!forecastRes.ok) {
    throw new Error(`forecast HTTP ${forecastRes.status}`);
  }
  const forecast = await forecastRes.json();
  const air = airRes && airRes.ok ? await airRes.json() : null;

  // 시간대별 기온 — 현재 시각이 속한 시간대부터 24시간만 슬라이스(과거 시간 제외).
  const hTime: string[] = forecast?.hourly?.time ?? [];
  const hTemp: number[] = forecast?.hourly?.temperature_2m ?? [];
  const currentTime: string = forecast?.current?.time ?? "";
  let startIdx = hTime.findIndex((t) => t >= currentTime);
  if (startIdx < 0) startIdx = 0;
  // findIndex 는 현재 시각 이상의 첫 칸 → 현재 시각이 속한 직전 시간대를 포함하도록 한 칸 당김
  if (startIdx > 0 && (hTime[startIdx] ?? "") > currentTime) startIdx -= 1;
  const endIdx = startIdx + 24;

  // 체감온도는 업스트림 값을 쓰지 않고 기상청 산출식으로 직접 계산한다 —
  // 법령이 폭염작업 기준으로 지정한 것이 '기상청 체감온도'이기 때문(docs/apparent-temp-kma/).
  // Open-Meteo 의 apparent_temperature(Steadman 식)는 정의가 달라 판정 단계가 어긋난다.
  //
  // ★ 입력도 기상청 관측(초단기실황)을 우선한다 — 식만 바꾸고 입력을 Open-Meteo(수치예보 모델
  // 격자 분석값)로 두면 법령이 말하는 '기상청이 측정한' 값이 아니다. 실측 대조에서 기온이
  // 3.6℃ 벌어져 법정 임계 31℃ 판정이 갈렸다(2026-08-14). 실황 조회 실패 시에만 업스트림 폴백.
  const omTempC: number = forecast?.current?.temperature_2m ?? 0;
  const omHumidityPct: number = forecast?.current?.relative_humidity_2m ?? 0;
  const omWindKmh: number = forecast?.current?.wind_speed_10m ?? 0;

  const obs = await fetchKmaObservation(lat, lon).catch(() => null);
  const curTempC = obs?.temperatureC ?? omTempC;
  const curHumidityPct = obs?.humidityPct ?? omHumidityPct;
  // 풍속은 체감온도(여름철)에 안 들어가지만 겨울철 식과 표시에 쓰인다 — 출처를 섞지 않는다.
  const curWindKmh = obs ? obs.windMs * 3.6 : omWindKmh;

  return {
    source: "open-meteo",
    lat,
    lon,
    current: {
      weatherCode: forecast?.current?.weather_code ?? 0,
      temperatureC: curTempC,
      apparentTempC: apparentTempKma(curTempC, curHumidityPct, curWindKmh),
      // 판정 입력의 출처와 나이를 숨기지 않는다 — 실황은 40분~1시간 40분 지연될 수 있다.
      obsSource: obs ? "kma-ncst" : "open-meteo",
      obsAt: obs?.observedAt,
      // WBGT(Liljegren 2008) — **참고 지표**다. 법정 폭염 판정은 체감온도가 담당하고 여기엔
      // 임계를 붙이지 않는다(ACGIH TLV 는 대사율이 필요해 별도 트랙). 산출 실패면 undefined.
      // ⚠ 입력 혼합 — 기온·습도·풍속은 기상청 관측, 일사량만 Open-Meteo(실황에 일사가 없다).
      wbgt:
        computeWbgt({
          tempC: curTempC,
          humidityPct: curHumidityPct,
          windKmh: curWindKmh,
          directRadiation: forecast?.current?.direct_radiation ?? 0,
          diffuseRadiation: forecast?.current?.diffuse_radiation ?? 0,
          at: new Date(),
          lat,
          lon,
        })?.wbgt,
      humidityPct: curHumidityPct,
      windKmh: curWindKmh,
      windGustKmh: forecast?.current?.wind_gusts_10m ?? undefined,
      precipitationMm: forecast?.current?.precipitation ?? 0,
      uvIndex: forecast?.current?.uv_index ?? 0,
      pm10: air?.current?.pm10,
      pm25: air?.current?.pm2_5,
    },
    daily: {
      sunrise: forecast?.daily?.sunrise?.[0],
      sunset: forecast?.daily?.sunset?.[0],
    },
    daily7: {
      time: forecast?.daily?.time ?? [],
      weatherCode: forecast?.daily?.weather_code ?? [],
      tMax: forecast?.daily?.temperature_2m_max ?? [],
      tMin: forecast?.daily?.temperature_2m_min ?? [],
      precipProbMax: forecast?.daily?.precipitation_probability_max ?? [],
      windGustMaxKmh: forecast?.daily?.wind_gusts_10m_max ?? [],
      precipSumMm: forecast?.daily?.precipitation_sum ?? [],
    },
    hourly: {
      time: hTime.slice(startIdx, endIdx),
      temperatureC: hTemp.slice(startIdx, endIdx),
    },
    fetchedAt: new Date().toISOString(),
  };
}
