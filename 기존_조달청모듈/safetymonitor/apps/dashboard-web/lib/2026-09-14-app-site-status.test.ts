// 실제 GET·앱 게이트·작업자 선별·공용 판정을 실행한다. DB와 외부 통신만 격리한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";

import * as appJwt from "./app-jwt";
import * as aedDevices from "./aed-devices";
import * as aedStatus from "./aed-status";
import * as power from "./gaspod-power";
import * as vitalAge from "./vital-age";
import * as workerSignal from "./worker-signal";
import * as weatherRules from "./weather-rules";
import * as weatherCode from "./weather-code-label";
import * as weatherEffects from "./app-weather-effects";
import { apparentTempKma } from "./apparent-temp";
import type * as siteStatus from "./app-site-status";
import type * as siteWeather from "./app-site-weather";
import type { AppAdminGate } from "./app-admin-auth";
import type { AedInspectionRow, AlertRow, GaspodTelemetryRow, RegisteredAedDevice, WeatherDailyRow } from "./db";
import type { LocationWarning } from "../app/lib/kma";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const NOW = Date.parse("2026-09-14T03:00:00Z");
class FixtureDate extends Date {
  constructor(value: string | number = NOW) { super(value); }
  static override now() { return NOW; }
}
const codeCache = new Map<string, string>();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
function loadModule<T>(path: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  let code = codeCache.get(path);
  if (!code) {
    code = ts.transpileModule(read(path), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    codeCache.set(path, code);
  }
  const module = { exports: {} };
  runInNewContext(code, {
    module, exports: module.exports, Date: FixtureDate,
    require: (name: string) => {
      assert.ok(Object.hasOwn(imports, name), `실 DB/통신을 허용하지 않은 의존성: ${name}`);
      return imports[name];
    },
    console: { warn: () => {}, error: () => {} }, ...globals,
  });
  return module.exports as T;
}

const savedSecret = process.env.APP_JWT_SECRET;
before(() => { process.env.APP_JWT_SECRET = "site-status-fixture-not-a-credential"; });
after(() => {
  if (savedSecret === undefined) delete process.env.APP_JWT_SECRET;
  else process.env.APP_JWT_SECRET = savedSecret;
});
function token() {
  return appJwt.signMobileAccessJwt({
    sub: "fixture-admin", role: "admin", name: "검증 관리자", workerId: "fixture-worker",
    sessionId: "11111111-2222-3333-4444-555555555555",
  });
}
function request(jwt: string | null = token()) {
  return new Request("http://fixture.test/api/app/admin/site-status", {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
  });
}
type Reader = "weather" | "workers" | "gas" | "aed" | "alerts";
function harness(exposePii = false) {
  const state = {
    fail: null as Reader | "power" | "inspections" | "gas-config" | "warning" | null,
    user: { username: "fixture-admin", role: "admin", status: "approved", admin_access: true },
    userLookupFails: false,
    pendingWeather: null as Promise<void> | null,
    calls: [] as { name: string; args: unknown[] }[],
    samples: [{ workerId: "worker-1", workerName: "작업자", ts: new FixtureDate().toISOString(),
      heartRate: 80, latitude: 35.1, longitude: 126.9, locationAccuracyMeters: 8,
      guardianName: "보호자", guardianPhone: "010-fixture", lastAccurateLat: 35.2, lastAccurateLon: 126.8,
    }] as Record<string, unknown>[],
    gas: [{ device_id: "gaspod-01", received_at: new FixtureDate().toISOString(),
      o2: 20.9, mq7_raw: 151, mq136_raw: 10, temp: 21, humidity: 55, pressure: 1000,
      vbat: 4.1, state: "CLEAR", acked: false,
    }] as GaspodTelemetryRow[],
    mins: Array.from({ length: 150 }, (_, i) => ({ vbat: 4.1, ts: new Date(NOW - (149 - i) * 60_000).toISOString() })),
    aeds: [{ aedId: "AED-real", loc: "지하 주차장 B1", product: null, manager: "검증 관리자",
      devBatt: 1, battCycleMonths: 12, padCycleMonths: 24,
      lastSwapTs: new Date(NOW - 280 * 86400000).toISOString(), registeredAt: new FixtureDate().toISOString(),
    }] as RegisteredAedDevice[],
    inspections: [] as AedInspectionRow[],
    alerts: ["sos", "fall", "vital", "geofence"].map((type, i) => ({
      id: i + 1, worker_id: "worker-1", worker_name: "작업자", type, ts: new FixtureDate().toISOString(),
      created_at: new FixtureDate().toISOString(), ack_at: i < 2 ? null : new FixtureDate().toISOString(),
      ack_by: i < 2 ? null : "fixture-admin",
    })) as AlertRow[],
    coords: { lat: 35.1, lon: 126.9 } as { lat: number; lon: number } | null,
    address: "",
    geo: { ok: true, lat: 35.2, lon: 126.8 },
    daily: null as WeatherDailyRow | null,
    forecast: { time: ["2026-09-14", "2026-09-15"], weatherCode: [0, 61], tMax: [27, 21], tMin: [19, 15], precipProbMax: [3, 4] as (number | null)[] },
    current: { weatherCode: 0, temperatureC: 20, apparentTempC: 20, humidityPct: 30,
      windKmh: 0, windGustKmh: 0, precipitationMm: 0, uvIndex: 0, pm25: 0 },
    warning: { source: "live", sido: "광주", warnings: [], severity: "normal", summary: "특보 없음",
      preliminary: [], preliminarySeverity: "normal", preliminarySummary: "예정 특보 없음",
    } as LocationWarning,
  };
  const call = (name: string, args: unknown[] = []) => { state.calls.push({ name, args }); };
  const fail = (name: typeof state.fail) => {
    if (state.fail === name) throw new Error("내부 DB 주소·토큰 등 노출 금지");
  };
  const gate = loadModule<{ requireAppAdmin: (r: Request) => Promise<AppAdminGate> }>("lib/app-admin-auth.ts", {
    "./app-jwt": appJwt,
    "./db": { findUserByUsername: async () => {
      if (state.userLookupFails) throw new Error("권한 DB 실패");
      return state.user;
    } },
  });
  const workers = loadModule<{ GET: (r: Request) => Promise<Response> }>("app/api/app/admin/workers/route.ts", {
    "next/server": { NextResponse }, "../../../../../lib/app-admin-auth": gate,
    "../../../../../lib/vital-age": vitalAge, "../../../../../lib/worker-signal": workerSignal,
    "../../vital/store": {
      workerAliases: async () => ({}), coreTempEstimates: async () => ({}),
      rosterWorkerNamesMap: async () => ({}), workerProfiles: async () => ({}),
      latestByWorkerWithSpo2: async () => { call("workers"); fail("workers"); return state.samples; },
    },
  }, { process: { env: { MOCK_VITAL_EXPOSE_PII: String(exposePii) } } });
  const readers = loadModule<typeof siteStatus>("lib/app-site-status.ts", {
    "../app/api/app/admin/workers/route": workers,
    "../app/lib/kma": { warningsForLocation: async (...args: unknown[]) => {
      call("warning", args); fail("warning"); return state.warning;
    } },
    "../app/lib/vworld": {
      vworldConfigured: () => true,
      geocodeAddress: async (address: string) => { call("geocode", [address]); return state.geo; },
    },
    "./aed-devices": aedDevices, "./aed-status": aedStatus,
    "./gaspod-power": loadModule<typeof power>("lib/gaspod-power.ts", {}),
    "./worker-signal": workerSignal, "./weather-rules": weatherRules, "./weather-code-label": weatherCode, "./app-weather-effects": weatherEffects,
    "./app-site-weather": { readSiteWeather: async (...args: unknown[]) => {
      call("weather", args); fail("weather");
      if (state.pendingWeather) await state.pendingWeather;
      return { cached: true, stale: false, persisted: false, source: "open-meteo",
        fetchedAt: new FixtureDate().toISOString(), current: state.current, daily7: state.forecast };
    } },
    "./db": {
      getLatestSiteInfo: async () => ({ address: state.address }),
      getLatestSiteCoord: async () => state.coords, getLatestWeatherDaily: async () => state.daily,
      listGaspodTelemetry: async (limit: number) => { call("gas", [limit]); fail("gas"); return state.gas; },
      gaspodVbatMinuteMedians: async (minutes: number) => { call("power", [minutes]); fail("power"); return state.mins; },
      getGaspodConfigs: async () => {
        fail("gas-config"); return { "gaspod-01:co": { loc: "탱크 야드", gas: null } };
      },
      listRegisteredAedDevices: async () => { call("aed"); fail("aed"); return state.aeds; },
      listAedInspections: async () => { fail("inspections"); return state.inspections; },
      listAlerts: async (limit: number) => { call("alerts", [limit]); fail("alerts"); return state.alerts; },
    },
  });
  const route = loadModule<{ GET: (r: Request) => Promise<Response> }>("app/api/app/admin/site-status/route.ts", {
    "next/server": { NextResponse }, "../../../../../lib/app-admin-auth": gate,
    "../../../../../lib/app-site-status": readers,
  });
  return { ...route, state, readers };
}

test("정상 응답은 네 행·경보·수신 시각이며 브라우저 캐시를 금지한다", async () => {
  const h = harness();
  const response = await h.GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.deepEqual(Object.keys(data).sort(), ["aed", "alerts", "fetchedAt", "gas", "ok", "weather", "workers"]);
  assert.equal(data.fetchedAt, new FixtureDate().toISOString());
  assert.equal(data.weather.cached, true);
  assert.equal(data.weather.summary, "특보 없음 · 광주");
  assert.equal(data.workers.normal, 1);
  assert.equal(data.gas.level, "warn");
  assert.equal(data.aed.level, "warn");
  assert.equal(data.alerts.unacked, 2);
});

for (const failed of ["weather", "workers", "gas", "aed", "alerts"] as const) {
  test(`${failed}만 실패해도 다른 네 결과가 살아 온다`, async () => {
    const h = harness(); h.state.fail = failed;
    const response = await h.GET(request());
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    for (const key of ["weather", "workers", "gas", "aed", "alerts"]) {
      assert.equal(data[key].ok, key !== failed, key);
    }
    assert.deepEqual(Object.keys(data[failed]).sort(), ["error", "ok"]);
    assert.doesNotMatch(JSON.stringify(data), /내부 DB 주소/);
  });
}

test("무인증·레거시 수집 토큰은 실제 게이트에서 401, 행 조회는 0회", async () => {
  for (const jwt of [null, appJwt.signAppJwt({ sub: "fixture-admin", role: "admin", name: null, workerId: null })]) {
    const h = harness();
    const response = await h.GET(request(jwt));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: "unauthorized", action: "reauth" });
    assert.equal(h.state.calls.length, 0);
  }
});

