// 조직 유형 재편 가드(2026-08-28 사용자 결정) — 'member' 하나가 조달청·공단 검증 화면을 다 보던 것을
// 담당 업무로 쪼갰다. 이 파일이 지키는 성질 넷:
//   ① 두 영역이 실제로 갈린다(화면·서버 양쪽에서)
//   ② 'test'(양쪽 열람)는 가입 경로로 만들 수 없다
//   ③ 담당관은 안전관리비 영역 유형만 가진다
//   ④ 내부 키 'contractor' 는 유지된다(표기만 '현장 관리자')
//
// ⚠ 화면 리다이렉트만 있고 서버 게이트가 없으면 주소를 직접 쳐서 남의 영역 데이터를 받는다.
//   그래서 이 가드는 **양쪽 다** 있는지를 본다 — 한쪽만 지키면 의미가 없다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ORG_TYPES,
  SIGNUP_ORG_TYPES,
  SITE_OFFICER_ORG_TYPES,
  areasForOrgType,
  canHoldSiteOfficer,
  canViewArea,
  isSignupOrgType,
  orgTypeLabel,
} from "./org-type";
import { AREA_HOME, areaForPath } from "./verification-area";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string): string => readFileSync(resolve(here, "..", p), "utf8");

// ── ① 영역 분리가 실제로 작동한다 ────────────────────────────────────────────

test("조달청 관리자는 안전관리비만, 공단 관리자는 보조금만 본다", () => {
  assert.equal(canViewArea("jodal", "safetyCost"), true);
  assert.equal(canViewArea("jodal", "subsidy"), false, "조달청 관리자가 보조금을 본다");
  assert.equal(canViewArea("kosha", "subsidy"), true);
  assert.equal(canViewArea("kosha", "safetyCost"), false, "공단 관리자가 안전관리비를 본다");
});

test("VitAlGuard 관리자와 테스트 계정은 양쪽 다 본다", () => {
  for (const kind of ["vitalguard", "test"] as const) {
    assert.equal(canViewArea(kind, "safetyCost"), true, `${kind} 가 안전관리비를 못 본다`);
    assert.equal(canViewArea(kind, "subsidy"), true, `${kind} 가 보조금을 못 본다`);
  }
});

test("현장 관리자는 어느 검증 영역도 열람하지 않는다 — 제출 화면만 쓴다", () => {
  assert.deepEqual(areasForOrgType("contractor"), []);
});

test("구 'member' 잔여분은 조달청 관리자와 같이 취급한다 — 최소권한으로 가두지 않는다", () => {
  // 마이그레이션 실패분이 남았을 때 조용히 아무것도 못 보게 되면 원인 찾기가 어렵다.
  assert.deepEqual(areasForOrgType("member"), areasForOrgType("jodal"));
});

test("모든 유형은 영역이 정의돼 있다 — 정의를 빠뜨리면 폴백으로 조용히 새 권한이 생긴다", () => {
  const org = read("lib/org-type.ts");
  for (const kind of ORG_TYPES) {
    assert.match(org, new RegExp(`^\\s{2}${kind}:`, "m"), `AREA_BY_ORG_TYPE 에 ${kind} 가 없다`);
  }
});

test("경로↔영역 매핑 — 검증 라우트가 자기 영역에 붙어 있다", () => {
  assert.equal(areaForPath("/safeprocure"), "safetyCost");
  assert.equal(areaForPath("/safety-audit"), "safetyCost");
  assert.equal(areaForPath("/weekly-report"), "safetyCost");
  assert.equal(areaForPath("/contractor"), "safetyCost");
  assert.equal(areaForPath("/subsidy-audit"), "subsidy");
  // 공통 경로는 영역이 없다 — 소속과 무관하게 본다(2026-08-28 사용자 결정).
  for (const p of ["/", "/assignment", "/erp", "/aed/inspect"]) {
    assert.equal(areaForPath(p), null, `${p} 가 영역에 묶였다 — 공통 화면이 막힌다`);
  }
});

