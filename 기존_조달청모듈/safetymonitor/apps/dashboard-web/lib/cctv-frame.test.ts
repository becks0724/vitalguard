// CAM-03 서버 중계 순수 헬퍼 시험 — 토큰 비교·통계 화이트리스트·신선도. 통제군(깨져야 하는 입력)을 같이 둔다.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  bearerFromHeader, cameraIdForSuffix, frameAgeSec, frameStaleSec, ingestTokenMatches,
  isStale, parseIngestStats, publicStats, MAX_JPEG_BYTES,
} from "./cctv-frame";

test("cameraIdForSuffix — 한 자리 숫자만 카메라가 된다", () => {
  assert.equal(cameraIdForSuffix("3"), "CAM-03");
  assert.equal(cameraIdForSuffix("1"), "CAM-01");
  // 통제군 — 두 자리·문자·빈값은 카메라가 아니다
  assert.equal(cameraIdForSuffix("13"), null);
  assert.equal(cameraIdForSuffix("x"), null);
  assert.equal(cameraIdForSuffix(""), null);
});

test("bearerFromHeader — Bearer 접두사와 값만 받는다", () => {
  assert.equal(bearerFromHeader("Bearer abc.def"), "abc.def");
  assert.equal(bearerFromHeader("Bearer   "), null);
  assert.equal(bearerFromHeader("Basic abc"), null);
  assert.equal(bearerFromHeader(null), null);
});

test("ingestTokenMatches — 같으면 true, 다르면 false, env 비면 항상 false(soft 모드 없음)", () => {
  assert.equal(ingestTokenMatches("s3cret", "s3cret"), true);
  assert.equal(ingestTokenMatches("s3cret", "S3CRET"), false);
  assert.equal(ingestTokenMatches("s3cre", "s3cret"), false, "길이가 다르면 false");
  // ★ 통제군 — env 가 없을 때 무토큰·유토큰 어느 쪽도 통과하면 안 된다
  assert.equal(ingestTokenMatches(null, undefined), false);
  assert.equal(ingestTokenMatches("anything", undefined), false);
  assert.equal(ingestTokenMatches("anything", ""), false);
});

test("parseIngestStats — 푸셔 쿼리 키를 게이트 응답 키로 옮긴다 · worker/unknown 은 있을 때만", () => {
  const p = new URLSearchParams("drawn=1&persons=2&violations=1&compliance=50&hardhat=1&no_hardhat=1&engine=v7e");
  const s = parseIngestStats(p);
  assert.deepEqual(s, {
    person_count: 2, violation_count: 1, compliance_rate: 50,
    hardhat_count: 1, no_hardhat_count: 1, engine: "v7e",
  });
  assert.equal("worker_count" in s, false, "푸셔가 안 보낸 키는 만들지 않는다 — 0 으로 채우면 화면이 0명으로 그린다");
  assert.equal("zone_on" in s, false, "옛 푸셔(zone 안 보냄)는 zone_on 도 없다 — false 로 채우면 「구역 꺼짐」으로 읽힌다");
  const p2 = new URLSearchParams("persons=3&worker=1&unknown=0&zone=1&engine=" + "x".repeat(40));
  const s2 = parseIngestStats(p2);
  assert.equal(s2.worker_count, 1);
  assert.equal(s2.unknown_count, 0);
  assert.equal(s2.zone_on, true);
  assert.equal(parseIngestStats(new URLSearchParams("zone=0")).zone_on, false, "구역 꺼짐이면 false — worker_count 가 person_count 값이라는 표식");
  assert.equal(s2.engine.length, 24, "engine 은 게이트와 같이 24자에서 자른다");
  // 통제군 — 숫자가 아닌 값은 기본값으로
  const s3 = parseIngestStats(new URLSearchParams("persons=abc&compliance="));
  assert.equal(s3.person_count, 0);
  assert.equal(s3.compliance_rate, 100);
});

test("publicStats — 화이트리스트 밖 키는 나가지 않는다 · 숫자 없으면 0 · engine 없으면 빈 문자열", () => {
  const out = publicStats({
    person_count: 2, worker_count: 1, engine: "v7e",
    fall_count: 9, pose_detail: { x: 1 }, gopro: { ip: "172.23.102.51" }, ZZZ_secret: 1,
  });
  assert.deepEqual(Object.keys(out).sort(), [
    "compliance_rate", "engine", "hardhat_count", "no_hardhat_count",
    "person_count", "unknown_count", "violation_count", "worker_count",
  ]);
  assert.equal(out.person_count, 2);
  assert.equal(out.worker_count, 1);
  assert.equal(out.unknown_count, 0);
  assert.equal(out.engine, "v7e");
  // 통제군 — 진단 정보는 어떤 이름으로도 새지 않는다
  for (const k of ["fall_count", "pose_detail", "gopro", "ZZZ_secret"]) assert.equal(k in out, false, k);
  const empty = publicStats(null);
  assert.equal(empty.engine, "");
  assert.equal(empty.violation_count, 0);
});

test("frameAgeSec · isStale — 기본 15초 · 시각을 못 읽으면 stale", () => {
  const now = Date.parse("2026-09-16T09:00:15.000Z");
  assert.equal(frameAgeSec("2026-09-16T09:00:10.000Z", now), 5);
  assert.equal(isStale(5, 15), false);
  assert.equal(isStale(15, 15), true, "경계값은 stale — 15초 지난 프레임은 살아 있다고 하지 않는다");
  assert.equal(isStale(frameAgeSec("not-a-date", now)), true);
  // env 기본값과 오염값
  const saved = process.env.CCTV_FRAME_STALE_SEC;
  try {
    delete process.env.CCTV_FRAME_STALE_SEC;
    assert.equal(frameStaleSec(), 15);
    process.env.CCTV_FRAME_STALE_SEC = "30";
    assert.equal(frameStaleSec(), 30);
    process.env.CCTV_FRAME_STALE_SEC = "-1";
    assert.equal(frameStaleSec(), 15, "음수·0·NaN 은 기본값으로");
  } finally {
    if (saved === undefined) delete process.env.CCTV_FRAME_STALE_SEC;
    else process.env.CCTV_FRAME_STALE_SEC = saved;
  }
});

test("MAX_JPEG_BYTES — 푸셔 40KB 의 여유 6배 = 256KB", () => {
  assert.equal(MAX_JPEG_BYTES, 262144);
});
