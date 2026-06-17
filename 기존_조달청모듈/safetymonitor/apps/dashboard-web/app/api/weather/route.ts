// 위치 기반 날씨 + 대기질 — Open-Meteo (API key 불필요, 무료, CORS 허용)
import { NextResponse } from "next/server";

import { persistWeather } from "../../../lib/db";

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
    humidityPct: number;
    windKmh: number;
    precipitationMm: number;
    uvIndex: number;
    pm10?: number;
    pm25?: number;
  };
  daily: {
    sunrise?: string;
    sunset?: string;
  };
  // 일주일 기상예보 — 날씨 항목 클릭 시 모달 표시용
  daily7: {
    time: string[];
    weatherCode: number[];
    tMax: number[];
    tMin: number[];
    precipProbMax: (number | null)[];
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
    try {
      persistWeather({
        lat,
        lon,
        workerCount: Number.isFinite(workerCountRaw) ? workerCountRaw : undefined,
        weatherCode: data.current.weatherCode,
        temperatureC: data.current.temperatureC,
        apparentTempC: data.current.apparentTempC,
        humidityPct: data.current.humidityPct,
        windKmh: data.current.windKmh,
        precipitationMm: data.current.precipitationMm,
        uvIndex: data.current.uvIndex,
        pm10: data.current.pm10,
        pm25: data.current.pm25,
        sunrise: data.daily.sunrise,
        sunset: data.daily.sunset,
      });
    } catch (persistError) {
      console.error("[weather] persist failed:", persistError);
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

async function fetchWeather(lat: number, lon: number): Promise<WeatherPayload> {
  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", lat.toString());
  forecastUrl.searchParams.set("longitude", lon.toString());
  forecastUrl.searchParams.set(
    "current",
    "weather_code,temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,uv_index",
  );
  forecastUrl.searchParams.set(
    "daily",
    "sunrise,sunset,weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
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

  return {
    source: "open-meteo",
    lat,
    lon,
    current: {
      weatherCode: forecast?.current?.weather_code ?? 0,
      temperatureC: forecast?.current?.temperature_2m ?? 0,
      apparentTempC: forecast?.current?.apparent_temperature ?? 0,
      humidityPct: forecast?.current?.relative_humidity_2m ?? 0,
      windKmh: forecast?.current?.wind_speed_10m ?? 0,
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
    },
    hourly: {
      time: hTime.slice(startIdx, endIdx),
      temperatureC: hTemp.slice(startIdx, endIdx),
    },
    fetchedAt: new Date().toISOString(),
  };
}
