import { weatherLabel } from "./weather-code-label";
import { appWeatherEffects } from "./app-weather-effects";
// S 현장 화면의 읽기 모델. 관제 HTTP/인가를 거치지 않고 기존 조회·판정을 조합한다.
import { GET as getAppWorkers } from "../app/api/app/admin/workers/route";
import { warningsForLocation } from "../app/lib/kma";
import { geocodeAddress, vworldConfigured } from "../app/lib/vworld";
import { normalizeAedItems } from "./aed-devices";
import { aedCycleSev, aedRowSev, battDueDays, buildAedStatusInput, padDueDays, worstAedSev } from "./aed-status";
import {
  gaspodVbatMinuteMedians, getGaspodConfigs, getLatestSiteCoord, getLatestSiteInfo,
  getLatestWeatherDaily, listAedInspections, listAlerts, listGaspodTelemetry,
  listRegisteredAedDevices,
} from "./db";
import { type GaspodPower, gaspodPowerState } from "./gaspod-power";
import { readSiteWeather } from "./app-site-weather";
import {
  evaluateApparentTemp, evaluateDiscomfortIndex, evaluateKmaPreliminary, evaluateKmaWarning,
  evaluatePM25, evaluatePrecipitation, evaluateUV, evaluateWindKmh, type RuleSeverity,
} from "./weather-rules";
import { type SignalTone, workerSignalCopy } from "./worker-signal";

// 사양의 warn은 기존 caution의 API 표기일 뿐, 임계는 바꾸지 않는다.
function levelOf(severity: SignalTone) {
  return severity === "caution" ? "warn" : severity;
}

// cron/env-check와 같은 좌표 선택 순서. 좌표 부재/조회 실패는 기상 행에만 전파한다.
async function siteCoordinates() {
  const info = await getLatestSiteInfo().catch(() => null);
  const address = info?.address?.trim() ?? "";
  if (address && vworldConfigured()) {
    const g = await geocodeAddress(address).catch(() => ({ ok: false }) as const);
    if (g.ok) return { lat: g.lat, lon: g.lon, coordSource: "address" };
  }
  const coord = await getLatestSiteCoord();
  if (coord) return { lat: coord.lat, lon: coord.lon, coordSource: "cache" };
  const daily = await getLatestWeatherDaily();
  if (daily) return { lat: daily.lat, lon: daily.lon, coordSource: "weatherDaily" };
  throw new Error("저장된 현장 좌표 없음");
}

export async function readWeatherStatus() {
  const coords = await siteCoordinates();
  const [weather, warning] = await Promise.all([
    readSiteWeather(coords.lat, coords.lon), warningsForLocation(coords.lat, coords.lon),
  ]);
  const c = weather.current;
  // 관제의 항목별 판정을 한 번 계산해 종합 요약과 앱 위젯에 함께 사용한다.
  const metricEvaluations = {
    apparent: evaluateApparentTemp(c.apparentTempC),
    pm25: evaluatePM25(c.pm25), wind: evaluateWindKmh(c.windKmh, c.windGustKmh),
    uv: evaluateUV(c.uvIndex), rain: evaluatePrecipitation(c.precipitationMm),
  };
  const evaluations = [
    evaluateKmaWarning(warning), evaluateKmaPreliminary(warning),
    metricEvaluations.apparent, evaluateDiscomfortIndex(c.temperatureC, c.humidityPct),
    metricEvaluations.pm25, metricEvaluations.wind, metricEvaluations.uv, metricEvaluations.rain,
  ];
  const severity = worstAedSev(evaluations.map((e) => e.currentSeverity));
  const headline = evaluations.find((e) => e.currentSeverity === severity)!;
  const conditionEvaluations = evaluations.filter((e) => e.itemKey !== "pm25");
  const conditionSeverity = worstAedSev(conditionEvaluations.map((e) => e.currentSeverity));
  const conditionHeadline = conditionEvaluations.find((e) => e.currentSeverity === conditionSeverity)!;
  const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const forecast = weather.daily7;

  return {
    ok: true as const, level: levelOf(severity),
    summary: `${severity === "normal" ? warning.summary : `${headline.itemLabel} ${headline.currentValue}`} · ${warning.sido}`,
    ...coords, source: weather.source, cached: weather.cached, stale: weather.stale,
    persisted: weather.persisted, fetchedAt: weather.fetchedAt, current: c, warning,
    effects: appWeatherEffects(c),
    conditions: {
      level: levelOf(conditionSeverity),
      summary: `${conditionSeverity === "normal" ? warning.summary : `${conditionHeadline.itemLabel} ${conditionHeadline.currentValue}`} · ${warning.sido}`,
    },
    forecast: (forecast?.time ?? []).slice(0, 7).map((date: string, i: number) => {
      const code = numberOrNull(forecast?.weatherCode?.[i]);
      const probability = numberOrNull(forecast?.precipProbMax?.[i]);
      return { date, weatherCode: code, label: code === null ? null : weatherLabel(code),
        highC: numberOrNull(forecast?.tMax?.[i]), lowC: numberOrNull(forecast?.tMin?.[i]),
        precipitationProbabilityPct: probability !== null && probability >= 0 && probability <= 100 ? probability : null };
    }),
    // null은 판정 없음이다. 참고값·미수신을 정상 또는 종합 danger로 채우지 않는다.
    metricLevels: {
      temperature: null, humidity: null, pm10: null, wbgt: null,
      apparent: Number.isFinite(c.apparentTempC) ? levelOf(metricEvaluations.apparent.currentSeverity) : null,
      pm25: Number.isFinite(c.pm25) ? levelOf(metricEvaluations.pm25.currentSeverity) : null,
      wind: Number.isFinite(c.windKmh) && (c.windGustKmh === undefined || Number.isFinite(c.windGustKmh))
        ? levelOf(metricEvaluations.wind.currentSeverity) : null,
      uv: Number.isFinite(c.uvIndex) ? levelOf(metricEvaluations.uv.currentSeverity) : null,
      rain: Number.isFinite(c.precipitationMm) ? levelOf(metricEvaluations.rain.currentSeverity) : null,
    },
  };
}

