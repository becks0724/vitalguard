// 폰 GPS 수집 가드 — 08-01 이후 좌표가 0건이던 결함을 다시 열지 않게 못 박는다.
//
// 무엇이 있었나(2026-08-16 실측). 신규 앱(`vitalguard_app`)에 위치 코드가 **한 줄도 없었다** —
// `CoreLocation` grep 0건 · 권한 문구 0개 · 백그라운드 모드 없음. DB 로도 확인된다:
// 08-10~08-16 **36,007행에 GPS 0건**, 마지막 좌표는 2026-07-31 21:46(구 앱)이다.
// 그동안 관제 지도에 작업자가 한 명도 안 떴고 지오펜스·동선·좌표 내보내기가 통째로 무동작이었다.
//
// 이 가드가 지키는 것은 네 가지이고, 넷 다 **조용히** 깨질 수 있는 종류다.
//
//  ① 반경 정책이 갈리지 않는다.
//     구 앱은 단말 게이트 **500m**(ConnectionSettings.swift:881, 기본 반경 :828) 인데 관제 구획은
//     **100m** 였다. 단말이 5배 성겨서 **100m 원을 벗어나도 500m 를 안 넘으면 좌표가 안 올라와
//     이탈 판정이 아예 안 걸렸다.** 두 숫자가 서로 다른 파일에 리터럴로 있으면 이 어긋남은 재발한다.
//
//  ② 정확도 등급을 올리지 않는다.
//     `kCLLocationAccuracyBest`/`BestForNavigation` 은 GNSS 상시 구동이라 배터리 축이 통째로
//     달라진다. 100m 구획 판정에 그 정밀도는 필요 없다. "정확도가 높을수록 좋다"는 직관으로
//     승격되기 딱 좋은 자리라 코드로 막는다.
//
//  ③ 정확도(`locationAccuracyMeters`)가 다시 무음 폐기되지 않는다.
//     구 앱은 이 값을 **이미 보내고 있었는데**(워치 VitalTransmitter.swift:121 · 폰 :3921)
//     스키마에 없어 Zod 가 strip 했고, `raw_json` 은 파싱 후 객체를 저장하므로 거기에도 안 남았다.
//     그래서 DB 21만 GPS 행 어디에도 품질 지표가 없다. 같은 파일 vital-stream.ts:132 주석이
//     이 병에 이미 이름을 붙여 뒀다 — 감사 BND-CONTRACT-01. **스키마·DB 컬럼·insert 매핑 셋 중
//     하나만 빠져도 값은 조용히 사라진다.**
//
//  ④ 묵은 좌표를 싣지 않는다.
//     캐시된 마지막 좌표는 한 번 채워지면 비지 않는다. 신선도 게이트가 없으면 그 값이 모든 샘플에
//     영원히 찍혀 **작업자가 두 시간 전에 떠난 자리에 계속 서 있는 것으로 보인다.** 이번 주에 고친
//     워치 하트비트(12시간 34분·8,531건 전부 102bpm)와 **같은 형태**다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "./test-support/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const IOS = join(ROOT, "..", "vitalguard_app", "ios", "Runner");

const provider = readFileSync(join(IOS, "LocationProvider.swift"), "utf8");
const pipeline = readFileSync(join(IOS, "VitalPipeline.swift"), "utf8");
const plist = readFileSync(join(IOS, "Info.plist"), "utf8");
const radius = readFileSync(join(ROOT, "lib", "site-radius.ts"), "utf8");
const dashboard = readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8");
const db = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");
const schema = readFileSync(join(ROOT, "..", "..", "packages", "schemas", "src", "vital-stream.ts"), "utf8");
// 읽는 경로(4중주의 넷째) — 컬럼이 SELECT 에 있고, 순수 유틸을 지나, 화면에 닿는가.
const trackLib = readFileSync(join(ROOT, "app", "lib", "track.ts"), "utf8");
const trackRoute = readFileSync(join(ROOT, "app", "api", "monitor", "track", "route.ts"), "utf8");
const gpsMap = readFileSync(join(ROOT, "app", "components", "WorkerGpsMap.tsx"), "utf8");

/**
 * 줄 주석을 걷어낸 코드 본문.
 * ⚠ 금지 패턴 검사에 필요하다 — 주석에 "이 값을 쓰지 말 것" 이라고 적어 두면 그 설명 자체가
 *   금지 패턴에 걸려 가드가 자기 근거를 실패로 읽는다(작성 중 실제로 발생).
 */
