// site-env-rules.ts 단위 테스트 — 환경(가스·특보)×태그 배제표 회귀 방지.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { matchEnvironment, type SiteEnvSignals } from "./site-env-rules";

const base: SiteEnvSignals = { gaspod: null, warnings: [], sido: "광주" };

const gaspod = (state: "CLEAR" | "WARNING" | "DANGER", stale = false) => ({
  deviceId: "gaspod-01",
  state,
  o2: 17.9,
  receivedAt: "2026-07-21T01:00:00Z",
  stale,
});

test("환경 신호 없음 → 배제 0·안내 0", () => {
  const r = matchEnvironment(base);
  assert.equal(r.blocks.length, 0);
  assert.equal(r.notes.length, 0);
});

test("가스 감지기 WARNING/DANGER → 밀폐공간 배제(제618조·제619조 근거)", () => {
  for (const state of ["WARNING", "DANGER"] as const) {
    const r = matchEnvironment({ ...base, gaspod: gaspod(state) });
    assert.equal(r.blocks.length, 1);
    assert.equal(r.blocks[0]?.tag, "밀폐공간");
    assert.ok(r.blocks[0]?.basis.includes("제618조"));
  }
});

test("가스 감지기 CLEAR → 배제 없음", () => {
  const r = matchEnvironment({ ...base, gaspod: gaspod("CLEAR") });
  assert.equal(r.blocks.length, 0);
});

test("가스 감지기 stale → 배제 대신 측정 필요 안내", () => {
  const r = matchEnvironment({ ...base, gaspod: gaspod("DANGER", true) });
  assert.equal(r.blocks.length, 0);
  assert.ok(r.notes[0]?.includes("측정 필요"));
});

test("강풍경보 → 고소·양중·해체 배제(제37조·제383조)", () => {
  const r = matchEnvironment({ ...base, warnings: [{ type: "강풍경보", level: "경보" }] });
  const tags = r.blocks.map((b) => b.tag).sort();
  assert.deepEqual(tags, ["고소작업", "중장비/양중", "해체/철거"].sort());
  assert.ok(r.blocks.every((b) => b.basis.includes("제37조")));
});

test("강풍주의보 → 배제 아닌 감독관 확인 안내", () => {
  const r = matchEnvironment({ ...base, warnings: [{ type: "강풍주의보", level: "주의보" }] });
  assert.equal(r.blocks.length, 0);
  assert.ok(r.notes[0]?.includes("감독관 확인"));
});

test("호우경보 → 고소·굴착·전기 배제", () => {
  const r = matchEnvironment({ ...base, warnings: [{ type: "호우경보", level: "경보" }] });
  const tags = r.blocks.map((b) => b.tag).sort();
  assert.deepEqual(tags, ["고소작업", "굴착/흙막이", "전기/감전"].sort());
});

test("폭염특보 → 배제 없이 휴식 의무(2025.7.17. 시행) 안내", () => {
  for (const level of ["경보", "주의보"] as const) {
    const r = matchEnvironment({ ...base, warnings: [{ type: `폭염${level}`, level }] });
    assert.equal(r.blocks.length, 0);
    assert.ok(r.notes[0]?.includes("휴식 의무"));
  }
});

test("복합(가스 DANGER + 강풍경보) → 밀폐공간+옥외 3종 배제·중복 없음", () => {
  const r = matchEnvironment({
    ...base,
    gaspod: gaspod("DANGER"),
    warnings: [
      { type: "강풍경보", level: "경보" },
      { type: "태풍경보", level: "경보" },
    ],
  });
  const tags = r.blocks.map((b) => b.tag);
  assert.equal(new Set(tags).size, tags.length);
  assert.deepEqual(
    [...tags].sort(),
    ["고소작업", "밀폐공간", "중장비/양중", "해체/철거"].sort(),
  );
});
