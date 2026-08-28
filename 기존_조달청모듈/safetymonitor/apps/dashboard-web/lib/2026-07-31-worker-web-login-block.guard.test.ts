// 구조적 재발 방지 — 작업자(role='worker') 계정의 관제웹 로그인 차단 가드.
//
// 왜 가드 테스트인가 — 로그인 라우트는 실 DB 세션이 있어야 동작해 tsx --test 로 기능 테스트가
// 불가하다(mock.module 미지원). 되돌리면 여기서 실패로 드러나게 소스 불변식을 고정한다.
//
// 배경 — 관제 웹은 관리자용이고 작업자는 모바일 앱(/api/app-auth/login)을 쓴다. 두 로그인이
// 같은 users 테이블을 보므로 차단이 없으면 앱 계정이 관제 화면에 그대로 들어온다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const loginSource = readFileSync(
  join(ROOT, "app", "api", "admin", "login", "route.ts"),
  "utf8",
);

// POST 핸들러 본문 — 최상위 닫는 중괄호까지.
function postBody(): string {
  const start = loginSource.indexOf("export async function POST");
  assert.ok(start >= 0, "POST 핸들러를 찾지 못함");
  const end = loginSource.indexOf("\n}", start);
  return loginSource.slice(start, end < 0 ? undefined : end);
}

test("관제웹 로그인 — 작업자 계정을 403 으로 막는다(세션 발급 전)", () => {
  const body = postBody();
  const guardAt = body.indexOf('user.role === "worker"');
  assert.ok(
    guardAt >= 0,
    "로그인 라우트에 worker 차단이 없다 — 앱 전용 작업자 계정이 관제 화면에 들어온다",
  );
  // DB 가입자에게 세션을 주는 지점 — 로컬 데모 분기(createSession("admin", id))와 구분한다.
  const tokenAt = body.indexOf('createSession("admin", user.username, user.org_type)');
  assert.ok(
    tokenAt > guardAt,
    "worker 차단이 세션 발급보다 뒤에 있다 — 토큰이 먼저 나가면 차단이 무의미하다",
  );
});

test("관제웹 로그인 — worker 차단이 승인 상태 검사보다 앞에 있다", () => {
  const body = postBody();
  const guardAt = body.indexOf('user.role === "worker"');
  const pendingAt = body.indexOf('user.status === "pending"');
  assert.ok(guardAt >= 0, "worker 차단이 없다");
  assert.ok(pendingAt >= 0, "승인 대기 분기를 찾지 못함");
  assert.ok(
    guardAt < pendingAt,
    "worker 차단이 pending 검사보다 뒤에 있다 — 승인되면 들어올 수 있다는 잘못된 안내를 준다",
  );
});