test("권한 회수 403·권한 DB 실패 503을 게이트 응답 그대로 보존한다", async () => {
  const h = harness(); h.state.user.admin_access = false;
  let response = await h.GET(request());
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "forbidden" });
  h.state.userLookupFails = true;
  response = await h.GET(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: "권한 확인 실패" });
  assert.equal(h.state.calls.length, 0);
});

test("가스 세 종류는 최신 측정값·단위를 기존 표시 필드·판정과 함께 반환한다", async () => {
  const h = harness();
  const data = await (await h.GET(request())).json();
  assert.deepEqual(data.gas.gases, [
    { key: "o2", gas: "O₂ 산소", loc: "현장 가스 감지기", level: "normal", value: 20.9, unit: "%" },
    { key: "co", gas: "CO 일산화탄소", loc: "탱크 야드", level: "warn", value: 151, unit: "raw" },
    { key: "h2s", gas: "H₂S 황화수소", loc: "현장 가스 감지기", level: "normal", value: 10, unit: "raw" },
  ]);
});

test("측정값 0도 보존하며 단위는 O₂만 %, CO·H₂S는 ppm 환산 없이 raw다", async () => {
  const h = harness();
  Object.assign(h.state.gas[0]!, { o2: 0, mq7_raw: 0, mq136_raw: 0 });
  const data = await (await h.GET(request())).json();
  assert.deepEqual(data.gas.gases.map((g: { key: string; value: number; unit: string }) => [g.key, g.value, g.unit]), [
    ["o2", 0, "%"], ["co", 0, "raw"], ["h2s", 0, "raw"],
  ]);
});

