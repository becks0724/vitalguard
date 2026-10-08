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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { workerSignalCopy, type WorkerTally } from "./worker-signal";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

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
  // ⚠ 종전 단언은 `summary === "이상 1명 / 전체 4명"` 이었다. 2026-08-26 에 **의도적으로**
  //    바꿨다(사용자 제보 — 이상자만 말하고 나머지 3명 상태가 통째로 빠졌다). 정확 문자열
  //    대신 **지켜야 할 성분**으로 고정한다: 이상 수와 전체 분모는 반드시 남는다.
  assert.match(c.summary, /이상 1\b/, `이상 인원이 요약에서 사라졌다 — ${c.summary}`);
  assert.match(c.summary, /전체 4명/, `전체 분모가 사라졌다 — 1명이 4명 중인지 40명 중인지 모른다`);
  assert.ok(c.short.includes("골든타임 4분"), c.short);
  assert.ok(c.lines.some((l) => l.label === "골든타임"));
  assert.ok(c.lines.some((l) => l.label === "권장 대응"));
});

// ── 2026-08-26 · 연결 상태 반영 ────────────────────────────────────────────────
// 사용자 제보 — "안전 신호등에서 이상1 장우진 연결끊김은 맞다. 하지만 김태곤의 연결상태를
// 전혀 반영하지 못하고 있다." 원인이 둘이었다.
//   ① 문구 — 이상 분기가 이상자만 적고 수신 중 인원을 아예 안 만들었다.
//   ② 렌더 — SafetySignalBoard.summaryLines 가 상세를 2줄로 잘라, 만들어도 화면에 못 갔다.
// 둘 다 막지 않으면 한쪽만 고쳐 놓고 "반영했다"고 착각한다([[L-115]]③ 양 끝 단언).

test("★ 이상이 있어도 수신 중 인원이 요약에서 침묵하지 않는다", () => {
  // 제보 당시 실제 배분 — 장우진 연결끊김 / 김태곤 수신 중 / 전 팀원·김○○ 대기.
  const c = workerSignalCopy({
    count: 4,
    evaluated: 2,
    issues: [{ name: "장우진", metrics: "연결끊김" }],
    waitingNames: ["임시작업자A", "임시작업자B"],
    normalNames: ["김태곤"],
  });
  assert.match(c.summary, /이상 1\b/, `이상이 빠졌다 — ${c.summary}`);
  assert.match(c.summary, /수신 1\b/, `수신 중 인원이 빠졌다(제보의 그 결함) — ${c.summary}`);
  assert.match(c.summary, /대기 2\b/, `대기 인원이 빠졌다 — ${c.summary}`);
});

test("★ 수신 중 작업자를 실명으로 남긴다 — 이상 명단과 섞이지 않는다", () => {
  const c = workerSignalCopy({
    count: 4,
    evaluated: 2,
    issues: [{ name: "장우진", metrics: "연결끊김" }],
    waitingNames: ["임시작업자A", "임시작업자B"],
    normalNames: ["김태곤"],
  });
  const line = c.lines.find((l) => l.label === "수신 중");
  assert.ok(line, "수신 중 줄이 없다 — 정상 수신자가 상세에서 사라진다");
  assert.ok(line?.text.includes("김태곤"), `수신 중 명단에 이름이 없다 — ${line?.text}`);
  // 섞이면 관제가 "김태곤도 이상인가" 로 읽는다. 라벨이 갈라져 있어야 한다.
  const issueLines = c.lines.filter((l) => l.label.startsWith("이상"));
  assert.ok(
    !issueLines.some((l) => l.text.includes("김태곤")),
    "수신 중인 사람이 이상 명단에 섞였다",
  );
});

test("★ 이름을 안 넘겨도 수치는 정확하다 — 이름만 생략된다", () => {
  // normalNames 는 선택 필드다. 호출부가 빠뜨려도 요약의 인원 배분이 틀리면 안 된다.
  const c = workerSignalCopy({
    count: 4,
    evaluated: 2,
    issues: [{ name: "장우진", metrics: "연결끊김" }],
    waitingNames: ["임시작업자A", "임시작업자B"],
  });
  assert.match(c.summary, /수신 1\b/, `이름 없이도 수신 인원은 나와야 한다 — ${c.summary}`);
  assert.ok(!c.lines.some((l) => l.label === "수신 중"), "이름이 없는데 빈 명단 줄을 만들었다");
});

