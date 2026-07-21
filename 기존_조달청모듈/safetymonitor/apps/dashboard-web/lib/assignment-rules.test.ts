// assignment-rules.ts 단위 테스트 — 등급×태그 배제표 회귀 방지.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { ALL_RISK_TAGS, matchAssignments } from "./assignment-rules";
import type { ConditionResult } from "./worker-condition";

const fit: ConditionResult = { grade: "fit", reasons: [], workedHours: 2 };

test("양호(fit) → 전 태그 배치 가능", () => {
  const a = matchAssignments(fit);
  assert.equal(a.perTag.length, ALL_RISK_TAGS.length);
  assert.ok(a.perTag.every((t) => t.allowed && !t.pending));
});

test("미판정(unknown) → 전 태그 보류(pending, 배제 아님)", () => {
  const a = matchAssignments({
    grade: "unknown",
    reasons: [{ code: "NO_DATA", label: "생체 데이터 없음", detail: "" }],
    workedHours: null,
  });
  assert.ok(a.perTag.every((t) => !t.allowed && t.pending && t.blockedBy.length === 0));
});

test("제한(restricted) → 전 태그 배제 + 사유 전파", () => {
  const a = matchAssignments({
    grade: "restricted",
    reasons: [{ code: "FALL_24H", label: "24시간 내 낙상 신호", detail: "" }],
    workedHours: 3,
  });
  assert.ok(a.perTag.every((t) => !t.allowed && !t.pending));
  assert.ok(a.perTag.every((t) => t.blockedBy.some((b) => b.code === "FALL_24H")));
});

test("주의(caution)+SpO₂ 빈발 → 밀폐공간·고소작업만 배제, 나머지 허용", () => {
  const a = matchAssignments({
    grade: "caution",
    reasons: [{ code: "SPO2_CAUTION_FREQ", label: "혈중산소 주의 구간 빈발", detail: "" }],
    workedHours: 3,
  });
  const blocked = a.perTag.filter((t) => !t.allowed).map((t) => t.tag);
  assert.deepEqual(blocked.sort(), ["고소작업", "밀폐공간"].sort());
  assert.ok(a.perTag.find((t) => t.tag === "전기/감전")?.allowed);
});

test("주의(caution)+장시간 작업 → 고소·중장비/양중 배제(피로)", () => {
  const a = matchAssignments({
    grade: "caution",
    reasons: [{ code: "LONG_SHIFT", label: "장시간 연속 작업", detail: "" }],
    workedHours: 11,
  });
  const blocked = a.perTag.filter((t) => !t.allowed).map((t) => t.tag);
  assert.deepEqual(blocked.sort(), ["고소작업", "중장비/양중"].sort());
});

test("UNACKED_ALERT 단독은 태그 배제 없음(표시만)", () => {
  const a = matchAssignments({
    grade: "caution",
    reasons: [{ code: "UNACKED_ALERT", label: "미대응 경보 존재", detail: "" }],
    workedHours: 3,
  });
  assert.ok(a.perTag.every((t) => t.allowed));
});

test("배제 태그에는 법적 근거(basis)가 항상 붙는다", () => {
  const a = matchAssignments({
    grade: "restricted",
    reasons: [{ code: "SOS_24H", label: "24시간 내 SOS 발신", detail: "" }],
    workedHours: 1,
  });
  assert.ok(a.perTag.every((t) => t.basis.includes("산업안전보건기준")));
});
