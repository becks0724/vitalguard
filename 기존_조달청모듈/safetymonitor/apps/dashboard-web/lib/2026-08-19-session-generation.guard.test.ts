// 워치 세션 계측 트리오 가드 — 하나만 빠지면 값이 조용히 사라진다(BND-CONTRACT-01).
//
// 무엇이 있었나(2026-08-19 · docs/vital-absence-triage §4-7).
// 08-18 에 자동 세션 재개(`f67442f`)를 워치에 설치하고 15시간을 관측했더니 **20.9분·12.9시간
// 공백이 그대로 났다**. 그런데 DB 로는 원인을 못 가른다 —
//   ① 델리게이트가 아예 안 돌았나  ② 돌았는데 3연속 실패로 포기했나
//   ③ 돌았는데 suspend 중 콜백이 늦게 배달됐나
// **셋은 조치가 전부 다르다**(미발동 / 폭주 가드 임계 / 콜백 지연). 계측 없이는 다음 수정도 추측이다.
//
// 부수 지문으로 대신하려 했으나 셋 다 기저율에 묻혀 기각됐다(§5) —
// 8~25초 공백 대역 하루 136건 · "심박 있고 정지값 결측" 30시간 238건 ·
// "심박 결측 + 정지값만" 하루 3~27건(밀린 배치 도착과 같은 모양).
//
// ⚠ 카운터가 아니라 **시각**인 이유 — 카운터는 프로세스가 죽으면 0 부터 다시 세어 재설치와
// 구별이 안 된다. 시각은 그 문제가 없고 "언제 시작했는지"까지 준다.
//
// 이 가드가 지키는 것 넷.
//  ① 스키마 필드 ② DB 컬럼 DDL ③ insert 매핑 — 셋이 함께 있어야 값이 남는다
//  ④ **내보내기 계약(`ExportRow`)에는 넣지 않는다** — 진단 필드이지 사용자에게 주는 값이 아니다.
//     빠뜨린 것이 아니라 뺀 것이라 여기 못 박는다(다음 사람이 "없네" 하고 채우지 않게).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const schema = readFileSync(
  join(ROOT, "..", "..", "packages", "schemas", "src", "vital-stream.ts"),
  "utf8",
);
const db = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");
const IOS = join(ROOT, "..", "vitalguard_app", "ios");
const watch = readFileSync(join(IOS, "VitalWatch", "WatchStreamer.swift"), "utf8");
const phone = readFileSync(join(IOS, "Runner", "VitalPipeline.swift"), "utf8");
// 주석을 걷어낸 본문에서만 검사한다 — 설명 주석의 낱말이 가드를 통과시키면 안 된다.
const bare = (s: string) =>
  s.replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const dbBare = bare(db);

test("★ 앵커 — 같은 형태의 기존 필드(batteryPct)가 트리오를 유지하고 있다", () => {
  assert.match(bare(schema), /batteryPct:\s*z\.number\(\)/, "앵커 필드가 스키마에서 사라졌다");
  assert.match(dbBare, /battery_pct INTEGER/, "앵커 필드의 DDL 이 사라졌다");
  assert.match(dbBare, /battery_pct:\s*sample\.batteryPct/, "앵커 필드의 insert 매핑이 사라졌다");
});

test("① 스키마 — 두 필드가 있다", () => {
  const s = bare(schema);
  assert.match(s, /sessionStartedAt:\s*z\.string\(\)\.datetime\(\)/, "sessionStartedAt 소실");
  assert.match(s, /sessionAutoResumed:\s*z\.boolean\(\)/, "sessionAutoResumed 소실");
});

test("② DB — 두 컬럼 DDL 이 있다", () => {
  assert.match(
    dbBare,
    /ADD COLUMN IF NOT EXISTS session_started_at TEXT/,
    "session_started_at DDL 소실 — 스키마가 통과시켜도 저장될 자리가 없다",
  );
  assert.match(
    dbBare,
    /ADD COLUMN IF NOT EXISTS session_auto_resumed INTEGER/,
    "session_auto_resumed DDL 소실",
  );
});

test("③ insert 매핑 — 두 필드가 컬럼으로 옮겨진다", () => {
  assert.match(dbBare, /session_started_at:\s*sample\.sessionStartedAt/, "시각 매핑 소실");
  assert.match(
    dbBare,
    /session_auto_resumed:[\s\S]{0,120}sample\.sessionAutoResumed === true \? 1/,
    "불리언 매핑 소실 — 이 레포는 불리언을 INTEGER 0/1 로 저장한다(manual_sos 선례)",
  );
});

