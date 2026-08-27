// 구획 이탈 서버 크론 가드 — 판정이 브라우저에만 살아 있던 것을 서버로 옮긴 배선을 고정한다.
//
// 배경(2026-08-27). 구획 판정은 `app/lib/geofence.ts` 를 쓰는 곳이 `DemoDashboard.tsx`
// **하나뿐**이었다. 즉 관제웹을 아무도 열어 두지 않으면 이탈 알림이 **누구에게도** 안 갔다.
// `cron/absence-check` 가 같은 이유로 먼저 서버로 옮겨진 전례다.
//
// ★ 이 가드의 한 문장 보장.
//   "서버 크론은 **화면과 같은 판정 규칙**과 **화면과 같은 중심 좌표 출처**를 쓰고,
//    같은 이탈 구간을 두 번 알리지 않는다."
//
// ★★ 왜 중심 출처가 핵심인가 — 실측으로 1,009m 갈렸다.
//   화면은 `siteAnchor(등록 주소 지오코딩) ?? cachedCoord ?? 기상 좌표` 순이다.
//   서버가 `site_coord_daily`(작업자 좌표 일별 캐시)를 1순위로 쓰면
//     주소 지오코딩 35.150500, 126.916166
//     일별 캐시   35.156,    126.925      ← 1,009m 떨어져 있다
//   이 조사에서 **내가 실제로 캐시를 중심으로 착각해** 이탈률을 15.6% → 100% 로 잘못 쟀다.
//   두 판정이 다른 중심을 쓰면 화면과 텔레그램이 서로 다른 말을 한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "./test-support/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const route = stripComments(read("app", "api", "cron", "geofence-check", "route.ts"));
const watch = stripComments(read("lib", "geofence-watch.ts"));

test("① 크론 게이트가 있다 — 공개 엔드포인트가 아니다", () => {
  assert.match(route, /cronAuth\(request\.headers\.get\("x-cron-key"\), process\.env\.CRON_SECRET\)/,
    "cronAuth 게이트가 없다 — 누구나 알림을 쏠 수 있다");
  assert.match(route, /notConfigured[\s\S]{0,200}status: 503/, "CRON_SECRET 미설정이 503 이 아니다");
  assert.match(route, /unauthorized[\s\S]{0,200}status: 401/, "키 불일치가 401 이 아니다");
});

test("② ★ 중심 좌표는 주소 지오코딩이 1순위 — 캐시는 폴백이다", () => {
  const iAddr = route.indexOf("geocodeAddress(");
  const iCache = route.indexOf("getLatestSiteCoord(");
  assert.ok(iAddr > 0, "주소 지오코딩을 안 쓴다 — 화면과 중심이 갈린다");
  assert.ok(iCache > 0, "캐시 폴백이 없다 — 지오코딩 실패 시 판정이 멈춘다");
  assert.ok(iAddr < iCache, "캐시가 주소보다 먼저다 — 화면과 1km 어긋난다");
  // 중심을 모르면 판정하지 않는다(임의 중심으로 재면 전원이 이탈로 보인다).
  assert.match(route, /if \(!center\)[\s\S]{0,200}ok: false/,
    "중심 없이도 판정을 진행한다 — 전원 이탈 오탐이 난다");
});

test("③ ★ 판정 규칙은 화면과 같은 모듈을 공유한다 — 사본 금지", () => {
  assert.match(watch, /from "\.\.\/app\/lib\/geofence"/, "판정 모듈을 공유하지 않는다");
  assert.match(watch, /\bstepGeofence\b/, "stepGeofence 를 안 쓴다 — 규칙 사본이 생겼다");
  // 반경도 정책 상수에서 온다(리터럴 금지 — site-radius.ts 주석이 경고하는 그 어긋남).
  assert.match(route, /SITE_RADIUS_MAX_M/, "반경이 정책 상수가 아니다");
  assert.doesNotMatch(route, /radiusM: 100\b|, 100\)/, "반경을 리터럴로 박았다");
});

test("④ ★ 같은 이탈 구간을 두 번 알리지 않는다", () => {
  // ⓐ 전이 표본의 ts 를 자연키로 쓴다(크론 재실행 dedup).
  assert.match(watch, /exitTs = f\.ts;/, "이탈 ts 가 전이 표본의 것이 아니다 — 매번 새 알림이 된다");
  // ⓑ 화면이 먼저 기록한 구간을 건너뛴다.
  assert.match(route, /lastGeofenceAlertTsByWorker\(/, "기존 알림 조회가 없다 — 화면과 중복 통지된다");
  assert.match(route, /if \(prev && prev >= v\.exitTs\)/, "이탈 시각 이후 알림을 건너뛰지 않는다");
});

test("⑤ 통지는 recordAlert 관문을 거친다 — 별도 텔레그램 경로를 만들지 않는다", () => {
  assert.match(route, /recordAlert\(\{/, "recordAlert 를 안 쓴다");
  assert.match(route, /type: "geofence"/, "알림 유형이 geofence 가 아니다");
  assert.doesNotMatch(route, /sendTelegramMessage/,
    "크론이 텔레그램을 직접 부른다 — dedup 관문을 우회해 중복 통지된다");
});

test("⑥ ★ 한 줄 요약을 남긴다 — 없으면 정상과 고장이 똑같이 200 으로 보인다", () => {
  // 첫 실행(2026-08-27 07:25Z)이 200 이었지만 창 안 좌표가 0건이라 판정이 아예 안 돌았다.
  // 그 사실을 알아내려고 DB 를 따로 뒤져야 했다 — 응답 코드만으로는 아래 셋이 안 갈린다.
  //   ⓐ 정상(아무도 안 벗어남) ⓑ 입력 고장(좌표 0) ⓒ 출력 고장(이탈은 잡았는데 알림 0)
  assert.match(route, /console\.log\(/, "요약 로그가 없다 — 조용한 실패를 못 본다");
  // 위 셋을 가르는 네 숫자가 모두 있어야 한다. 하나라도 빠지면 가르지 못한다.
  const log = route.slice(route.indexOf("console.log("), route.indexOf("return NextResponse.json({", route.indexOf("console.log(")));
  for (const [what, re] of [
    ["좌표 건수", /fixes\.length/],
    ["작업자 수", /verdicts\.length/],
    ["이탈자 수", /outside\.length/],
    ["알림 건수", /\$\{alerted\}/],
  ] as const) {
    assert.match(log, re, `요약에 ${what}가 없다 — 고장 유형을 못 가른다`);
  }
  // 중심 출처도 남긴다 — 주소/캐시가 바뀌면 판정이 1km 어긋난다(②).
  assert.match(log, /centerSource/, "요약에 중심 출처가 없다");
  // ⚠ 개인 식별자 금지 — 이탈자는 수만 남기고 명단은 응답 본문에만.
  assert.doesNotMatch(log, /outside\.join|workerName|workerId/,
    "요약 로그에 개인 식별자가 들어갔다 — 수만 남긴다");
});
