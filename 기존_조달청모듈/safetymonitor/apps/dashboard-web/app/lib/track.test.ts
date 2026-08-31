// 트랙 유틸 단위 테스트 — 한국범위 게이트·다운샘플 끝점 보존·소량 통과 + 좌표 메타 요약(D-1).
//
// ★ 좌표 메타(측위 시각·정확도) 부분이 왜 필요한가. 이 레포는 같은 결함을 네 번 냈다 —
//   앱이 보내는 값이 스키마·컬럼·화면 어딘가에서 조용히 사라지는 것(BND-CONTRACT-01 계열).
//   `location_accuracy_m` 은 컬럼과 insert 까지 갔는데 **읽는 SELECT 가 0건**이라 6주간
//   쓰기 전용으로 남아 있었다. 여기서 고정하는 것은 "필드가 있다" 가 아니라
//   **"요약이 그 필드를 실제로 쓴다"** 이다.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  downsampleTrack,
  isKoreaCoord,
  sanitizeTrack,
  summarizeTrackQuality,
  type TrackPoint,
} from "./track";

function mk(n: number): TrackPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    lat: 35.1 + i * 1e-5,
    lon: 126.9 + i * 1e-5,
    ts: new Date(1_700_000_000_000 + i * 2_000).toISOString(),
    fixTs: null,
    accM: null,
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

// ── 좌표 메타(D-1) — 측위 시각·정확도가 이력까지 살아 나가는가 ──────────────

/** 서울 근방 좌표 — 한국 범위 게이트를 통과시키기 위한 고정값. */
const LAT = 35.16;
const LON = 126.85;

function row(ts: string, fixTs: string | null, accM: number | null) {
  return { ts, latitude: LAT, longitude: LON, location_timestamp: fixTs, location_accuracy_m: accM };
}

function pt(ts: string, fixTs: string | null, accM: number | null): TrackPoint {
  return { lat: LAT, lon: LON, ts, fixTs, accM };
}

test("★ 좌표 메타가 없어도 점을 버리지 않는다 — 메타는 게이트가 아니다", () => {
  // 여기서 걸러 버리면 이력이 조용히 짧아진다. 좌표는 멀쩡한데 메타 때문에 사라지는 꼴이라
  // 화면에는 "그 시간대에 안 움직였다" 로 보인다 — 가장 나쁜 실패다.
  const out = sanitizeTrack([row("2026-08-21T00:00:00.000Z", null, null)]);
  assert.equal(out.length, 1, "메타 결손으로 점이 사라졌다");
  assert.equal(out[0]?.fixTs, null);
  assert.equal(out[0]?.accM, null);
});

test("깨진 측위 시각은 점을 죽이지 않고 '미상'으로 눕힌다", () => {
  const out = sanitizeTrack([row("2026-08-21T00:00:00.000Z", "not-a-date", 12)]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.fixTs, null, "파싱 불가를 그대로 실어 나르면 나이 계산이 NaN 이 된다");
  assert.equal(out[0]?.accM, 12, "정확도는 멀쩡한데 함께 버려졌다");
});

test("좌표 메타를 실제로 실어 나른다", () => {
  const out = sanitizeTrack([row("2026-08-21T00:05:00.000Z", "2026-08-21T00:00:00.000Z", 8.5)]);
  assert.equal(out[0]?.fixTs, "2026-08-21T00:00:00.000Z");
  assert.equal(out[0]?.accM, 8.5);
});

test("★ 측위 시각이 없는 점을 0 으로 위장하지 않는다", () => {
  // 이 컬럼 도입 이전 행은 전부 NULL 이다. 그것을 "지연 0초" 로 내면 화면이 거짓말을 한다.
  const q = summarizeTrackQuality([
    pt("2026-08-21T00:00:00.000Z", null, null),
    pt("2026-08-21T00:00:05.000Z", null, null),
  ]);
  assert.equal(q.unknownFix, 2, "미상 건수를 안 센다");
  assert.equal(q.fixAgeMaxSec, null, "잴 수 없는 것을 0 으로 냈다");
  assert.equal(q.points, 2);
});

test("★ 최대 지연을 낸다 — 이어 붙인 좌표가 이력에서 드러나야 한다", () => {
  // 서버 sticky merge 가 좌표를 이어 주므로, 같은 좌표가 새 ts 로 반복되면 트레일은
  // "가만히 서 있었다" 로 그려진다. 실제로는 측위가 40분 전 것일 수 있다.
  const q = summarizeTrackQuality([
    pt("2026-08-21T00:00:10.000Z", "2026-08-21T00:00:00.000Z", null), // 10초
    pt("2026-08-21T00:40:00.000Z", "2026-08-21T00:00:00.000Z", null), // 2400초
    pt("2026-08-21T00:41:00.000Z", "2026-08-21T00:40:30.000Z", null), // 30초
  ]);
  assert.equal(q.fixAgeMaxSec, 2400, "최댓값이 아니라 다른 것을 냈다");
});

test("시계 어긋남(측위가 전송보다 미래)은 0 으로 눕힌다", () => {
  const q = summarizeTrackQuality([pt("2026-08-21T00:00:00.000Z", "2026-08-21T00:00:30.000Z", null)]);
  assert.equal(q.fixAgeMaxSec, 0, "음수 나이를 그대로 냈다 — 미래 측위는 없다");
});

