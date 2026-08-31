// 마커 "마지막 정확 fix" 폴백 가드(2026-08-31 사용자 결정 ①) — 실내 폴백 좌표가 최신일 때
// 마커가 245m 튀지 않게, 최근 창 안의 정확 fix 위치를 우선한다
//
// ★ 왜. 15:20 실측 — 최신 표본이 ±100m 기지국 좌표(실제 위치에서 245m)인데 6분 전 ±13m 위성
//   fix 가 있었다. 마커 규칙이 "최신 표본 무조건" 이라 더 정확한 최근 위치를 버리고 있었다.
//   판정(구획/위험구역)은 이미 게이트(fixUsableForJudgment)로 같은 철학을 쓴다 — 표시만 따라간 것.
// ★ 되돌아가는 방식 = 서버가 힌트를 안 얹거나(필드명 드리프트 포함), 마스킹이 새 좌표를 남기거나,
//   폴백이 창·상한 없이 무조건이 되거나, 정확도 원이 마커를 따라가 "최신 신호 근방" 사실이 지워지거나,
//   판정 effect 가 폴백 좌표를 읽거나.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { VitalSample } from "@safetymonitor/schemas";

import { mergeLatestByWorker } from "../app/api/app/vital/store";

const ROOT = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const store = codeOnly(read("app", "api", "app", "vital", "store.ts"));
const route = codeOnly(read("app", "api", "app", "vital", "route.ts"));
const board = codeOnly(read("app", "components", "DemoDashboard.tsx"));
const map = codeOnly(read("app", "components", "WorkerGpsMap.tsx"));

const s = (partial: Partial<VitalSample> & { workerId: string; ts: string }): VitalSample =>
  partial as VitalSample;

test("① 병합 — 정확 fix 를 기억하고, 최신 좌표(부정확)는 그대로 둔다", () => {
  const [m] = mergeLatestByWorker([
    s({
      workerId: "EMP-1", ts: "2026-08-31T05:55:00Z",
      latitude: 35.1505, longitude: 126.9161, locationAccuracyMeters: 13,
      locationTimestamp: "2026-08-31T05:54:50Z",
    }),
    s({
      workerId: "EMP-1", ts: "2026-08-31T06:20:00Z",
      latitude: 35.1493, longitude: 126.9183, locationAccuracyMeters: 100,
    }),
  ]);
  assert.equal(m!.latitude, 35.1493, "최신 좌표(원좌표)가 바뀌면 안 된다 — 폴백은 표시 힌트다");
  assert.equal(m!.lastAccurateLat, 35.1505);
  assert.equal(m!.lastAccurateLon, 126.9161);
  assert.equal(m!.lastAccurateAccM, 13);
  assert.equal(m!.lastAccurateTs, "2026-08-31T05:54:50Z", "나이 기준은 측위 시각(locationTimestamp)");
});

test("② 병합 — 부정확·미보고만 있으면 힌트를 지어내지 않는다", () => {
  const [coarseOnly] = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-08-31T06:00:00Z", latitude: 35.1, longitude: 126.9, locationAccuracyMeters: 100 }),
  ]);
  assert.equal(coarseOnly!.lastAccurateLat, undefined);
  const [noAcc] = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-08-31T06:00:00Z", latitude: 35.1, longitude: 126.9 }),
  ]);
  assert.equal(noAcc!.lastAccurateLat, undefined, "정확도 미보고 좌표는 '정확한 위치' 자격이 없다");
});

test("③ 병합 — 백로그 역순 삽입에도 행 ts 로 최신 정확 fix 를 고른다", () => {
  const [m] = mergeLatestByWorker([
    s({
      workerId: "EMP-1", ts: "2026-08-31T06:10:00Z",
      latitude: 35.2, longitude: 126.8, locationAccuracyMeters: 20,
    }),
    // 더 오래된 정확 fix 가 나중에 삽입(오프라인 backlog) — 최신(06:10)을 덮으면 안 된다.
    s({
      workerId: "EMP-1", ts: "2026-08-31T05:00:00Z",
      latitude: 35.9, longitude: 126.1, locationAccuracyMeters: 10,
    }),
  ]);
  assert.equal(m!.lastAccurateLat, 35.2);
});

test("④ 서버 소스 — 자격은 공유 상수(R-33)로만 판정하고, 마스킹은 폴백 좌표도 지운다", () => {
  assert.match(store, /sample\.locationAccuracyMeters <= TRACK_LINE_ACC_MAX_M/, "자격 상한이 공유 상수가 아니다");
  assert.doesNotMatch(store, /locationAccuracyMeters <= 50\b/, "상한 리터럴 50 이 박혔다 — 상수와 표류한다");
  assert.match(
    route,
    /latitude, longitude, lastAccurateLat, lastAccurateLon, \.\.\.rest/,
    "redactPii 가 lastAccurate 좌표를 안 지운다 — 좌표 마스킹이 뚫린다",
  );
});

test("⑤ 대시보드 — 폴백은 부정확+창 안 정확 fix 일 때만, 판정 effect 는 원좌표만 본다", () => {
  assert.match(board, /s\.locationAccuracyMeters != null && s\.locationAccuracyMeters > TRACK_LINE_ACC_MAX_M/, "부정확 조건이 사라졌다 — 정확 fix 가 최신인데도 과거 위치로 덮인다");
  assert.match(board, /goodAgeSec <= TRACK_WINDOW_MIN \* 60/, "창 조건이 사라졌다 — 몇 시간 전 위치가 현재로 위장된다");
  assert.doesNotMatch(board, /pt\.goodLat/, "판정 effect 가 폴백 좌표를 읽는다 — 판정은 원좌표+게이트가 계약이다");
});

test("⑥ 지도 — 마커는 폴백 우선, 정확도 원은 원좌표에 닻을 내린다", () => {
  assert.match(map, /p\.goodLat != null && p\.goodLon != null \? lonToWorldX\(p\.goodLon, z\) - tlx : rawX/, "마커가 폴백을 우선하지 않는다");
  assert.match(map, /markers\.push\(\{ p, x, y, accR, rawX, rawY \}\)/, "원좌표가 마커 배열에서 사라졌다");
  const seg = /<svg[^>]*data-testid="worker-marker-accuracy"[\s\S]*?<\/svg>/.exec(map);
  assert.ok(seg, "정확도 원 레이어가 사라졌다");
  assert.match(seg![0], /cx=\{rawX\}/, "정확도 원이 마커를 따라간다 — '최신 신호는 이 근방' 사실이 지워진다");
});