test("가스는 최신 1건만 반환한다 — 720행 이력·펌웨어 state 제외", async () => {
  const h = harness();
  h.state.gas.push(...Array.from({ length: 719 }, () => ({ ...h.state.gas[0]!,
    device_id: "old-gaspod", received_at: new Date(NOW - 60_000).toISOString(),
    o2: 9999, mq7_raw: 9999, mq136_raw: 9999,
  })));
  const data = await (await h.GET(request())).json();
  assert.equal(data.gas.level, "warn"); // 최신 CLEAR라도 관제 CO 151은 주의, 과거 9999는 무시
  assert.equal(data.gas.summary, "CO 일산화탄소 주의 · 탱크 야드");
  assert.equal(data.gas.deviceId, "gaspod-01");
  assert.equal(data.gas.lastSeenAt, new FixtureDate().toISOString());
  assert.deepEqual(Object.keys(data.gas).sort(), ["deviceId", "environment", "gases", "lastSeenAt", "level", "ok", "power", "summary"]);
  assert.equal(data.gas.gases.length, 3);
  for (const gas of data.gas.gases) {
    assert.deepEqual(Object.keys(gas).sort(), ["gas", "key", "level", "loc", "unit", "value"]);
  }
  assert.deepEqual(data.gas.gases.map((g: { value: number }) => g.value), [20.9, 151, 10]);
  assert.deepEqual(h.state.calls.find((c) => c.name === "gas")?.args, [1]);
  assert.deepEqual(h.state.calls.find((c) => c.name === "power")?.args, [150]);
  assert.doesNotMatch(JSON.stringify(data.gas), /mq7_raw|mq136_raw|vbat|"humidity":|"pressure":|"o2":|"temp":|"rows":|"latest":|"history":|acked|CLEAR|old-gaspod|9999/);
  assert.deepEqual(data.gas.power, power.gaspodPowerState(h.state.mins, NOW));
  assert.equal(data.gas.power.state, "full_on_power");
});

