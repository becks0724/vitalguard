// 안전관리비 담당관 확정 가드 (2026-08-27 · 사용자 설계 결정).
//
// 규칙 한 줄 = **"시공사가 입력하지 않는다. 근거 문서만 제출하고, 그 문서를 확인한 담당관이 입력한다."**
// 이 규칙은 코드 세 곳에서 동시에 지켜져야 하고, 한 곳만 무너져도 검증이 통째로 성립하지 않는다.
//
//   ① 파싱 초안이 판정으로 **새지 않는다** — 기계가 읽은 값을 사람 확인 없이 '과소계상 의심'으로
//      찍으면 그 단정에 책임자가 없다. 라우트가 초안을 notice 에 주입하는 순간 규칙이 죽는다.
//   ② 확정자는 **세션에서만** 온다 — 본문의 이름을 믿으면 누구나 남의 이름으로 확정할 수 있다.
//   ③ 확정은 **append-only** — 값이 조용히 바뀌면 "그때 무엇을 보고 그렇게 판정했나"를 못 세운다.
//
// ⚠ 이 파일은 "확정이 판정을 실제로 바꾸는가"까지 본다. 저장만 되고 판정이 그대로면
//   화면상 확정은 아무 일도 안 한 것이고, 그건 저장 실패보다 발견이 늦다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const noticeRoute = read("app/api/g2b/notice/[id]/route.ts");
const confirmRoute = read("app/api/g2b/cost-confirm/route.ts");
const specRoute = read("app/api/g2b/spec-cost/route.ts");
const db = read("lib/db.ts");
const ui = read("app/components/ProcureCostConfirm.tsx");
const board = read("app/components/ProcureRiskBoard.tsx");
const risk = read("app/lib/procure-risk.ts");

test("앵커 — 확정 경로가 실재한다", () => {
  assert.match(db, /CREATE TABLE IF NOT EXISTS procure_cost_confirm/, "확정 테이블 소실");
  assert.match(db, /export async function latestProcureCostConfirm/, "현행 확정값 조회 소실");
  assert.match(confirmRoute, /export async function POST/, "확정 저장 라우트 소실");
  assert.ok(ui.includes("export default function ProcureCostConfirm("), "확정 화면 소실");
});

// ── ① 초안은 판정으로 새지 않는다
test("파싱 초안이 판정에 자동 주입되지 않는다", () => {
  // 상세 라우트가 초안 파서를 부르기 시작하면 그 순간 사람 확인이 빠진 값이 판정에 오른다.
  assert.doesNotMatch(noticeRoute, /spec-cost|draftFromXlsx|draftFromSheets/, "상세 라우트가 초안을 직접 읽는다 — 확정 없이 판정에 오른다");
  // 판정 입력은 확정 레코드에서만 온다.
  assert.match(noticeRoute, /latestProcureCostConfirm\(id\)/, "확정값 조회가 사라졌다");
  assert.match(noticeRoute, /targetAmount: confirmed\.target_amount/, "확정 대상액이 판정 입력에 안 실린다");
  assert.match(noticeRoute, /declaredSafetyCost: confirmed\.declared_cost/, "확정 계상액이 판정 입력에 안 실린다");
});

test("초안 라우트는 자기가 초안임을 응답에 박아 둔다", () => {
  assert.match(specRoute, /confirmed: false/, "초안 표식이 사라졌다 — 소비처가 확정값으로 오해한다");
});

