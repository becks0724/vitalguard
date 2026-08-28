// 가입 유형↔회사(상호) 정합성 단위 테스트 + 서버 게이트 가드.
// 배경 — 유형과 무관하게 승인 목록 전체를 고를 수 있어 "VitAlGuard 관리자인데 조달청 소속"이 만들어졌다.
// 2026-08-28 재편 — 'member' 하나가 조달청·공단 업무를 다 보던 것을 jodal/kosha 로 쪼갰다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_COMPANIES,
  JODAL_COMPANIES,
  KOSHA_COMPANIES,
  VITALGUARD_COMPANY,
  companiesForOrgType,
  isAllowedCompany,
  isAllowedCompanyForOrgType,
} from "./companies";
import { SIGNUP_ORG_TYPES } from "./org-type";

test("VitAlGuard 관리자의 선택지는 자사 하나뿐", () => {
  assert.deepEqual(companiesForOrgType("vitalguard"), [VITALGUARD_COMPANY]);
});

test("조달청·공단 관리자의 선택지에 자사는 없다", () => {
  assert.ok(!companiesForOrgType("jodal").includes(VITALGUARD_COMPANY));
  assert.ok(!companiesForOrgType("kosha").includes(VITALGUARD_COMPANY));
  assert.deepEqual(companiesForOrgType("jodal"), JODAL_COMPANIES);
  assert.deepEqual(companiesForOrgType("kosha"), KOSHA_COMPANIES);
});

test("두 기관의 상호는 서로 겹치지 않는다 — 겹치면 유형 분리가 무의미해진다", () => {
  for (const co of JODAL_COMPANIES) {
    assert.ok(!KOSHA_COMPANIES.includes(co), `${co} 가 양쪽 목록에 있다`);
  }
});

test("구 'member' 잔여분은 조달청 관리자와 같이 취급한다 — 마이그레이션 실패분이 갇히지 않게", () => {
  assert.deepEqual(companiesForOrgType("member"), JODAL_COMPANIES);
});

test("유형↔상호 정합성 — 서로의 상호를 쓰지 못한다", () => {
  assert.equal(isAllowedCompanyForOrgType(VITALGUARD_COMPANY, "vitalguard"), true);
  assert.equal(isAllowedCompanyForOrgType("조달청", "jodal"), true);
  assert.equal(isAllowedCompanyForOrgType("산업안전공단", "kosha"), true);
  // 화면을 우회해 직접 보내는 조합 — 이것이 이 게이트의 대상이다.
  assert.equal(isAllowedCompanyForOrgType("조달청", "vitalguard"), false);
  assert.equal(isAllowedCompanyForOrgType(VITALGUARD_COMPANY, "jodal"), false);
  assert.equal(isAllowedCompanyForOrgType("조달청", "kosha"), false);
  assert.equal(isAllowedCompanyForOrgType("산업안전공단", "jodal"), false);
});

test("테스트 계정은 전체 상호를 쓸 수 있다 — 시연에서 어느 기관으로든 세운다", () => {
  assert.deepEqual(companiesForOrgType("test"), ALLOWED_COMPANIES);
  assert.equal(isAllowedCompanyForOrgType("조달청", "test"), true);
  assert.equal(isAllowedCompanyForOrgType("산업안전공단", "test"), true);
  assert.equal(isAllowedCompanyForOrgType(VITALGUARD_COMPANY, "test"), true);
  // 관대해도 승인 목록 밖은 여전히 거부한다.
  assert.equal(isAllowedCompanyForOrgType("아무회사", "test"), false);
});

test("승인 목록 밖 상호는 어느 유형으로도 거부", () => {
  assert.equal(isAllowedCompanyForOrgType("아무회사", "vitalguard"), false);
  assert.equal(isAllowedCompanyForOrgType("아무회사", "jodal"), false);
  assert.equal(isAllowedCompanyForOrgType("아무회사", "kosha"), false);
  assert.equal(isAllowedCompany("아무회사"), false);
});

test("앞뒤 공백은 다듬어 판정한다", () => {
  assert.equal(isAllowedCompanyForOrgType(`  ${VITALGUARD_COMPANY} `, "vitalguard"), true);
  assert.equal(isAllowedCompanyForOrgType(" 조달청 ", "jodal"), true);
});

test("「(주)바이탈가드」는 승인 목록에서 빠졌다 — 같은 회사가 두 문자열로 쌓이던 것", () => {
  assert.ok(!ALLOWED_COMPANIES.includes("(주)바이탈가드"));
  assert.equal(isAllowedCompany("(주)바이탈가드"), false);
});

test("스마트인재개발원은 목록에서 빠졌다 — 실계정 0건이라 2026-08-28 재편 때 제거", () => {
  assert.ok(!ALLOWED_COMPANIES.includes("스마트인재개발원"));
});

test("화면 선택지는 전부 서버 게이트를 통과한다 — 어긋나면 '고를 수는 있는데 저장은 거부'가 된다", () => {
  for (const kind of SIGNUP_ORG_TYPES) {
    const options = companiesForOrgType(kind);
    assert.ok(options.length > 0, `${kind} 의 선택지가 비어 있다 — 가입이 잠긴다`);
    for (const co of options) {
      assert.equal(isAllowedCompanyForOrgType(co, kind), true, `${kind} / ${co}`);
    }
  }
});

// ── 서버 게이트 가드 — 라우트가 유형을 보지 않는 검증으로 되돌아가는 것을 막는다.
const here = dirname(fileURLToPath(import.meta.url));
// 프로필 수정도 포함한다 — 가입 때만 막으면 가입 후 회사를 바꿔 우회할 수 있다.
// ★ /api/admin/users 는 의도적으로 제외한다(2026-08-01, 사용자 결정) — 권한자가 회원사를 추가·교정하는
//   관리 기능이라 유형에 묶으면 정당한 운영이 막힌다. 여기에 넣지 말 것.
//   그 기능 자체는 admin-users-company-edit.guard.test.ts 가 별도로 지킨다.
const ROUTES = [
  resolve(here, "../app/api/admin/register/route.ts"),
  resolve(here, "../app/api/auth/google/complete/route.ts"),
  resolve(here, "../app/api/admin/profile/route.ts"),
];

test("가입·프로필 라우트는 유형을 함께 보는 게이트를 쓴다", () => {
  for (const path of ROUTES) {
    const src = readFileSync(path, "utf8");
    assert.match(src, /isAllowedCompanyForOrgType\(/, path);
    // 유형을 무시하는 옛 게이트로 되돌아가지 않았는지 — 호출부 기준으로 본다.
    assert.ok(!/[^a-zA-Z]isAllowedCompany\(/.test(src), `${path} 가 유형을 무시하는 게이트를 쓴다`);
  }
});

test("가입 라우트는 'test' 유형을 거부한다 — 가입 폼으로 전권 계정이 만들어지면 안 된다", () => {
  for (const path of [ROUTES[0]!, ROUTES[1]!]) {
    const src = readFileSync(path, "utf8");
    assert.match(src, /isSignupOrgType\(/, `${path} 가 가입 전용 유형 게이트를 안 쓴다`);
    // isOrgType 은 'test' 까지 통과시킨다 — 가입 경로에서 이걸로 되돌아가면 구멍이 다시 열린다.
    assert.ok(
      !/[^a-zA-Z]isOrgType\(/.test(src),
      `${path} 가 isOrgType 으로 되돌아갔다 — test 유형이 가입으로 새어 들어온다`,
    );
  }
});
