// 생체 배치 저장 일괄화 가드 — 건별 왕복으로 되돌아가는 것을 막는다.
//
// 배경(2026-08-28). 폰이 보낸 500건 배치를 서버가 **건별로** INSERT 해 왕복이 500번이었다.
// 건당 33ms × 500 = 16.5초. 폰 타임아웃은 15초라 **매번 먼저 끊겼고**, 폰은 실패로 보고 큐를
// 안 비운 채 같은 500건을 재전송했다. 서버는 매번 끝까지 처리해 201 을 썼지만 받는 사람이
// 없었다 — 스스로 못 빠져나오는 고착 루프다(장우진 20분 무수신 · 요청 크기가 271,742~271,744
// 바이트로 ±2바이트 고정인 것이 "같은 배치 반복"의 직접 증거였다).
//
// ★ 이 가드의 한 문장 보장.
//   "배치 수집은 저장을 루프 밖 **한 왕복**으로 모으고, 그 배치 저장은 단건 저장과
//    **같은 컬럼·같은 출처 관문·같은 멱등 규칙**을 쓴다."
//
// ★★ 왜 "같은 것을 쓴다" 가 단언 대상인가 — `vital_samples` 는 컬럼이 55개이고 계속 늘어온
//   테이블이다. 저장 경로가 둘인데 컬럼 목록이 사본이면, 다음 컬럼 추가 때 한쪽만 늘어나고
//   그 결함은 "배치로 들어온 행만 값이 빈다" 는 모양이라 눈에 잘 안 띈다. `persistSample`
//   주석이 같은 계열 사고를 이미 기록하고 있다 — "관문은 넷이다 — 스키마·분류·여기·컬럼".
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "./test-support/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const route = stripComments(read("app", "api", "app", "vital", "route.ts"));
const store = stripComments(read("app", "api", "app", "vital", "store.ts"));
const db = stripComments(read("lib", "db.ts"));

/** 여는 괄호 위치부터 짝이 맞는 닫는 괄호까지의 블록을 잘라낸다(창이 파일 끝까지 새는 것 방지). */
function blockAt(src: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return src.slice(openIdx);
}

test("① 배치 루프는 저장을 미룬다 — 건별 INSERT 로 되돌아가지 않았다", () => {
  assert.match(
    route,
    /addSample\(item, \{ deferPersist: true \}\)/,
    "배치 루프가 deferPersist 없이 addSample 을 부른다 — 건별 왕복으로 되돌아갔다",
  );
});

test("② 미뤄 둔 샘플이 실제로 저장된다 — 모으기만 하고 안 넣으면 조용히 유실된다", () => {
  assert.match(route, /toPersist\.push\(result\.pendingPersist\)/, "pendingPersist 를 안 모은다");
  assert.match(route, /await persistSamples\(toPersist\)/, "모은 것을 저장하지 않는다");
});

test("③ ★ 저장 호출은 루프 **밖**에 있다 — 안에 있으면 한 왕복이 아니다", () => {
  const loopIdx = route.indexOf("for (const item of body)");
  assert.ok(loopIdx > 0, "배치 루프를 못 찾았다 — 가드가 낡았다");
  const loopBody = blockAt(route, route.indexOf("{", loopIdx));
  assert.ok(
    !loopBody.includes("persistSamples("),
    "저장 호출이 루프 안에 있다 — 건별 왕복과 같아져 수리 효과가 사라진다",
  );
  assert.ok(
    route.indexOf("await persistSamples(toPersist)") > loopIdx + loopBody.length,
    "저장 호출이 루프보다 앞에 있다",
  );
});

test("④ store 가 deferPersist 를 실제로 분기한다 — 옵션만 받고 무시하지 않는다", () => {
  assert.match(store, /if \(options\?\.deferPersist\)/, "deferPersist 분기가 없다");
  assert.match(store, /pendingPersist = sample/, "미뤄 둔 샘플을 호출부로 안 올린다");
  assert.match(
    store,
    /return \{ sample, persistFailed, pendingPersist \}/,
    "반환에 pendingPersist 가 빠졌다 — 라우트가 모을 수 없다",
  );
});

test("⑤ ★ 배치 저장에도 실기기 출처 관문이 걸려 있다 — 목업 격리 우회 금지", () => {
  const idx = db.indexOf("export async function persistSamples(");
  assert.ok(idx > 0, "persistSamples 가 없다");
  const body = blockAt(db, db.indexOf("{", idx));
  assert.match(
    body,
    /assertRealDeviceOrigin\(sample\)/,
    "배치 경로가 출처 관문을 안 건다 — mockup_* 이 실데이터 테이블에 섞인다",
  );
  // 관문이 저장보다 **앞**이어야 한다. 뒤면 한 건이 위반해도 나머지가 이미 들어간다.
  assert.ok(
    body.indexOf("assertRealDeviceOrigin") < body.indexOf("buildBulkInsert"),
    "관문이 저장보다 뒤에 있다 — 위반 배치가 부분 적재된다",
  );
});

test("⑥ ★ 컬럼 목록이 단건·배치 공용이다 — 사본이 생기면 한쪽만 낡는다", () => {
  const single = blockAt(db, db.indexOf("{", db.indexOf("export async function persistSample(")));
  const batch = blockAt(db, db.indexOf("{", db.indexOf("export async function persistSamples(")));
  assert.match(single, /vitalSampleColumns\(sample\)/, "단건이 공용 컬럼 함수를 안 쓴다");
  assert.match(batch, /samples\.map\(vitalSampleColumns\)/, "배치가 공용 컬럼 함수를 안 쓴다");
  // 컬럼 맵을 만드는 자리는 하나뿐이어야 한다.
  assert.equal(
    (db.match(/function vitalSampleColumns\(/g) ?? []).length,
    1,
    "컬럼 함수가 둘 이상이다 — 사본이 생겼다",
  );
});

test("⑦ 두 저장 경로가 같은 멱등 규칙을 쓴다 — 재전송이 중복 행을 만들지 않는다", () => {
  assert.match(
    db,
    /const VITAL_UPSERT_SUFFIX = "ON CONFLICT \(worker_id, ts\) DO NOTHING"/,
    "멱등 꼬리말 상수가 없다",
  );
  const single = blockAt(db, db.indexOf("{", db.indexOf("export async function persistSample(")));
  const batch = blockAt(db, db.indexOf("{", db.indexOf("export async function persistSamples(")));
  assert.match(single, /VITAL_UPSERT_SUFFIX/, "단건이 멱등 꼬리말을 안 쓴다");
  assert.match(batch, /VITAL_UPSERT_SUFFIX/, "배치가 멱등 꼬리말을 안 쓴다");
});

test("⑧ 청크는 컬럼 수에서 계산한다 — 상수로 박으면 컬럼이 늘 때 바인드 상한을 넘는다", () => {
  const batch = blockAt(db, db.indexOf("{", db.indexOf("export async function persistSamples(")));
  assert.match(
    batch,
    /chunkSizeFor\(keys\.length\)/,
    "청크가 컬럼 수에서 계산되지 않는다 — 컬럼이 늘면 조용히 상한을 넘는다",
  );
});
