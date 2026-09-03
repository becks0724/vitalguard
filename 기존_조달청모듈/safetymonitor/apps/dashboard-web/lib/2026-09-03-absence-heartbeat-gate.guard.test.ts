// 부재 알림 가드 — 기준이 '행이 왔나' 로 되돌아가지 않고, 시계 게이트가 되살아나지 않는가
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// ★ 이 가드의 한 문장 보장 = **알림은 심박으로 판정하고, push 는 착용 상태로 가른다.**
//
// 무엇이 있었나(2026-09-03 실사고). 워치가 미착용 중에도 배터리 표본을 보내기 시작하자
// 텔레그램에 **"✅ 생체 수신 재개"** 가 떴다 — 심박은 없었고 온 것은 배터리 행뿐이었다.
// 알림 문구 스스로 "복귀 직후 심박이 없었음" 이라고 적으면서 재개라고 불렀다.
// 뿌리 = 부재·재개 판정이 `MAX(v.ts)` 와 "그 뒤 첫 행" 이라는 **행 도착 기준**이었던 것.
// 화면은 2026-08-15 에 같은 이유로 이미 `heartRateMeasuredAt` 으로 옮겼는데(lib/vital-age.ts)
// 알림만 안 따라와 **화면과 알림이 다른 기준**을 쓰고 있었다.
//
// 그리고 같은 날 시계 게이트(07~19)를 걷어냈다 — 그 규칙은 **야간 작업자를 통째로 버린다**.

const here = __dirname;
const read = (...p: string[]) => readFileSync(join(here, ...p), "utf8");
const db = read("db.ts");
const watch = read("absence-watch.ts");
const cron = read("..", "app", "api", "cron", "absence-check", "route.ts");

const bodyOf = (src: string, fn: string) => {
  const i = src.indexOf(`export async function ${fn}`);
  assert.ok(i >= 0, `${fn} 소실 — 가드를 다시 맞춰야 한다`);
  const rest = src.slice(i);
  return rest.slice(0, rest.indexOf("\n}\n") + 3);
};

test("① 공백 판정이 심박 있는 행만 센다", () => {
  const fn = bodyOf(db, "lastSeenByWorker");
  assert.match(
    fn,
    /FILTER \(WHERE v\.heart_rate IS NOT NULL\)/,
    "기준이 '행이 왔나' 로 되돌아갔다 — 착용 표식·미착용 배터리 표본이 수신으로 읽힌다",
  );
  assert.doesNotMatch(
    fn,
    /MAX\(v\.ts\) AS last_ts/,
    "종전 행 도착 기준이 되살아났다",
  );
});

test("② 복귀는 심박이 실린 첫 행이다", () => {
  const fn = bodyOf(db, "maxMeasuredLagSecAfter");
  const resumed = fn.slice(fn.indexOf("WITH resumed"), fn.indexOf("SELECT r.ts"));
  assert.match(
    resumed,
    /heart_rate IS NOT NULL/,
    "아무 행이나 복귀로 친다 — 배터리 행 하나에 '생체 수신 재개' 가 뜬다(09-03 실사고)",
  );
});

test("★③ 시계 게이트가 되살아나지 않았다", () => {
  // 07~19 로 자르면 밤 11시에 차고 있던 작업자의 심박이 끊겨도 조용하다.
  for (const [name, src] of [["absence-watch.ts", watch], ["cron route", cron]] as const) {
    assert.doesNotMatch(src, /isWithinPushWindow/, `${name} 에 시계 게이트가 돌아왔다`);
    assert.doesNotMatch(src, /PUSH_WINDOW_(START|END)_HOUR/, `${name} 에 시계 상수가 돌아왔다`);
  }
});

test("★④ push 는 착용 상태로 가른다", () => {
  assert.match(
    watch,
    /export function shouldPushAbsence\(worn: boolean \| null, batteryStatus: number \| null\)/,
    "상태 기반 push 판정이 사라졌다",
  );
  const decide = watch.slice(watch.indexOf("export function decideAbsences"));
  assert.match(
    decide,
    /push: shouldPushAbsence\(w\.worn, w\.batteryStatus\)/,
    "판정이 push 규칙을 안 쓴다 — 전부 push 되거나 전부 조용해진다",
  );
});

test("⑤ 크론이 착용·배터리를 판정에 넘긴다", () => {
  assert.match(cron, /lastHeartbeatIso: w\.last_hr_ts/, "크론이 아직 행 도착 시각을 넘긴다");
  assert.match(cron, /worn: w\.last_worn === "true"/, "착용 상태를 안 넘긴다 — 항상 '모름' 으로 떨어져 전부 push 된다");
  assert.match(cron, /batteryStatus: w\.last_battery_status/, "배터리 상태를 안 넘긴다");
});

test("⑥ 재개 push 는 그 공백이 push 됐을 때만", () => {
  // 벗어 둔 공백은 ②에서 push 되지 않는다. 그 복귀만 알리면 선행 알림 없이 "✅ 재개" 가 홀로 뜬다.
  assert.match(
    cron,
    /if \(!outcome\.offBody && Number\.isFinite\(gapMs\)\)/,
    "재개 통지가 공백의 성격을 안 본다",
  );
  assert.match(bodyOf(db, "maxMeasuredLagSecAfter"), /AS off_body/, "off_body 산출이 사라졌다");
});

test("★⑦-0 raw_json 은 text 다 — ->> 앞에 ::jsonb 가 반드시 붙는다", () => {
  // 2026-09-03 실사고. `->>` 만 쓰고 배포했더니 크론이 500 을 냈고 부재 감지가 죽었다
  // (operator does not exist: text ->> unknown). 이 테이블은 ts·heart_rate_measured_at 도 text 다.
  const uses = [...db.matchAll(/raw_json(::jsonb)? ->>/g)];
  assert.ok(uses.length > 0, "raw_json 접근이 사라졌다 — 가드를 다시 맞춰야 한다");
  for (const m of uses) {
    assert.equal(m[1], "::jsonb", `raw_json ->> 에 ::jsonb 가 빠졌다 — 런타임에 크론이 죽는다: ${m[0]}`);
  }
});

test("★⑦ 충전 판정이 세 곳에서 같다", () => {
  // 갈리면 같은 표본이 차트에서는 충전, 알림에서는 방전으로 읽힌다.
  // 09-03 실기 = 방전 3 · 무선 독 충전 2 · 만충 5. 4(NOT_CHARGING)는 관측된 적 없어 넣지 않는다.
  assert.match(db, /bool_or\(battery_status IN \(2, 5\)\)/, "차트 음영의 충전 판정이 바뀌었다");
  assert.match(db, /o\.battery_status IN \(2, 5\)/, "재개 억제의 충전 판정이 바뀌었다");
  assert.match(
    watch,
    /const CHARGING_STATUSES = new Set\(\[2, 5\]\)/,
    "push 억제의 충전 판정이 바뀌었다",
  );
});
