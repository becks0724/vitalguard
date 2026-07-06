// AED 심각도·알림 레벨 매핑 단위 테스트 — 임계(단말 20/50 · 교환주기 90일 임박) worst-of + CLEAR/WARNING/DANGER.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  aedCycleSev,
  aedDevBattSev,
  aedRowSev,
  alarmLevelOf,
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

test("aedRowSev — 단말 방전이면 교환주기 정상이어도 위험", () => {
  const r: AedStatusInput = {
    devBatt: 18,
    battCycleMonths: 48,
    padCycleMonths: 24,
    history: [{ daysAgo: 30, items: ["battery", "pad"] }],
  };
  assert.equal(aedRowSev(r), "danger");
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
