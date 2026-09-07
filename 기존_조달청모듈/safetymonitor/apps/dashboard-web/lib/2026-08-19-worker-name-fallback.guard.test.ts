// 관제 화면 이름 폴백 가드 — 화면과 알림이 같은 사람을 다르게 부르지 않게 못 박는다.
//
// 발단(2026-08-19 실측). 화면은 이름을 최근 500샘플 링(12건/분 ≈ 41.7분)의 `sample` 에서만 읽어
// 그보다 오래 끊긴 작업자는 이름·사번이 통째로 사라지고 **사번이 이름 자리에** 떴다(배정 4명 중 3명).
// 같은 순간 부재 알림은 사람 이름을 부르고 있었다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const db = readFileSync(join(ROOT, "lib/db.ts"), "utf8");
const store = readFileSync(join(ROOT, "app/api/app/vital/store.ts"), "utf8");
const route = readFileSync(join(ROOT, "app/api/app/vital/route.ts"), "utf8");
const dash = readFileSync(join(ROOT, "app/components/DemoDashboard.tsx"), "utf8");

// 앵커 — 대상이 통째로 사라지면 아래 금지 검사들이 조용히 통과한다(L-79).
test("앵커 — 검사 대상 네 파일이 실재한다", () => {
  assert.ok(db.includes("export async function rosterWorkerNames"), "db.rosterWorkerNames 소실");
  assert.ok(db.includes("export async function lastSeenByWorker"), "db.lastSeenByWorker 소실");
  assert.ok(store.includes("export async function rosterWorkerNamesMap"), "store 래퍼 소실");
  assert.ok(route.includes("workerNames:"), "GET 응답 필드 소실");
  assert.ok(dash.includes("function workerHeading("), "workerHeading 소실");
});

// ── 규칙 일치. 화면과 알림이 다른 이름을 부르지 않으려면 두 질의가 같은 규칙을 써야 한다.
function bodyOf(src: string, fn: string): string {
  const i = src.indexOf(`export async function ${fn}`);
  assert.ok(i >= 0, `${fn} 없음`);
  const j = src.indexOf("\nexport ", i + 10);
  return src.slice(i, j < 0 ? undefined : j);
}

test("화면 이름과 알림 이름이 같은 규칙을 쓴다 — 최빈·명부·별칭 접힘", () => {
  for (const fn of ["rosterWorkerNames", "lastSeenByWorker"]) {
    const body = bodyOf(db, fn);
    assert.match(body, /MODE\(\) WITHIN GROUP \(ORDER BY v\.worker_name\)/, `${fn}: 최빈 라벨이 아니다`);
    assert.match(body, /monitor_slot_config/, `${fn}: 명부 기준이 아니다`);
    assert.match(body, /worker_alias/, `${fn}: 별칭을 안 접는다`);
  }
});

// ⚠ 창의 표기가 둘이다(2026-09-07) — 옛 `now() - $1::interval` 캐스트와, 인덱스를 타는
//   새 문자열 하한 `tsSinceLiteral("$1")`. 이 가드가 지키는 것은 **표기가 아니라 창의 유무**이므로
//   양쪽을 다 인정한다. 한쪽만 보면 캐스트를 걷어낸 수리가 이 가드를 거짓으로 빨갛게 만든다.
const TIME_WINDOW = /now\(\) - \$1::interval|tsSinceLiteral\("\$1"\)/;

test("화면용 이름에는 시간 창이 없다 — 41일 꺼진 작업자도 이름은 떠야 한다", () => {
  const body = bodyOf(db, "rosterWorkerNames");
  assert.doesNotMatch(body, TIME_WINDOW, "시간 창이 생겼다 — 오래 끊긴 작업자가 다시 사번으로 뜬다");
  // 반대로 부재 판정 쪽은 창이 있어야 한다(사건이 아니라 상태인 기기를 매일 밀지 않기 위해).
  assert.match(bodyOf(db, "lastSeenByWorker"), TIME_WINDOW, "부재 판정의 공백 상한이 사라졌다");
});

