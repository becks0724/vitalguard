// 트랙 유틸 단위 테스트 — 한국범위 게이트·다운샘플 끝점 보존·소량 통과.
import assert from "node:assert/strict";
import { test } from "node:test";

import { downsampleTrack, isKoreaCoord, sanitizeTrack, type TrackPoint } from "./track";

function mk(n: number): TrackPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    lat: 35.1 + i * 1e-5,
    lon: 126.9 + i * 1e-5,
    ts: new Date(1_700_000_000_000 + i * 2_000).toISOString(),
  }));
}

test("한국범위 게이트 — 국내 좌표 통과·해외/비유한 좌표 거부", () => {
  assert.equal(isKoreaCoord(35.15, 126.92), true);
  assert.equal(isKoreaCoord(37.785, -122.4), false); // 시뮬레이터 SF 기본좌표
  assert.equal(isKoreaCoord(Number.NaN, 126.9), false);
});

test("sanitizeTrack — null 좌표·범위 밖·잘못된 ts 를 걸러낸다", () => {
  const rows = [
    { ts: "2026-07-22T01:00:00.000Z", latitude: 35.15, longitude: 126.92 },
    { ts: "2026-07-22T01:00:02.000Z", latitude: null, longitude: 126.92 },
    { ts: "2026-07-22T01:00:04.000Z", latitude: 37.785, longitude: -122.4 },
    { ts: "not-a-date", latitude: 35.15, longitude: 126.92 },
    { ts: "2026-07-22T01:00:06.000Z", latitude: 35.151, longitude: 126.921 },
  ];
  const pts = sanitizeTrack(rows);
  assert.equal(pts.length, 2);
  assert.equal(pts[0]?.lat, 35.15);
  assert.equal(pts[1]?.lon, 126.921);
});

test("다운샘플 — 상한 이하면 그대로 반환", () => {
  const pts = mk(100);
  assert.equal(downsampleTrack(pts, 240), pts);
});

test("다운샘플 — 상한 초과 시 개수 상한 + 첫/마지막 점 보존", () => {
  const pts = mk(900);
  const out = downsampleTrack(pts, 240);
  assert.equal(out.length, 240);
  assert.deepEqual(out[0], pts[0]);
  assert.deepEqual(out[out.length - 1], pts[pts.length - 1]);
});

test("다운샘플 — 시간 순서 유지(단조 증가)", () => {
  const out = downsampleTrack(mk(901), 50);
  for (let i = 1; i < out.length; i++) {
    assert.ok(Date.parse(out[i]!.ts) > Date.parse(out[i - 1]!.ts));
  }
});

test("다운샘플 — maxPoints 2 미만은 원본 유지(방어)", () => {
  const pts = mk(10);
  assert.equal(downsampleTrack(pts, 1), pts);
});

test("빈 입력은 빈 배열", () => {
  assert.deepEqual(sanitizeTrack([]), []);
  assert.deepEqual(downsampleTrack([], 240), []);
});
