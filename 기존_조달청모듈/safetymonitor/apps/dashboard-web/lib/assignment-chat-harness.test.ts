import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  AI_REPLY_POLICY,
  assignmentOutputPolicyInstruction,
  assignmentOutputPolicyRepairInstruction,
  assignmentSystemInstruction,
  findAiReplyPolicyViolations,
  hasMedicalInference,
  isWorkerId,
  isInvalidScopeRefusal,
  normalizeAiReplyPolicyLanguage,
  parseFollowUpWorkerIds,
  SERVER_VERIFIED_CONTEXT_NOTICE,
  unresolvedPersonNames,
} from "./assignment-chat-harness";

test("하네스 계층은 단일 레지스트리에 고정된 순서로 등록한다", () => {
  assert.deepEqual(
    AI_REPLY_POLICY.layers.map((layer) => layer.id),
    [
      "SERVER_INPUT",
      "FACTUAL_GROUNDING",
      "SAFETY_LANGUAGE",
      "ASSIGNMENT_AUTHORITY",
      "RESPONSE_INTEGRITY",
      "RECOVERY",
    ],
  );
  assert.match(assignmentSystemInstruction(), /\[입력 경계\]/);
  assert.match(assignmentSystemInstruction(), /\[사실 경계\]/);
  assert.match(assignmentSystemInstruction(), /\[배치 권한 언어\]/);
  assert.match(assignmentSystemInstruction(), /모든 문장에는 반드시 '권고', '검토', '관리자 확인'/);
});

test("의료적 상태 추정 표현을 감지한다", () => {
  assert.equal(hasMedicalInference("피로 누적이 예상됩니다."), true);
  assert.equal(hasMedicalInference("낙상 재발이 우려됩니다."), true);
  assert.equal(hasMedicalInference("현재 건강 상태는 제한입니다."), true);
  assert.equal(hasMedicalInference("작업 배치 컨디션 등급은 제한입니다."), false);
  assert.equal(
    hasMedicalInference("낙상 관련 안전 이벤트가 기록되어 고위험 작업 배제를 권고합니다."),
    false,
  );
});

test("사람의 컨디션 단정 대신 배치 참고 등급을 요구한다", () => {
  const context = { allowedCount: 1 };
  assert.deepEqual(
    findAiReplyPolicyViolations("EMP-admin6861님의 컨디션은 주의 단계입니다.", context).map(
      (violation) => violation.code,
    ),
    ["PERSON_CONDITION_LABEL"],
  );
  assert.deepEqual(
    findAiReplyPolicyViolations("EMP-admin6861의 배치 참고 등급은 주의입니다.", context),
    [],
  );
});

test("서버 확정 작업 목록은 UI 카드가 보장하므로 CLOVA 작업명 누락은 폴백 사유가 아니다(유도만)", () => {
  const context = {
    allowedCount: 4,
    taskLists: [
      {
        workerId: "EMP-admin6861",
        blockedTags: ["고소작업", "중장비/양중"],
        allowedTags: ["굴착/흙막이", "밀폐공간", "해체/철거", "도장/화기"],
        pendingTags: [],
      },
    ],
  };
  // 작업명을 '일부 작업'으로 뭉뚱그려도 위반이 아니다 — 화면 카드가 서버 목록을 항상 표시하므로
  // CLOVA 자연어 문장을 버리고 규칙 텍스트로 폴백하지 않는다.
  assert.deepEqual(
    findAiReplyPolicyViolations(
      "배치 참고 등급은 주의입니다. 일부 고위험 작업은 배제 권고 대상입니다.",
      context,
    ),
    [],
  );
  // 전부 열거해도 물론 위반이 아니다.
  assert.deepEqual(
    findAiReplyPolicyViolations(
      "배제 권고 작업은 고소작업, 중장비/양중입니다. 배치 가능 작업은 굴착/흙막이, 밀폐공간, 해체/철거, 도장/화기입니다.",
      context,
    ),
    [],
  );
  // instruction(유도)은 여전히 프롬프트에 포함돼 CLOVA 가 작업명을 자연스럽게 열거하도록 이끈다.
  assert.match(assignmentOutputPolicyInstruction(context), /서버 확정 작업 목록/);
  assert.match(assignmentOutputPolicyInstruction(context), /각 작업명을 그대로 열거하면 좋다/);
});

