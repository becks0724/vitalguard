// 구조적 재발 방지 — SOS·낙상 경보 무음 유실(감사 DB-POOL-02·BE-IDEM-01) 수정의 가드 테스트.
//
// 왜 가드 테스트인가 — 이 결함은 계산 결과가 아니라 제어 흐름(한 try 가 persist 실패로 경보까지
// 삼킴)이라 DB 없이 기능 테스트가 불가하고(tsx --test 는 mock.module 미지원), 2026-06-30 에 실제
// 유실이 발생했던 경로다. 되돌리면 여기서 실패로 드러나게 소스 불변식을 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const dbSource = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");
const storeSource = readFileSync(join(ROOT, "app", "api", "app", "vital", "store.ts"), "utf8");

// export 함수 본문 슬라이스 — 다음 export 직전까지.
function fnSlice(source: string, marker: string): string {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} 를 찾지 못함`);
  const end = source.indexOf("\nexport ", start + marker.length);
  return source.slice(start, end < 0 ? undefined : end);
}

test("BE-IDEM-01 — persistSample 은 (worker_id, ts) 멱등 적재다(중복이 예외로 안 터짐)", () => {
  const body = fnSlice(dbSource, "export async function persistSample");
  const literal = "ON CONFLICT (worker_id, ts) DO NOTHING";
  // 2026-08-28 에 이 꼬리말이 상수(VITAL_UPSERT_SUFFIX)로 빠졌다 — 배치 저장(persistSamples)이
  // **같은 것**을 쓰게 하기 위해서다. 그래서 리터럴 직접 포함도, 상수 경유도 통과시킨다.
  // ⚠ 상수 경유일 때는 **그 상수의 값까지** 확인한다 — 이름만 보면 값이 바뀌어도 초록이다.
  const viaConst =
    body.includes("VITAL_UPSERT_SUFFIX") &&
    dbSource.includes(`const VITAL_UPSERT_SUFFIX = "${literal}"`);
  assert.ok(
    body.includes(literal) || viaConst,
    "persistSample 의 INSERT 에 ON CONFLICT (worker_id, ts) DO NOTHING 이 없다 — 중복 재전송이 23505 예외로 터져 실제 장애와 같은 catch 로 들어간다(DB-POOL-02 의 절반)",
  );
});

test("BE-IDEM-01 — initSchema 가 uq_vs_worker_ts UNIQUE 인덱스를 선언한다(신규 환경 보장)", () => {
  assert.ok(
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_vs_worker_ts ON vital_samples\(worker_id, ts\)/.test(dbSource),
    "코드 DDL 에 uq_vs_worker_ts 가 없다 — 라이브에만 있는 인덱스(2026-06-29 수동 생성)를 코드가 모른다",
  );
});

test("DB-POOL-02 — addSample 에서 persist 실패가 경보 기록을 건너뛰지 못한다(try 분리)", () => {
  const body = fnSlice(storeSource, "export async function addSample");
  const persistAt = body.indexOf("await persistSample(");
  const alertAt = body.indexOf("recordAlert(");
  assert.ok(persistAt >= 0 && alertAt > persistAt, "addSample 안에 persistSample → recordAlert 순서가 아님");
  // persistSample 호출과 첫 recordAlert 호출 사이에 catch 경계가 있어야 한다.
  // 한 try 로 합치면 persist 예외가 경보 기록·텔레그램까지 삼킨다(2026-06-30 SOS 무음 유실 재발).
  assert.ok(
    /catch/.test(body.slice(persistAt, alertAt)),
    "persistSample 과 recordAlert 가 같은 try 안에 있다 — persist 실패가 SOS·낙상 경보를 삼킨다",
  );
});

test("DB-POOL-02 — recordAlert 는 기록 실패 시에도 텔레그램 통지를 보낸다(fail-open)", () => {
  const body = fnSlice(dbSource, "export async function recordAlert");
  const catchAt = body.indexOf("catch");
  assert.ok(catchAt >= 0, "recordAlert 에 catch 가 없다 — DB 장애가 통지까지 삼킨다");
  const catchBlock = body.slice(catchAt, body.indexOf("}", body.indexOf("throw", catchAt)));
  assert.ok(
    catchBlock.includes("notifyAlertTelegram"),
    "recordAlert 의 catch 가 notifyAlertTelegram 을 호출하지 않는다 — 기록 실패 = 통지 유실",
  );
  assert.ok(
    catchBlock.includes("throw"),
    "recordAlert 의 catch 가 에러를 다시 던지지 않는다 — 호출측(alerts 라우트)의 실패 표현·재시도 신호가 사라진다",
  );
});
