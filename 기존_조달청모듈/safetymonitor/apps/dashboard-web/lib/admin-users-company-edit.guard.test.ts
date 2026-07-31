// 구조적 재발 방지 — 사용자 관리의 회원사 상호(company) 추가·수정 기능 가드 테스트.
//
// 왜 가드 테스트인가 — 이 라우트는 DB·세션이 필요해 tsx --test 로 기능 테스트가 불가하다
// (mock.module 미지원). 핵심 불변식 = ① 상호 편집이 verifyUserAdmin(권한자) 게이트 뒤에 있다
// ② set_profile 이 company 를 받아 DB 까지 전달한다 ③ UPDATE 가 company 컬럼을 실제로 쓴다.
// 되돌리면 여기서 실패로 드러나게 소스 불변식을 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const routeSource = readFileSync(
  join(ROOT, "app", "api", "admin", "users", "route.ts"),
  "utf8",
);
const dbSource = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");
const modalSource = readFileSync(
  join(ROOT, "app", "components", "UserManagementModal.tsx"),
  "utf8",
);

// export 함수 본문 슬라이스 — 다음 export 직전까지.
function fnSlice(source: string, marker: string): string {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} 를 찾지 못함`);
  const end = source.indexOf("\nexport ", start + marker.length);
  return source.slice(start, end < 0 ? undefined : end);
}

test("상호 편집 — POST 핸들러가 verifyUserAdmin 게이트 뒤에 있다(권한자 한정)", () => {
  const body = fnSlice(routeSource, "export async function POST");
  const gateAt = body.indexOf("verifyUserAdmin(");
  const profileAt = body.indexOf('"set_profile"');
  assert.ok(gateAt >= 0, "POST 에 verifyUserAdmin 호출이 없다 — 로그인만 하면 누구나 상호를 고칠 수 있게 된다");
  assert.ok(profileAt > gateAt, "set_profile 분기가 verifyUserAdmin 검사보다 앞에 있다 — 게이트를 우회한다");
});

test("상호 편집 — set_profile 이 company 를 정규화해 setUserProfileFields 로 전달한다", () => {
  const body = fnSlice(routeSource, "export async function POST");
  assert.ok(
    /setUserProfileFields\(id,\s*norm\(company\),\s*norm\(department\),\s*norm\(jobTitle\)\)/.test(body),
    "set_profile 이 company 를 setUserProfileFields 에 넘기지 않는다 — 화면에서 저장해도 상호가 유실된다",
  );
});

test("상호 편집 — setUserProfileFields 의 UPDATE 가 company 컬럼을 쓴다", () => {
  const body = fnSlice(dbSource, "export async function setUserProfileFields");
  assert.ok(
    body.includes("SET company = $1, department = $2, job_title = $3"),
    "setUserProfileFields 의 UPDATE SET 목록에 company 가 없다 — API 는 받아도 DB 에 안 써진다",
  );
});

test("상호 편집 — 사용자 관리 화면이 저장 요청에 company 를 싣는다", () => {
  assert.ok(
    /action: "set_profile",\s*company: companyDraft/.test(modalSource),
    "UserManagementModal 의 set_profile 요청 본문에 company 가 없다 — 입력해도 전송되지 않는다",
  );
});
