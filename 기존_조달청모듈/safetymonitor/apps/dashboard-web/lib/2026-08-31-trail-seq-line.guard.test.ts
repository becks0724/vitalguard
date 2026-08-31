// 근사 동선 점선 가드(2026-08-31 사용자 지시) — 부정확 점도 시간순 점선으로 이어 이동 순서를 읽게 한다
//
// ★ 왜. 실내(기지국·wifi 폴백)에서는 트레일이 정확도 원 무더기로만 남아 "어느 순서로 움직였나" 를
//   읽을 수 없었다(08-31 스크린샷 — 원반경만 보여 동선 파악 불가). R-33(확정 실선은 정확 점만)은
//   그대로 두고, 전체 시퀀스를 **점선** 으로 덧그린다 — 확정처럼 위장하지 않으면서 순서는 보이게.
// ★ 되돌아가는 방식 = 점선이 실선이 되거나(위장), 병합이 시간순을 잃거나, 대시보드가 seq 를 안 넘기거나.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { mergeTrackSeq } from "../app/lib/track";

const ROOT = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const map = codeOnly(read("app", "components", "WorkerGpsMap.tsx"));
const board = codeOnly(read("app", "components", "DemoDashboard.tsx"));

test("① 지도 — 근사 동선 레이어는 점선으로만 긋는다(확정 선 위장 금지)", () => {
  const m = /<svg[^>]*data-testid="worker-trail-seq"[\s\S]*?<\/svg>/.exec(map);
  assert.ok(m, "근사 동선 레이어가 사라졌다");
  const seg = m![0];
  const polylines = seg.match(/<polyline[\s\S]*?\/>/g) ?? [];
  assert.ok(polylines.length >= 1, "점선 폴리라인이 없다");
  for (const p of polylines)
    assert.match(p, /strokeDasharray/, "근사 동선이 실선이 됐다 — 기지국 좌표가 확정 길로 위장된다");
  assert.match(seg, /seqPts\.map/, "점선의 출처가 seq 가 아니다");
});

test("② 지도 — 확정 실선은 여전히 trail.points 로만 긋는다(R-33 유지)", () => {
  assert.match(map, /trailPts = trail\.points\.map/, "확정 선의 출처가 trail.points 가 아니다");
});

test("③ 대시보드 — 부정확 점이 있을 때만 seq 를 병합해 넘긴다", () => {
  assert.match(
    board,
    /seq:\s*trailPoints && trailCoarse && trailCoarse\.length > 0\s*\?\s*mergeTrackSeq\(trailPoints, trailCoarse\)\s*:\s*undefined/,
    "seq 병합·전달이 끊겼다",
  );
});

test("④ 병합 — 정확·부정확 점이 시간순 한 줄이 된다", () => {
  const pts = [
    { lat: 1, lon: 1, ts: "2026-08-31T01:00:00Z" },
    { lat: 3, lon: 3, ts: "2026-08-31T03:00:00Z" },
  ];
  const coarse = [{ lat: 2, lon: 2, accM: 100, ts: "2026-08-31T02:00:00Z" }];
  assert.deepEqual(mergeTrackSeq(pts, coarse), [
    { lat: 1, lon: 1 },
    { lat: 2, lon: 2 },
    { lat: 3, lon: 3 },
  ]);
});

test("⑤ 병합 — ts 없는 부정확 점(옛 응답)은 순서를 지어내지 않고 뺀다", () => {
  const pts = [{ lat: 1, lon: 1, ts: "2026-08-31T01:00:00Z" }];
  const coarse = [{ lat: 9, lon: 9, accM: 100 }];
  assert.deepEqual(mergeTrackSeq(pts, coarse), [{ lat: 1, lon: 1 }]);
});
