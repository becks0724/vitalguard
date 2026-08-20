// 정지 중 좌표 유지 가드 — 앱의 주기 갱신(②)과 관제의 좌표 나이 표기(①)를 고정한다
//
// ★ 왜 소스로 못 박는가. 이 결함은 **빌드도 통과하고 화면도 멀쩡해 보인다.** 좌표가 없는 것이
//   아니라 5분마다 있다 없다 하는 것이라, 짧게 보면 언제나 "정상"으로 읽힌다.
//   2026-08-20 프로덕션 14시간 실측 — 5,586건 중 좌표 실린 행 1,407건(커버리지 25.1%).
//   좌표가 1개뿐인(=정지) 구간 길이가 `300·305·295·305·290·305·296·293초` 로
//   `maxFixAgeSec` 300초 상한에 정확히 붙었다. `distanceFilter` 100m 가 정지 상태에서 새 fix 를
//   막고, 300초가 지나면 `currentFix()` 가 nil 을 돌려주기 때문이다.
//
// ⚠ 이 트랙은 같은 자리를 **세 번째** 여는 것이다(08-16 생산자 복구 · 08-19 각인 · 08-20 지도).
//   08-19 에는 `didPause` 로 오진했다가 같은 상수들로 정정됐다. 그래서 여기서 고정하는 것은
//   "증상" 이 아니라 **상수 사이의 관계**다 — 값이 바뀌어도 관계가 깨지면 잡힌다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(fileURLToPath(new URL(".", import.meta.url)));
const APP = join(here, "..", "..", "vitalguard_app");
const WEB = join(here, "..", "app", "components");
const loc = readFileSync(join(APP, "ios", "Runner", "LocationProvider.swift"), "utf8");
const dash = readFileSync(join(WEB, "DemoDashboard.tsx"), "utf8");
const map = readFileSync(join(WEB, "WorkerGpsMap.tsx"), "utf8");

/** Swift 소스에서 `private static let <이름>: TimeInterval = <수>` 의 수를 읽는다. */
function swiftInterval(name: string): number {
  const m = loc.match(new RegExp(`static let ${name}: TimeInterval = (\\d+)`));
  assert.ok(m, `${name} 상수가 없다`);
  // ⚠ 이 레포는 `noUncheckedIndexedAccess: true` 라 캡처 그룹이 `string | undefined` 다.
  const captured = m[1];
  assert.ok(captured, `${name} 값이 비어 있다`);
  return Number(captured);
}

