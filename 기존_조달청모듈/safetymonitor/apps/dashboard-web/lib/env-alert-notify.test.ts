// 현장환경 알림 발송 결정·포맷·매핑 단위 테스트.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { formatEnvAlertMessage, ruleEvalToItem, shouldSendEnv } from "./env-alert-notify.js";
import type { RuleEvaluation } from "./weather-rules.js";

test("발송 결정 — 악화 전이(주의+)만 발송", () => {
  assert.equal(shouldSendEnv(null, "caution"), true); // 최초 주의
  assert.equal(shouldSendEnv(null, "danger"), true); // 최초 위험
  assert.equal(shouldSendEnv("normal", "caution"), true); // 정상→주의
  assert.equal(shouldSendEnv("caution", "danger"), true); // 주의→위험
  assert.equal(shouldSendEnv("caution", "caution"), false); // 동일 유지
  assert.equal(shouldSendEnv("danger", "caution"), false); // 완화(위험→주의) 재발송 안 함
  assert.equal(shouldSendEnv("danger", "normal"), false); // 정상 복귀
  assert.equal(shouldSendEnv(null, "normal"), false); // 정상은 미발송
});

test("RuleEvaluation → 항목 매핑(임계 단계 → detail)", () => {
  const evalHeat: RuleEvaluation = {
    itemKey: "apparentTemp",
    itemLabel: "체감온도",
    currentValue: "34.2℃",
    currentSeverity: "caution",
    currentStep: {
      severity: "caution",
      binding: "legal",
      label: "33℃ 이상 — 휴식 의무",
      action: "매시간 10분 이상 휴식",
      source: "산업안전보건기준 규칙",
    },
    steps: [],
    baseline: "정상",
  };
  const item = ruleEvalToItem(evalHeat);
  assert.equal(item.itemKey, "apparentTemp");
  assert.equal(item.severity, "caution");
  assert.ok(item.detail?.includes("33℃ 이상"));
  assert.ok(item.detail?.includes("휴식"));
});

test("임계 단계 없으면 notes 를 detail 로", () => {
  const info: RuleEvaluation = {
    itemKey: "pm25",
    itemLabel: "초미세먼지",
    currentValue: "40",
    currentSeverity: "caution",
    steps: [],
    baseline: "정상",
    notes: "에어코리아 기준",
  };
  assert.equal(ruleEvalToItem(info).detail, "에어코리아 기준");
});

test("메시지 포맷 — 이모지·심각도·항목·현재값·조치", () => {
  const msg = formatEnvAlertMessage({
    itemKey: "wind",
    itemLabel: "풍속",
    currentValue: "순간 16.2 m/s",
    severity: "danger",
    detail: "15m/s 이상 — 타워크레인 운전 중지",
  });
  assert.ok(msg.includes("🔴"));
  assert.ok(msg.includes("현장환경 위험"));
  assert.ok(msg.includes("풍속"));
  assert.ok(msg.includes("순간 16.2 m/s"));
  assert.ok(msg.includes("타워크레인"));
});
