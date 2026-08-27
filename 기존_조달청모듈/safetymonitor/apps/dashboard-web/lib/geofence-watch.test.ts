// replayGeofence 동작 시험 — 저장된 표본만으로 이탈 상태를 재구성하는가.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { replayGeofence, type GpsFix } from "./geofence-watch";

const C = { lat: 35.1505, lon: 126.9162 };
const R = 100;
// 위도 1도 ≈ 111,320m — 북쪽으로 m 만큼 옮긴 좌표.
const north = (m: number) => C.lat + m / 111_320;
const fix = (i: number, m: number, id = "W1"): GpsFix => ({
  workerId: id,
  workerName: "테스터",
  ts: new Date(Date.UTC(2026, 7, 27, 0, i, 0)).toISOString(),
  lat: north(m),
  lon: C.lon,
});

test("① 연속 3회를 채워야 이탈이다 — 2회로는 안 울린다", () => {
  const two = replayGeofence([fix(0, 300), fix(1, 300)], C, R);
  assert.equal(two[0]!.outside, false, "2회만에 이탈로 확정됐다");
  const three = replayGeofence([fix(0, 300), fix(1, 300), fix(2, 300)], C, R);
  assert.equal(three[0]!.outside, true, "3회를 채웠는데 이탈이 아니다");
});

test("② ★ 이탈 ts 는 전이가 일어난 표본의 것 — 크론 재실행 dedup 의 근거", () => {
  const fixes = [fix(0, 300), fix(1, 300), fix(2, 300), fix(3, 300), fix(4, 300)];
  const a = replayGeofence(fixes, C, R)[0]!;
  // 뒤에 표본이 더 쌓여도 같은 이탈 구간이면 ts 가 바뀌지 않아야 한다.
  const b = replayGeofence([...fixes, fix(5, 300), fix(6, 300)], C, R)[0]!;
  assert.equal(a.exitTs, fix(2, 300).ts, "전이 표본(3번째)의 ts 가 아니다");
  assert.equal(b.exitTs, a.exitTs, "표본이 늘자 ts 가 바뀌었다 — 크론이 돌 때마다 중복 통지된다");
});

test("③ 복귀하면 닫힌다 — 다시 나가면 새 ts", () => {
  const out = [fix(0, 300), fix(1, 300), fix(2, 300)];
  const back = [fix(3, 10)]; // 반경 − 마진 안쪽
  const again = [fix(4, 300), fix(5, 300), fix(6, 300)];
  const mid = replayGeofence([...out, ...back], C, R)[0]!;
  assert.equal(mid.outside, false, "복귀했는데 이탈 상태가 남았다");
  assert.equal(mid.exitTs, null, "복귀 후에도 이탈 ts 가 남았다");
  const last = replayGeofence([...out, ...back, ...again], C, R)[0]!;
  assert.equal(last.outside, true, "재이탈이 안 잡혔다");
  assert.equal(last.exitTs, fix(6, 300).ts, "재이탈 ts 가 새 전이 표본이 아니다");
});

test("④ 회색지대(반경±마진)에서는 상태를 유지한다 — 경계 플리커 흡수", () => {
  // 105m = 반경 100 + 마진 10 안쪽이라 이탈 후보가 아니다.
  const grey = [fix(0, 105), fix(1, 105), fix(2, 105), fix(3, 105)];
  assert.equal(replayGeofence(grey, C, R)[0]!.outside, false, "회색지대가 이탈로 샜다");
});

test("⑤ ★ 작업자별로 따로 센다 — 한 사람의 streak 이 남에게 넘어가지 않는다", () => {
  const mixed = [fix(0, 300, "A"), fix(1, 300, "B"), fix(2, 300, "A"), fix(3, 300, "B")];
  const out = replayGeofence(mixed, C, R);
  assert.equal(out.length, 2, "작업자 분리가 안 됐다");
  for (const v of out) assert.equal(v.outside, false, `${v.workerId}: 2회뿐인데 이탈로 확정됐다`);
});

test("⑥ 입력 순서가 뒤집혀 있어도 시간순으로 센다", () => {
  const shuffled = [fix(2, 300), fix(0, 300), fix(1, 300)];
  const v = replayGeofence(shuffled, C, R)[0]!;
  assert.equal(v.outside, true, "정렬을 안 해서 streak 이 안 쌓였다");
  assert.equal(v.exitTs, fix(2, 300).ts, "정렬 후 전이 표본이 마지막이어야 한다");
});

test("⑦ 좌표가 비유한이면 건너뛴다 — 판정을 오염시키지 않는다", () => {
  const bad = { ...fix(1, 300), lat: Number.NaN };
  const v = replayGeofence([fix(0, 300), bad, fix(2, 300)], C, R)[0]!;
  assert.equal(v.usedFixes, 2, "비유한 좌표를 셌다");
  assert.equal(v.outside, false, "비유한 좌표가 streak 을 채웠다");
});