// ★ 확정이 판정을 **실제로** 바꾸는가. 저장만 되고 판정이 그대로면 확정은 무의미하다.
test("확정하면 판정이 갱신된다 — 저장만 되고 끝나지 않는다", () => {
  // 공사종류는 요율을 가르는 축이라(특수 2.07% vs 건축 3.11%) 확정값이 추정을 이겨야 한다.
  assert.match(risk, /confirmedType\?: ConstructionType \| null,/, "확정 공사종류 인자가 사라졌다");
  assert.match(risk, /confirmedType \?\? classifyConstructionType/, "확정 공사종류가 추정에 밀린다");
  assert.match(noticeRoute, /buildRiskProfile\(notice, tags, confirmed\?\.construction_type/, "확정 공사종류가 판정에 안 넘어간다");
  // 화면도 확정 직후 다시 받아야 한다 — 안 그러면 칩이 '검토 필요'로 남아 아무 일도 안 한 것처럼 보인다.
  assert.match(board, /onConfirmed=\{\(\) => refreshOne\(current\.notice\.id\)\}/, "확정 후 갱신이 배선되지 않았다");
});

// ── ①-2 역할 분리(2026-08-27 사용자 결정 3차) — 확정은 owner 또는 현장 담당관만
//   "시공사에게도 실제 계정을 지급할 예정 · 담당관 = 현장 담당관 역할 계정 · 최고관리자는 다 볼 수 있게"
//   시공사 계정이 생기는 순간 로그인-만-보는 게이트는 자기확정 구멍이 된다 — 지금 막아 둔다.
test("확정 권한 — owner 또는 현장 담당관만, 시공사는 부여돼도 불가", () => {
  const auth = read("lib/admin-auth.ts");
  assert.match(auth, /export async function procureConfirmAccess/, "확정 권한 게이트 소실");
  // 시공사 검사가 site_officer 검사보다 **먼저**여야 한다 — 순서가 뒤집히면
  // 실수로 부여된 시공사 계정이 확정을 뚫는다.
  const body = auth.slice(auth.indexOf("procureConfirmAccess"), auth.indexOf("appUploadTokenMatches"));
  const iContractor = body.indexOf(`"contractor"`);
  const iOfficer = body.indexOf("site_officer");
  assert.ok(iContractor >= 0 && iOfficer > iContractor, "시공사 차단이 담당관 검사보다 뒤에 있다");
  // ⚠ 직책(job_title) 글자에 권한을 걸면 본인 편집 필드라 자가승격이 된다.
  assert.doesNotMatch(body, /job_title/, "권한 판정이 직책 글자를 본다 — 본인 편집 필드라 자가승격 구멍");
  // 라우트가 게이트를 실제로 쓴다 + 거부 코드가 있다.
  assert.match(confirmRoute, /await procureConfirmAccess\(req\)/, "확정 라우트가 게이트를 안 탄다");
  assert.match(confirmRoute, /code: "CONTRACTOR"/, "시공사 거부 코드 소실");
  assert.match(confirmRoute, /code: "NOT_OFFICER"/, "담당관 아님 거부 코드 소실");
});

test("담당관 부여 — 시공사에게는 부여되지 않는다(라우트·DB 이중 방어)", () => {
  const usersRoute = read("app/api/admin/users/route.ts");
  assert.match(usersRoute, /grant_officer/, "부여 액션 소실");
  // DB 함수 자체가 시공사를 거른다 — 부여 경로가 늘어도 안 뚫린다.
  assert.match(db, /SET site_officer = \$1 WHERE id = \$2 AND \(\$1 = false OR org_type <> 'contractor'\)/, "DB 쪽 시공사 제외 조건 소실");
});

// 시공사 가입은 상호 화이트리스트가 비어 있는 동안 서버 게이트가 자동으로 막는다 —
// 목록을 채우는 것이 곧 개방이므로, 게이트 함수가 시공사 목록을 실제로 보는지 본다.
test("시공사 가입 게이트 — 상호 화이트리스트가 잠금장치다", () => {
  const companies = read("lib/companies.ts");
  assert.match(companies, /CONTRACTOR_COMPANIES/, "시공사 상호 목록 소실");
  assert.match(companies, /if \(orgType === "contractor"\) return CONTRACTOR_COMPANIES;/, "가입 게이트가 시공사 목록을 안 본다");
  const org = read("lib/org-type.ts");
  assert.match(org, /"vitalguard", "member", "contractor"/, "org_type 에서 contractor 가 사라졌다");
});

// ── ①-3 태그 사전 분리(2026-08-27 사용자 결정 4차) — 안전조달 전용 사전만 쓴다
//   risk-tagging.ts 는 배치 어시스턴트(assignment)와 공용이라, 조달 공고에 맞춰 사전을 넓히면
//   그쪽 판정까지 함께 움직인다. 그래서 전용 사전(procure-risk-tags.ts)으로 뺐다.
test("안전조달은 전용 태그 사전만 쓴다 — 공용 사전에 얹지 않는다", () => {
  assert.match(noticeRoute, /extractProcureRiskTags/, "전용 사전 호출이 사라졌다");
  assert.doesNotMatch(noticeRoute, /from ".*\/risk-tagging"/, "공용 사전을 다시 쓴다 — 배치 어시스턴트 판정이 같이 움직인다");
  // 역방향 — 배치 어시스턴트가 조달 전용 사전을 끌어다 쓰면 분리가 무의미해진다.
  const assignment = read("app/api/assignment/task-doc/route.ts") + read("lib/assignment-rules.ts");
  assert.doesNotMatch(assignment, /procure-risk-tags/, "배치 어시스턴트가 조달 전용 사전을 쓴다");
});

// ── ② 확정자는 세션에서만 온다
test("확정자를 본문에서 받지 않는다 — 남의 이름으로 확정할 수 없다", () => {
  // ⚠ 3차 결정으로 세션 확인이 procureConfirmAccess 게이트 뒤로 갔다 — 형태가 아니라
  //   "확정자 이름이 세션에서 온다"가 규칙이므로 그 줄만 짚는다.
  assert.match(confirmRoute, /const session = getSession\(req\)!;/, "세션 조회가 사라졌다");
  assert.match(confirmRoute, /confirmed_by: session\.username/, "확정자가 세션에서 오지 않는다");
  assert.doesNotMatch(confirmRoute, /confirmed_by: .*body\./, "확정자를 본문에서 받는다 — 사칭이 가능해진다");
  assert.match(confirmRoute, /status: 401/, "비로그인 차단이 사라졌다");
});

// ⚠ 빈 확정은 "확인했다"는 거짓 신호다 — 근거도 값도 없이 도장만 찍히면 이력이 알리바이가 된다.
test("근거 문서 없는 확정과 빈 확정을 막는다", () => {
  assert.match(confirmRoute, /code: "NO_EVIDENCE"/, "근거 문서 필수 검사가 사라졌다");
  assert.match(confirmRoute, /code: "EMPTY"/, "빈 확정 차단이 사라졌다");
  // 서버가 막아도 화면이 열려 있으면 사용자는 눌러 보고 실패한다 — 양쪽 다 같은 규칙을 건다.
  assert.match(ui, /evidence\.trim\(\) !== "" && \(target\.trim\(\) !== "" \|\| declared\.trim\(\) !== ""\) && ctype !== ""/, "화면 쪽 확정 조건이 서버와 갈라졌다");
});

// ★ 공사종류도 담당관이 고른다(2026-08-27 사용자 결정 2차) — 자동 추정에 맡기면 틀린 요율로
//   판정된다. 실측: 「가운중앙근린공원 리모델링」 을 건축(3.11%)으로 추정했는데 문서 요율은
//   2.07%(특수건설공사)였다. 기준액이 3.11/2.07 = 1.5배 틀어진다.
test("공사종류 없는 확정을 막는다 — 자동 추정이 판정에 남지 않게", () => {
  assert.match(confirmRoute, /code: "NO_CTYPE"/, "서버 쪽 공사종류 필수 검사가 사라졌다");
  assert.match(confirmRoute, /CTYPES\.has\(constructionType\)/, "공사종류 값 검증이 사라졌다 — 임의 문자열이 요율표를 뚫는다");
  // 화면은 문서 요율로 어느 공종인지 힌트를 띄운다 — 고르는 건 여전히 사람이다.
  assert.match(ui, /typesMatchingRate\(/, "요율→공종 역추론 힌트가 사라졌다");
  assert.match(ui, /공사종류 \(필수\)/, "공사종류가 다시 선택사항이 됐다");
});

// ── ③ append-only
test("확정 이력은 덮어쓰이지 않는다 — 수정도 새 행이다", () => {
  const i = db.indexOf("CREATE TABLE IF NOT EXISTS procure_cost_confirm");
  const j = db.indexOf("export async function insertProcureCostConfirm");
  const k = db.indexOf("// 현장별 수신 계산서");
  const block = db.slice(j, k);
  assert.ok(i >= 0 && j >= 0 && k > j, "확정 블록 앵커 소실");
  // UPDATE·DELETE·upsert 가 생기면 이전 확정이 사라진다.
  assert.doesNotMatch(block, /UPDATE procure_cost_confirm|DELETE FROM procure_cost_confirm|ON CONFLICT/, "확정에 덮어쓰기 경로가 생겼다");
  assert.match(block, /ORDER BY id DESC LIMIT 1/, "현행값을 '최신 한 건'으로 안 읽는다");
  // 확정 당시 초안을 얼려 둬야 한다 — 파서를 고치면 오늘의 초안은 달라진다.
  assert.match(confirmRoute, /draft_json: body\.draft === undefined \? null : JSON\.stringify\(body\.draft\)/, "확정 당시 초안 보존이 사라졌다");
});

// ⚠ 확정 화면이 초안을 폼에 자동으로 밀어 넣으면 담당관은 확인 없이 [확정] 만 누르게 된다.
//   그러면 ①을 라우트에서 막은 의미가 화면에서 무너진다 — 채우기는 사람이 누르는 버튼이어야 한다.
test("초안을 폼에 자동으로 채우지 않는다 — 채우기는 사람의 행위다", () => {
  assert.match(ui, /function fillFromDraft\(\)/, "초안 채우기 함수 소실");
  assert.match(ui, /onClick=\{fillFromDraft\}/, "초안 채우기가 버튼이 아니다");
  // useEffect 안에서 폼 상태를 초안으로 세팅하면 자동 주입이다.
  assert.doesNotMatch(ui, /useEffect\([\s\S]{0,600}?setDeclared\(String\(/, "초안이 폼에 자동으로 채워진다");
});

// ★ 공고를 바꿨는데 폼이 남아 있으면 앞 공고의 값을 다음 공고에 확정하게 된다.
test("공고를 바꾸면 확정 폼이 비워진다", () => {
  assert.match(board, /key=\{current\.notice\.id\}/, "공고별 재마운트 키가 사라졌다");
  const i = ui.indexOf("useEffect(() => {");
  const body = ui.slice(i, i + 900);
  assert.match(body, /setTarget\(""\);/, "폼 초기화가 사라졌다 — 앞 공고 값이 남는다");
  assert.match(body, /setEvidence\(""\);/, "근거 지정이 앞 공고 것으로 남는다");
});