test("④ 진단 필드는 내보내기 계약(ExportRow)에 넣지 않는다", () => {
  const from = dbBare.indexOf("export type ExportRow");
  assert.ok(from >= 0, "ExportRow 앵커 소실");
  const body = dbBare.slice(from, dbBare.indexOf("};", from));
  assert.doesNotMatch(body, /session_started_at/, "★ 진단 필드가 CSV 내보내기로 샜다");
  assert.doesNotMatch(body, /session_auto_resumed/, "★ 진단 필드가 CSV 내보내기로 샜다");
  // 앵커 — ExportRow 를 잘못 잘라 빈 문자열을 검사하고 통과하는 것을 막는다.
  assert.match(body, /battery_pct/, "ExportRow 본문을 못 잘랐다(검사가 무의미해진다)");
});

// ── 전송 사슬 — 서버가 받을 자리를 만들어도 워치가 안 보내면 값은 0건이다.
//    `battery_pct` 가 정확히 그 형태였다(트리오는 구 앱 시절부터 있었는데 10,189행 0건).

test("⑤ 워치 — 세션 시작 시각과 주체를 기록한다", () => {
  const w = bare(watch);
  assert.match(w, /private var sessionStartedAt: Date\?/, "세션 시작 시각 상태 소실");
  assert.match(w, /sessionStartedAt = startDate/, "세션 시작 시각을 기록하지 않는다");
  assert.match(w, /sessionAutoResumed = auto/, "재시작 주체를 기록하지 않는다");
});

test("⑥ 워치 — 두 진입점이 주체를 다르게 넘긴다", () => {
  const w = bare(watch);
  assert.match(w, /private func beginWorkout\(auto: Bool\)/, "주체 인자가 사라졌다");
  assert.match(w, /beginWorkout\(auto: false\)/, "사람이 누른 시작이 auto:false 로 안 간다");
  assert.match(w, /beginWorkout\(auto: true\)/, "★ 자동 재개가 auto:true 로 안 간다 — 두 경로가 구별되지 않는다");
});

test("⑦ 워치 — 심박 항목에 얹는다(단독 항목 금지)", () => {
  const w = bare(watch);
  // ⚠ `lastIndex(where:)` 는 파일에 여러 번 나온다(활동에너지·걸음·이산…). 배터리 블록을
  //    정확히 집어야 한다 — 첫 등장을 잡으면 엉뚱한 창을 검사하고 조용히 통과·실패한다.
  const bat = w.indexOf("WKInterfaceDevice.current().batteryLevel");
  assert.ok(bat > 0, "배터리 앵커 소실");
  const head = w.lastIndexOf('lastIndex(where: { $0["bpm"] is Double }', bat);
  assert.ok(head > 0 && bat - head < 300, "세션 값이 심박 항목 블록 밖에 있다");
  const block = w.slice(head, bat + 600);
  assert.match(block, /\["sst"\] = started\.timeIntervalSince1970/, "세션 시작 시각을 심박 항목에 안 싣는다");
  assert.match(block, /\["sar"\] = sessionAutoResumed/, "주체를 심박 항목에 안 싣는다");
});

test("⑧ 워치 — teardown 이 끝난 세션의 정체성을 버린다", () => {
  const w = bare(watch);
  const from = w.indexOf("private func teardown()");
  assert.ok(from > 0, "teardown 앵커 소실");
  assert.match(
    w.slice(from, from + 1600),
    /sessionStartedAt = nil/,
    "안 버리면 다음 세션 첫 배치에 옛 세션 시각이 실린다",
  );
});

test("⑨ 폰 — 서버 스키마 이름으로 옮긴다", () => {
  const p = bare(phone);
  assert.match(p, /let sst = s\["sst"\] as\? Double/, "워치 키를 안 읽는다");
  assert.match(p, /v\["sessionStartedAt"\] = self\.isoMs\.string/, "ISO 변환·매핑 소실");
  assert.match(p, /v\["sessionAutoResumed"\] = sar == 1/, "불리언 매핑 소실");
});

test("⑩ 폰 — 이 값만으로 행을 만들지 않는다", () => {
  const p = bare(phone);
  const from = p.indexOf("guard bpm != nil");
  assert.ok(from > 0, "guard 앵커 소실");
  const g = p.slice(from, p.indexOf("else { continue }", from));
  assert.doesNotMatch(g, /sst/, "★ 세션 값이 guard 에 들어가면 생체 없는 행이 생긴다");
  assert.doesNotMatch(g, /sar/, "★ 같은 이유");
  // 앵커 — guard 를 잘못 잘라 빈 문자열을 검사하고 통과하는 것을 막는다.
  assert.match(g, /still != nil/, "guard 본문을 못 잘랐다(검사가 무의미해진다)");
});