// ⚠️ 종전 구현은 `l.replace(/\/\/.*$/, "")` 였다. 이 가드가 읽는 WorkerGpsMap.tsx 에는
//   Esri 타일 URL 두 줄이 있어 `const SAT = "https:` 까지만 남고 잘렸다. 지금 단언들은
//   그 줄을 안 봐서 통과하고 있었지만, 금지형 단언이 하나라도 그 줄에 걸리면 **거짓 초록**
//   이 된다(금지 패턴이 URL 과 함께 증발). 문자열 안을 건너뛰는 공유 헬퍼로 교체 — [[L-119]].
const codeOnly = stripComments;

/** 숫자 상수 하나를 뽑는다. 못 뽑으면 가드가 참조를 잃은 것이라 즉시 실패시킨다. */
function num(src: string, re: RegExp, label: string): number {
  const m = src.match(re);
  assert.ok(m?.[1], `${label} 를 못 읽었다 — 가드가 참조를 잃었으니 재작성할 것`);
  return Number(m[1]);
}

test("① ★ 관제구역 반경 정책이 관제웹과 앱에서 같은 값이다", () => {
  const tsMin = num(radius, /SITE_RADIUS_MIN_M = (\d+)/, "TS 하한");
  const tsMax = num(radius, /SITE_RADIUS_MAX_M = (\d+)/, "TS 상한");
  const swMin = num(provider, /siteRadiusMinM: CLLocationDistance = (\d+)/, "Swift 하한");
  const swMax = num(provider, /siteRadiusMaxM: CLLocationDistance = (\d+)/, "Swift 상한");

  assert.equal(tsMin, 50, "하한이 50m 가 아니다 — 사용자 결정값");
  assert.equal(tsMax, 100, "상한이 100m 가 아니다 — 사용자 결정값");
  assert.equal(
    swMin,
    tsMin,
    `단말 하한 ${swMin} ≠ 관제 하한 ${tsMin} — 구 앱의 500m vs 100m 어긋남이 재발한다`,
  );
  assert.equal(
    swMax,
    tsMax,
    `단말 상한 ${swMax} ≠ 관제 상한 ${tsMax} — 단말이 성기면 이탈이 안 잡힌다`,
  );
  assert.ok(tsMin < tsMax, "하한이 상한 이상이다");
});

test("② 관제 화면이 반경을 리터럴로 되돌리지 않았다", () => {
  assert.match(
    dashboard,
    /const SITE_CIRCLE_RADIUS_M = SITE_RADIUS_MAX_M;/,
    "구획 반경이 공유 상수를 안 쓴다",
  );
  assert.match(dashboard, /from "\.\.\/\.\.\/lib\/site-radius"/, "정책 모듈 import 가 사라졌다");
  assert.doesNotMatch(
    codeOnly(dashboard),
    /const SITE_CIRCLE_RADIUS_M = \d+;/,
    "반경이 다시 리터럴로 박혔다 — 앱과 갈린다",
  );
});

test("③ ★ 저전력 설정이 유지된다(정확도 등급 승격 금지)", () => {
  // 앵커 — 이 셋이 사라지면 아래 금지 검사가 빈 파일에서도 통과한다.
  assert.match(provider, /desiredAccuracy = kCLLocationAccuracyHundredMeters/, "정확도 등급 지정이 사라졌다");
  assert.match(provider, /pausesLocationUpdatesAutomatically = true/, "정지 시 자동 중단이 꺼졌다");
  assert.match(provider, /distanceFilter = Self\.siteRadiusMaxM/, "거리 필터가 반경과 분리됐다");

  assert.doesNotMatch(
    codeOnly(provider),
    /kCLLocationAccuracyBest(ForNavigation)?\b/,
    "정확도가 Best 등급으로 승격됐다 — GNSS 상시 구동이라 배터리 축이 달라진다",
  );
});