test("배치 가능 0종이면 근거 없는 일반 작업 허용을 감지한다", () => {
  const noAllowed = { allowedCount: 0 };
  const violations = findAiReplyPolicyViolations(
    "등록된 고위험 작업은 배제 권고 대상입니다. 일반 작업 배치는 감독관 판단에 따라 진행되어야 합니다.",
    noAllowed,
  );
  assert.deepEqual(violations.map((violation) => violation.code), ["UNSUPPORTED_WORK_PERMISSION"]);
  assert.match(assignmentOutputPolicyInstruction(noAllowed), /일반 작업 가능/);
  assert.deepEqual(
    findAiReplyPolicyViolations(
      "등록된 고위험 작업은 배제 권고 대상입니다. 관리자 확인 및 최신 안전 기준 재판정이 필요합니다.",
      noAllowed,
    ),
    [],
  );
  assert.deepEqual(
    findAiReplyPolicyViolations("일반 작업 배치가 가능합니다.", { allowedCount: 1 }),
    [],
  );
});

test("배치 가능 0종이면 고위험 작업 배제 권고 결론을 반드시 포함한다", () => {
  const noAllowed = { allowedCount: 0 };
  const missingConclusion = findAiReplyPolicyViolations(
    "낙상 신호와 미대응 경보가 기록되어 관리자 확인이 필요합니다.",
    noAllowed,
  );
  assert.deepEqual(missingConclusion.map((violation) => violation.code), ["ZERO_ALLOWED_EXCLUSION_CONCLUSION"]);
  assert.match(assignmentOutputPolicyInstruction(noAllowed), /반드시 '등록된 고위험 작업은 배제 권고 대상입니다'/);

  const futurePlacement = findAiReplyPolicyViolations(
    "등록된 고위험 작업은 배제 권고 대상입니다. 경보 확인 후 배치가 권고됩니다.",
    noAllowed,
  );
  assert.deepEqual(futurePlacement.map((violation) => violation.code), ["UNSUPPORTED_WORK_PERMISSION"]);
});

test("작업 배치 문구의 확정적 지시를 감지하고 권고형 교정을 제공한다", () => {
  const violations = findAiReplyPolicyViolations(
    "고위험 작업을 피해야 하며 해당 작업에서 제외되어야 합니다.",
    { allowedCount: 0 },
  );
  assert.deepEqual(violations.map((violation) => violation.code), [
    "ASSIGNMENT_DETERMINISTIC_TONE",
    "ZERO_ALLOWED_EXCLUSION_CONCLUSION",
  ]);
  // 배치 권한 언어는 계층(system)에서 한 번만 말한다 — 출력 정책에는 중복해 싣지 않는다.
  assert.match(
    assignmentSystemInstruction(),
    /배제해야·피해야·제외되어야·제한됩니다·금지합니다·해야 한다/,
  );
  assert.match(assignmentOutputPolicyRepairInstruction(violations), /모든 문장에 반드시 권고·검토·관리자 확인/);
  assert.deepEqual(
    findAiReplyPolicyViolations(
      "등록된 고위험 작업은 배제 권고 대상이며 관리자 확인 및 최신 안전 기준 재판정이 필요합니다.",
      { allowedCount: 0 },
    ),
    [],
  );
});

test("권고형 정규화는 CLOVA의 판정 내용 대신 확정적 배치 말투만 바꾼다", () => {
  const normalized = normalizeAiReplyPolicyLanguage(
    "고소작업, 굴착/흙막이 작업을 피해야 하며 해당 작업에서 제외되어야 합니다.",
    { allowedCount: 0 },
  );
  assert.match(normalized, /고소작업, 굴착\/흙막이 작업은 배제 권고 대상이며/);
  assert.match(normalized, /해당 작업은 배제 권고 대상입니다/);
  assert.deepEqual(findAiReplyPolicyViolations(normalized, { allowedCount: 1 }), []);
});

test("유효한 판정 문맥을 무시하는 표준 범위 거절문을 감지한다", () => {
  assert.equal(isInvalidScopeRefusal("작업 배치와 관련된 질문에만 답변할 수 있습니다."), true);
  assert.equal(isInvalidScopeRefusal("작업 배치 관련된 질문에만 대답할 수 있습니다."), true);
});

