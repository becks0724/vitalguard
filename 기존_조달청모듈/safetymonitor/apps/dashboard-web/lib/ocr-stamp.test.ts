// OCR 사진 하단 스탬프 파서 단위 테스트 — 실제 오인식 샘플 포함.
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseOcrStamp } from "./ocr-stamp";

// 스크린샷 실측 OCR(터미널 화면 촬영 + 하단 스탬프, 라벨 오인식 포함).
const GARBLED = `페이지 1
Cursor
g • 8%
7 (79 1653666 push)
db.ts getCalendarMediaById
36 Esc to focus or unfocus Claude
[2026-07-01 10:56:02]
0E/7E: 35.169862, 126.863702
tOX/ID: NÇZ, admin6861, EMP-6861`;

test("스탬프 — 촬영시각/GPS/작업자ID 추출(라벨 오인식 무관)", () => {
  const s = parseOcrStamp(GARBLED);
  assert.equal(s.capturedAt, "2026-07-01 10:56");
  assert.equal(s.gps, "35.169862, 126.863702");
  assert.equal(s.workerId, "EMP-6861"); // admin6861 보다 EMP-#### 우선
  assert.equal(s.roadAddress, null); // 이 샘플엔 주소 없음
});

test("스탬프 — 도로명 주소 줄 추출", () => {
  const s = parseOcrStamp(
    `[2026-06-30 14:23:11]
광주광역시 광산구 하남산단6번로 107
35.169862, 126.863702
작업자/ID: 장우진, EMP-6861`,
  );
  assert.equal(s.capturedAt, "2026-06-30 14:23");
  assert.equal(s.roadAddress, "광주광역시 광산구 하남산단6번로 107");
  assert.equal(s.gps, "35.169862, 126.863702");
  assert.equal(s.workerId, "EMP-6861");
});

test("스탬프 — 구분자 변형(슬래시 날짜)", () => {
  const s = parseOcrStamp("촬영 2026/7/1 9:05 · 위치 37.5665, 126.9780");
  assert.equal(s.capturedAt, "2026-07-01 09:05");
  assert.equal(s.gps, "37.5665, 126.9780"); // 서울(한국 범위)
});

test("스탬프 — 한국 범위 좌표쌍 우선 선택", () => {
  // 앞의 비-한국 쌍(0.1234, 0.5678)은 건너뛰고 한국 좌표를 고른다.
  const s = parseOcrStamp("noise 0.1234, 0.5678 end\n35.169862, 126.863702");
  assert.equal(s.gps, "35.169862, 126.863702");
});

test("스탬프 — 좌표/시각 없으면 null, 버전문자열 오탐 없음", () => {
  const s = parseOcrStamp("health 13.3.1 build ok\nno stamp here");
  assert.equal(s.capturedAt, null);
  assert.equal(s.gps, null);
  assert.equal(s.workerId, null);
  assert.equal(s.roadAddress, null);
});

test("스탬프 — 빈 입력", () => {
  const s = parseOcrStamp(null);
  assert.deepEqual(s, {
    capturedAt: null,
    gps: null,
    workerId: null,
    roadAddress: null,
  });
});
