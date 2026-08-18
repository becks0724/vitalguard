// 저장 실패 신호 가드 — 실패를 삼키고 201 을 주던 상태로 되돌아가면 실패한다.
//
// 2026-08-15 DB 장애(3시간 50분) 때 생체 샘플이 통째로 사라졌다. 원인은 DB 가 죽은 것이
// 아니라 **POST 가 201 을 돌려준 것**이다 — 폰(VitalPipeline)은 2xx 를 받으면 디스크 큐에서
// 원본을 지운다. 5xx 였으면 큐(5,000건 ≈ 6.9시간)에 남기고 30초 뒤 재전송했을 것이다.
//
// ★ 그렇다고 catch 를 없애면 안 된다. 감사 DB-POOL-02(2026-06-30)가 저장과 경보를 분리해
//   "샘플은 잃어도 SOS·낙상은 나간다"를 만들었고, 이번 장애 3시간 50분 내내 그 덕에 경보가
//   살아 있었다. 그러니 계약은 **삼키되 알린다** 이다 — catch 는 남기고 실패만 호출부로 올린다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const store = readFileSync(join(ROOT, "app", "api", "app", "vital", "store.ts"), "utf8");
const route = readFileSync(join(ROOT, "app", "api", "app", "vital", "route.ts"), "utf8");

test("① persistSample 실패가 호출부로 올라간다 — 삼키고 끝나지 않는다", () => {
  const i = store.indexOf("await persistSample(sample);");
  assert.ok(i >= 0, "persistSample 호출이 사라짐");
  const block = store.slice(i, i + 300);
  assert.match(block, /catch/, "catch 가 사라짐 — 경보 경로가 죽는다(DB-POOL-02 회귀)");
  assert.match(block, /persistFailed = true/, "실패를 호출부에 알리지 않는다 — 201 유실 재발");
});

test("② 경보 기록이 저장 실패와 독립이다 — DB-POOL-02 회귀 방지", () => {
  const p = store.indexOf("await persistSample(sample);");
  const a = store.indexOf("recordAlert", p);
  assert.ok(a > p, "경보 기록이 persistSample 뒤에 없다");
  // 두 구간 사이에 return/throw 가 끼면 저장 실패가 경보를 막는다.
  const between = store.slice(p, a);
  assert.doesNotMatch(between, /\n\s*(return|throw)\s/, "저장 실패가 경보 경로를 끊는다");
});

test("③ 저장 실패 시 5xx — 201 로 덮지 않는다", () => {
  assert.match(route, /persistFailures > 0/, "배치 저장 실패 판정이 사라짐");
  assert.match(route, /if \(persistFailed\)/, "단건 저장 실패 판정이 사라짐");
  // 503 이 두 경로(배치·단건) 모두에 있어야 한다.
  const n = (route.match(/status: 503/g) ?? []).length;
  assert.ok(n >= 2, `503 반환이 ${n}곳뿐 — 배치·단건 둘 다 필요`);
});

test("④ ★ 저장 대상이 아닌 것은 실패가 아니다 — 폰 무한 재시도 방지", () => {
  // 예약 워커·미분류 source·빈 샘플은 재전송해도 결과가 같다. 여기에 persistFailed 가 서면
  // 폰이 30초마다 영원히 같은 샘플을 보낸다(배터리·트래픽).
  const i = store.indexOf("export async function addSample");
  const head = store.slice(i, store.indexOf("isDataMockupOrigin", i));
  const rejects = head.match(/return \{ sample: null, persistFailed: (\w+) \}/g) ?? [];
  assert.equal(rejects.length, 3, `거부 경로가 3개가 아님(${rejects.length}) — 계약 변경 확인 필요`);
  for (const r of rejects) {
    assert.match(r, /persistFailed: false/, "거부 경로가 저장 실패로 보고된다");
  }
  // 단건 라우트의 not_stored 는 202 여야 한다(503 이면 재시도 루프).
  assert.match(route, /dropped: "not_stored"[\s\S]{0,80}status: 202/, "미저장 응답이 202 가 아님");
});

test("⑤ 목업 저장 실패는 재전송을 유도하지 않는다", () => {
  const i = store.indexOf("await persistDataMockup(sample);");
  assert.ok(i >= 0, "목업 저장 호출이 사라짐");
  const block = store.slice(i, i + 400);
  assert.match(block, /persistFailed: false/, "목업 실패가 실데이터 큐를 막는다");
});
