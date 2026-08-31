// 구획이탈 통지 억제 가드 — 에피소드 1건=알림 1건이 지켜지고, 일일 상한이 통지에만 걸리는가
//
// ★ 왜 필요한가(2026-08-30 실사고). 워치가 현장에서 약 1.6km 밖에 연속으로 있었는데 —
//   이탈 전이는 **1회** — 텔레그램은 79건이 4~6분 간격으로 나갔다. 크론 되짚기 창(60분)이
//   이탈 지속시간보다 짧아, 매 실행 창 시작 부근에서 새 exitTs 가 발급되고 `prev >= exitTs`
//   dedup 을 매번 통과한 것이다. 수술 = ① "이전 알림 이후의 구획 안 관측(lastInsideTs)이
//   있어야 새 사건"(에피소드 규칙 + 24h 조회 창) ② 작업자당 일일 통지 상한 3회(원장은 전부
//   남기고 텔레그램만 억제 · 3회째에 침묵 예고 꼬리).
//
// ★ 이 가드가 초록일 때 보장하는 것(한 문장) —
//   **연속 이탈은 안 관측 없이는 재알림되지 않고(조회 창 24h·되짚기 창보다 김), 상한은
//   원장 기록·자연키 dedup 을 건드리지 않고 텔레그램만 막으며, 3회째에 침묵을 예고한다.**
//   보장하지 않는 것 = 3회·24h 가 관제자에게 옳은 값인가. 그것은 운용에서 본다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { replayGeofence, type GpsFix } from "./geofence-watch";
import { GEOFENCE_NOTIFY_CAP_TAIL, GEOFENCE_NOTIFY_DAILY_CAP } from "./telegram";
// 주석 제거는 정본 헬퍼로만 — 순진한 정규식은 URL 의 `//` 를 먹어 거짓 초록을 만든다([[L-119]]).
import { stripComments } from "./test-support/strip-comments";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (...p: string[]) => stripComments(readFileSync(join(here, ...p), "utf8"));

const route = read("..", "app", "api", "cron", "geofence-check", "route.ts");
const db = read("db.ts");

const C = { lat: 35.1505, lon: 126.9162 };
const R = 100;
const north = (m: number) => C.lat + m / 111_320;
const fix = (i: number, m: number): GpsFix => ({
  workerId: "W1",
  workerName: "테스터",
  ts: new Date(Date.UTC(2026, 7, 31, 0, i, 0)).toISOString(),
  lat: north(m),
  lon: C.lon,
});

// ── ① lastInsideTs — 에피소드 구분 근거 ────────────────────────────────────
test("★★ 창 전체가 밖이면 lastInsideTs 가 없다 — 연속 이탈은 같은 에피소드다", () => {
  const v = replayGeofence([fix(0, 1600), fix(1, 1600), fix(2, 1600), fix(3, 1600)], C, R)[0]!;
  assert.equal(v.outside, true);
  assert.equal(v.lastInsideTs, null, "밖뿐인 창에서 안 관측이 나왔다 — 재알림이 계속 뚫린다");
});

test("★★ 확실한 안(반경−마진 이내) 표본만 에피소드를 끊는다 — 회색지대는 아니다", () => {
  // 95m = 반경 100 − 마진 10 밖(회색지대) → 안 관측 아님. 10m = 확실한 안.
  const grey = replayGeofence([fix(0, 1600), fix(1, 95), fix(2, 1600)], C, R)[0]!;
  assert.equal(grey.lastInsideTs, null, "회색지대(95m)가 안 관측으로 잡혔다 — 경계 플리커가 연발을 되살린다");
  const back = replayGeofence([fix(0, 1600), fix(1, 10), fix(2, 1600)], C, R)[0]!;
  assert.equal(back.lastInsideTs, fix(1, 10).ts, "확실한 안 표본이 lastInsideTs 로 안 잡혔다");
});

test("★ 창 시작이 안쪽이어도 잡힌다 — return 이벤트가 없어도 새 이탈은 새 사건이다", () => {
  // 상태머신은 INITIAL(안) 에서 시작하므로 안→안 은 return 이벤트를 안 낸다. 표본 자체로 잡아야
  // "아침에 현장에 있다가 다시 나간" 새 에피소드가 어제 알림에 막히지 않는다.
  const v = replayGeofence([fix(0, 10), fix(1, 10), fix(2, 1600), fix(3, 1600), fix(4, 1600)], C, R)[0]!;
  assert.equal(v.outside, true);
  assert.equal(v.lastInsideTs, fix(1, 10).ts, "초기 안쪽 표본이 안 잡혔다");
});

// ── ② 크론 배선 ─────────────────────────────────────────────────────────────
test("★★ 조회 창이 되짚기 창보다 길다 — 같으면 표류 ts 가 매번 새 사건으로 통과한다", () => {
  assert.match(route, /const GEOFENCE_ALERT_LOOKBACK_MS = 24 \* 60 \* 60 \* 1000/,
    "24h 조회 창 상수가 없다");
  assert.match(route, /lastGeofenceAlertTsByWorker\(lookbackIso\)/,
    "기존 알림 조회가 24h 창을 안 쓴다 — 되짚기 창(60분)으로 되돌아갔다");
  assert.doesNotMatch(route, /lastGeofenceAlertTsByWorker\(sinceIso\)/,
    "조회 창이 되짚기 창과 같다 — 08-30 연발 구조 그대로다");
});

// ── ③ 상한은 통지에만 — 원장·dedup 불변 ────────────────────────────────────
test("★★ 상한 판정은 INSERT 뒤에 온다 — 원장 기록을 상한이 막으면 dedup·이력이 함께 죽는다", () => {
  const at = db.indexOf("export async function recordAlert(");
  assert.notEqual(at, -1);
  const body = db.slice(at, db.indexOf("export async function listAlerts("));
  assert.ok(body.indexOf("INSERT INTO alerts") < body.indexOf("countGeofenceAlertsTodayKst("),
    "상한 카운트가 INSERT 앞에 있다 — 원장이 상한에 물렸다");
  assert.match(body, /if \(input\.type === "geofence"\)/, "상한이 구획이탈에만 걸리지 않는다");
  assert.match(body, /n === GEOFENCE_NOTIFY_DAILY_CAP/, "상한 회째 꼬리 분기가 없다");
  assert.match(body, /n > GEOFENCE_NOTIFY_DAILY_CAP/, "상한 초과 억제 분기가 없다");
  assert.match(body, /notifyAlertTelegram\(input, GEOFENCE_NOTIFY_CAP_TAIL\)/,
    "3회째에 침묵 예고 꼬리를 안 단다 — 관제자가 채널 고장으로 오해한다");
});

test("★ 상한 값·꼬리 문구 — 사용자 결정 3회, 꼬리는 관제웹으로 안내한다", () => {
  assert.equal(GEOFENCE_NOTIFY_DAILY_CAP, 3, "상한이 사용자 결정(3회)과 다르다");
  assert.match(GEOFENCE_NOTIFY_CAP_TAIL, /관제웹/, "꼬리가 대체 확인 경로를 안내하지 않는다");
});
