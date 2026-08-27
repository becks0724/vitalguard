// 내역서 원가 추출 가드 — 실측 파일(2026-08-27 나라장터 공사 공고 첨부 7건)에서 드러난
// 함정을 셀 배치로 재현한다. 실파일은 수 MB 라 커밋하지 않고 배치만 옮겼다.
import assert from "node:assert/strict";
import { test } from "node:test";

import { draftFromSheets } from "./spec-cost-parse";
import { cellKey, type Sheet } from "./xlsx-lite";

/** 배열 표기 → Sheet. `null` 은 빈 셀. */
function sheet(name: string, rows: (string | number | null)[][], firstRow = 1): Sheet {
  const cells = new Map<string, string>();
  rows.forEach((cols, r) =>
    cols.forEach((v, c) => {
      if (v !== null && v !== "") cells.set(cellKey(firstRow + r, c + 1), String(v));
    }),
  );
  return { name, cells };
}

test("원가계산서 행에서 계상액·요율을 뽑는다", () => {
  const s = sheet("원가계산서", [
    [null, null, "퇴직공제부금비", 2.3, 2779312],
    [null, null, "산업안전보건관리비", 2.07, 5744631, 2.07, 0, -5744631],
  ]);
  const d = draftFromSheets([s]);
  assert.equal(d.safetyCost?.amount, 5744631);
  assert.equal(d.safetyCost?.ratePercent, 2.07);
  assert.equal(d.safetyCost?.row, 2);
});

test("소계 행의 주석 셀을 계상액으로 오인하지 않는다", () => {
  // 실측 함정: 소계 행 K열에 "산업안전보건관리비:" 주석이 있고 E열에 소계 145,383,748 이 있다.
  // 첫 일치를 쓰면 소계를 계상액으로 읽는다.
  const s = sheet("심사요약", [
    [null, null, "소          계", null, 145383748, null, null, null, null, null, "산업안전보건관리비:"],
    [null, null, "산업안전보건관리비", 2.07, 5744631],
  ]);
  const d = draftFromSheets([s]);
  assert.equal(d.safetyCost?.amount, 5744631, "소계가 아니라 항목 행의 금액이어야 한다");
});

test("「안전관리비」(건진법 계열)를 산업안전보건관리비로 집지 않는다", () => {
  const s = sheet("원가계산서", [
    [null, null, "산업안전보건관리비", 2.07, 5744631],
    [null, null, "안전관리비", null, 661000],
  ]);
  const d = draftFromSheets([s]);
  assert.equal(d.safetyCost?.amount, 5744631);
  assert.notEqual(d.safetyCost?.amount, 661000);
});

test("공란 내역서 — 요율만 있고 금액이 없으면 amount=null 로 남기고 사유를 적는다", () => {
  const s = sheet("설계내역서", [[null, null, "산업안전보건관리비", null, 3.15, "%"]]);
  const d = draftFromSheets([s]);
  assert.equal(d.safetyCost?.amount, null);
  assert.equal(d.safetyCost?.ratePercent, 3.15);
  assert.ok(d.notes.some((n) => n.includes("공란 내역서")), "공란 사유가 메모에 있어야 한다");
});

test("값이 있는 시트를 빈 총괄표보다 우선한다", () => {
  const empty = sheet("내역서총괄표", [[null, null, "산업안전보건관리비"]]);
  const real = sheet("원가계산서", [[null, null, "산업안전보건관리비", 3.15, 1845728]]);
  const d = draftFromSheets([empty, real]);
  assert.equal(d.safetyCost?.sheet, "원가계산서");
  assert.equal(d.safetyCost?.amount, 1845728);
});

test("대상액은 구성이 다 있을 때만 만든다(추정 금지)", () => {
  const partial = sheet("원가계산서", [[null, null, "재료비", null, 100000000]]);
  assert.equal(draftFromSheets([partial]).targetAmount, null);

  const full = sheet("원가계산서", [
    [null, null, "재료비", null, 100000000],
    [null, null, "직접노무비", null, 50000000],
    [null, null, "관급자재", null, 10000000],
  ]);
  assert.equal(draftFromSheets([full]).targetAmount, 160000000);
});

test("잡재료비·할증 같은 유사 라벨은 항목으로 보지 않는다", () => {
  const s = sheet("원가계산서", [
    [null, null, "잡재료비", null, 9999999],
    [null, null, "재료비 할증 계수", null, 1.05],
    [null, null, "재료비", null, 100000000],
  ]);
  assert.equal(draftFromSheets([s]).material?.amount, 100000000);
});

test("금액÷요율이 대상액과 크게 어긋나면 정합 경고를 남긴다", () => {
  const s = sheet("원가계산서", [
    [null, null, "재료비", null, 100000000],
    [null, null, "직접노무비", null, 50000000],
    // 대상액 1.5억 · 요율 2% 면 300만원이어야 하는데 1000만원이 적혀 있다.
    [null, null, "산업안전보건관리비", 2, 10000000],
  ]);
  const d = draftFromSheets([s]);
  assert.ok(d.notes.some((n) => n.includes("정합 경고")));
});