/** Swift 함수 본문(중괄호 균형)을 이름으로 잘라낸다. 이름만 grep 하면 정의와 호출을 못 가른다. */
function swiftBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} 를 찾지 못했다`);
  const open = source.indexOf("{", start);
  assert.ok(open >= 0, `${signature} 의 본문 시작을 찾지 못했다`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  assert.fail(`${signature} 의 본문이 닫히지 않았다`);
}

// ── ② 앱 — 정지 중 주기 갱신 ────────────────────────────────────────────────

test("★ 갱신 주기가 신선도 상한보다 짧다 — 좌표가 끊기기 전에 새것을 받는다", () => {
  const refresh = swiftInterval("fixRefreshAfterSec");
  const maxAge = swiftInterval("maxFixAgeSec");
  // 이것이 이 파일에서 가장 중요한 한 줄이다. 두 값 중 무엇을 바꾸든 관계가 깨지면 좌표가 다시
  // 끊긴다. 같기만 해도 안 된다 — 요청·응답 지연 동안 만료 창이 열린다.
  assert.ok(
    refresh < maxAge,
    `갱신 주기(${refresh}s)가 신선도 상한(${maxAge}s)보다 짧아야 한다 — 같거나 길면 좌표가 끊긴다`,
  );
  // 여유가 너무 얇으면(예: 299 vs 300) 타임아웃 12초를 못 흡수한다.
  const timeout = swiftInterval("fixRefreshTimeoutSec");
  assert.ok(
    maxAge - refresh > timeout,
    `여유(${maxAge - refresh}s)가 요청 타임아웃(${timeout}s)보다 커야 한다 — 요청이 늦으면 만료된다`,
  );
});

test("★ 신선도 상한 300초와 거리필터 100m 는 완화하지 않는다 — ③안 기각의 고정", () => {
  // 사용자가 2026-08-20 에 명시적으로 기각한 처방이다. 여기를 늘려서 "고쳤다" 고 하면
  // 두 시간 전에 떠난 자리에 작업자가 서 있는 것으로 보인다(워치 하트비트 12시간 복사와 같은 형태).
  assert.equal(swiftInterval("maxFixAgeSec"), 300, "신선도 상한이 바뀌었다 — 묵은 좌표가 실린다");
  assert.match(
    loc,
    /self\.manager\.distanceFilter = Self\.siteRadiusMaxM/,
    "거리필터가 관제 반경에서 풀렸다 — 앱과 관제의 구획 정책이 갈린다",
  );
});

test("★ 생체 도착마다 갱신 필요 여부를 본다 — 추적 시작 여부와 독립으로", () => {
  const body = swiftBody(loc, "func noteVitalsActive()");
  assert.match(body, /shouldRefreshFixLocked\(\)/, "갱신 판단이 사라졌다");
  assert.match(body, /refreshFixWhileStationary\(\)/, "갱신 호출이 사라졌다");
  // ⚠ 종전 코드는 `guard needStart else { return }` 로 조기 반환했다. 그 아래에 갱신을 두면
  //   **이미 추적 중일 때 영영 안 돈다** — 그런데 정지 중 끊김이 일어나는 곳이 바로 거기다.
  //   `distanceFilter` 가 fix 를 막는 것이지 추적이 꺼진 것이 아니기 때문이다.
  assert.ok(
    !/guard needStart else \{ return \}/.test(body),
    "needStart 조기 반환이 남아 있다 — 추적 중에는 갱신이 영영 안 돈다",
  );
});

test("★ 갱신이 latestFix 를 실제로 채운다 — 안 채우면 업로드에는 아무 효과가 없다", () => {
  const body = swiftBody(loc, "private func refreshFixWhileStationary()");
  // `currentFix()` 는 `latestFix` 만 본다. 페이로드만 만들고 캐시를 안 건드리면
  // 업로드 경로는 그대로 nil 이다 — `requestFreshFix()` 를 재사용하면 정확히 그렇게 된다.
  assert.match(body, /self\.latestFix = fix/, "latestFix 에 쓰지 않는다 — 업로드 좌표는 그대로 빈다");
  assert.ok(
    !/requestFreshFix\(/.test(body),
    "requestFreshFix 를 재사용한다 — 저것은 캐시 적중 시 latestFix 를 안 건드린다",
  );
});

test("★ 갱신이 추적 경로와 같은 정확도 기준을 건다", () => {
  const body = swiftBody(loc, "private func refreshFixWhileStationary()");
  assert.match(
    body,
    /horizontalAccuracy > 0[\s\S]{0,80}horizontalAccuracy <= Self\.siteRadiusMaxM/,
    "정확도 게이트가 없다 — 출처에 따라 좌표의 의미가 달라진다",
  );
});

test("★ 촬영 요청 중이면 갱신을 건너뛴다 — 각인의 좌표를 뺏지 않는다", () => {
  const body = swiftBody(loc, "private func refreshFixWhileStationary()");
  // `OneShotLocator.request` 는 앞선 요청을 취소하고 자기로 대체한다. 확인 없이 부르면
  // 촬영 중 각인이 다시 빈다 — 2026-08-19 에 고친 바로 그 결함이 되돌아온다.
  assert.match(body, /!oneShot\.isRequesting/, "진행 중 확인이 없다 — 촬영 좌표를 취소한다");
  assert.match(loc, /var isRequesting: Bool/, "isRequesting 이 없다");
});

test("★ 요청 폭주 방지 — 실패해도 최소 간격만큼 쉰다", () => {
  const gap = swiftInterval("fixRefreshMinGapSec");
  assert.ok(gap > 0, "최소 간격이 0 이다 — 생체가 올 때마다(5초) GPS 를 때린다");
  const decide = swiftBody(loc, "private func shouldRefreshFixLocked()");
  assert.match(decide, /fixRefreshMinGapSec/, "최소 간격이 판단에 안 쓰인다");
  // 요청 **시각**을 성공 전에 기록해야 실패해도 쉰다. 성공 시에만 기록하면 실내에서 폭주한다.
  const body = swiftBody(loc, "private func refreshFixWhileStationary()");
  const stampAt = body.indexOf("lastFixRefreshAt = Date()");
  const requestAt = body.indexOf("oneShot.request(");
  assert.ok(stampAt >= 0, "요청 시각을 기록하지 않는다");
  assert.ok(
    stampAt < requestAt,
    "요청 시각을 요청 뒤에 기록한다 — 실패 경로에서 기록이 빠지면 폭주한다",
  );
});

// ── ① 관제 — 좌표 나이 ──────────────────────────────────────────────────────

test("★ 좌표 나이는 측위 시각에서 재고, 생체 수신 시각에서 재지 않는다", () => {
  // 서버 sticky merge 가 좌표를 이어 주므로(store.ts `{...older, ...newer}` — 좌표 없는
  // 샘플엔 키 자체가 없어 older 가 살아남는다) 심박이 5초 전이어도 좌표는 40분 전일 수 있다.
  // `s.ts` 로 재면 항상 "방금" 이 나와 **화면이 거짓말을 한다.**
  assert.match(
    dash,
    /const fixMs = s\.locationTimestamp \? now - Date\.parse\(s\.locationTimestamp\)/,
    "좌표 나이를 locationTimestamp 에서 재지 않는다",
  );
  assert.match(dash, /fixAgeSec,/, "지도 포인트에 좌표 나이를 안 싣는다");
  assert.match(map, /fixAgeSec\?: number \| null;/, "WorkerMapPoint 타입에 좌표 나이가 없다");
});

test("★ 관제의 좌표 만료 경계 = 앱의 신선도 상한", () => {
  // 두 숫자가 갈리면 화면이 "최신" 이라 부르는 좌표를 앱은 이미 안 싣고 있는 상태가 된다.
  // 이 레포는 같은 어긋남을 이미 겪었다 — 단말 500m vs 관제 100m(G-04).
  const m = map.match(/const FIX_STALE_SEC = (\d+);/);
  assert.ok(m, "FIX_STALE_SEC 이 없다");
  const captured = m[1];
  assert.ok(captured, "FIX_STALE_SEC 값이 비어 있다");
  assert.equal(
    Number(captured),
    swiftInterval("maxFixAgeSec"),
    "관제 만료 경계가 앱 신선도 상한과 다르다 — 화면이 앱보다 오래된 좌표를 최신이라 부른다",
  );
});

test("★ 좌표를 못 올린 사유가 권한만 가리키지 않는다", () => {
  // 실측된 주 원인은 권한도 로그인도 아니었다(둘 다 정상이었다). 권한만 보라고 안내하면
  // 멀쩡한 권한을 반복 확인하게 되고, 진짜 원인인 정지·재기동은 끝내 안 보인다.
  assert.ok(
    !dash.includes("GPS 미포함 — 위치 권한·로그인 게이트 확인"),
    "옛 사유 문구가 남아 있다 — 실측된 주 원인을 안 가리킨다",
  );
  assert.match(dash, /좌표 미수신 — 폰 정지 중이면/, "새 사유 문구가 없다");
  assert.match(map, /폰이 정지 중이면 수 분 내 다시 잡힙니다/, "빈 상태 안내가 옛 문구다");
});