test("가스 임계 경계값·0값 판정과 전체 최악 단계는 그대로다", async () => {
  const cases = [
    { key: "o2", field: "o2", values: [[0, "normal"], [18.49, "danger"], [18.5, "warn"], [19.19, "warn"], [19.2, "normal"]] },
    { key: "co", field: "mq7_raw", values: [[0, "normal"], [150, "normal"], [151, "warn"], [350, "warn"], [351, "danger"]] },
    { key: "h2s", field: "mq136_raw", values: [[0, "normal"], [1800, "normal"], [1801, "warn"], [2200, "warn"], [2201, "danger"]] },
  ] as const;
  const h = harness();
  for (const { key, field, values } of cases) {
    for (const [value, level] of values) {
      Object.assign(h.state.gas[0]!, { o2: 20.9, mq7_raw: 0, mq136_raw: 0, [field]: value });
      const data = await (await h.GET(request())).json();
      assert.equal(data.gas.level, level, `${key}=${value}`);
      assert.deepEqual(data.gas.gases.map((g: { key: string; level: string }) => [g.key, g.level]),
        ["o2", "co", "h2s"].map((k) => [k, k === key ? level : "normal"]), `${key}=${value}`);
    }
  }
});

test("전원 조회 실패·표본 없음은 기존 readPower와 같이 null만 반환한다", async () => {
  const h = harness(); h.state.fail = "power";
  let data = await (await h.GET(request())).json();
  assert.equal(data.gas.ok, true); assert.equal(data.gas.power, null);
  h.state.fail = null; h.state.mins = [];
  data = await (await h.GET(request())).json();
  assert.equal(data.gas.power, null);
});

for (const exposePii of [false, true]) {
  test(`기존 workers PII 선별 그대로 — 스위치 ${exposePii}`, async () => {
    const h = harness(exposePii);
    const data = await (await h.GET(request())).json();
    assert.equal(data.workers.piiRedacted, !exposePii);
    assert.equal(Object.hasOwn(data.workers.items[0], "latitude"), exposePii);
    assert.equal(Object.hasOwn(data.workers.items[0], "longitude"), exposePii);
    assert.doesNotMatch(JSON.stringify(data), /guardianName|guardianPhone|lastAccurateLat|lastAccurateLon/);
  });
}

