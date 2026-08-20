// 폴링 경로 DB 압력 가드 — 풀 고갈로 관제 화면이 분당 한 번 500 을 내던 것을 되돌리지 않게.
//
// 발단(2026-08-20 실측). 매분 같은 초에 요청 7건이 동시에 오는데(aed 3종·gaspod·monitor/vital·
// calendar/media) 그중 하나가 5초 안에 커넥션을 못 얻어 500 이 났다.
//   증거 = `Connection terminated due to connection timeout` 스택이 라우트 핸들러 안이고
//          (요청 없는 백그라운드 타이머가 아니다) 실패 라우트 최대 지연이 정확히 5.01초
//          = connectionTimeoutMillis.
// 주범 = `/api/monitor/vital` — 가장 잦은데 평균 0.881초로, DB 질의를 **순차로** 여럿 돈다.
//
// 처방은 둘이고 성격이 다르다.
//   ⓐ 풀 8 → 16       증상 완화(동시 수용량)
//   ⓑ 폴링 TTL 캐시    근본(요청당 왕복 수 = 점유 시간)
// 하나만 남으면 조건이 조금 바뀔 때 재발하므로 **둘 다** 지킨다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const db = readFileSync(join(ROOT, "lib/db.ts"), "utf8");
const store = readFileSync(join(ROOT, "app/api/app/vital/store.ts"), "utf8");

// 앵커 — 대상이 사라지면 아래 검사가 조용히 통과한다(L-79).
test("앵커 — 풀 설정과 폴링 래퍼가 실재한다", () => {
  assert.match(db, /new Pool\(\{/, "풀 생성부 소실");
  assert.ok(store.includes("export async function totalPersisted"), "totalPersisted 래퍼 소실");
  assert.ok(store.includes("export async function countsByWorker"), "countsByWorker 소실");
  assert.ok(store.includes("export async function workerProfiles"), "workerProfiles 소실");
});

// ── ⓐ 수용량
test("풀 크기가 8 로 되돌아가지 않았다", () => {
  const i = db.indexOf("new Pool({");
  const body = db.slice(i, i + 900);
  const m = body.match(/max:\s*(\d+)/);
  assert.ok(m, "풀 max 설정 소실");
  assert.ok(Number(m[1]) >= 16, `풀 max=${m?.[1]} — 16 미만으로 내리면 분당 500 이 재발한다`);
  // 획득 대기 상한이 사라지면 무한 대기가 되어 증상이 500 에서 무응답으로 바뀔 뿐이다.
  assert.match(body, /connectionTimeoutMillis:\s*\d+/, "커넥션 획득 상한이 사라졌다");
});

// ── ⓑ 왕복 수(근본)
test("폴링 집계에 TTL 캐시가 있다 — 요청당 DB 왕복을 줄인다", () => {
  assert.match(store, /const POLL_AGG_TTL_MS\s*=\s*[\d_]+/, "폴링 TTL 상수 소실");
  // ⚠ 식별자 존재만 보면 안 된다 — 조기 반환이 빠져도 통과한다(어제 캐시 가드에서 실측).
  //   **신선하면 질의 없이 돌아가는 것**이 이 가드가 지키는 것이다.
  assert.match(
    store,
    /if \(cache && now - cache\.at < ttlMs\) return cache\.value;/,
    "TTL 조기 반환이 사라졌다 — 캐시가 이름만 남고 매번 DB 를 친다",
  );
  for (const fn of ["memoTotalPersisted", "memoTotalDataMockup", "memoAllWorkers", "memoWorkerProfiles"]) {
    assert.ok(store.includes(fn), `${fn} 소실 — 그 집계가 폴링마다 DB 를 친다`);
  }
});

test("폴링 래퍼가 메모를 실제로 호출한다 — 선언만 남으면 아무 효과가 없다", () => {
  assert.match(store, /return memoTotalPersisted\(\)/, "totalPersisted 가 캐시를 안 쓴다");
  assert.match(store, /return memoTotalDataMockup\(\)/, "totalDataMockupPersisted 가 캐시를 안 쓴다");
  assert.match(store, /for \(const w of await memoAllWorkers\(\)\)/, "countsByWorker 가 캐시를 안 쓴다");
  assert.match(store, /const all = await memoWorkerProfiles\(\)/, "workerProfiles 가 캐시를 안 쓴다");
});

// ★ 공유 DB 함수에는 걸지 않는다 — 관리자 화면이 즉시 반영을 잃는다.
test("캐시는 폴링 경로에만 — 공유 db.ts 함수는 안 건드린다", () => {
  for (const fn of ["listAllWorkers", "getWorkerProfiles", "totalPersisted"]) {
    const i = db.indexOf(`export async function ${fn}`);
    assert.ok(i >= 0, `${fn} 소실(앵커)`);
    const body = db.slice(i, i + 400);
    assert.doesNotMatch(
      body,
      /TTL|cache\.at|memo/i,
      `db.${fn} 에 캐시가 생겼다 — 관리자 화면이 변경을 늦게 본다(작업자 추가 후 대기)`,
    );
  }
});

// ★ 병렬화 금지 — 요청 하나가 커넥션 여러 칸을 잡으면 고갈이 더 빨라진다.
test("vital GET 집계를 Promise.all 로 병렬화하지 않았다", () => {
  const route = readFileSync(join(ROOT, "app/api/app/vital/route.ts"), "utf8");
  assert.ok(route.includes("softly("), "softly 소실(앵커)");
  assert.doesNotMatch(
    route,
    /Promise\.all\(\s*\[[^\]]*softly/,
    "집계를 병렬화했다 — 요청 하나가 커넥션을 여럿 잡아 풀 고갈이 빨라진다",
  );
});
