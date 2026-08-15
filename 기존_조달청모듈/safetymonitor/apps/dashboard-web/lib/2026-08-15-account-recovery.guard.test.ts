// 구조적 재발 방지 — 계정 찾기(아이디 찾기·비밀번호 재설정)의 보안 불변식 가드.
//
// 왜 가드 테스트인가 — 이 라우트들은 실 DB 가 있어야 동작해 tsx --test 로 기능 테스트가 불가하다
// (mock.module 미지원). 되돌리면 여기서 실패로 드러나게 소스 불변식을 고정한다.
//
// 배경 — 재설정 승인은 "남의 계정 접근을 넘기는" 행위다. 권한 게이트가 빠지거나, 임시 비밀번호
// 평문이 DB 에 남거나, 만료 판정이 세션 발급 뒤로 밀리면 그 즉시 계정 탈취 경로가 된다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const manageSource = read("app", "api", "admin", "password-reset", "manage", "route.ts");
const requestSource = read("app", "api", "admin", "password-reset", "route.ts");
const findIdSource = read("app", "api", "admin", "find-id", "route.ts");
const loginSource = read("app", "api", "admin", "login", "route.ts");
const dbSource = read("lib", "db.ts");

// 핸들러 본문 — 최상위 닫는 중괄호까지.
function handlerBody(source: string, name: "GET" | "POST"): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} 핸들러를 찾지 못함`);
  const end = source.indexOf("\n}", start);
  return source.slice(start, end < 0 ? undefined : end);
}

test("재설정 처리 — GET·POST 둘 다 권한 게이트를 먼저 통과한다", () => {
  for (const method of ["GET", "POST"] as const) {
    const body = handlerBody(manageSource, method);
    const guardAt = body.indexOf("guard(request)");
    assert.ok(guardAt >= 0, `${method} 에 권한 게이트가 없다 — 누구나 요청 목록을 보거나 발급할 수 있다`);
    // 게이트가 본문 첫머리에 있어야 한다. 뒤에 있으면 그 앞의 처리는 무인증으로 실행된다.
    const bodyStart = body.indexOf("{");
    assert.ok(
      guardAt - bodyStart < 200,
      `${method} 의 권한 게이트가 본문 앞머리에 없다 — 앞선 처리가 무인증으로 실행된다`,
    );
  }
});

test("재설정 처리 — 권한 경계는 가입 승인과 같은 verifyUserAdmin 이다", () => {
  // verifyBasicAuth(로그인만 확인)로 낮추면 일반 관리자가 남의 비밀번호를 발급할 수 있다.
  assert.match(
    manageSource,
    /verifyUserAdmin/,
    "재설정 처리가 verifyUserAdmin 을 쓰지 않는다 — 승인 권한 없는 계정이 발급할 수 있다",
  );
});

test("재설정 승인 — 임시 비밀번호 평문을 DB 에 넘기지 않는다", () => {
  const body = handlerBody(manageSource, "POST");
  const hashAt = body.indexOf("hashPassword(tempPassword)");
  assert.ok(hashAt >= 0, "임시 비밀번호를 해시하지 않는다 — 평문이 DB 에 남는다");
  // approvePasswordReset 인자에 평문이 직접 들어가면 안 된다(해시 호출을 거쳐야 한다).
  const call = body.slice(body.indexOf("approvePasswordReset("));
  const args = call.slice(0, call.indexOf(");"));
  assert.ok(
    !/(^|[^a-zA-Z])tempPassword\s*,/.test(args),
    "approvePasswordReset 에 평문 임시 비밀번호가 그대로 전달된다",
  );
});

test("재설정 승인 — 계정 갱신과 요청 종료가 한 트랜잭션이다", () => {
  const fn = dbSource.slice(dbSource.indexOf("export async function approvePasswordReset"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.match(body, /BEGIN/, "트랜잭션이 없다");
  assert.match(body, /COMMIT/, "커밋이 없다");
  assert.match(body, /ROLLBACK/, "롤백이 없다");
  // status='pending' 조건이 없으면 두 owner 가 동시에 승인해 뒤엣것이 앞 임시 비번을 죽인다.
  assert.match(
    body,
    /status = 'pending'/,
    "승인 UPDATE 에 pending 조건이 없다 — 동시 승인으로 임시 비번이 덮인다",
  );
});

test("로그인 — 임시 비밀번호 만료를 세션 발급 전에 막는다", () => {
  const body = handlerBody(loginSource, "POST");
  const expiredAt = body.indexOf("tempPasswordExpired(");
  assert.ok(expiredAt >= 0, "로그인이 임시 비밀번호 만료를 보지 않는다 — 임시 비번이 영구히 산다");
  const tokenAt = body.indexOf('createSession("admin", user.username)');
  assert.ok(
    tokenAt > expiredAt,
    "만료 검사가 세션 발급보다 뒤에 있다 — 토큰이 먼저 나가면 만료가 무의미하다",
  );
});

test("비밀번호 변경 — 임시 비밀번호 만료를 함께 해제한다", () => {
  const fn = dbSource.slice(dbSource.indexOf("export async function updateUserProfile"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  const pwBranch = body.slice(body.indexOf("input.passwordHash !== undefined"));
  assert.match(
    pwBranch,
    /temp_password_expires_at = NULL/,
    "비번 변경 시 임시 만료가 안 풀린다 — 본인이 바꾼 비번인데도 24시간 뒤 로그인이 거부된다",
  );
});

test("아이디 찾기 — 아이디를 마스킹해서 내린다", () => {
  const body = handlerBody(findIdSource, "POST");
  assert.match(
    body,
    /maskUsername\(/,
    "아이디를 마스킹하지 않는다 — 이름·이메일만으로 남의 계정 아이디를 캐낼 수 있다",
  );
  // 원문 username 을 그대로 응답에 넣으면 마스킹이 무의미하다.
  assert.ok(
    !/username:\s*r\.username/.test(body),
    "응답에 원문 아이디가 그대로 들어간다",
  );
});

test("미인증 라우트 — 아이디 찾기·재설정 신청에 요청 제한이 걸려 있다", () => {
  for (const [name, source] of [
    ["find-id", findIdSource],
    ["password-reset", requestSource],
  ] as const) {
    assert.match(
      source,
      /consumeToken\(/,
      `${name} 에 요청 제한이 없다 — 유출 명단으로 계정 존재 여부를 훑을 수 있다`,
    );
  }
});

test("재설정 신청 — 구글 전용 계정과 작업자 계정을 걸러낸다", () => {
  const body = handlerBody(requestSource, "POST");
  assert.match(
    body,
    /auth_provider !== "password"/,
    "구글 전용 계정을 거르지 않는다 — 쓸 수 없는 비밀번호를 발급하게 된다",
  );
  assert.match(
    body,
    /user\.role === "worker"/,
    "작업자 계정을 거르지 않는다 — 관제웹에 못 들어오는 계정에 임시 비번이 발급된다",
  );
});
