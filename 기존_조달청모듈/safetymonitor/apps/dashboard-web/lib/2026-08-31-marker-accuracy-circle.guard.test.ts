// 마커 정확도 원 가드(R-33 확장) — 부정확 현재 위치가 정밀한 점으로 위장하지 않는가
//
// ★ 왜 필요한가(2026-08-31 실사고). 작업자가 현장 실내에 있는데 지도 마커는 수백 m 밖을
//   찍었다. DB 실측: 워치가 위성 신호를 못 잡아 셀/와이파이 폴백 좌표(정확도 ±100m 등급)로
//   떨어졌고, 양자화된 지점 2~3곳(중심 42~352m)을 왕복했다. R-33 처방(부정확 점 = 반경=정확도
//   원)이 **트레일에만** 있고 현재 위치 마커는 `locationAccuracyMeters` 를 한 줄도 안 읽어
//   ±100m 좌표가 정밀한 점처럼 보였다 — 관제자는 "전혀 다른 위치" 로 읽는다.
//
// ★ 이 가드가 초록일 때 보장하는 것(한 문장) —
//   **마커 정확도는 대시보드→지도로 전달되고, 부정확(> R-33 상한 상수) 마커에만 지리 반경의
//   원이 그려지며, 문턱은 리터럴이 아니라 트레일과 같은 상수이고, 미보고는 미보고로 표기된다.**
//   보장하지 않는 것 = 원이 시각적으로 읽기 좋은가. 그것은 라이브에서 눈으로 본다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { TRACK_LINE_ACC_MAX_M } from "../app/lib/track";
// 주석 제거는 정본 헬퍼로만 — 순진한 정규식은 URL 의 `//` 를 먹어 거짓 초록을 만든다([[L-119]]).
import { stripComments } from "./test-support/strip-comments";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (...p: string[]) => stripComments(readFileSync(join(here, ...p), "utf8"));

const map = read("..", "app", "components", "WorkerGpsMap.tsx");
const board = read("..", "app", "components", "DemoDashboard.tsx");

test("★★ 대시보드가 측위 정확도를 지도에 전달한다 — 안 읽으면 위장이 재발한다", () => {
  assert.match(board, /accM: s\.locationAccuracyMeters \?\? null/,
    "workerMapData 가 locationAccuracyMeters 를 전달하지 않는다");
  assert.match(map, /accM\?: number \| null/, "WorkerMapPoint 에 accM 필드가 없다");
});

test("★★ 부정확 판별은 트레일과 같은 상수다 — 리터럴이면 두 문턱이 조용히 갈린다", () => {
  assert.match(map, /p\.accM != null && p\.accM > TRACK_LINE_ACC_MAX_M/,
    "마커 원 게이트가 TRACK_LINE_ACC_MAX_M 상수가 아니다");
  // 상수 자체는 R-33 근거 구간(30~99m) 안 — track 가드와 이중 확인.
  assert.ok(TRACK_LINE_ACC_MAX_M >= 30 && TRACK_LINE_ACC_MAX_M < 100,
    `상한 ${TRACK_LINE_ACC_MAX_M}m 가 근거 구간 밖이다`);
});

test("★ 원 반경은 지리값(정확도/metersPerPx) — 줌과 함께 스케일돼야 거리로 읽힌다", () => {
  // 트레일 coarse 와 같은 식이 마커에도 있어야 한다(두 곳 이상).
  const hits = map.split("Math.max(4, p.accM / metersPerPx(p.lat))").length - 1;
  assert.ok(hits >= 2, `반경 환산식이 ${hits}곳뿐 — 마커 쪽이 픽셀 고정 반경으로 퇴행했다`);
  assert.match(map, /data-testid="worker-marker-accuracy"/, "정확도 원 레이어가 없다");
  const at = map.indexOf('data-testid="worker-marker-accuracy"');
  const layer = map.slice(Math.max(0, at - 300), at + 300);
  assert.match(layer, /pointer-events-none/, "정확도 원이 마커 클릭·드래그를 삼킨다");
});

test("★ 툴팁 — 부정확은 ±m 로 경고색, 미보고는 미보고로 적는다(0 이나 정밀로 위장 금지)", () => {
  assert.match(map, /±\$\{Math\.round\(p\.accM\)\}m/, "툴팁에 측위 정확도 숫자가 없다");
  assert.match(map, /정확도 미보고/, "미보고를 빈 값·정밀로 위장한다");
});
