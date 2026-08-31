// 판정 정확도 게이트 가드 — 부정확 좌표가 구획·위험구역 상태머신을 움직이지 않는가
//
// ★ 왜 필요한가(2026-08-31 실사고). 작업자가 현장 실내에 있는데 "구획 이탈 +140m" 경보가
//   떴다. 워치가 위성 신호를 못 잡아 셀/와이파이 폴백 좌표(acc=100m 등급 · 양자화 지점
//   42~352m 왕복)를 보고했고, 판정은 그 가짜 좌표를 그대로 믿었다. 처방 = R-33 상한(트레일
//   선 필터와 같은 상수)보다 나쁜 좌표는 화면·서버 어느 판정도 전진시키지 않는다.
//   미보고(null)는 통과 — 정확도를 안 싣던 구 경로의 종전 동작을 보존한다.
//
// ★ 이 가드가 초록일 때 보장하는 것(한 문장) —
//   **게이트 술어는 한 곳(fixUsableForJudgment)이고 문턱은 트레일과 같은 상수이며, 화면의
//   구획·위험구역 두 판정과 서버 리플레이가 모두 그것을 통과한 좌표만 쓰고, 부정확 좌표는
//   에피소드 근거(lastInsideTs)로도 안 쓰인다.** 보장하지 않는 것 = 실외 fix 포착 지연의 크기.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { fixUsableForJudgment } from "../app/lib/geofence";
import { TRACK_LINE_ACC_MAX_M } from "../app/lib/track";
import { replayGeofence, type GpsFix } from "./geofence-watch";
// 주석 제거는 정본 헬퍼로만 — 순진한 정규식은 URL 의 `//` 를 먹어 거짓 초록을 만든다([[L-119]]).
import { stripComments } from "./test-support/strip-comments";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (...p: string[]) => stripComments(readFileSync(join(here, ...p), "utf8"));

const board = read("..", "app", "components", "DemoDashboard.tsx");
const watch = read("geofence-watch.ts");
const db = read("db.ts");
const geo = read("..", "app", "lib", "geofence.ts");

const C = { lat: 35.1505, lon: 126.9162 };
const R = 100;
const north = (m: number) => C.lat + m / 111_320;
const fix = (i: number, m: number, accM?: number | null): GpsFix => ({
  workerId: "W1",
  workerName: "테스터",
  ts: new Date(Date.UTC(2026, 7, 31, 1, i, 0)).toISOString(),
  lat: north(m),
  lon: C.lon,
  accM,
});

// ── ① 술어 — 문턱은 공유 상수, 미보고는 통과 ───────────────────────────────
test("★★ fixUsableForJudgment — 상한 초과만 거르고 미보고는 종전 동작(통과)", () => {
  assert.equal(fixUsableForJudgment(100), false, "±100m 폴백이 판정에 들어간다 — 오탐 경보 재발");
  assert.equal(fixUsableForJudgment(TRACK_LINE_ACC_MAX_M), true, "상한 경계값이 거부된다");
  assert.equal(fixUsableForJudgment(13), true, "위성 fix(실측 13m)가 거부된다");
  assert.equal(fixUsableForJudgment(null), true, "미보고를 거부한다 — 구 경로가 판정 불능이 된다");
  assert.equal(fixUsableForJudgment(undefined), true);
  // 문턱이 리터럴로 갈리지 않는다 — 술어 본문은 상수 비교여야 한다.
  assert.match(geo, /accM <= TRACK_LINE_ACC_MAX_M/, "술어가 공유 상수를 안 쓴다");
});

// ── ② 서버 리플레이 — 부정확 좌표는 판정에도 에피소드 근거에도 안 쓴다 ─────
test("★★ 폴백 좌표만으로는 이탈이 확정되지 않는다(08-31 오탐 재현 방지)", () => {
  // 실사고 형태: 전부 acc=100 · 중심에서 240m 급 — 종전엔 3연속으로 이탈 확정됐다.
  const v = replayGeofence([fix(0, 240, 100), fix(1, 240, 100), fix(2, 240, 100), fix(3, 240, 100)], C, R)[0]!;
  assert.equal(v.outside, false, "부정확 좌표가 이탈을 확정했다");
  assert.equal(v.usedFixes, 0, "게이트에 걸린 표본이 판정 표본으로 집계됐다");
  // 통제군 — 같은 거리라도 정확도가 좋으면 종전대로 확정된다.
  const good = replayGeofence([fix(0, 240, 13), fix(1, 240, 20), fix(2, 240, 33)], C, R)[0]!;
  assert.equal(good.outside, true, "정확한 좌표의 진짜 이탈까지 막았다 — 게이트 과잉");
});

test("★★ 부정확 '안' 좌표는 에피소드를 끊지 못한다 — 가짜 안 관측이 재알림을 연다", () => {
  const out3 = [fix(0, 300, 20), fix(1, 300, 20), fix(2, 300, 20)];
  const coarseIn = fix(3, 10, 100); // 확실히 안쪽이지만 ±100m — 믿을 수 없다
  const v = replayGeofence([...out3, coarseIn, fix(4, 300, 20)], C, R)[0]!;
  assert.equal(v.outside, true);
  assert.equal(v.lastInsideTs, null, "부정확 안 관측이 lastInsideTs 로 잡혔다");
  // 통제군 — 정확한 안 관측은 잡힌다.
  const goodIn = fix(3, 10, 20);
  const w = replayGeofence([...out3, goodIn, fix(4, 300, 20)], C, R)[0]!;
  assert.equal(w.lastInsideTs, goodIn.ts, "정확한 안 관측까지 막았다");
});

test("★ 미보고(accM 없음) 표본은 종전대로 판정된다 — 구 경로 회귀 방지", () => {
  const v = replayGeofence([fix(0, 300), fix(1, 300), fix(2, 300)], C, R)[0]!;
  assert.equal(v.outside, true, "미보고 표본이 판정 불능이 됐다");
});

// ── ③ 배선 — 화면 두 판정·DB 조회 ──────────────────────────────────────────
test("★★ 화면의 구획·위험구역 두 판정 루프가 같은 게이트를 지난다", () => {
  const hits = board.split("if (!fixUsableForJudgment(pt.accM)) continue;").length - 1;
  assert.equal(hits, 2, `화면 게이트가 ${hits}곳 — 구획·위험구역 두 곳이어야 한다`);
  const gateAt = board.indexOf("if (!fixUsableForJudgment(pt.accM)) continue;");
  const stepAt = board.indexOf("stepGeofence(");
  assert.ok(gateAt !== -1 && stepAt !== -1 && gateAt < stepAt, "게이트가 판정 호출 앞에 있지 않다");
});

test("★ 서버 게이트는 표본 집계보다 앞이고, DB 조회가 정확도를 싣는다", () => {
  const loop = watch.slice(watch.indexOf("for (const f of list)"));
  assert.ok(loop.indexOf("fixUsableForJudgment(f.accM)") < loop.indexOf("used += 1"),
    "게이트가 used 집계 뒤에 있다 — 걸러진 표본이 판정 근거 수로 보인다");
  const fn = db.slice(db.indexOf("export async function recentGpsFixes"));
  assert.match(fn.slice(0, 900), /location_accuracy_m/, "recentGpsFixes 가 정확도를 안 읽는다 — 서버 게이트가 전부 통과가 된다");
});
