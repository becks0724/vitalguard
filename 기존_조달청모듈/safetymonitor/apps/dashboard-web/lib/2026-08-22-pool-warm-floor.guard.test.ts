// 웜 바닥 유지 가드 — 접속 생성을 요청 경로 밖에 두는 성질이 되돌아가면 실패한다.
//
// 배경(2026-08-22 실측). 실패는 **새 물리 접속에만** 붙는다 — 웜 재사용 22ms·실패 0/104,
// 새 접속은 간헐적으로 5초를 넘겨 죽는다. 지연 분포가 0.5~4.9초에서 0건이라 **느린 게 아니라 멎는다**.
// 그래서 이 코드가 지키는 것은 "빠르게 만들기" 가 아니라 **"멎어도 사용자 요청이 안 죽는 자리에서 만들기"** 다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** 주석을 걷어낸 본문 — 이름이 주석에만 남아도 통과하는 약한 단언을 막는다([[L-104]]). */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

const db = codeOnly(readFileSync(join(ROOT, "lib", "db.ts"), "utf8"));

test("★ 웜업은 배경 타이머에서 돈다 — 요청 경로에서 접속을 만들면 그 지연이 사용자에게 간다", () => {
  assert.match(db, /setInterval\(/, "웜업 타이머가 사라졌다");
  assert.match(db, /globalForDb\.__safetyMonitorPoolWarmer/, "타이머 중복 기동 가드가 사라졌다");
  assert.match(db, /startPoolWarmer\(pool\)/, "풀 생성 시 워머를 기동하지 않는다");
});

test("★ 웜업 실패를 삼킨다 — 배경에서 throw 하면 unhandled rejection 으로 프로세스가 죽는다", () => {
  const fn = db.slice(db.indexOf("async function warmPool"), db.indexOf("function startPoolWarmer"));
  assert.ok(fn.length > 0, "warmPool 을 못 찾았다 — 앵커가 낡았다");
  // 2026-09-09: `catch {` 만 받던 것을 `catch (e) {` 도 받도록 넓혔다.
  //   워머가 삼킨 실패를 로그로 남기려면 오류 바인딩이 필요한데, 종전 정규식이 그것을 막았다.
  //   ★ 넓히되 약화시키지 않는다 — 아래 "다시 던지지 않는다"를 새로 못박는다.
  assert.match(fn, /\}\s*catch\s*(\([A-Za-z_$][\w$]*\)\s*)?\{/, "catch 가 사라졌다");
  assert.doesNotMatch(
    fn,
    /catch[\s\S]*?\bthrow\b[\s\S]*?finally/,
    "catch 안에서 다시 던지면 배경 작업이 unhandled rejection 으로 프로세스를 죽인다",
  );
  assert.match(fn, /finally\s*\{/, "finally 가 사라졌다");
  assert.match(fn, /\.release\(\)/, "잡은 커넥션을 놓지 않는다 — 풀 누수");
});

test("★ 순차로 만든다 — 동시에 열면 문제의 버스트를 우리가 재현한다", () => {
  const fn = db.slice(db.indexOf("async function warmPool"), db.indexOf("function startPoolWarmer"));
  assert.doesNotMatch(fn, /Promise\.all/, "동시 생성으로 되돌아갔다");
  assert.match(fn, /await pool\.connect\(\)/, "순차 await 가 사라졌다");
});

test("★ 종료 조건은 만진 수(held.length)다 — 가진 수로 끊으면 기존 커넥션이 늙어 죽는다", () => {
  const fn = db.slice(db.indexOf("async function warmPool"), db.indexOf("function startPoolWarmer"));
  assert.match(
    fn,
    /while \(held\.length < WARM_FLOOR\)/,
    "루프가 held.length 기준이 아니다 — 바닥이 차 있으면 아무것도 안 만져 유휴 타이머가 리셋되지 않는다",
  );
  assert.doesNotMatch(
    fn,
    /while \([^)]*pool\.totalCount/,
    "가진 수 기준 루프로 되돌아갔다 — 1차 배포(00311-nfk)에서 2분마다 재생성을 만든 그 조건이다",
  );
});

test("★ 대기 중인 요청이 있으면 워머가 물러난다 — 풀을 두고 요청과 경쟁하면 안 된다", () => {
  const fn = db.slice(db.indexOf("async function warmPool"), db.indexOf("function startPoolWarmer"));
  assert.match(fn, /pool\.waitingCount > 0/, "경쟁 회피 가드가 사라졌다");
});

test("웜 바닥은 실측 버스트 이상이고, 주기는 폴링(60초)보다 짧다", () => {
  const floor = Number(/const WARM_FLOOR = (\d+)/.exec(db)?.[1]);
  const interval = Number(/const WARM_INTERVAL_MS = ([\d_]+)/.exec(db)?.[1]?.replace(/_/g, ""));
  assert.ok(floor >= 8, `WARM_FLOOR ${floor} — 실측 버스트 동시 6~8 미만이면 바닥 구실을 못 한다`);
  assert.ok(
    interval > 0 && interval < 60_000,
    `WARM_INTERVAL_MS ${interval} — 폴링 60초 안에 한 번은 돌아야 버스트 전에 바닥이 찬다`,
  );
});