test("작업자 정상·대기·끊김을 기존 tone으로 집계하고 낡은 생체를 비운다", async () => {
  const h = harness();
  h.state.samples.push(...Array.from({ length: 3 }, (_, i) => ({ workerId: `wait-${i}`, ts: new FixtureDate().toISOString() })));
  let data = await (await h.GET(request())).json();
  assert.equal(data.workers.normal, 1); assert.equal(data.workers.waiting, 3);
  assert.equal(data.workers.summary, "정상 1명 · 대기 3명");
  h.state.samples[0]!.ts = new Date(NOW - 86400000).toISOString();
  data = await (await h.GET(request())).json();
  assert.equal(data.workers.level, "warn"); assert.equal(data.workers.normal, 0);
  assert.equal(data.workers.stale, 1); assert.equal(data.workers.items[0].heartRate, null);
  assert.equal(data.workers.waiting, 3);
});

test("AED는 NFC 배터리·패드 교환을 병합하고 낮은 단말 잔량으로 위험을 만들지 않는다", async () => {
  const h = harness();
  let data = await (await h.GET(request())).json();
  assert.equal(data.aed.summary, "AED 배터리 교환 임박 · 지하 주차장 B1");
  assert.equal(data.aed.devices[0].batteryDueDays, 80);
  h.state.inspections = [{ id: 1, aed_id: "AED-real", loc: null, inspector: "검증",
    items: '["battery"]', ts: new FixtureDate().toISOString(), source: "nfc", created_at: new FixtureDate().toISOString() }];
  data = await (await h.GET(request())).json();
  assert.equal(data.aed.level, "normal");
  assert.equal(data.aed.devices[0].batteryDueDays, 360);
  assert.equal(data.aed.devices[0].padsDueDays, 440);
});

test("AED 교환 주기 경과는 danger, 동률은 본체 배터리를 먼저 표시한다", async () => {
  const h = harness();
  Object.assign(h.state.aeds[0]!, { padCycleMonths: 12, lastSwapTs: new Date(NOW - 361 * 86400000).toISOString() });
  const data = await (await h.GET(request())).json();
  assert.equal(data.aed.level, "danger");
  assert.equal(data.aed.summary, "AED 배터리 교환 필요 · 지하 주차장 B1");
});

test("NFC 이력·가스 설정 조회 실패도 해당 행에만 표시한다", async () => {
  for (const [failure, row] of [["inspections", "aed"], ["gas-config", "gas"], ["warning", "weather"]] as const) {
    const h = harness(); h.state.fail = failure;
    const data = await (await h.GET(request())).json();
    assert.equal(data[row].ok, false); assert.equal(data.alerts.ok, true);
  }
});

test("수신/등록 데이터가 없으면 idle이며 목업 장비·정상 인원을 만들지 않는다", async () => {
  const h = harness(); h.state.samples = []; h.state.gas = []; h.state.aeds = [];
  const data = await (await h.GET(request())).json();
  for (const key of ["workers", "gas", "aed"]) assert.equal(data[key].level, "idle");
  assert.equal(data.workers.total, 0); assert.equal(data.aed.total, 0);
});

test("경보는 최근 100건·4종·실제 8컬럼만, 현장 범위로 표시하지 않는다", async () => {
  const h = harness(); Object.assign(h.state.alerts[0]!, { site_id: "위조", latitude: 35, secret: "제외" });
  const data = await (await h.GET(request())).json();
  assert.deepEqual(h.state.calls.find((c) => c.name === "alerts")?.args, [100]);
  assert.equal(data.alerts.siteScoped, false); assert.equal(data.alerts.unacked, 2);
  assert.deepEqual(data.alerts.items.map((a: { type: string }) => a.type), ["sos", "fall", "vital", "geofence"]);
  assert.deepEqual(Object.keys(data.alerts.items[0]).sort(), ["ack_at", "ack_by", "created_at", "id", "ts", "type", "worker_id", "worker_name"]);
});