test("★ 0 인 항목은 요약에 적지 않는다 — '대기 0명' 은 정보가 아니라 잡음이다", () => {
  const c = workerSignalCopy({
    count: 2,
    evaluated: 2,
    issues: [{ name: "장우진", metrics: "심박" }],
    waitingNames: [],
    normalNames: ["김태곤"],
  });
  assert.ok(!/대기 0/.test(c.summary), `대기 0 이 적혔다 — ${c.summary}`);
  assert.match(c.summary, /수신 1\b/, c.summary);
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

// SafetySignalBoard 는 행을 `{summary} · {short}` 로 **이어 붙여** 한 줄로 렌더한다.
// short 가 summary 의 수치를 되풀이하면 "정상 1명 · 대기 3명 · 정상 1명 · 3명 수신 대기" 처럼
// 말을 더듬는다(2026-08-12 첫 배포에서 실제로 그렇게 나갔다). 대기 분기의 short 는 수치가 아니라
// 의미를 담아야 하므로 숫자를 아예 금지한다 — 이상 분기는 골든타임 "4분" 이 필요해 제외.
const rowCases: [string, WorkerTally][] = [
  ["정상+대기 혼재", { count: 4, evaluated: 1, issues: [], waitingNames: ["A", "B", "C"] }],
  ["전원 미수신", { count: 3, evaluated: 0, issues: [], waitingNames: ["A", "B", "C"] }],
];
for (const [label, tally] of rowCases) {
  test(`${label} — 행 한 줄에서 수치가 겹쳐 읽히지 않는다`, () => {
    const c = workerSignalCopy(tally);
    assert.ok(
      !/\d/.test(c.short),
      `short 에 숫자가 있어 summary 와 겹친다 — "${c.summary} · ${c.short}"`,
    );
  });
}

test("★ 렌더 — 보드가 작업자 상세를 2줄로 잘라 수신 상태를 먹지 않는다", () => {
  // ②번 원인. 문구를 아무리 잘 만들어도 여기서 잘리면 화면엔 없다 — 실제로 그랬다.
  // 작업자 행의 한 벌 = `이상 N · 수신 중 · 수신 대기 · 권장 대응` 이라 4줄이 하한이다.
  const board = readFileSync(join(ROOT, "app", "components", "SafetySignalBoard.tsx"), "utf8");

  // 상한이 인자로 열려 있는가(고정 2 로 되돌아가면 행별 조정이 불가능해진다).
  assert.match(
    board,
    /function summaryLines\(lines: LampDetail\["lines"\], max = \d+\)/,
    "상세 줄 상한이 다시 하드코딩됐다 — 작업자 행이 잘린다",
  );
  // 렌더가 그 인자를 실제로 넘기는가(열어 두고 안 쓰면 아무것도 안 바뀐다).
  assert.match(
    board,
    /summaryLines\(row\.detail\.lines, row\.maxLines\)/,
    "렌더가 행별 상한을 안 넘긴다 — 기본값으로 다시 잘린다",
  );
  // 작업자 행이 4줄 이상을 요구하는가.
  const workerRow = board.slice(board.indexOf("const workerRow: LampRow = {"), board.indexOf("const workerRow: LampRow = {") + 700);
  const max = Number(workerRow.match(/maxLines: (\d+)/)?.[1] ?? 0);
  assert.ok(max >= 4, `작업자 행 상세 상한이 ${max} 줄 — 수신 중·수신 대기가 잘린다`);
});

test("★ 생산 — 대시보드가 수신 중 명단을 실제로 채워 넘긴다", () => {
  // 양 끝의 나머지 한쪽([[L-115]]③). 문구 함수와 렌더를 아무리 묶어도 **호출부가 안 넘기면**
  // 상세의 실명이 사라진다 — 그런데 수치는 evaluated 에서 파생돼 여전히 맞으므로
  // "수신 1" 만 보이고 "누구인지" 는 영영 안 나오는, 조용히 반쪽인 상태가 된다.
  const dash = readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8");
  assert.match(dash, /const normalNames: string\[\] = \[\];/, "수신 중 명단 수집이 사라졌다");
  // 채우는 자리가 있는가 — 선언만 있고 push 가 없으면 늘 빈 배열이다.
  assert.match(dash, /normalNames\.push\(name\);/, "수신 중 명단에 아무도 담기지 않는다");
  // 넘기는가.
  const call = dash.slice(dash.indexOf("const copy = workerSignalCopy({"), dash.indexOf("const copy = workerSignalCopy({") + 300);
  assert.match(call, /normalNames,/, "수집만 하고 문구 함수에 안 넘긴다");
});

test("등록 0명 — 종전대로 '작업자 대기'", () => {
  const c = workerSignalCopy({ count: 0, evaluated: 0, issues: [], waitingNames: [] });
  assert.equal(c.summary, "작업자 대기");
  assert.equal(c.short, "작업자 등록 대기");
});
