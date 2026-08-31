// 경로 정확도 필터 가드(R-33) — 부정확 좌표가 선으로 이어지지 않고, 버려지지도 않는다
//
// ★ 왜 (2026-08-29). 워치 FUSED 공급자는 위성(±12~40m)과 기지국(±100·200·300·1,366m) 좌표를 한 줄에 섞어 보낸다.
//   지도는 정확도 중앙값을 캡션에 적을 뿐 점을 거르지 않아, 도보 불가 속도(>15km/h) 8구간 중 7이 정확도 >50m 점이었고
//   사용자가 "동선과 상반된다" 고 짚은 500m 점프가 그것이었다. 처방 = 선은 정확도 ≤ 상한만 · 초과는 반경=정확도 원.
// ★ 되돌아가는 방식은 값이 아니라 **배선**이다(라우트가 분할을 빼거나, 지도가 coarse 를 선에 다시 넣거나, 캡션이 사라지거나).
//   그래서 소스를 읽어 못 박는다. 주석에 이름만 남는 것을 막으려고 코드 본문만 본다.
// ★ 08-31 보완(사용자 지시): 근사 동선 **점선**(worker-trail-seq · 전용 가드 2026-08-31-trail-seq-line)은
//   예외로 전체 시퀀스를 잇는다. 이 파일의 계약은 "확정 실선은 coarse 를 잇지 않는다" 로 유지된다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const lib = codeOnly(read("app", "lib", "track.ts"));
const route = codeOnly(read("app", "api", "monitor", "track", "route.ts"));
const map = codeOnly(read("app", "components", "WorkerGpsMap.tsx"));
const board = codeOnly(read("app", "components", "DemoDashboard.tsx"));

test("① 라우트 — 선은 분할의 line 만 솎고, coarse 는 버리지 않고 함께 응답한다", () => {
  assert.match(route, /const \{ line, coarse: coarseAll \} = partitionTrackByAccuracy\(all\)/, "분할이 라우트에서 사라졌다");
  assert.match(route, /const points = downsampleTrack\(line\)/, "선이 전체 점으로 되돌아갔다 — 기지국 좌표가 다시 이어진다");
  assert.match(route, /const coarse = downsampleTrack\(coarseAll\)/, "부정확 점이 버려진다 — 데이터 손실");
  assert.match(route, /\{ ok: true, workerId, mins, points, coarse, quality \}/, "응답에 coarse 가 없다");
  // 품질 요약은 분할·다운샘플 **이전** 전체 점으로 — 표본의 분포를 전체로 보고하면 안 된다.
  assert.ok(route.indexOf("summarizeTrackQuality(all)") < route.indexOf("partitionTrackByAccuracy(all)"), "요약이 분할 뒤로 밀렸다");
});

test("② 유틸 — 미보고(null)는 선에 남고 상한은 근거 구간(30~99m) 안", () => {
  const fn = lib.slice(lib.indexOf("export function partitionTrackByAccuracy"));
  assert.match(fn, /p\.accM === null \|\| p\.accM <= TRACK_LINE_ACC_MAX_M/, "null 을 선에서 빼거나 경계가 바뀌었다");
  const m = /export const TRACK_LINE_ACC_MAX_M = (\d+);/.exec(lib);
  assert.ok(m, "상한 상수가 사라졌다");
  const v = Number(m![1]);
  assert.ok(v >= 30 && v < 100, `상한 ${v}m 가 근거 구간 밖이다`);
});

test("③ 지도 — 폴리라인은 trail.points 로만 긋고, coarse 는 반경=정확도 원으로 따로 그린다", () => {
  assert.match(map, /trailPts = trail\.points\.map/, "선의 출처가 trail.points 가 아니다");
  const polylines = map.match(/<polyline[\s\S]*?\/>/g) ?? [];
  assert.ok(polylines.length >= 2, "트레일 폴리라인이 없다");
  for (const p of polylines) assert.doesNotMatch(p, /coarse/i, "폴리라인이 coarse 를 잇는다 — 없는 길을 그린다");
  assert.match(map, /coarsePts = trail\.coarse\.map/, "부정확 점을 지도가 안 받는다");
  assert.match(map, /r: Math\.max\(4, p\.accM \/ metersPerPx\(p\.lat\)\)/, "원의 반경이 정확도가 아니다");
  assert.match(map, /data-testid="worker-trail-coarse"/, "부정확 점 레이어가 사라졌다");
  // 08-31 사용자 지시 — 부정확 점을 점선으로 잇게 되면서 캡션도 "선 제외" → "점선 근사" 로 사실에 맞췄다.
  assert.match(map, /부정확 \$\{trail\.coarse\.length\}점 점선 근사/, "캡션이 부정확 점의 표기 방식을 안 알린다");
});

test("④ 대시보드 — 응답의 coarse 를 지도까지 넘긴다(끊기면 옛 서버처럼 전부 선으로 그린다)", () => {
  assert.match(board, /setTrailCoarse\(Array\.isArray\(j\.coarse\) \? j\.coarse : null\)/, "응답의 coarse 를 안 받는다");
  assert.match(board, /coarse: trailCoarse \?\? undefined,/, "지도 prop 으로 coarse 를 안 넘긴다");
});