test("기상은 관제 체감온도·순간풍속·특보·예비특보 규칙의 최악 단계를 사용한다", async () => {
  const h = harness();
  h.state.current.apparentTempC = 33;
  let data = await (await h.GET(request())).json(); assert.equal(data.weather.level, "danger");
  assert.equal(data.weather.effects.windDanger, false);
  h.state.current.apparentTempC = 20; h.state.current.windGustKmh = 110;
  data = await (await h.GET(request())).json(); assert.equal(data.weather.level, "danger");
  assert.equal(data.weather.effects.windDanger, true);
  h.state.current.windGustKmh = 0; h.state.warning.severity = "danger"; h.state.warning.summary = "호우경보";
  data = await (await h.GET(request())).json(); assert.equal(data.weather.level, "danger");
  h.state.warning.severity = "normal"; h.state.warning.preliminarySeverity = "caution";
  data = await (await h.GET(request())).json(); assert.equal(data.weather.level, "warn");
});

test("기상 좌표는 기존 서버의 주소→좌표 캐시→기상 이력 순서, 부재는 기상만 실패", async () => {
  const h = harness(); h.state.address = "현장 등록 주소";
  let data = await (await h.GET(request())).json();
  assert.equal(data.weather.coordSource, "address"); assert.equal(data.weather.lat, 35.2);
  h.state.geo.ok = false;
  data = await (await h.GET(request())).json(); assert.equal(data.weather.coordSource, "cache");
  h.state.coords = null; h.state.daily = { lat: 35.3, lon: 126.7 } as WeatherDailyRow;
  data = await (await h.GET(request())).json(); assert.equal(data.weather.coordSource, "weatherDaily");
  h.state.daily = null;
  data = await (await h.GET(request())).json(); assert.equal(data.weather.ok, false); assert.equal(data.gas.ok, true);
});

// 비공개 관제 함수는 라우트 변경 없이 복제했다. 원문 body를 대조해 임계·조회 로직의 이탈을 잡는다.
function functionBody(path: string, name: string) {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = source.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === name);
  assert.ok(fn && ts.isFunctionDeclaration(fn) && fn.body, `${path}: ${name}`);
  return fn.body.getText(source);
}
test("비공개 가스 임계·전원·AED 날짜 변환은 관제 원문과 같다", () => {
  for (const name of ["o2Sev", "mq7Sev", "mq136Sev", "tsToDaysAgo"]) {
    assert.equal(functionBody("lib/app-site-status.ts", name), functionBody("app/components/SiteSafetyTables.tsx", name));
  }
  assert.equal(functionBody("lib/app-site-status.ts", "readPower"), functionBody("app/api/gaspod/telemetry/route.ts", "readPower"));
});

test("기상 조회·캐시 키·폴백 값 변환은 기존 weather 라우트 원문과 같다", () => {
  for (const name of ["cacheKey", "fetchWithTimeout", "fetchForecast", "fetchWeather", "weatherPayloadFromDaily"]) {
    assert.equal(functionBody("lib/app-site-weather.ts", name), functionBody("app/api/weather/route.ts", name));
  }
});

test("느린 기상 조회를 기다리는 동안 작업자·가스·AED·경보 조회가 모두 시작된다", async () => {
  const h = harness();
  let resume!: () => void;
  h.state.pendingWeather = new Promise<void>((resolve) => { resume = resolve; });
  const response = h.GET(request());
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const key of ["weather", "workers", "gas", "aed", "alerts"]) {
      assert.ok(h.state.calls.some((c) => c.name === key), key);
    }
  } finally { resume(); }
  assert.equal((await response).status, 200);
});

type WeatherPayload = Omit<Awaited<ReturnType<typeof siteWeather.readSiteWeather>>, "cached" | "stale" | "persisted">;
function weatherHarness() {
  const state = {
    cache: new Map<string, { ts: number; data: WeatherPayload }>(),
    upstreamFails: false, fetches: [] as string[], dbReads: 0,
    daily: null as WeatherDailyRow | null,
  };
  const reader = loadModule<typeof siteWeather>("lib/app-site-weather.ts", {
    "./apparent-temp": { apparentTempKma }, "./wbgt": { computeWbgt: () => null },
    "../app/lib/kma-observation": { fetchKmaObservation: async () => ({
      temperatureC: 24, humidityPct: 50, windMs: 2, precipitationType: 3, observedAt: new FixtureDate().toISOString(),
    }) },
    "./db": { getLatestWeatherDaily: async () => { state.dbReads++; return state.daily; } },
  }, {
    __safetyMonitorWeatherCache: state.cache,
    URL, AbortController, setTimeout, clearTimeout,
    fetch: async (url: URL) => {
      state.fetches.push(url.toString());
      if (state.upstreamFails) throw new Error("검증용 외부 조회 실패");
      return Response.json({ current: { temperature_2m: 10, relative_humidity_2m: 20, wind_speed_10m: 1 } });
    },
  });
  const cached: WeatherPayload = {
    source: "open-meteo", lat: 35.1, lon: 126.9,
    current: { weatherCode: 0, temperatureC: 24, apparentTempC: 24, humidityPct: 50,
      windKmh: 0, precipitationMm: 0, uvIndex: 0 },
    daily: {}, daily7: { time: [], weatherCode: [], tMax: [], tMin: [], precipProbMax: [], windGustMaxKmh: [], precipSumMm: [] },
    hourly: { time: [], temperatureC: [] }, fetchedAt: new Date(NOW - 60_000).toISOString(),
  };
  return { ...reader, state, cached };
}