test("하위 경로도 같은 영역으로 잡힌다 — 접두사만 보면 /subsidy-audit/detail 이 샌다", () => {
  assert.equal(areaForPath("/subsidy-audit/detail"), "subsidy");
  assert.equal(areaForPath("/weekly-report/2026-08"), "safetyCost");
  // 접두사가 겹치는 남의 경로를 잘못 삼키지 않는다.
  assert.equal(areaForPath("/contractor-list"), null);
});

test("영역 대표 경로는 실제 라우트다 — 리다이렉트가 404 로 가면 로그인 직후 갇힌다", () => {
  for (const area of ["safetyCost", "subsidy"] as const) {
    const home = AREA_HOME[area];
    assert.equal(areaForPath(home), area, `${home} 가 자기 영역으로 안 잡힌다`);
    readFileSync(resolve(here, "..", `app${home}/page.tsx`), "utf8");
  }
});

test("서버 게이트 — 영역 전용 API 는 verifyAreaAccess 를 거친다", () => {
  // ⚠ 화면 리다이렉트만으로는 못 막는다. 주소를 직접 치거나 fetch 를 직접 부르면 그만이다.
  const cases: [string, string][] = [
    ["app/api/subsidy-audit/route.ts", "subsidy"],
    ["app/api/safety-audit/route.ts", "safetyCost"],
    ["app/api/weekly-report/route.ts", "safetyCost"],
  ];
  for (const [path, area] of cases) {
    const src = read(path);
    assert.match(src, /verifyAreaAccess\(/, `${path} 에 영역 게이트가 없다`);
    assert.match(src, new RegExp(`verifyAreaAccess\\(req, "${area}"\\)`), `${path} 의 영역이 ${area} 가 아니다`);
  }
});

test("게이트를 붙였으면 화면도 토큰을 보낸다 — 한쪽만 고치면 보드가 403 으로 빈다", () => {
  for (const path of [
    "app/components/SubsidyAuditBoard.tsx",
    "app/components/SafetyCostAuditBoard.tsx",
    "app/components/WeeklyReportBoard.tsx",
  ]) {
    assert.match(read(path), /authHeaders\(\)/, `${path} 가 인증 헤더를 안 보낸다`);
  }
  assert.match(read("app/components/session-token.ts"), /export function authHeaders/, "공용 헤더 헬퍼 소실");
});

test("주간 보고서는 현장 관리자에게 열려 있다 — 제출 화면의 링크 동선이 끊기면 안 된다", () => {
  const src = read("app/api/weekly-report/route.ts");
  assert.match(src, /orgType === "contractor"/, "현장 관리자 통과 분기가 사라졌다");
  assert.match(read("app/components/ContractorSubmitForm.tsx"), /href="\/weekly-report"/, "제출 화면의 링크가 사라졌다 — 분기 근거가 없어졌다");
});

// ── ② 'test' 는 가입으로 만들 수 없다 ────────────────────────────────────────

test("가입 유형 목록에 'test' 가 없다 — 있으면 아무나 전권 계정을 만든다", () => {
  assert.ok(!(SIGNUP_ORG_TYPES as readonly string[]).includes("test"));
  assert.equal(isSignupOrgType("test"), false);
  // 나머지 넷은 가입 가능해야 한다(빠뜨리면 그 유형의 가입이 조용히 잠긴다).
  for (const kind of ["vitalguard", "jodal", "kosha", "contractor"] as const) {
    assert.equal(isSignupOrgType(kind), true, `${kind} 가입이 잠겼다`);
  }
});

test("가입 라우트가 가입 전용 게이트를 쓴다 — isOrgType 으로 되돌아가면 구멍이 열린다", () => {
  for (const path of ["app/api/admin/register/route.ts", "app/api/auth/google/complete/route.ts"]) {
    const src = read(path);
    assert.match(src, /isSignupOrgType\(/, `${path} 가 가입 전용 게이트를 안 쓴다`);
    assert.ok(!/[^a-zA-Z]isOrgType\(/.test(src), `${path} 가 isOrgType 으로 되돌아갔다`);
  }
});

test("가입 화면 선택지가 SIGNUP_ORG_TYPES 와 일치한다 — 화면에 test 가 뜨면 안 된다", () => {
  const login = read("app/components/LoginScreen.tsx");
  assert.ok(!/value: "test" as const/.test(login), "가입 화면에 테스트 계정 선택지가 있다");
  assert.ok(!/\["test",/.test(login), "구글 가입 화면에 테스트 계정 선택지가 있다");
});

test("유형 변경은 관리 경로에만 있다 — 여기가 test 를 주는 유일한 문", () => {
  const route = read("app/api/admin/users/route.ts");
  assert.match(route, /action === "set_org_type"/, "유형 변경 액션 소실");
  assert.match(route, /verifyUserAdmin/, "유형 변경이 관리 권한 게이트 뒤에 없다");
  assert.match(read("lib/db.ts"), /export async function setUserOrgType/, "유형 변경 DB 함수 소실");
});

// ── ③ 담당관 자격 ────────────────────────────────────────────────────────────

test("담당관은 안전관리비 유형만 — 공단·현장 관리자는 거부", () => {
  assert.equal(canHoldSiteOfficer("jodal"), true);
  assert.equal(canHoldSiteOfficer("vitalguard"), true);
  assert.equal(canHoldSiteOfficer("test"), true, "테스트 계정이 확정 시연을 못 한다");
  assert.equal(canHoldSiteOfficer("kosha"), false, "공단 관리자가 안전관리비를 확정할 수 있다");
  assert.equal(canHoldSiteOfficer("contractor"), false, "피검증자가 자기 공사를 확정할 수 있다");
});

test("허용 목록은 규칙에서 유도된다 — 하드코딩하면 규칙과 어긋난다", () => {
  for (const kind of [...ORG_TYPES, "member"]) {
    assert.equal(
      SITE_OFFICER_ORG_TYPES.includes(kind),
      canHoldSiteOfficer(kind),
      `${kind} 의 목록 포함 여부가 규칙과 다르다`,
    );
  }
});

test("유형을 내리면 담당관 자격이 함께 정리된다 — 부여 게이트만으론 못 막는다", () => {
  // 자격 없는 유형으로 바꾼 뒤 site_officer 가 남으면 '공단 관리자인데 확정 가능' 이 된다.
  assert.match(
    read("lib/db.ts"),
    /site_officer = CASE WHEN \$1 = ANY\(\$3\) THEN site_officer ELSE false END/,
    "유형 변경이 담당관 플래그를 정리하지 않는다",
  );
});

// ── ④ 내부 키는 유지, 표기만 변경 ────────────────────────────────────────────

test("현장 관리자의 내부 키는 'contractor' 그대로다 — 갈면 발급된 세션이 전부 깨진다", () => {
  assert.ok((ORG_TYPES as readonly string[]).includes("contractor"));
  assert.equal(orgTypeLabel("contractor"), "현장 관리자");
  // 세션 클레임·공용 게이트가 이 문자열에 걸려 있다.
  assert.match(read("lib/admin-auth.ts"), /info\.orgType !== "contractor"/, "공용 게이트의 키가 바뀌었다");
});

test("새 유형의 표기가 자리잡았다", () => {
  assert.equal(orgTypeLabel("jodal"), "조달청 관리자");
  assert.equal(orgTypeLabel("kosha"), "산업안전공단 관리자");
  assert.equal(orgTypeLabel("test"), "테스트 계정");
});

test("마이그레이션은 멱등적이다 — 재실행으로 신규 계정이 휩쓸리면 안 된다", () => {
  const db = read("lib/db.ts");
  // WHERE 가 'member' 만 잡아야 한다. 조건이 빠지면 두 번째 실행에서 전 계정이 jodal 이 된다.
  assert.match(db, /UPDATE users SET org_type = 'test'\s+WHERE org_type = 'member' AND company = '행정안전부';/);
  assert.match(db, /UPDATE users SET org_type = 'jodal' WHERE org_type = 'member';/);
  // 순서가 뒤집히면 행정안전부까지 jodal 이 되어 test 계정이 안 생긴다.
  assert.ok(
    db.indexOf("org_type = 'test'") < db.indexOf("UPDATE users SET org_type = 'jodal'"),
    "행안부 분기가 일괄 UPDATE 뒤에 있다 — 먼저 잡아야 한다",
  );
});
