import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  formatChatRuleFallback,
  toClovaChatContext,
  type ChatAssignment,
} from "./assignment-chat-presentation";

const restricted: ChatAssignment = {
  workerId: "EMP-test0001",
  condition: {
    grade: "restricted",
    reasons: [{ code: "FALL_24H" }, { code: "UNACKED_ALERT" }],
  },
  advice: {
    perTag: [
      { tag: "고소작업", allowed: false, pending: false },
      { tag: "밀폐공간", allowed: false, pending: false },
    ],
  },
  environment: { warningSummary: "특보 없음", gaspodSummary: "감지기 미연결", notes: [] },
  taskDoc: null,
};

test("CLOVA 문맥은 공용 문구 대신 챗봇 전용 안전 DTO를 사용한다", () => {
  const context = toClovaChatContext(restricted);
  assert.deepEqual(context.안전신호, ["최근 24시간 낙상 경보 신호", "대응 확인이 필요한 경보"]);
  assert.equal(context.결론, "등록된 고위험 작업은 배제 권고 대상입니다.");
  assert.doesNotMatch(JSON.stringify(context), /컨디션|확인 후 배치 권고|재판정 후 배치를 검토/);
});

test("챗봇 규칙 폴백은 배제 권고 결론만 말하고 미래 배치를 암시하지 않는다", () => {
  const fallback = formatChatRuleFallback([restricted]);
  assert.match(fallback, /등록된 고위험 작업은 배제 권고 대상입니다/);
  assert.match(fallback, /대응 확인이 필요한 경보/);
  assert.doesNotMatch(fallback, /컨디션|확인 후 배치 권고|재판정 후 배치를 검토/);
  // "배치 가능 0종"은 결정 결과의 집계다. 이후 배치를 권하거나 허용하는 문장만 금지한다.
  assert.doesNotMatch(fallback, /(?:확인\s*후\s*배치|배치(?:가|를)?\s*(?:검토|권고|허용|진행))/);
});
