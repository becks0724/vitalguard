// AED 심각도·알림 레벨 매핑 단위 테스트 — 임계(단말 20/50 · 교환주기 90일 임박) worst-of + CLEAR/WARNING/DANGER.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  aedCycleSev,
  aedDevBattSev,
  aedRowSev,
  alarmLevelOf,
  buildAedStatusInput,
  worstAedSev,
  type AedStatusInput,
} from "./aed-status.js";

test("단말 배터리 임계 — 20↓ 위험 · 50↓ 주의 · 초과 정상", () => {
  assert.equal(aedDevBattSev(18), "danger");
  assert.equal(aedDevBattSev(20), "danger");
  assert.equal(aedDevBattSev(50), "caution");
  assert.equal(aedDevBattSev(51), "normal");
});

test("교환주기 임계 — 경과(음수) 위험 · 90일 이내 주의 · 초과 정상", () => {
  assert.equal(aedCycleSev(-1), "danger");
  assert.equal(aedCycleSev(0), "caution");
  assert.equal(aedCycleSev(90), "caution");
  assert.equal(aedCycleSev(91), "normal");
});

test("worst-of — 단말·본체 배터리·패드 중 최악", () => {
  assert.equal(worstAedSev(["normal", "caution", "danger"]), "danger");
  assert.equal(worstAedSev(["normal", "caution", "normal"]), "caution");
  assert.equal(worstAedSev(["normal", "normal"]), "normal");
});

test("aedRowSev — 단말 배터리는 심각도 무관(방전이어도 교환주기 정상이면 정상)", () => {
  const r: AedStatusInput = {
    devBatt: 18, // 단말 배터리 항목 제거 — 더 이상 심각도에 반영되지 않음.
    battCycleMonths: 48,
    padCycleMonths: 24,
    history: [{ daysAgo: 30, items: ["battery", "pad"] }],
  };
  assert.equal(aedRowSev(r), "normal");
});

test("aedRowSev — 패드 교환주기 경과면 위험(단말 양호여도)", () => {
  const r: AedStatusInput = {
    devBatt: 92,
    battCycleMonths: 48, // 1440일
    padCycleMonths: 24, // 720일
    history: [
      { daysAgo: 800, items: ["pad"] }, // pad due = 720 - 800 = -80 < 0 → danger
      { daysAgo: 100, items: ["battery"] },
    ],
  };
  assert.equal(aedRowSev(r), "danger");
});

test("aedRowSev — 전부 여유면 정상", () => {
  const r: AedStatusInput = {
    devBatt: 92,
    battCycleMonths: 48,
    padCycleMonths: 24,
    history: [{ daysAgo: 30, items: ["battery", "pad"] }],
  };
  assert.equal(aedRowSev(r), "normal");
});

test("alarmLevelOf — 정상 CLEAR · 주의 WARNING · 위험 DANGER", () => {
  assert.equal(alarmLevelOf("normal"), "CLEAR");
  assert.equal(alarmLevelOf("caution"), "WARNING");
  assert.equal(alarmLevelOf("danger"), "DANGER");
});

// ── 등록 실 장비 심각도(buildAedStatusInput) — 알림 엔드포인트·관제 표 공유 입력 ──
test("buildAedStatusInput — 신품(교환 0일 경과)·배터리 양호면 정상", () => {
  const inp = buildAedStatusInput({ devBatt: 100, battCycleMonths: 48, padCycleMonths: 24, lastSwapDaysAgo: 0 });
  assert.equal(aedRowSev(inp), "normal");
});

test("buildAedStatusInput — 단말 배터리 부족이어도 신품(교환주기 정상)이면 정상(단말 배터리 심각도 제거)", () => {
  const inp = buildAedStatusInput({ devBatt: 18, battCycleMonths: 48, padCycleMonths: 24, lastSwapDaysAgo: 0 });
  assert.equal(aedRowSev(inp), "normal");
});

test("buildAedStatusInput — 교환일 오래 경과(패드 주기 초과)면 위험", () => {
  // pad 720일 주기 · 800일 경과 → due = -80 < 0 → danger.
  const inp = buildAedStatusInput({ devBatt: 92, battCycleMonths: 48, padCycleMonths: 24, lastSwapDaysAgo: 800 });
  assert.equal(aedRowSev(inp), "danger");
});

test("buildAedStatusInput — 추가 점검 이력(더 최근 교체)이 주기 리셋", () => {
  // seed 교체는 800일 전(경과)이지만 NFC 점검으로 10일 전 battery·pad 교체 → 정상 복귀.
  const inp = buildAedStatusInput({
    devBatt: 92,
    battCycleMonths: 48,
    padCycleMonths: 24,
    lastSwapDaysAgo: 800,
    extraHistory: [{ daysAgo: 10, items: ["battery", "pad"] }],
  });
  assert.equal(aedRowSev(inp), "normal");
});