test("정상 컨디션 설명은 범위 거절로 오인하지 않는다", () => {
  assert.equal(isInvalidScopeRefusal("현재 안전 기준상 제한 등급이며 고소작업은 피하는 것을 권고합니다."), false);
  assert.match(SERVER_VERIFIED_CONTEXT_NOTICE, /컨디션 알려줘/);
  assert.match(SERVER_VERIFIED_CONTEXT_NOTICE, /등급 알려줘/);
});

test("직전 단일 서버 판정의 가명 사번만 후속 질문 문맥으로 허용한다", () => {
  assert.deepEqual(parseFollowUpWorkerIds(["EMP-admin6861"]), ["EMP-admin6861"]);
  assert.deepEqual(parseFollowUpWorkerIds(["EMP-admin6861", "EMP-admin7276"]), []);
  assert.deepEqual(parseFollowUpWorkerIds(["장우진"]), []);
  assert.deepEqual(parseFollowUpWorkerIds("EMP-admin6861"), []);
  assert.deepEqual(parseFollowUpWorkerIds([{ workerId: "EMP-admin6861" }]), []);
});

test("해소되지 않은 사람 이름을 찾아 후속 문맥 폴백을 막는다", () => {
  // 이 버그의 재현 조건: 이름 조회가 실패했는데 직전 작업자(장우진)로 답해버렸다.
  assert.deepEqual(unresolvedPersonNames("김태곤 컨디션 알려줘"), ["김태곤"]);
  assert.deepEqual(unresolvedPersonNames("김태곤이 오늘 밀폐공간 가능해?"), ["김태곤"]);
  assert.deepEqual(unresolvedPersonNames("최민수랑 박서준 배치 알려줘"), ["최민수", "박서준"]);
  // 복성도 이름으로 본다.
  assert.deepEqual(unresolvedPersonNames("남궁민 컨디션"), ["남궁민"]);
  // 이미 해소된 이름은 후보에서 뺀다(정상 이름 조회를 막지 않는다).
  assert.deepEqual(unresolvedPersonNames("장우진 컨디션 알려줘", ["장우진"]), []);
});

test("주어 없는 후속 질문은 이름으로 오인하지 않는다(폴백 유지)", () => {
  // 여기서 하나라도 이름으로 잡히면 정상 후속 질문이 도움말로 빠져 기능이 죽는다.
  for (const followUp of [
    "배제 이유는?",
    "왜?",
    "자세히 설명해줘",
    "그럼 밀폐공간은 가능해?",
    "고소작업 배치 가능한가요?",
    "지금 상태 확인해줘",
    "오늘 등급 알려줘",
    "전체 작업자 컨디션 확인해줘",
    "추가 정보 있어?",
    "안전 신호 근거가 뭐야?",
  ]) {
    assert.deepEqual(unresolvedPersonNames(followUp), [], `후속 질문 오탐: ${followUp}`);
  }
});

test("성씨로 시작하지 않거나 음절 수가 이름 범위를 벗어나면 이름으로 보지 않는다", () => {
  assert.deepEqual(unresolvedPersonNames("밀폐공간 알려줘"), []); // 성씨 아님
  assert.deepEqual(unresolvedPersonNames("김"), []); // 1음절
  assert.deepEqual(unresolvedPersonNames("김태곤이라는사람"), []); // 5음절 초과
});

test("로그인 계정 ID는 작업자 후보로 취급하지 않는다", () => {
  assert.equal(isWorkerId("EMP-admin6861"), true);
  assert.equal(isWorkerId("VW-6861"), true);
  assert.equal(isWorkerId("admin6861"), false);
  assert.equal(isWorkerId("장우진"), false);
});

test("지어낸 법령 사유 거절을 감지해 교정한다(범위 안내는 유지)", () => {
  const violations = findAiReplyPolicyViolations(
    "죄송하지만 말씀하신 내용은 개인정보 보호법에 따라 수집하거나 제공하는 것이 불가능한 정보이므로 답변을 제공해 드릴 수 없습니다.",
    { allowedCount: 3 },
  );
  assert.ok(violations.some((v) => v.code === "FABRICATED_LEGAL_REFUSAL"));
  // 법령 인용 없는 정상 범위 안내는 위반이 아니다.
  const clean = findAiReplyPolicyViolations(
    "작업자 배치·컨디션과 현장 정보에 관한 질문에 답할 수 있습니다.",
    { allowedCount: 3 },
  );
  assert.ok(!clean.some((v) => v.code === "FABRICATED_LEGAL_REFUSAL"));
});