test("정확도 중앙값 — 홀수·짝수", () => {
  const odd = summarizeTrackQuality([
    pt("2026-08-21T00:00:00.000Z", null, 5),
    pt("2026-08-21T00:00:01.000Z", null, 50),
    pt("2026-08-21T00:00:02.000Z", null, 9),
  ]);
  assert.equal(odd.accuracyMedianM, 9, "정렬 안 하고 가운데를 집었다");

  const even = summarizeTrackQuality([
    pt("2026-08-21T00:00:00.000Z", null, 10),
    pt("2026-08-21T00:00:01.000Z", null, 20),
  ]);
  assert.equal(even.accuracyMedianM, 15);
});

test("정확도 미보고 점은 중앙값 계산에서 빠진다(0 으로 안 센다)", () => {
  // 0 으로 세면 "±0m" 라는 있을 수 없는 품질이 나온다.
  const q = summarizeTrackQuality([
    pt("2026-08-21T00:00:00.000Z", null, null),
    pt("2026-08-21T00:00:01.000Z", null, 30),
  ]);
  assert.equal(q.accuracyMedianM, 30);
});

test("빈 구간 요약은 전부 null·0 — 없는 것을 지어내지 않는다", () => {
  const q = summarizeTrackQuality([]);
  assert.deepEqual(q, { points: 0, fixAgeMaxSec: null, unknownFix: 0, accuracyMedianM: null });
});

test("★ 요약은 다운샘플 이전 점으로 내야 한다 — 표본의 분포가 아니라 실제 분포", () => {
  // 이 테스트는 값이 갈린다는 것 자체를 고정한다. 갈리지 않으면 호출 순서를 바꿔도
  // 아무도 안 잡아 주고, 그때부터 화면은 240점의 분포를 전체 분포로 보고하게 된다.
  const points: TrackPoint[] = [];
  for (let i = 0; i < 500; i++) {
    // 한 점만 지연이 크다 — 솎이면 사라지는 종류의 신호.
    const fix = i === 1 ? "2026-08-21T00:00:00.000Z" : `2026-08-21T00:${String(i % 60).padStart(2, "0")}:00.000Z`;
    points.push(pt(`2026-08-21T01:${String(i % 60).padStart(2, "0")}:00.000Z`, fix, 10));
  }
  const before = summarizeTrackQuality(points);
  const after = summarizeTrackQuality(downsampleTrack(points));
  assert.equal(before.points, 500);
  assert.ok(after.points <= 240, "다운샘플이 안 걸렸다 — 이 테스트의 전제가 깨졌다");
  assert.ok(
    before.fixAgeMaxSec !== null && after.fixAgeMaxSec !== null,
    "두 값 모두 나와야 비교가 성립한다",
  );
  assert.ok(
    before.fixAgeMaxSec >= after.fixAgeMaxSec,
    "다운샘플 이후 요약이 이전보다 크다 — 있을 수 없다",
  );
});

// ── 정확도 분할(R-33 · 2026-08-29) — 기지국 좌표가 선에 섞여 없는 길을 그리던 것 ──
import { partitionTrackByAccuracy, TRACK_LINE_ACC_MAX_M } from "./track";

function accPt(accM: number | null, i: number): TrackPoint {
  return { lat: 35.1 + i * 1e-4, lon: 126.9, ts: new Date(1_700_000_000_000 + i * 120_000).toISOString(), fixTs: null, accM };
}

test("partitionTrackByAccuracy — 상한 초과만 coarse 로, 미보고(null)는 선에 남는다", () => {
  const pts = [accPt(12, 0), accPt(null, 1), accPt(200, 2), accPt(TRACK_LINE_ACC_MAX_M, 3), accPt(1366, 4), accPt(40, 5)];
  const { line, coarse } = partitionTrackByAccuracy(pts);
  assert.deepEqual(line.map((p) => p.accM), [12, null, TRACK_LINE_ACC_MAX_M, 40]);
  assert.deepEqual(coarse.map((p) => p.accM), [200, 1366]);
});

test("partitionTrackByAccuracy — 순서 보존·점 손실 0·빈 입력", () => {
  const pts = [accPt(100, 0), accPt(10, 1), accPt(300, 2), accPt(20, 3)];
  const { line, coarse } = partitionTrackByAccuracy(pts);
  assert.equal(line.length + coarse.length, pts.length);
  assert.deepEqual(line.map((p) => p.lat), [pts[1]!.lat, pts[3]!.lat]);
  assert.deepEqual(coarse.map((p) => p.lat), [pts[0]!.lat, pts[2]!.lat]);
  assert.deepEqual(partitionTrackByAccuracy([]), { line: [], coarse: [] });
});

test("TRACK_LINE_ACC_MAX_M — 위성 p90(≈40m)과 기지국 최소(≈100m) 사이", () => {
  assert.ok(TRACK_LINE_ACC_MAX_M >= 30 && TRACK_LINE_ACC_MAX_M < 100, `상한 ${TRACK_LINE_ACC_MAX_M}m 가 근거 구간 밖이다`);
});
