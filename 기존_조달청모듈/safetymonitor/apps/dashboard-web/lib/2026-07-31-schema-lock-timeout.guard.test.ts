// 구조적 재발 방지 — 스키마 초기화 DDL 의 잠금 대기 상한(lock_timeout) + 실패의 비치명 처리 가드.
//
// 배경 — 2026-07-30 다른 세션의 58분짜리 조회가 users 테이블을 붙잡았고, ALTER TABLE 이 그 뒤에서
// 대기하자 PostgreSQL FIFO 잠금 큐 때문에 이후의 모든 조회까지 줄서면서 관제웹 전 라우트가 500 이 됐다.
// ① 잠금 대기를 끊고 ② 초기화 실패를 치명적으로 다루지 않으면 같은 상황에서 서비스가 살아남는다
// (컬럼이 정말 없으면 이어지는 쿼리가 자기 오류로 실패하므로 문제가 가려지지도 않는다).
//
// 왜 가드 테스트인가 — 실 DB 없이는 잠금 상황을 재현할 수 없다. 소스 불변식으로 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const dbSource = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");

// 함수 본문 슬라이스 — 지정한 다음 선언 직전까지.
function fnSlice(marker: string, until: string): string {
  const start = dbSource.indexOf(marker);
  assert.ok(start >= 0, `${marker} 를 찾지 못함`);
  const end = dbSource.indexOf(until, start + marker.length);
  return dbSource.slice(start, end < 0 ? undefined : end);
}

test("스키마 초기화 — DDL 전에 lock_timeout 을 설정한다", () => {
  const body = fnSlice("async function initSchema", "\n// 쿼리 헬퍼");
  assert.ok(
    /SET lock_timeout = '\$\{SCHEMA_LOCK_TIMEOUT\}'/.test(body),
    "initSchema 가 lock_timeout 을 걸지 않는다 — 남의 긴 조회가 API 전체를 막을 수 있다",
  );
  const setAt = body.indexOf("SET lock_timeout");
  const ddlAt = body.indexOf("CREATE TABLE IF NOT EXISTS");
  assert.ok(setAt < ddlAt, "lock_timeout 설정이 DDL 보다 뒤에 있다 — 효과가 없다");
});

test("스키마 초기화 — 전용 커넥션을 쓰고 반납 전 lock_timeout 을 복구한다", () => {
  const body = fnSlice("async function initSchema", "\n// 쿼리 헬퍼");
  assert.ok(
    body.includes("await getPool().connect()"),
    "풀 공유 쿼리로 SET 하면 설정이 다른 쿼리에 남는다 — 전용 커넥션이어야 한다",
  );
  assert.ok(
    body.includes("RESET lock_timeout") && body.includes("client.release()"),
    "커넥션 반납 전 RESET lock_timeout 이 없다 — 일반 쿼리도 3초에 잠금을 포기하게 된다",
  );
});

test("스키마 초기화 — 실패를 다시 던지지 않는다(비치명) + 재시도 유예를 둔다", () => {
  const body = fnSlice("async function ensureSchema", "\nasync function initSchema");
  assert.ok(
    !/\bthrow\b/.test(body),
    "ensureSchema 가 실패를 다시 던진다 — 스키마 DDL 하나가 막히면 모든 라우트가 500 이 된다",
  );
  assert.ok(
    body.includes("schemaRetryAfter"),
    "재시도 유예가 없다 — 잠금이 풀릴 때까지 매 요청이 lock_timeout 만큼 지연된다",
  );
});