test("④ ★ 경계 감시(region monitoring)가 살아 있다", () => {
  // 폰으로 모으기로 한 이유의 절반이다 — OS 가 원을 대신 감시하므로 앱이 잠들어도 이탈을 놓치지 않는다.
  assert.match(provider, /CLCircularRegion\(/, "구획 원 생성이 사라졌다");
  assert.match(provider, /startMonitoring\(for: region\)/, "경계 감시 등록이 사라졌다");
  assert.match(provider, /notifyOnExit = true/, "이탈 알림이 꺼졌다");
  assert.match(provider, /func locationManager\(_ manager: CLLocationManager, didExitRegion/, "이탈 콜백이 사라졌다");
  // 추적을 멈춰도 경계 감시는 남긴다 — 둘을 함께 끄면 잠든 동안 이탈을 통째로 놓친다.
  const stop = provider.slice(provider.indexOf("private func stopTracking()"), provider.indexOf("private func stopTracking()") + 600);
  assert.ok(stop.length > 100, "stopTracking 구간을 못 찾았다");
  assert.doesNotMatch(codeOnly(stop), /stopMonitoring/, "추적 중지와 함께 경계 감시까지 껐다");
});

test("⑤ ★ 묵은 좌표를 싣지 않는다(신선도 게이트)", () => {
  const maxAge = num(provider, /maxFixAgeSec: TimeInterval = (\d+)/, "좌표 신선도 상한");
  assert.equal(maxAge, 300, "신선도 상한이 바뀌었다 — 구 앱과 같은 300초가 근거값이다");

  const fn = provider.slice(provider.indexOf("func currentFix()"), provider.indexOf("func currentFix()") + 800);
  assert.ok(fn.length > 200, "currentFix 구간을 못 찾았다");
  assert.match(
    fn,
    /Date\(\)\.timeIntervalSince\(fix\.timestamp\) <= Self\.maxFixAgeSec else \{ return nil \}/,
    "신선도 검사 없이 좌표를 돌려준다 — 떠난 자리가 영원히 찍힌다(워치 하트비트와 같은 형태)",
  );
});

test("⑥ ★ 좌표 4종을 한 덩어리로 싣는다(정확도·측위시각 분리 금지)", () => {
  // ⚠ 전에는 `currentFix()` 부터 **고정 900자**를 잘라 봤다. 그 사이에 함수가 하나 들어가자
  //   창이 밀려 초록이던 가드가 빨개졌다(2026-08-20 — 이 레포에서 같은 형태가 세 번째다).
  //   좌표 4종은 `payload(from:)` 한 곳에서만 만들어지므로 **그 함수를 직접** 앵커로 쓴다.
  const start = provider.indexOf("private func payload(from fix: CLLocation)");
  assert.notEqual(start, -1, "payload(from:) 를 못 찾았다 — 좌표 조립 지점이 옮겨졌다");
  const fn = provider.slice(start, provider.indexOf("\n    }", start));
  for (const key of ["latitude", "longitude", "locationAccuracyMeters", "locationTimestamp"]) {
    assert.match(fn, new RegExp(`"${key}":`), `${key} 가 빠졌다 — 품질·나이를 못 재는 좌표가 된다`);
  }
});

test("⑦ ★ 좌표 메타 2종이 스키마·컬럼·insert·**읽는 경로** 4중주로 산다", () => {
  // ★ 왜 3중주가 아니라 4중주인가 (2026-08-21).
  //   이 테스트는 원래 스키마·ALTER·insert 셋만 봤다. 그런데 그 셋이 다 초록인 채로
  //   `location_accuracy_m` 은 **읽는 SELECT 0건 · 화면 0건** 이었다 — 값은 6주간 DB 에
  //   쌓이기만 하고 아무도 안 봤다. 가드가 초록이라 아무도 의심하지 않았다.
  //   ⟹ 결함을 가드로 고정하면 결함이 규범이 된다. 넷째 다리를 여기서 세운다.
  //   넷째의 정의 = **SELECT 에 있고 · 순수 유틸을 지나 · 사람 눈에 닿는 지점에 쓰인다.**
  const legs = [
    {
      what: "정확도",
      schemaRe: /locationAccuracyMeters: z\.number\(\)/,
      alterRe: /ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS location_accuracy_m DOUBLE PRECISION;/,
      insertRe: /location_accuracy_m: sample\.locationAccuracyMeters \?\? null,/,
      selectKey: "location_accuracy_m",
      // ⚠ 약한 단언 금지 — `/accM/` 만 보면 **주석에 이름만 남아도 통과**한다(작성 중 변이시험에서
      //   실제로 살아남았다). 타입 선언 + 요약에서의 소비 + 화면에서의 소비를 각각 못 박는다.
      libRes: [/accM: number \| null/, /p\.accM/],
      screenRes: [/trail\.quality\.accuracyMedianM/],
    },
    {
      what: "측위 시각",
      schemaRe: /locationTimestamp: z\.string\(\)\.datetime\(\)/,
      alterRe: /ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS location_timestamp TEXT;/,
      insertRe: /location_timestamp: sample\.locationTimestamp \?\? null,/,
      selectKey: "location_timestamp",
      libRes: [/fixTs: string \| null/, /p\.fixTs/],
      screenRes: [/trail\.quality\.fixAgeMaxSec/],
    },
  ] as const;

  for (const leg of legs) {
    assert.match(schema, leg.schemaRe, `${leg.what}: 스키마에서 사라졌다 — Zod 가 무음 strip 한다`);
    assert.match(db, leg.alterRe, `${leg.what}: DB 컬럼 마이그레이션이 사라졌다`);
    assert.match(db, leg.insertRe, `${leg.what}: insert 매핑이 사라졌다 — 컬럼만 있고 값이 안 들어간다`);
    // ★ 넷째 — 읽는 경로. 이 셋 중 하나만 빠져도 컬럼은 쓰기 전용으로 되돌아간다.
    assert.match(
      db,
      new RegExp(`SELECT[^\`]*${leg.selectKey}[^\`]*FROM vital_samples`),
      `${leg.what}: 어떤 SELECT 에도 없다 — 쓰기 전용 컬럼이다`,
    );
    // 주석에 이름만 남는 것을 막으려고 코드 본문에서만 찾는다.
    const libCode = codeOnly(trackLib);
    const screenCode = codeOnly(gpsMap);
    for (const re of leg.libRes) {
      assert.match(libCode, re, `${leg.what}: 트랙 유틸이 안 실어 나른다 (${re})`);
    }
    for (const re of leg.screenRes) {
      assert.match(screenCode, re, `${leg.what}: 화면에 닿지 않는다 — 사람이 못 본다 (${re})`);
    }
  }

  // 요약은 **솎기 전** 점으로 내야 한다. 뒤로 밀리면 240점 표본의 분포를 전체로 보고하게 된다.
  const routeCode = codeOnly(trackRoute);
  const sumAt = routeCode.indexOf("summarizeTrackQuality(");
  const downAt = routeCode.indexOf("downsampleTrack(");
  assert.ok(sumAt >= 0, "라우트가 품질 요약을 안 낸다");
  assert.ok(downAt >= 0, "라우트가 다운샘플을 안 한다 — 이 검사의 전제가 깨졌다");
  assert.ok(sumAt < downAt, "요약이 다운샘플 뒤에 있다 — 표본의 분포를 전체로 보고하게 된다");
});

test("⑧ ★ 근무 중에만 추적한다(상시 추적 금지)", () => {
  // "근무 중" = 워치 생체가 들어오는 동안. 이 앱에 근무 시간 개념이 없어 다른 정의가 없다.
  assert.match(
    pipeline,
    /LocationProvider\.shared\.noteVitalsActive\(\)/,
    "생체 도착이 추적을 살리는 연결이 끊겼다",
  );
  assert.match(provider, /vitalIdleStopSec: TimeInterval = \d+/, "생체 유휴 상한이 사라졌다");
  assert.match(provider, /if idle \{ stopTracking\(\) \}/, "생체가 끊겨도 추적이 안 멈춘다");

  // start() 가 곧바로 추적을 켜면 근무 개념이 무의미해진다(설치만 해도 24시간 추적).
  const start = provider.slice(provider.indexOf("    func start()"), provider.indexOf("    func start()") + 700);
  assert.ok(start.length > 200, "start 구간을 못 찾았다");
  assert.doesNotMatch(codeOnly(start), /startUpdatingLocation\(\)/, "기동만으로 추적을 시작한다 — 근무 중 한정이 깨졌다");
});

test("⑨ 배경 위치 모드와 권한 문구가 함께 있다", () => {
  // allowsBackgroundLocationUpdates = true 인데 UIBackgroundModes 에 location 이 없으면 **크래시**다.
  assert.match(provider, /allowsBackgroundLocationUpdates = true/, "배경 추적 플래그가 사라졌다");
  assert.match(plist, /<string>location<\/string>/, "UIBackgroundModes 에 location 이 없다 — 앱이 크래시한다");
  assert.match(plist, /<key>NSLocationWhenInUseUsageDescription<\/key>/, "사용 중 권한 문구가 없다");
  assert.match(
    plist,
    /<key>NSLocationAlwaysAndWhenInUseUsageDescription<\/key>/,
    "항상 허용 문구가 없다 — 경계 감시 콜백이 배경에서 오지 않는다",
  );
});

test("⑩ 좌표가 새 행을 만들지 않는다(기존 샘플에 얹는다)", () => {
  // 별도 전송 경로를 만들면 행 수·요청 수가 늘고 ON CONFLICT (worker_id, ts) 와 얽힌다.
  assert.match(
    pipeline,
    /if let fix \{ v\.merge\(fix\) \{ current, _ in current \} \}/,
    "좌표를 기존 샘플에 병합하지 않는다",
  );
  assert.doesNotMatch(
    codeOnly(pipeline),
    /pending\.append\(\["latitude"/,
    "좌표만 담은 행을 따로 쌓는다 — 행 수가 늘고 계약이 갈린다",
  );
});
