// 사번(workerId) 바인딩 가드 — 빈 문자열이 토큰에 새어 들어가 수집이 401 로 죽는 것을 막는다.
//
// 무슨 일이 있었나(2026-07-29): 앱은 `Authorization: Bearer <appJWT>` 를 정상 전송했는데
// 수집이 401 로 거부돼 배포를 4회 롤백했다. 원인은 토큰 안의 `workerId` 가 **빈 문자열**이었던 것.
//   · 로그인 라우트 `account.employee_id ?? null` — `??` 는 null·undefined 만 거른다. '' 는 통과.
//   · 스키마 백필 `WHERE employee_id IS NULL` — '' 는 안 걸려 데이터가 영영 안 고쳐진다.
//   · 수집 라우트 `if (!claims?.workerId)` — '' 는 falsy 라 401.
// 세 곳이 각자 옳아 보였는데 합쳐지면 "토큰은 있는데 거부"라는, 로그만 봐서는 원인이 안 보이는
// 실패가 된다. 그래서 라우트 단위 테스트가 어려운 두 지점을 소스 가드로 고정한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { defaultEmployeeId } from "./employee-id";

const root = resolve(__dirname, "..");
// 사번 판정은 2026-07-30 에 라우트에서 lib/app-login 으로 옮겼다.
// 이유: 같은 날 추가된 모바일 세션 라우트가 `account.employee_id ?? null` 을 그대로 다시 써서
// 이 가드가 막으려던 형태가 재발했다. 가드가 '한 라우트 파일'만 보고 있었기 때문에 못 잡았다.
// → 판정은 모듈 한 곳에서만 하고, 가드는 **로그인 라우트 전체**가 그 모듈에 위임하는지 본다.
const loginModule = readFileSync(resolve(root, "lib/app-login.ts"), "utf8");
const LOGIN_ROUTES = [
  "app/api/app-auth/login/route.ts",
  "app/api/mobile/v1/session/login/route.ts",
];
const dbSource = readFileSync(resolve(root, "lib/db.ts"), "utf8");
const vitalRoute = readFileSync(resolve(root, "app/api/app/vital/route.ts"), "utf8");

test("빈 문자열 사번은 falsy 라 수집 게이트를 통과하지 못한다(이 사실이 전제)", () => {
  // 수집 라우트가 쓰는 판정과 동일한 식. 이게 참이라 '' 가 위험하다.
  const claims: { workerId: string | null } = { workerId: "" };
  assert.equal(!claims.workerId, true, "'' 는 falsy — 토큰에 넣으면 401 이 된다");
  assert.match(vitalRoute, /!claims\?\.workerId/, "수집 라우트의 게이트 형태가 바뀌면 이 가드를 재검토할 것");
});

test("사번 판정 모듈은 빈 사번을 그대로 토큰에 넣지 않는다", () => {
  assert.doesNotMatch(
    loginModule,
    /workerId\s*=\s*account\.employee_id\s*\?\?\s*null/,
    "`account.employee_id ?? null` 은 빈 문자열을 통과시킨다 — trim 후 폴백해야 한다",
  );
  assert.match(loginModule, /\.trim\(\)/, "저장된 사번은 trim 해서 공백만 있는 값도 걸러야 한다");
  assert.match(
    loginModule,
    /defaultEmployeeId\(account\.username\)/,
    "비어 있으면 서버가 이미 쓰는 규칙(EMP-<username>)으로 되살려야 한다",
  );
});

test("모든 로그인 라우트가 사번을 직접 만지지 않고 공용 모듈에 위임한다", () => {
  // 라우트가 늘어날 때마다 판정이 복제되는 것이 이 사고의 재발 경로다.
  // 새 로그인 라우트를 추가하면 위 LOGIN_ROUTES 에도 넣어야 한다.
  for (const path of LOGIN_ROUTES) {
    const src = readFileSync(resolve(root, path), "utf8");
    assert.doesNotMatch(
      src,
      /employee_id/,
      `${path} 가 사번을 다시 만지면 모듈과 갈라진다 — authenticateAppLogin 결과를 그대로 써야 한다`,
    );
    assert.match(src, /authenticateAppLogin/, `${path} 는 공용 검증 모듈을 호출해야 한다`);
  }
});

test("스키마 백필은 NULL 뿐 아니라 빈 문자열도 되살린다", () => {
  const backfill = dbSource.match(/UPDATE users SET employee_id[\s\S]{0,200}?;/);
  assert.ok(backfill, "사번 백필 구문을 찾지 못했다");
  assert.match(backfill[0], /IS NULL/, "NULL 은 계속 대상이어야 한다");
  assert.match(
    backfill[0],
    /trim\(employee_id\)\s*=\s*''/,
    "빈 문자열도 대상이어야 한다 — 아니면 '' 인 계정은 영영 안 고쳐진다",
  );
});

test("폴백 사번은 앱·백필과 같은 규칙이라 기존 데이터와 맞물린다", () => {
  // 앱이 서버 값이 없을 때 만드는 값, 백필이 넣는 값, 로그인 폴백이 같아야 대조가 성립한다.
  assert.equal(defaultEmployeeId("admin6861"), "EMP-admin6861");
  assert.equal(defaultEmployeeId("  admin6861  "), "EMP-admin6861");
  assert.equal(defaultEmployeeId(""), "", "빈 username 은 사번을 만들지 않는다(호출부가 null 처리)");
});