test("캐시가 있다 — 없으면 폴링마다 Seq Scan 1초를 문다", () => {
  const body = bodyOf(db, "rosterWorkerNames");
  assert.match(db, /ROSTER_NAME_TTL_MS\s*=\s*[\d_]+/, "TTL 상수 소실");
  // ⚠ 식별자 존재만 보면 안 된다 — 조기 반환을 지워도 마지막 대입문이 남아 통과한다(음성 대조로 실측).
  //   **캐시가 신선하면 질의 없이 돌아가는 것**이 이 가드가 지키는 것이다.
  assert.match(
    body,
    /if \(rosterNameCache[^)]*ROSTER_NAME_TTL_MS\)\s*return rosterNameCache\.map;/,
    "캐시 조기 반환이 사라졌다 — 폴링마다 Seq Scan 1초를 문다",
  );
});

// ★★ 사슬 전체를 검사한다 — 선언·전달·사용 중 **하나만 빠져도 화면은 사번으로 돌아간다**.
//    ⚠ 종전에는 파라미터 선언만 봤고, 옆 세션 음성 대조가 "실제로 쓰는 한 줄"을 지워도 초록인 것을
//      잡아냈다(2026-08-19). tsc·eslint 도 안 잡는다 — 쓰지 않는 인자는 오류가 아니기 때문이다.
test("이름 폴백 사슬 — 선언·전달·사용이 모두 살아 있다", () => {
  const i = dash.indexOf("function workerHeading(");
  assert.ok(i >= 0, "workerHeading 소실(앵커)");
  const body = dash.slice(i, dash.indexOf("\n}\n", i));

  // ① 실제 사용 — 이것이 없으면 나머지가 다 남아도 화면은 사번으로 돌아간다.
  assert.match(
    body,
    /sample\?\.workerName\?\.trim\(\)\s*\|\|\s*nameFallback\?\.trim\(\)/,
    "폴백이 선언만 남고 안 쓰인다 — 화면은 사번으로 돌아가는데 가드는 초록이다",
  );
  // ② 호출부가 폴백을 넘긴다.
  assert.match(dash, /workerHeading\(sample, workerId, nameFallback\)/, "호출부가 폴백을 안 넘긴다");
  // ③ 렌더가 서버 값을 prop 으로 준다 — 자동 슬라이딩 복제본까지 **2곳 모두**.
  const passes = dash.match(/nameFallback=\{data\.workerNames\?\.\[entry\.workerId\]\}/g) ?? [];
  assert.equal(passes.length, 2, `렌더 전달이 ${passes.length}곳 — 복제본 포함 2곳이어야 한다`);
});

test("DB 장애에 화면이 죽지 않는다 — softly 로 감싼다", () => {
  assert.match(
    route,
    /workerNames:\s*await softly\("이름", rosterWorkerNamesMap, \{\}, degraded\)/,
    "workerNames 가 softly 밖으로 나왔다 — 이름 조회 실패가 GET 전체를 500 으로 만든다",
  );
});

// ── ★ 판정 무주입. 이름이 떴다고 수신 중인 것이 아니다.
test("이름 폴백이 상태 판정에 닿지 않는다", () => {
  const staleLine = dash.split("\n").find((l) => l.includes("const stale = sample !== undefined"));
  assert.ok(staleLine, "stale 판정 줄 소실(앵커)");
  assert.doesNotMatch(staleLine, /nameFallback|workerNames/, "stale 판정이 이름을 본다");

  const overallLine = dash.split("\n").find((l) => l.includes("const overall = effectiveTone("));
  assert.ok(overallLine, "overall 판정 줄 소실(앵커)");
  assert.doesNotMatch(overallLine, /nameFallback|workerNames/, "신호등이 이름을 본다");
});

test("판정·경보 모듈은 이름 폴백을 모른다", () => {
  for (const rel of ["lib/severity.ts", "lib/telegram.ts", "lib/worker-signal.ts", "lib/absence-watch.ts"]) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    assert.ok(src.length > 200, `${rel} 앵커 — 파일이 비면 아래 금지가 조용히 통과한다`);
    assert.doesNotMatch(src, /nameFallback|rosterWorkerNames/, `${rel} 가 화면 표시용 이름을 끌어썼다`);
  }
});

test("예약 시험 워커는 이름 맵에서도 빠진다 — 화면에 없는 사람을 만들지 않는다", () => {
  assert.match(bodyOf(store, "rosterWorkerNamesMap"), /isReservedTestWorker/, "예약 워커 제외가 사라졌다");
});