type AppWorker = {
  workerId: string; name: string; tone: SignalTone; label: string; stale: boolean;
};

export async function readWorkersStatus(request: Request) {
  // 앱 workers GET을 인프로세스로 재사용한다. 게이트·PII 선별·끊김 판정을 복제하지 않는다.
  const response = await getAppWorkers(request);
  const data = await response.json() as {
    ok: boolean; workers: AppWorker[]; piiRedacted: boolean; now: string;
  };
  if (!response.ok || !data.ok) throw new Error("작업자 조회 실패");
  const workers = data.workers;
  const normal = workers.filter((w) => w.tone === "normal");
  const waiting = workers.filter((w) => w.tone === "idle");
  const caution = workers.filter((w) => w.tone === "caution");
  const danger = workers.filter((w) => w.tone === "danger");
  const copy = workerSignalCopy({
    count: workers.length, evaluated: workers.length - waiting.length,
    issues: workers.filter((w) => w.tone === "caution" || w.tone === "danger")
      .map((w) => ({ name: w.name, metrics: w.label })),
    waitingNames: waiting.map((w) => w.name), normalNames: normal.map((w) => w.name),
  });
  const severity = danger.length ? "danger" : caution.length ? "caution" : normal.length ? "normal" : "idle";
  return {
    ok: true as const, level: levelOf(severity), summary: copy.summary,
    total: workers.length, normal: normal.length, waiting: waiting.length,
    caution: caution.length, danger: danger.length, stale: workers.filter((w) => w.stale).length,
    piiRedacted: data.piiRedacted, fetchedAt: data.now, items: workers,
  };
}

// SiteSafetyTables의 비공개 함수와 동일. 관제 라우트 수정 없이 동등성 테스트로 차이를 검출한다.
// O₂/H₂S는 펌웨어와 동일, CO는 관제 표시의 raw ADC 임계다(ppm으로 환산하지 않는다).
function o2Sev(v: number): RuleSeverity {
  return v > 0 && v < 18.5 ? "danger" : v > 0 && v < 19.2 ? "caution" : "normal";
}
function mq7Sev(v: number): RuleSeverity {
  return v > 350 ? "danger" : v > 150 ? "caution" : "normal";
}
function mq136Sev(v: number): RuleSeverity {
  return v > 2200 ? "danger" : v > 1800 ? "caution" : "normal";
}

// gaspod/telemetry의 readPower 그대로. 전원 조회 실패는 null이며 가스 행 실패가 아니다.
async function readPower(): Promise<GaspodPower | null> {
  try {
    const mins = await gaspodVbatMinuteMedians(150);
    return mins.length ? gaspodPowerState(mins) : null;
  } catch {
    return null;
  }
}