test("관제 global 캐시의 5분 이내 값은 cached:true, 외부·DB 조회 0회", async () => {
  const h = weatherHarness();
  h.state.cache.set("35.10,126.90", { ts: NOW - 299_999, data: h.cached });
  const weather = await h.readSiteWeather(35.101, 126.901);
  assert.equal(weather.cached, true); assert.equal(weather.stale, false);
  assert.equal(weather.fetchedAt, h.cached.fetchedAt);
  assert.equal(h.state.fetches.length, 0); assert.equal(h.state.dbReads, 0);
});

test("기상 캐시 5분 만료 시 신규 조회·동일 캐시 저장, 기상청 관측을 우선한다", async () => {
  const h = weatherHarness();
  h.state.cache.set("35.10,126.90", { ts: NOW - 300_000, data: h.cached });
  const weather = await h.readSiteWeather(35.1, 126.9);
  assert.equal(weather.cached, false); assert.equal(weather.stale, false);
  assert.equal(weather.current.temperatureC, 24); // Open-Meteo 10℃ 대신 기상청 24℃
  assert.equal(weather.current.obsSource, "kma-ncst");
  assert.equal(weather.current.precipitationType, 3);
  assert.equal(weather.current.apparentTempC, apparentTempKma(24, 50, 7.2));
  assert.equal(h.state.cache.get("35.10,126.90")?.ts, NOW);
  await h.readSiteWeather(35.1, 126.9);
  assert.equal(h.state.fetches.length, 2); assert.equal(h.state.dbReads, 0);
});

test("기상 외부 장애 시 만료 캐시의 시각과 stale:true를 보존한다", async () => {
  const h = weatherHarness(); h.state.upstreamFails = true;
  h.state.cache.set("35.10,126.90", { ts: NOW - 300_000, data: h.cached });
  const weather = await h.readSiteWeather(35.1, 126.9);
  assert.equal(weather.cached, true); assert.equal(weather.stale, true);
  assert.equal(weather.fetchedAt, h.cached.fetchedAt); assert.equal(h.state.dbReads, 0);
  assert.equal(h.state.fetches.filter((url) => new URL(url).hostname === "api.open-meteo.com").length, 2);
});

test("기상 외부 장애·빈 캐시는 DB 일별 값으로 폴백하고 이전 수신 시각을 보존한다", async () => {
  const h = weatherHarness(); h.state.upstreamFails = true;
  h.state.daily = { temperature_c: 31, apparent_temp_c: 33, recorded_at: new Date(NOW - 86400000).toISOString() } as WeatherDailyRow;
  const weather = await h.readSiteWeather(35.1, 126.9);
  assert.equal(weather.cached, true); assert.equal(weather.stale, true); assert.equal(weather.persisted, true);
  assert.equal(weather.current.temperatureC, 31); assert.equal(weather.current.apparentTempC, 33);
  assert.equal(weather.fetchedAt, h.state.daily.recorded_at); assert.equal(h.state.dbReads, 1);
});

test("기상 외부·캐시·DB 모두 값이 없으면 정상값을 만들지 않고 실패한다", async () => {
  const h = weatherHarness(); h.state.upstreamFails = true;
  await assert.rejects(h.readSiteWeather(35.1, 126.9), /검증용 외부 조회 실패/);
  h.state.daily = { temperature_c: null } as WeatherDailyRow;
  await assert.rejects(h.readSiteWeather(35.1, 126.9), /검증용 외부 조회 실패/);
});


