// 가입 유형(VitAlGuard 관리자 / 회원사 관리자)↔회사(상호) 정합성 단위 테스트 + 서버 게이트 가드.
// 배경 — 유형과 무관하게 승인 목록 전체를 고를 수 있어 "VitAlGuard 관리자인데 조달청 소속"이 만들어졌다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_COMPANIES,
  MEMBER_COMPANIES,
  VITALGUARD_COMPANY,
  companiesForOrgType,
  isAllowedCompany,
  isAllowedCompanyForOrgType,
} from "./companies";

test("VitAlGuard 관리자의 선택지는 자사 하나뿐", () => {
  assert.deepEqual(companiesForOrgType("vitalguard"), [VITALGUARD_COMPANY]);
});

test("회원사 관리자의 선택지에 자사는 없다", () => {
  assert.ok(!companiesForOrgType("member").includes(VITALGUARD_COMPANY));
  assert.deepEqual(companiesForOrgType("member"), MEMBER_COMPANIES);
});

test("유형↔상호 정합성 — 서로의 상호를 쓰지 못한다", () => {
  assert.equal(isAllowedCompanyForOrgType(VITALGUARD_COMPANY, "vitalguard"), true);
  assert.equal(isAllowedCompanyForOrgType("조달청", "member"), true);
  // 화면을 우회해 직접 보내는 조합 — 이것이 이번 수정의 대상이다.
  assert.equal(isAllowedCompanyForOrgType("조달청", "vitalguard"), false);
  assert.equal(isAllowedCompanyForOrgType(VITALGUARD_COMPANY, "member"), false);
});

test("승인 목록 밖 상호는 어느 유형으로도 거부", () => {
  assert.equal(isAllowedCompanyForOrgType("아무회사", "vitalguard"), false);
  assert.equal(isAllowedCompanyForOrgType("아무회사", "member"), false);
  assert.equal(isAllowedCompany("아무회사"), false);
});

test("앞뒤 공백은 다듬어 판정한다", () => {
  assert.equal(isAllowedCompanyForOrgType(`  ${VITALGUARD_COMPANY} `, "vitalguard"), true);
  assert.equal(isAllowedCompanyForOrgType(" 조달청 ", "member"), true);
});

test("「(주)바이탈가드」는 승인 목록에서 빠졌다 — 같은 회사가 두 문자열로 쌓이던 것", () => {
  assert.ok(!ALLOWED_COMPANIES.includes("(주)바이탈가드"));
  assert.equal(isAllowedCompany("(주)바이탈가드"), false);
});

test("화면 선택지는 전부 서버 게이트를 통과한다 — 어긋나면 '고를 수는 있는데 저장은 거부'가 된다", () => {
  for (const kind of ["vitalguard", "member"] as const) {
    for (const co of companiesForOrgType(kind)) {
      assert.equal(isAllowedCompanyForOrgType(co, kind), true, `${kind} / ${co}`);
    }
  }
});

// ── 서버 게이트 가드 — 라우트가 유형을 보지 않는 검증으로 되돌아가는 것을 막는다.
const here = dirname(fileURLToPath(import.meta.url));
// 프로필 수정도 포함한다 — 가입 때만 막으면 가입 후 회사를 바꿔 우회할 수 있다.
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