export async function readGasStatus() {
  const [latest, power, configs] = await Promise.all([
    listGaspodTelemetry(1), readPower(), getGaspodConfigs(),
  ]);
  const sample = latest[0];
  if (!sample) {
    return { ok: true as const, level: "idle" as const, summary: "가스 수신 대기", power, gases: [], environment: null };
  }
  const gases = [
    { key: "o2", gas: "O₂ 산소", value: sample.o2, unit: "%" as const, severity: o2Sev(sample.o2) },
    { key: "co", gas: "CO 일산화탄소", value: sample.mq7_raw, unit: "raw" as const, severity: mq7Sev(sample.mq7_raw) },
    { key: "h2s", gas: "H₂S 황화수소", value: sample.mq136_raw, unit: "raw" as const, severity: mq136Sev(sample.mq136_raw) },
  ].map((g) => {
    const config = configs[`${sample.device_id}:${g.key}`];
    return { ...g, gas: config?.gas || g.gas, loc: config?.loc || "현장 가스 감지기" };
  });
  const severity = worstAedSev(gases.map((g) => g.severity));
  const headline = gases.find((g) => g.severity === severity)!;
  const labels = { normal: "정상", caution: "주의", danger: "위험" };
  return {
    ok: true as const, level: levelOf(severity),
    summary: `${headline.gas} ${labels[severity]} · ${headline.loc}`,
    deviceId: sample.device_id, lastSeenAt: sample.received_at, power,
    environment: {
      source: "gaspod" as const,
      temperatureC: Number.isFinite(sample.temp) ? sample.temp : null,
      humidityPct: Number.isFinite(sample.humidity) ? sample.humidity : null,
      pressureHpa: Number.isFinite(sample.pressure) ? sample.pressure : null,
      checkedAt: new Date().toISOString(),
      // 관제 IndoorEnvRows와 동일한 60초 수신 유효 기간. 앱에 임계/서버 시계를 복제하지 않는다.
      validForMs: (() => {
        const age = Date.now() - Date.parse(sample.received_at);
        return Number.isFinite(age) && age >= 0 ? Math.max(0, 60_000 - age) : 0;
      })(),
    },
    // 2026-09-14 SPEC-d4-app-admin-routes 정정: 워치 생체 원시값은 개인정보·민감정보 보호를 위해 계속 금지한다.
    // 가스포드 측정값은 개인정보·민감정보가 아니므로 최신 1건의 값·단위를 허용한다.
    // O₂는 %, CO·H₂S는 raw ADC 그대로이며 ppm 환산은 가스 임계 v2 과제다.
    // 가스 이력(720행)·펌웨어 state는 응답에 싣지 않는다.
    gases: gases.map(({ key, gas, loc, value, unit, severity: sev }) => ({ key, gas, loc, level: levelOf(sev), value, unit })),
  };
}

// SiteSafetyTables/buildRegisteredAedRow와 같은 날짜·이력 병합 기준.
function tsToDaysAgo(ts: string): number {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

export async function readAedStatus() {
  const [registered, inspections] = await Promise.all([listRegisteredAedDevices(), listAedInspections()]);
  const devices = registered.map((d) => {
    const input = buildAedStatusInput({
      ...d, lastSwapDaysAgo: tsToDaysAgo(d.lastSwapTs ?? d.registeredAt),
      extraHistory: inspections.filter((i) => i.aed_id === d.aedId)
        .map((i) => ({ daysAgo: tsToDaysAgo(i.ts), items: normalizeAedItems(i.items) })),
    });
    const severity = aedRowSev(input);
    const batteryDueDays = battDueDays(input);
    const padsDueDays = padDueDays(input);
    // 관제 aedStatus: 최악 차원 우선, 동률이면 본체 배터리를 패드보다 먼저 표시한다.
    const dimension = aedCycleSev(batteryDueDays) === severity ? "AED 배터리" : "전극패드";
    const summary = severity === "normal" ? "정상"
      : `${dimension} 교환 ${severity === "danger" ? "필요" : "임박"}`;
    return { deviceId: d.aedId, loc: d.loc, severity, summary, batteryDueDays, padsDueDays };
  });
  const severity = worstAedSev(devices.map((d) => d.severity));
  const headline = devices.find((d) => d.severity === severity);
  return {
    ok: true as const, level: devices.length ? levelOf(severity) : "idle" as const,
    summary: headline ? `${headline.summary} · ${headline.loc}` : "등록된 AED 없음",
    total: devices.length,
    devices: devices.map(({ severity: sev, ...d }) => ({ ...d, level: levelOf(sev) })),
  };
}

export async function readAlertsStatus() {
  const rows = await listAlerts(100);
  // 실제 컬럼 8개만. 현장 필터가 없으며 unacked도 이 최근 100건 안의 미확인 수다.
  const items = rows.map(({ id, worker_id, worker_name, type, ts, created_at, ack_at, ack_by }) => ({
    id, worker_id, worker_name, type, ts, created_at, ack_at, ack_by,
  }));
  return { ok: true as const, unacked: items.filter((r) => r.ack_at === null).length, siteScoped: false as const, items };
}
