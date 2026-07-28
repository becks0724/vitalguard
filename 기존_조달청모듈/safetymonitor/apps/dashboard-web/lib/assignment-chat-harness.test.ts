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
  assert.match(assignmentOutputPolicyInstruction({ allowedCount: 0 }), /배제해야, 피해야/);
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

test("로그인 계정 ID는 작업자 후보로 취급하지 않는다", () => {
  assert.equal(isWorkerId("EMP-admin6861"), true);
  assert.equal(isWorkerId("VW-6861"), true);
  assert.equal(isWorkerId("admin6861"), false);
  assert.equal(isWorkerId("장우진"), false);
});
