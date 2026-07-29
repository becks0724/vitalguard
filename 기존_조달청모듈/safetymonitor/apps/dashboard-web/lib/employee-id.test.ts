// 사번 기본값 규칙 회귀 — 2026-07-27 제보("본인 사진을 못 지운다")의 근본 원인이
// users.employee_id 공백이었다. 규칙이 앱의 파생값과 어긋나면 같은 증상이 되살아난다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultEmployeeId } from "./employee-id";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// 이 값이 바뀌면 기존 데이터(EMP-admin6861 등 수십만 건)와의 연결이 끊긴다.
test("사번 기본값은 'EMP-' + 로그인ID — 앱 파생값과 같은 규칙", () => {
  assert.equal(defaultEmployeeId("admin6861"), "EMP-admin6861");
  assert.equal(defaultEmployeeId("admin7276"), "EMP-admin7276");
  assert.equal(defaultEmployeeId("worker1"), "EMP-worker1");
});

test("구글 가입(이메일 username)도 같은 규칙", () => {
  assert.equal(
    defaultEmployeeId("johnyang060323@gmail.com"),
    "EMP-johnyang060323@gmail.com",
  );
});

test("앞뒤 공백은 제거하고, 빈 ID 는 빈 값을 돌려준다", () => {
  assert.equal(defaultEmployeeId("  admin6861  "), "EMP-admin6861");
  // 빈 문자열에 접두어만 붙은 'EMP-' 를 만들면 여러 계정이 같은 사번을 갖게 된다.
  assert.equal(defaultEmployeeId(""), "");
  assert.equal(defaultEmployeeId("   "), "");
});

// username 이 UNIQUE 이므로 기본 사번도 유일하다.
// 이 성질이 깨지면 두 계정이 같은 사번을 갖고 서로의 사진을 지울 수 있다.
test("서로 다른 로그인ID 는 서로 다른 사번을 만든다", () => {
  const ids = ["admin6861", "admin7276", "admin3470", "worker1"];
  const emps = ids.map(defaultEmployeeId);
  assert.equal(new Set(emps).size, ids.length);
});

// 백필은 **비어 있는 계정만** 채워야 한다. 실제 사번(worker1 = EMP-6861)을 덮어쓰면
// 그 사람의 기존 생체·미디어 귀속이 통째로 끊긴다.
// 2026-07-29 — '빈 계정'의 정의에 빈 문자열을 추가했다. NULL 만 보면 '' 인 계정이 영영 안 고쳐져
// 로그인 토큰의 workerId 가 빈 문자열로 나가고 수집이 401 로 죽는다. ''는 실제 사번이 아니므로
// 덮어써도 귀속이 끊기지 않는다 — 아래 "값이 있으면 건드리지 않는다"는 성질은 그대로 지킨다.
test("백필 SQL 은 사번이 비어 있는 행만 갱신한다(NULL·빈 문자열)", () => {
  const db = readFileSync(join(ROOT, "lib/db.ts"), "utf8");
  const backfill = db
    .split("\n")
    .find((l) => l.includes("UPDATE users SET employee_id"));
  assert.ok(backfill, "사번 백필 구문이 사라졌다");
  assert.match(
    backfill,
    /WHERE employee_id IS NULL/,
    "백필이 기존 사번까지 덮어쓴다 — 실제 사번 보유 계정의 데이터 귀속이 끊긴다",
  );
  assert.match(
    backfill,
    /trim\(employee_id\)\s*=\s*''/,
    "빈 문자열이 대상에서 빠졌다 — 그 계정은 로그인 토큰에 사번이 안 실려 수집이 401 로 죽는다",
  );
  assert.match(backfill, /'EMP-'\s*\|\|\s*username/, "백필 규칙이 앱 파생값과 달라졌다");
});

// 가입 경로가 늘어날 때 사번을 빠뜨리면 그 계정만 조용히 같은 버그를 안고 태어난다.
test("사용자 생성 경로는 모두 사번 기본값을 넣는다", () => {
  const db = readFileSync(join(ROOT, "lib/db.ts"), "utf8");
  const inserts = db.split("buildInsert(\"users\"").slice(1);
  assert.ok(inserts.length >= 2, "users 삽입 지점을 찾지 못했다(테스트 갱신 필요)");
  for (const [i, block] of inserts.entries()) {
    const head = block.slice(0, 700);
    assert.match(
      head,
      /employee_id:/,
      `users 삽입 ${i + 1}번째에 employee_id 가 없다 — 그 경로로 만든 계정은 본인 사진을 못 지운다`,
    );
  }
});
