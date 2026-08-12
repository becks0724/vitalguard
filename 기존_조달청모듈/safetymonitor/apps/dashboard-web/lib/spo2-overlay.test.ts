// SpO₂ 표시 겹침 단위 테스트 — 인스턴스 메모리에 없는 spo2 를 DB 행으로 메우는 경계를 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { overlayLatestSpo2, type Spo2DbRow } from "./spo2-overlay";
import { SPO2_FRESH_MS } from "./spo2-freshness";

const NOW = Date.parse("2026-08-12T05:20:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function card(workerId: string, extra: Partial<{ spo2: number; spo2MeasuredAt: string }> = {}) {
  return { workerId, ts: iso(0), ...extra };
}
function row(worker_id: string, spo2: number, measuredAgo: number): Spo2DbRow {
  return { worker_id, spo2, spo2_measured_at: iso(measuredAgo), ts: iso(measuredAgo - 3_000) };
}

test("메모리에 spo2 없는 카드 — DB 마지막 측정으로 채운다(다른 인스턴스 응답 재현)", () => {
  const latest = [card("EMP-6861")];
  overlayLatestSpo2(latest, [row("EMP-6861", 96, 2 * 60_000)], {}, SPO2_FRESH_MS, NOW);
  assert.equal(latest[0]!.spo2, 96);
  assert.equal(latest[0]!.spo2MeasuredAt, iso(2 * 60_000));
});

test("신선 한도(30분) 밖의 DB 행은 겹치지 않는다 — 낡은 값 부활 금지", () => {
  const latest = [card("EMP-6861")];
  overlayLatestSpo2(latest, [row("EMP-6861", 96, SPO2_FRESH_MS + 60_000)], {}, SPO2_FRESH_MS, NOW);
  assert.equal(latest[0]!.spo2, undefined);
});

test("카드가 더 새 측정을 이미 들고 있으면 DB 행이 덮지 않는다", () => {
  const latest = [card("EMP-6861", { spo2: 98, spo2MeasuredAt: iso(60_000) })];
  overlayLatestSpo2(latest, [row("EMP-6861", 93, 10 * 60_000)], {}, SPO2_FRESH_MS, NOW);
  assert.equal(latest[0]!.spo2, 98);
});

test("별칭 접기 — secondary ID 로 저장된 행이 주 ID 카드에 겹친다", () => {
  const latest = [card("EMP-6861")];
  overlayLatestSpo2(
    latest,
    [row("EMP-admin6861", 95, 5 * 60_000)],
    { "EMP-admin6861": "EMP-6861" },
    SPO2_FRESH_MS,
    NOW,
  );
  assert.equal(latest[0]!.spo2, 95);
});

test("같은 주 ID 에 여러 행이 접히면 측정 시각이 최신인 행이 이긴다", () => {
  const latest = [card("EMP-6861")];
  overlayLatestSpo2(
    latest,
    [row("EMP-6861", 93, 20 * 60_000), row("EMP-admin6861", 97, 3 * 60_000)],
    { "EMP-admin6861": "EMP-6861" },
    SPO2_FRESH_MS,
    NOW,
  );
  assert.equal(latest[0]!.spo2, 97);
});
