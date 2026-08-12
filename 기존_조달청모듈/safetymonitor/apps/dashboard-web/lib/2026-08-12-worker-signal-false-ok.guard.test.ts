// 구조적 재발 방지 — 신호등 작업자 항목이 "미수신"을 "정상"으로 셈하는 false-OK 가드.
//
// 배경 — 2026-08-12 사용자 제보. 등록 4명 중 장우진만 수신 중인데 신호등이
// "정상 4명 · 전 작업자 정상 범위 · 등록 4명 전부 정상 범위(심박·SpO₂·체온·낙상·SOS)" 로 표시했다.
// 생체 샘플이 없는 작업자는 tone 이 idle 이라 이상 명단에 안 들어가는데 인원수에는 함께 세어진 탓이다.
// 한 번도 받은 적 없는 값 5종을 정상이라 단언하는 문장이라 관리자가 "4명이 감시되고 있다"고 오독한다
// (2026-07-30 CCTV "미수신 → 준수율 100%" 와 같은 계열).
//
// 왜 가드 테스트인가 — 결함이 tsc·lint·기존 테스트가 전부 통과하는 상태로 존재했고,
// 이 레포에는 렌더 테스트 인프라가 없다. 문구 산출을 순수 함수로 빼고 출력 문자열로 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { workerSignalCopy } from "./worker-signal";

test("제보 재현 — 4명 등록 · 1명만 수신: 전원 정상이라고 말하지 않는다", () => {
  const c = workerSignalCopy({
    count: 4,
    evaluated: 1,
    issues: [],
    waitingNames: ["EMP-admin7276", "EMP-admin3470", "EMP-admin0740"],
  });
  const all = [c.summary, c.short, c.title, ...c.lines.map((l) => l.text)].join(" | ");
  assert.ok(!all.includes("전 작업자 정상"), `"전 작업자 정상" 이 남아 있다 — ${all}`);
  assert.ok(!all.includes("등록 4명 전부"), `"등록 4명 전부" 가 남아 있다 — ${all}`);
  assert.ok(!/정상\s*4명/.test(all), `미수신 3명이 정상 인원에 섞였다 — ${all}`);
  assert.ok(c.summary.includes("대기 3"), `요약에 대기 인원이 없다 — ${c.summary}`);
});

test("대기 작업자 이름을 상세에 실명으로 남긴다 — 누가 미수신인지 알아야 조치한다", () => {
  const c = workerSignalCopy({
    count: 4,
    evaluated: 1,
    issues: [],
    waitingNames: ["EMP-admin7276", "EMP-admin3470", "EMP-admin0740"],
  });
  const line = c.lines.find((l) => l.label === "수신 대기");
  assert.ok(line, "수신 대기 줄이 없다");
  for (const n of ["EMP-admin7276", "EMP-admin3470", "EMP-admin0740"]) {
    assert.ok(line?.text.includes(n), `${n} 이 대기 명단에 없다 — ${line?.text}`);
  }
});

test("전원 미수신 — '정상' 이라는 단어를 쓰지 않는다", () => {
  const c = workerSignalCopy({
    count: 3,
    evaluated: 0,
    issues: [],
    waitingNames: ["A", "B", "C"],
  });
  const all = [c.summary, c.short, c.title, ...c.lines.map((l) => l.text)].join(" | ");
  assert.ok(!all.includes("정상 3명"), `아무도 판정 안 됐는데 정상 인원이 있다 — ${all}`);
  assert.ok(/판정|미수신|대기/.test(c.short), `판정 불가 사실이 요약에 없다 — ${c.short}`);
});

test("전원 수신 + 이상 없음 — 기존 문구를 그대로 유지한다(회귀 방지)", () => {
  const c = workerSignalCopy({ count: 4, evaluated: 4, issues: [], waitingNames: [] });
  assert.equal(c.summary, "정상 4명");
  assert.equal(c.short, "전 작업자 정상 범위");
  assert.equal(c.title, "작업자 정상 (4명)");
  assert.equal(c.lines.length, 1);
  assert.ok(c.lines[0]?.text.includes("등록 4명 전부 정상 범위"));
});

test("이상 있음 — 기존 경보 문구·골든타임 안내가 그대로 나온다(회귀 방지)", () => {
  const c = workerSignalCopy({
    count: 4,
    evaluated: 4,
    issues: [{ name: "장우진", metrics: "심박" }],
    waitingNames: [],
  });
  assert.equal(c.summary, "이상 1명 / 전체 4명");
  assert.ok(c.short.includes("골든타임 4분"), c.short);
  assert.ok(c.lines.some((l) => l.label === "골든타임"));
  assert.ok(c.lines.some((l) => l.label === "권장 대응"));
});

test("이상 + 대기 동시 — 경보를 유지하면서 대기 인원도 함께 알린다", () => {
  const c = workerSignalCopy({
    count: 4,
    evaluated: 2,
    issues: [{ name: "장우진", metrics: "연결끊김" }],
    waitingNames: ["A", "B"],
  });
  assert.ok(c.short.includes("연결끊김"), `경보가 대기 문구에 밀렸다 — ${c.short}`);
  assert.ok(c.lines.some((l) => l.label === "수신 대기"), "대기 명단이 빠졌다");
});

test("등록 0명 — 종전대로 '작업자 대기'", () => {
  const c = workerSignalCopy({ count: 0, evaluated: 0, issues: [], waitingNames: [] });
  assert.equal(c.summary, "작업자 대기");
  assert.equal(c.short, "작업자 등록 대기");
});
