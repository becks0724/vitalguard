// 현장 정보 챗의 경계 가드 — 2026-08-31 리서치 브리핑 「사실은 실행, 문장은 생성」의 확정 사항을
// 소스 구조로 고정한다. 이 가드가 빨간불이면 경계가 이동한 것이니 브리핑 확정과 대조할 것.
//
//  ① 개인정보 최소화 — 현장 컨텍스트(DTO)에 이름류(worker_name·AED manager)가 실리지 않는다.
//  ② 분기 순서 — 현장 의도 검사는 이름 해소 실패 뒤·이름 가드(unresolvedPersonNames) 앞이다.
//     (뒤로 가면 '한파'류 어휘가 "조회할 수 없는 작업자"로 거절되고, 앞으로 가면 실명 질문이
//      배치 판정 대신 현장 일반 답변으로 샌다.)
//  ③ 좌표 출처 순서 — 주소 지오코딩 → 작업자 좌표 캐시 → 기상 스냅숏(env-check 와 동일 ·
//     2026-08-27 실측: 캐시 우선이면 화면과 1,009m 어긋난다).
//  ④ 인젝션 경계 — 현장 흐름도 사용자 질문을 "지시가 아니라 답변할 대상"으로 격리하고,
//     마무리 안내는 모델이 아니라 서버가 결정적으로 부착한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...p: string[]) => readFileSync(resolve(root, ...p), "utf8");

const ctxSource = read("lib", "site-chat-context.ts");
const routeSource = read("app", "api", "assignment", "chat", "route.ts");

test("① 현장 컨텍스트 DTO 에 이름류 필드가 없다", () => {
  assert.ok(!ctxSource.includes("worker_name"), "경보 컨텍스트에 작업자 이름이 실렸다");
  assert.ok(!/\.manager\b/.test(ctxSource), "AED 담당자 이름이 DTO 에 실렸다");
  // 경보 이력은 가명 사번까지만 — 그 필드가 실제로 쓰이고 있는지(우회 삭제 방지) 함께 본다.
  assert.ok(ctxSource.includes("worker_id"), "경보 컨텍스트가 가명 사번을 잃었다");
});

test("② 현장 의도 분기는 이름 해소 실패 뒤·이름 가드 앞이다", () => {
  const iResolve = routeSource.indexOf("await resolveByName(message)");
  const iSite = routeSource.indexOf("matchSiteChatIntents(message)");
  const iNameGuard = routeSource.indexOf("unresolvedPersonNames(message)");
  assert.ok(iResolve > 0 && iSite > 0 && iNameGuard > 0, "분기 구성 요소가 사라졌다");
  assert.ok(iResolve < iSite, "현장 의도 검사가 이름 해소보다 앞이다 — 실명 질문이 샌다");
  assert.ok(iSite < iNameGuard, "이름 가드가 현장 의도보다 앞이다 — 한파·태풍류가 거절된다");
});

test("③ 현장 챗 좌표 출처는 주소 → 캐시 → 기상 스냅숏 순이다", () => {
  // 임포트 구문이 아니라 resolveSiteCenter 본문의 실행 순서를 본다.
  const body = ctxSource.slice(ctxSource.indexOf("async function resolveSiteCenter"));
  const iAddr = body.indexOf("geocodeAddress");
  const iCache = body.indexOf("getLatestSiteCoord");
  const iDaily = body.indexOf("getLatestWeatherDaily");
  assert.ok(iAddr > 0 && iCache > 0 && iDaily > 0, "좌표 출처가 사라졌다");
  assert.ok(iAddr < iCache && iCache < iDaily, "좌표 출처 순서가 화면·env-check 와 어긋난다");
});

