// 커버리지 히트맵 배치·상태 판정 단위 테스트.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  buildCoverageCells,
  coverageLevel,
  formatCoverage,
  monthLabels,
  summarizeCoverage,
  toWeekGrid,
} from "./coverage-heatmap";

test("색 단계는 교대 시간 경계에서 갈린다", () => {
  assert.equal(coverageLevel(0), 0);
  assert.equal(coverageLevel(1), 1);
  assert.equal(coverageLevel(60), 1);
  assert.equal(coverageLevel(61), 2);
  assert.equal(coverageLevel(240), 2);
  assert.equal(coverageLevel(241), 3);
  assert.equal(coverageLevel(480), 3); // 8시간 = 교대 1회
  assert.equal(coverageLevel(481), 4);
  assert.equal(coverageLevel(720), 4);
  assert.equal(coverageLevel(721), 5);
  assert.equal(coverageLevel(1440), 5);
});

test("시간 표기", () => {
  assert.equal(formatCoverage(0), "0분");
  assert.equal(formatCoverage(45), "45분");
  assert.equal(formatCoverage(60), "1시간");
  assert.equal(formatCoverage(62), "1시간 2분");
});

test("★ 빈칸이 세 종류로 갈린다 — 운영 이전 · 미수신 · 수집됨", () => {
  const cells = buildCoverageCells(
    [{ date: "2026-08-16", value: 300 }],
    "2026-08-15",
    "2026-08-17",
    5, // 08-13 ~ 08-17
  );
  assert.deepEqual(
    cells.map((c) => [c.date, c.state]),
    [
      ["2026-08-13", "before"], // 최초 수집일 이전
      ["2026-08-14", "before"],
      ["2026-08-15", "missing"], // 운영 시작했는데 그날 0
      ["2026-08-16", "covered"],
      ["2026-08-17", "missing"],
    ],
  );
});

test("★ 한 번도 수집된 적 없는 워커는 전부 '운영 이전' — 365칸 미수신으로 칠하지 않는다", () => {
  const cells = buildCoverageCells([], null, "2026-08-17", 10);
  assert.equal(cells.length, 10);
  assert.ok(cells.every((c) => c.state === "before"), "미수신으로 칠했다 — 없는 사고를 그린다");
});

test("실제 데이터가 최초 수집일 계산을 이긴다", () => {
  // firstDataDate 가 늦게 잡혀도 값이 있는 날은 covered 다(별칭 병합 지연 등으로 어긋날 수 있다).
  const cells = buildCoverageCells(
    [{ date: "2026-08-10", value: 120 }],
    "2026-08-15",
    "2026-08-10",
    1,
  );
  assert.equal(cells[0]?.state, "covered");
});

test("주 격자 — 월요일이 첫 행이고 시작 전 요일은 비어 있다", () => {
  // 2026-08-13 은 목요일 → 행 index 3.
  const cells = buildCoverageCells([], null, "2026-08-17", 5); // 목·금·토·일·월
  const weeks = toWeekGrid(cells);
  assert.equal(weeks.length, 2, "월요일에서 열이 갈려 2주가 되어야 한다");
  assert.deepEqual(weeks[0]?.slice(0, 3), [null, null, null], "목요일 앞은 비어야 한다");
  assert.equal(weeks[0]?.[3]?.date, "2026-08-13");
  assert.equal(weeks[1]?.[0]?.date, "2026-08-17", "새 열의 첫 행이 월요일");
});

test("칸 총수가 요청한 일수와 같다(격자에서 유실 없음)", () => {
  const cells = buildCoverageCells([], null, "2026-08-17", 365);
  assert.equal(cells.length, 365);
  const placed = toWeekGrid(cells).flat().filter((c) => c !== null).length;
  assert.equal(placed, 365, "격자로 옮기며 칸이 사라졌다");
});

test("월 라벨은 달이 바뀌는 열에만 붙는다", () => {
  const cells = buildCoverageCells([], null, "2026-08-17", 40);
  const labels = monthLabels(toWeekGrid(cells));
  const named = labels.filter((l) => l !== "");
  assert.ok(named.length >= 2, "두 달 이상 걸치는데 라벨이 부족하다");
  assert.ok(named.every((l) => /^\d+월$/.test(l)));
});

test("요약 — 운영 기간이 0이면 비율은 null 이다(0% 가 아니다)", () => {
  const none = summarizeCoverage(buildCoverageCells([], null, "2026-08-17", 30));
  assert.equal(none.rate, null, "운영 이전만 있는데 0% 로 적으면 미수신처럼 읽힌다");
  assert.equal(none.beforeDays, 30);

  const some = summarizeCoverage(
    buildCoverageCells([{ date: "2026-08-16", value: 480 }], "2026-08-15", "2026-08-17", 5),
  );
  assert.equal(some.coveredDays, 1);
  assert.equal(some.missingDays, 2);
  assert.equal(some.beforeDays, 2);
  assert.equal(some.totalMinutes, 480);
  assert.equal(some.rate, 1 / 3);
});