test("기상 위젯은 관제 항목별 판정과 동일하며 종합 위험을 다른 항목에 전파하지 않는다", async () => {
  const h = harness();
  const level = (severity: string) => severity === "caution" ? "warn" : severity;
  for (const [temp, gust, uv, rain, pm25] of [
    [20, 0, 0, 0, 0], [30.9, 35.9, 7.9, .9, 35.9], [31, 36, 8, 1, 36],
    [33, 54, 11, 5, 76], [35, 108, 12, 10, 150], [-12, 0, 0, 0, 0], [-15, 0, 0, 0, 0],
  ]) {
    Object.assign(h.state.current, { apparentTempC: temp, windGustKmh: gust, uvIndex: uv, precipitationMm: rain, pm25 });
    const data = await (await h.GET(request())).json();
    assert.deepEqual(data.weather.metricLevels, {
      temperature: null, humidity: null, pm10: null, wbgt: null,
      apparent: level(weatherRules.evaluateApparentTemp(temp!).currentSeverity),
      wind: level(weatherRules.evaluateWindKmh(0, gust).currentSeverity),
      uv: level(weatherRules.evaluateUV(uv!).currentSeverity),
      rain: level(weatherRules.evaluatePrecipitation(rain!).currentSeverity),
      pm25: level(weatherRules.evaluatePM25(pm25).currentSeverity),
    });
  }
  Object.assign(h.state.current, { apparentTempC: 20, windGustKmh: 0, uvIndex: 0, precipitationMm: 0, pm25: 42 });
  h.state.warning.severity = "danger";
  const data = await (await h.GET(request())).json();
  assert.equal(data.weather.level, "danger");
  assert.equal(data.weather.metricLevels.pm25, "warn");
  assert.equal(data.weather.metricLevels.wind, "normal");
  Object.assign(h.state.current, { pm25: undefined });
  const missing = await (await h.GET(request())).json();
  assert.equal(missing.weather.metricLevels.pm25, null);
});


test("실내 환경은 동일 가스포드 최신 표본의 온습도·hPa이며 실외 기상 실패와 독립이다", async () => {
  const h = harness(); h.state.fail = "weather";
  Object.assign(h.state.gas[0]!, { temp: 0, humidity: 0, pressure: 1008.4, received_at: new Date(NOW - 12_000).toISOString() });
  let data = await (await h.GET(request())).json();
  assert.equal(data.weather.ok, false);
  assert.deepEqual(data.gas.environment, { source: "gaspod", temperatureC: 0, humidityPct: 0, pressureHpa: 1008.4,
    checkedAt: new FixtureDate().toISOString(), validForMs: 48_000 });
  Object.assign(h.state.gas[0]!, { received_at: new Date(NOW - 60_001).toISOString() });
  data = await (await h.GET(request())).json(); assert.equal(data.gas.environment.validForMs, 0);
  Object.assign(h.state.gas[0]!, { temp: NaN, pressure: Infinity, received_at: "bad" });
  data = await (await h.GET(request())).json();
  assert.equal(data.gas.environment.temperatureC, null); assert.equal(data.gas.environment.pressureHpa, null);
  assert.equal(data.gas.environment.validForMs, 0);
  h.state.gas = [];
  data = await (await h.GET(request())).json(); assert.equal(data.gas.environment, null);
});


test("기상 요약에서 대기질을 분리하고 기존 일주일 예보의 실제 값만 전달한다", async () => {
  const h = harness(); h.state.current.pm25 = 160;
  h.state.forecast.precipProbMax[1] = null;
  const data = await (await h.GET(request())).json();
  assert.equal(data.weather.level, "danger");
  assert.equal(data.weather.conditions.level, "normal");
  assert.doesNotMatch(data.weather.conditions.summary, /미세먼지/);
  assert.deepEqual(data.weather.forecast, [
    { date: "2026-09-14", weatherCode: 0, label: "맑음", highC: 27, lowC: 19, precipitationProbabilityPct: 3 },
    { date: "2026-09-15", weatherCode: 61, label: "비", highC: 21, lowC: 15, precipitationProbabilityPct: null },
  ]);
});
