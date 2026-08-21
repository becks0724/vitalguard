// 가스포드 텔레메트리 GET 봉인 가드 — 실데이터 조회는 세션 인증 뒤에 있어야 한다
//
// 발단(2026-08-20 안정화 분석 P1-3 · 2026-08-21 봉인). 프로덕션 GET 이 **무인증 200** 이었다 —
// 센서 원시값(o2·mq7·mq136·vbat)·기기 ID · 32,228행 · 최대 720행/회. 통제군 aed/devices 는
// 401 이었다. mock/history(08-13)와 같은 형태 — 모의 시절 무해했던 경로가 실데이터 전환으로
// 구멍이 된다. 처방도 같다: 서버는 세션 게이트, 화면은 토큰 동봉.
//
// 이 가드가 초록이면 보장되는 것 —
//  ① GET 은 `if (!verifyBasicAuth(request))` 차단 관용구 뒤다(호출 존재만 보면 `true ||` 우회를
//     못 잡는다 — 08-13 사고 조사 가드에서 실증된 맹점).
//  ② POST(기기 수집)에는 세션 게이트가 **없다** — ESP32 는 soft 토큰 계약이고 세션이 없다.
//     여기에 세션을 요구하면 수집이 통째로 끊긴다(L-11). 이것이 이 가드의 음성 통제군이다.
//  ③ 화면 두 곳의 폴링 fetch 가 세션 토큰을 동봉한다(서버만 잠그면 화면이 401 로 빈다).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const route = readFileSync(join(ROOT, "app", "api", "gaspod", "telemetry", "route.ts"), "utf8");
const indoor = readFileSync(join(ROOT, "app", "components", "IndoorEnvRows.tsx"), "utf8");
const tables = readFileSync(join(ROOT, "app", "components", "SiteSafetyTables.tsx"), "utf8");
const bare = (s: string) =>
  s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// POST/GET 본문 분리 — 고정 창이 아니라 함수 시그니처 경계로 자른다(고정 창은 이 레포에서
// 네 번 밀렸다). 시그니처가 사라지면 여기서 먼저 죽는다.
const src = bare(route);
const postAt = src.indexOf("export async function POST");
const getAt = src.indexOf("export async function GET");
assert.ok(postAt >= 0 && getAt > postAt, "gaspod route 의 POST/GET 시그니처가 사라졌다");
const postBody = src.slice(postAt, getAt);
const getBody = src.slice(getAt);

test("★ GET — 세션 차단 관용구 뒤에 있다", () => {
  assert.match(getBody, /if \(!verifyBasicAuth\(request\)\)/, "GET 세션 게이트 소실 — 무인증 실데이터 조회로 회귀");
  assert.match(getBody, /status: 401/, "GET 401 응답 소실");
});

test("★ 음성 통제군 — POST(기기 수집)는 세션 게이트가 없어야 한다", () => {
  assert.doesNotMatch(
    postBody,
    /verifyBasicAuth/,
    "기기 수집 POST 에 세션 게이트가 생겼다 — ESP32 는 세션이 없어 수집이 통째로 끊긴다(L-11)",
  );
  assert.match(postBody, /ingestAuthStatus\(request\)/, "POST soft 토큰 계약 소실");
});

test("★ 화면 두 곳 — 가스포드 폴링이 세션 토큰을 동봉한다", () => {
  for (const [name, text] of [
    ["IndoorEnvRows", indoor],
    ["SiteSafetyTables", tables],
  ] as const) {
    const b = bare(text);
    const at = b.indexOf("/api/gaspod/telemetry");
    assert.ok(at >= 0, `${name} 의 가스포드 fetch 소실`);
    // 창 = URL 리터럴부터 그 fetch 체인의 .then 까지 — 내용 경계라 주석·코드가 늘어도 안 밀린다.
    const untilThen = b.indexOf(".then", at);
    assert.ok(untilThen > at, `${name} 의 fetch 체인 형태가 바뀌었다 — 가드 창을 다시 잡을 것`);
    const call = b.slice(at, untilThen);
    assert.match(call, /Authorization/, `${name} 가 세션 토큰 없이 가스포드를 조회한다 — 봉인 후 401 로 화면만 빈다`);
  }
});
