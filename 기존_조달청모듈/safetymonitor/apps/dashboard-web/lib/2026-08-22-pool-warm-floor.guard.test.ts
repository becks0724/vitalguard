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
  assert.match(fn, /\}\s*catch\s*\{/, "catch 가 사라졌다");
  assert.match(fn, /finally\s*\{/, "finally 가 사라졌다");
  assert.match(fn, /\.release\(\)/, "잡은 커넥션을 놓지 않는다 — 풀 누수");
});

test("★ 순차로 만든다 — 동시에 열면 문제의 버스트를 우리가 재현한다", () => {
  const fn = db.slice(db.indexOf("async function warmPool"), db.indexOf("function startPoolWarmer"));
  assert.doesNotMatch(fn, /Promise\.all/, "동시 생성으로 되돌아갔다");
  assert.match(fn, /await pool\.connect\(\)/, "순차 await 가 사라졌다");
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
