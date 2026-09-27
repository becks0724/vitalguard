// 캘린더 미디어 다운로드 인증 가드 (2026-09-27).
// 목록 GET과 같은 관제 인증·앱 JWT 허용 및 401 action 계약을 소스 문자열로 검사한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const route = readFileSync(join(ROOT, "app/api/calendar/media/download-url/route.ts"), "utf8");

test("다운로드 URL은 유효한 앱 로그인 JWT를 허용한다", () => {
  assert.match(
    route,
    /if \(!verifyBasicAuth\(request\) && verifyAppJwt\(bearerToken\(request\)\) === null\) \{/,
    "목록 GET과 같은 앱 JWT 인증 분기가 사라졌다 — 현장 앱 다운로드가 401이 된다",
  );
});

test("기존 verifyBasicAuth 인증도 계속 허용한다", () => {
  assert.match(
    route,
    /import \{ verifyBasicAuth \} from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/lib\/admin-auth";/,
    "기존 관제 인증 가져오기가 사라졌다",
  );
  assert.match(
    route,
    /if \(!verifyBasicAuth\(request\) && verifyAppJwt\(/,
    "관제 인증 성공 시 앱 JWT 없이도 통과해야 한다",
  );
});

test("인증 실패 401은 diagnoseAppAuth의 action을 반환한다", () => {
  assert.match(route, /const d = diagnoseAppAuth\(request\);/, "앱 인증 실패 진단이 사라졌다");
  assert.match(
    route,
    /return NextResponse\.json\(\{ ok: false, error: "인증 필요", action: d\.action \}, \{ status: 401 \}\);/,
    "401 응답에서 인증 복구 action이 사라졌다",
  );
});
