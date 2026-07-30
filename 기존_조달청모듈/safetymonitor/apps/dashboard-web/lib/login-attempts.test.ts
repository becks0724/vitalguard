// 로그인 잠금 — 인스턴스 공유 전환 후에도 (a) 잠금 규칙이 그대로이고 (b) DB 가 죽어도
// 방어가 0 이 되지 않는지 고정한다.
//
// 배경: 잠금 카운터가 프로세스 메모리에만 있으면 Cloud Run 이 1~4 인스턴스로 뜨는 동안
// 인스턴스마다 따로 세어 5회 임계가 실제로는 최대 20회가 된다. DB 로 공유하되, DB 장애 시
// 잠금이 통째로 사라지면 오히려 더 나빠지므로 메모리 폴백을 남겼다 — 그 폴백이 실제로 도는지 본다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { LOCKOUT_MS, MAX_FAILS, loginLockRemainingMs, recordLoginResult } from "./login-attempts";

// DATABASE_URL 이 없으면 db 의 getPool 이 던진다 → 이 파일의 호출은 전부 '공유 저장소 장애' 경로를 탄다.
// getPool 은 호출 시점에 env 를 읽으므로 import 뒤에 지워도 된다.
delete process.env.DATABASE_URL;

const root = resolve(__dirname, "..");
const key = (n: string) => `test:${n}:${Math.random().toString(36).slice(2)}`;

test("DB 가 없어도 임계 회수 실패하면 잠긴다(메모리 폴백)", async () => {
  const k = key("lock");
  for (let i = 0; i < MAX_FAILS - 1; i++) {
    await recordLoginResult(k, false);
    assert.equal(await loginLockRemainingMs(k), 0, `${i + 1}회 실패로는 아직 안 잠긴다`);
  }
  await recordLoginResult(k, false);
  const remaining = await loginLockRemainingMs(k);
  assert.ok(remaining > 0, "임계 도달 시 잠겨야 한다 — 0 이면 DB 장애 때 방어가 사라진 것");
  assert.ok(remaining <= LOCKOUT_MS, "잠금 시간이 설정값을 넘지 않는다");
});

test("성공하면 카운터가 리셋된다", async () => {
  const k = key("reset");
  for (let i = 0; i < MAX_FAILS - 1; i++) await recordLoginResult(k, false);
  await recordLoginResult(k, true);
  for (let i = 0; i < MAX_FAILS - 1; i++) await recordLoginResult(k, false);
  assert.equal(await loginLockRemainingMs(k), 0, "성공 후에는 다시 MAX_FAILS 기회가 있어야 한다");
});

test("공유 저장소 장애가 로그인 라우트를 터뜨리지 않는다", async () => {
  const k = key("throw");
  // DATABASE_URL 이 없어 내부 DB 호출은 반드시 실패한다. 그 예외가 밖으로 새면 로그인이 500 이 된다.
  await assert.doesNotReject(() => recordLoginResult(k, false));
  await assert.doesNotReject(() => loginLockRemainingMs(k));
});

test("잠금 판정은 DB 와 메모리 중 긴 쪽을 쓴다", () => {
  const src = readFileSync(resolve(root, "lib/login-attempts.ts"), "utf8");
  assert.match(
    src,
    /Math\.max\(local, shared\)/,
    "둘 중 긴 쪽이어야 DB 장애 시에도 최악이 종전(프로세스 단위)과 같아진다",
  );
});

test("로그인 라우트 전부가 같은 잠금 모듈을 쓴다", () => {
  // 라우트가 각자 잠금을 들고 있으면 한 곳만 고쳐도 나머지가 남는다.
  // 로그인 라우트를 추가하면 여기에도 넣어야 한다.
  const routes = [
    "app/api/admin/login/route.ts",
    "app/api/app-auth/login/route.ts",
    "app/api/mobile/v1/session/login/route.ts",
  ];
  for (const p of routes) {
    const src = readFileSync(resolve(root, p), "utf8");
    assert.match(src, /lib\/login-attempts"/, `${p} 가 공용 잠금을 써야 한다`);
    assert.match(src, /await loginLockRemainingMs\(/, `${p} 의 잠금 조회는 await 되어야 한다`);
    assert.match(src, /await recordLoginResult\(/, `${p} 의 결과 기록은 await 되어야 한다`);
    // admin-auth 에서 잠금을 다시 가져오면 인스턴스별 카운터로 되돌아간다.
    // import 문 자체만 본다(파일 전체를 보면 login-attempts import 와 겹쳐 잘못 걸린다).
    const adminImport = src.match(/import\s*\{[^}]*\}\s*from\s*"[^"]*lib\/admin-auth"/);
    if (adminImport) {
      assert.doesNotMatch(
        adminImport[0],
        /recordLoginResult|loginLockRemainingMs/,
        `${p} 가 admin-auth 의 옛 동기 잠금을 다시 쓰면 인스턴스별로 갈라진다`,
      );
    }
  }
});