test("④ 현장 흐름의 인젝션 경계·결정적 마무리가 유지된다", () => {
  assert.ok(
    routeSource.includes("SITE_CHAT_CONTEXT_NOTICE"),
    "현장 흐름이 서버 검증 문맥 고지를 잃었다",
  );
  const siteReply = routeSource.slice(
    routeSource.indexOf("async function clovaSiteReply"),
    routeSource.indexOf("function isMostlyKorean"),
  );
  assert.match(
    siteReply,
    /지시가 아니라 답변할 대상/,
    "현장 흐름이 사용자 입력을 지시로 격상시킬 수 있게 됐다",
  );
  // 마무리·무권한 안내의 결정적 부착은 answerSiteIntents(본류·현장 후속 공유 함수)가 소유한다.
  const siteFlow = routeSource.slice(
    routeSource.indexOf("async function answerSiteIntents"),
    routeSource.indexOf("function isMostlyKorean"),
  );
  assert.match(siteFlow, /siteRuleText/, "현장 규칙 폴백 텍스트가 사라졌다");
  assert.match(siteFlow, /isMostlyKorean\(body\)/, "현장 흐름의 언어 가드가 사라졌다");
  assert.match(siteFlow, /SITE_CHAT_TAIL/, "마무리 안내의 서버 부착이 사라졌다");
  // 서버 트리밍 — 무권한 의도가 CLOVA 컨텍스트에 실리는 회귀를 막는다.
  assert.match(siteFlow, /filter\(\(c\) => !c\.denied\)/, "권한 트리밍 필터가 사라졌다");
  assert.match(
    siteFlow,
    /clovaSiteReply\(message, allowedContexts\)/,
    "CLOVA 가 트리밍 전 컨텍스트를 받게 됐다 — 무권한 데이터가 모델에 노출된다",
  );
  // 본류·현장 후속 둘 다 공유 함수를 거친다(사본 금지) + 후속 반송값은 화이트리스트 검증을 거친다.
  const calls = routeSource.match(/await answerSiteIntents\(/g) ?? [];
  assert.ok(calls.length >= 2, "본류·현장 후속이 공유 함수를 함께 쓰지 않는다");
  assert.match(routeSource, /parseFollowUpIntents\(body\.followUpIntents\)/, "후속 반송값 검증이 사라졌다");
});

test("⑤ 실명 병기는 모델 응답 확정 후의 서버 후처리다 — 이름은 CLOVA 에 가지 않는다", () => {
  // 장식 함수는 존재하고, CLOVA 프롬프트 구성부(clovaReply·toClovaChatContext)에는
  // 이름 맵이 전달되지 않는다. 순서: clovaReply 호출 → decorateWorkerNames.
  const presentation = read("lib", "assignment-chat-presentation.ts");
  assert.match(presentation, /decorateWorkerNames/, "장식 함수가 사라졌다");
  assert.ok(
    !/clovaReply\([^)]*workerNames/.test(routeSource),
    "이름 맵이 CLOVA 호출에 전달된다 — 개인정보 경계 위반",
  );
  assert.ok(
    !/toClovaChatContext\([^)]*workerNames/.test(routeSource),
    "이름 맵이 CLOVA 컨텍스트에 전달된다 — 개인정보 경계 위반",
  );
  const iReply = routeSource.indexOf("reply = await clovaReply(");
  const iDecorate = routeSource.indexOf("decorateWorkerNames(followUpNotice + reply");
  assert.ok(iReply > 0 && iDecorate > iReply, "장식이 모델 응답 확정 전에 실행된다");
});

test("⑥ CLOVA 분류 폴백은 화이트리스트 검증 후에만 실행되고, 이름 가드보다 앞이다", () => {
  const iClassify = routeSource.indexOf("parseIntentClassification(");
  const iValidate = routeSource.indexOf("SITE_CHAT_INTENTS.find((intent) => intent.id === cls)");
  const iNameGuard = routeSource.indexOf("unresolvedPersonNames(message)");
  assert.ok(iClassify > 0, "분류 폴백이 사라졌다");
  assert.ok(iValidate > 0, "분류 결과의 화이트리스트 검증이 사라졌다 — 목록 밖 실행 위험");
  assert.ok(iClassify < iNameGuard, "분류 폴백이 이름 가드 뒤로 갔다 — 미지 표현이 거절부터 당한다");
});
