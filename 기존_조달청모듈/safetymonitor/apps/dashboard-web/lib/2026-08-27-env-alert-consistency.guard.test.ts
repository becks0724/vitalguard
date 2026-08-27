// 현장환경 경보 일관성 가드 — 서버와 화면이 같은 지점을 보고, 해제된 특보가 되살아날 수 있게 한다.
//
// 배경(2026-08-27 실측 · 프로덕션). 사용자가 "관제웹 팝업이 로그인 직후 안 뜬다" 고 제보해
// 파 내려가다 **경보 판정 자체의 결함 두 건**이 나왔다. 팝업(화면)과는 별개 축이다.
//
// ★ B — 서버와 화면이 다른 좌표로 판정하고 있었다.
//     화면  siteAnchor(등록 주소 지오코딩) ?? cachedCoord ?? 기상 좌표
//     서버  site_coord_daily(작업자 좌표 일별 캐시)부터
//     실측 거리 **1,009m** — 주소 35.150500,126.916166 vs 캐시 35.156,126.925.
//     ⚠ 광주 안에서는 시·도 특보가 같아 **틀린 채로 맞는 답**이 나왔다. 현장이 경계 근처면 갈린다.
//     같은 날 구획 이탈 조사에서도 같은 폴백을 정본으로 착각해 이탈률을 15.6% → 100% 로 잘못 쟀다.
//
// ★ C — 해제된 기상특보가 **다시 발효돼도 영영 알림이 안 갔다.**
//     `kma-warning` 은 발효 중인 특보만 넘긴다. 해제되면 목록에서 빠질 뿐이라
//     `env_alert_state` 행이 마지막 심각도로 굳고, `shouldSendEnv` 는 악화 전이에서만 보낸다.
//     실측  kma:폭염중대경보 = danger (08-07 이후 20일째 갱신 없음) → 재발효돼도 무음
//     재난문자 경로는 같은 함정을 이미 겪고 "전 유형 매번 normal 반환" 으로 풀었다.
//
// ★ 이 가드의 한 문장 보장.
//   "환경 경보는 **화면과 같은 좌표**로 판정되고, **해제된 특보는 다시 울릴 수 있는 상태**로 돌아간다."
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "./test-support/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...p: string[]) => stripComments(readFileSync(join(ROOT, ...p), "utf8"));

const envCron = read("app", "api", "cron", "env-check", "route.ts");
const kmaRoute = read("app", "api", "kma-warning", "route.ts");
const db = read("lib", "db.ts");

test("① ★ B — 서버 환경 판정도 주소 지오코딩이 1순위다", () => {
  const iAddr = envCron.indexOf("geocodeAddress(");
  const iCache = envCron.indexOf("getLatestSiteCoord(");
  assert.ok(iAddr > 0, "env-check 가 주소 지오코딩을 안 쓴다 — 화면과 1km 어긋난다");
  assert.ok(iCache > 0, "캐시 폴백이 없다 — 지오코딩 실패 시 평가가 멈춘다");
  assert.ok(iAddr < iCache, "캐시가 주소보다 먼저다 — 이 순서가 뒤집히면 증상 없이 어긋난다");
});

test("② B — 어느 좌표를 썼는지 남긴다", () => {
  // 남기지 않으면 어긋났을 때 사후에 "어느 단계 값을 집었나" 를 알 수 없다.
  assert.match(envCron, /coordSource = "address"/, "주소 출처 표시가 없다");
  assert.match(envCron, /coordSource = "cache"/, "캐시 출처 표시가 없다");
  assert.match(envCron, /NextResponse\.json\(\{ ok: true, coordSource/, "응답에 좌표 출처가 없다");
});

test("③ ★ C — 해제된 특보를 normal 로 되돌린다", () => {
  assert.match(kmaRoute, /clearLiftedKmaAlertStates\(activeKeys\)/,
    "해제 특보 복귀를 안 부른다 — 재발효돼도 알림이 영영 안 간다");
  assert.match(db, /UPDATE env_alert_state[\s\S]{0,200}SET severity = 'normal'/,
    "복귀 쿼리가 normal 로 되돌리지 않는다");
  assert.match(db, /item_key LIKE 'kma:%'/, "복귀 대상이 kma 특보로 한정되지 않았다");
  assert.match(db, /NOT \(item_key = ANY\(\$1::text\[\]\)\)/,
    "발효 중인 특보를 제외하지 않는다 — 지금 울리는 것까지 지운다");
});

test("④ ★ C — 복귀는 notify **뒤**에 온다 — 앞이면 없던 전이가 생겨 오알림", () => {
  const iNotify = kmaRoute.indexOf("await notifyEnvAlerts(");
  const iClear = kmaRoute.indexOf("clearLiftedKmaAlertStates(");
  assert.ok(iNotify > 0 && iClear > 0, "두 호출을 못 찾았다");
  assert.ok(iClear > iNotify,
    "복귀가 notify 보다 먼저다 — 발효 중인 특보를 normal 로 만들었다가 다시 올려 오알림이 난다");
});

test("⑤ ★ C — 복귀는 live + 인증된 경로에서만", () => {
  // 목업·무인증 조회가 실제 특보 상태를 지우면, 그 뒤 진짜 특보가 조용해진다.
  //
  // ⚠ 이 단언은 처음에 `slice(블록시작)` 으로 썼다가 **변이를 놓쳤다** — 창이 파일 끝까지라
  //   호출을 블록 **밖**으로 빼내도 여전히 창 안이었다. 창 기반 단언은 방향이 있다.
  //   그래서 괄호를 대응시켜 블록의 **끝**을 찾고, 호출 위치가 그 안인지 좌표로 판정한다.
  const start = kmaRoute.indexOf('if (data.source === "live" && trusted) {');
  assert.ok(start > 0, "live+trusted 블록을 못 찾았다 — 가드가 앵커를 잃었다");
  let depth = 0;
  let end = -1;
  for (let i = kmaRoute.indexOf("{", start); i < kmaRoute.length; i++) {
    if (kmaRoute[i] === "{") depth += 1;
    else if (kmaRoute[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.ok(end > start, "블록의 끝을 못 찾았다");
  const at = kmaRoute.indexOf("clearLiftedKmaAlertStates(");
  assert.ok(at > 0, "복귀 호출이 아예 없다");
  assert.ok(
    at > start && at < end,
    "복귀 호출이 live+trusted 블록 밖이다 — 무인증·목업 조회가 실제 특보 상태를 지운다",
  );
});
