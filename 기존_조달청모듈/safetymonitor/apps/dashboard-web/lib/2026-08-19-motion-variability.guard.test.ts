// 모션 변동폭(mv) 가드 — 수집은 하되 **판정에는 올리지 않는다**.
//
// 무엇인가(2026-08-19 · 옆 세션 착용 판별 트랙 요청).
// 1Hz `deviceMotion` 60초 창의 `|userAcceleration|` 표준편차 × 1000(밀리g 정수).
// 지금 워치 코드는 임계 통과 여부(`motionMoveThresholdG`)만 보고 **변동폭을 버린다**.
// 책상 위 워치와 가만히 있는 손목을 가르는 것은 통과 여부가 아니라 변동폭이라(액티그래피
// 비착용 판정의 표준 축) 그 값을 남겨 두는 것이다.
//
// ★ 왜 판정 금지가 이 가드의 본론인가.
// §4-3 실기기 시험에서 **워치를 벗어도 그럴듯한 심박이 계속 온다**(착용 108.1 vs 벗음 108.4 ·
// 통계적으로 구별 불가)는 것이 확인됐다. 착용을 가를 신호가 0개인 상태이고, `mv` 는 그 후보를
// **하나 재 보는 재료**일 뿐이다. 분포가 안 갈리면 그 자리에서 폐기한다.
// 값이 그럴듯하다고 판정·경보·화면에 올리면 **그게 곧 근거 없는 판정**이 된다 —
// 이 레포가 WBGT·PSI·작업–휴식 표에서 같은 처방을 세 번 썼다.
//
// 검증 계획(2단계) — 라벨을 사람 손 없이 기존 데이터에서 얻는다.
//   착용 확실 = `steps > 0`(걷는 중) · 미착용 확실 = `battery_pct` 상승 구간(충전 중).
//   두 구간의 `mv` 분포가 갈리면 임계가 존재하는 것이고, 안 갈리면 축을 버린다.
//
// 이 가드가 지키는 것 아홉.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const IOS = join(ROOT, "..", "vitalguard_app", "ios");
const schema = readFileSync(
  join(ROOT, "..", "..", "packages", "schemas", "src", "vital-stream.ts"),
  "utf8",
);
const db = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");
const watch = readFileSync(join(IOS, "VitalWatch", "WatchStreamer.swift"), "utf8");
const phone = readFileSync(join(IOS, "Runner", "VitalPipeline.swift"), "utf8");
// 주석을 걷어낸 본문에서만 검사한다 — 설명 주석의 낱말이 가드를 통과시키면 안 된다.
const bare = (s: string) =>
  s.replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("★ 앵커 — 같은 계약의 기존 필드가 살아 있다", () => {
  assert.match(bare(schema), /motionStillSec:\s*z\.number\(\)/, "앵커(motionStillSec) 소실");
  assert.match(bare(db), /motion_still_sec DOUBLE PRECISION/, "앵커 DDL 소실");
});

test("① 스키마 — 정수·상한이 있다", () => {
  assert.match(
    bare(schema),
    /motionVariabilityMg:\s*z\.number\(\)\.int\(\)\.min\(0\)\.max\(10000\)/,
    "필드 소실 또는 상한 변경 — SMALLINT(32767) 를 넘기면 insert 가 깨진다",
  );
});

test("② 스키마 — 스트립 허용목록에 있다(진단 필드가 생체를 날리지 않게)", () => {
  const s = bare(schema);
  const from = s.indexOf("NON_SAFETY_STRIPPABLE_KEYS");
  assert.ok(from > 0, "허용목록 앵커 소실");
  const body = s.slice(from, s.indexOf("]", from));
  assert.match(body, /"motionVariabilityMg"/, "★ 빠지면 범위 이탈 시 샘플 전체가 거부된다");
  assert.match(body, /"steps"/, "허용목록 본문을 못 잘랐다(검사가 무의미해진다)");
});

test("③ DB — 컬럼 DDL 과 insert 매핑이 함께 있다", () => {
  const d = bare(db);
  assert.match(d, /ADD COLUMN IF NOT EXISTS motion_var_mg SMALLINT/, "DDL 소실");
  assert.match(d, /motion_var_mg:\s*sample\.motionVariabilityMg/, "insert 매핑 소실");
});

test("④ 내보내기 계약(ExportRow)에는 넣지 않는다", () => {
  const d = bare(db);
  const from = d.indexOf("export type ExportRow");
  assert.ok(from >= 0, "ExportRow 앵커 소실");
  const body = d.slice(from, d.indexOf("};", from));
  assert.doesNotMatch(body, /motion_var_mg/, "★ 진단 필드가 CSV 내보내기로 샜다");
  assert.match(body, /battery_pct/, "ExportRow 본문을 못 잘랐다");
});

test("⑤ 워치 — 1Hz 60개 창이다(창 크기와 표본율이 함께 있어야 60초가 된다)", () => {
  const w = bare(watch);
  assert.match(w, /motion\.deviceMotionUpdateInterval = 1\.0/, "★ 표본율이 바뀌면 60개 ≠ 60초다");
  assert.match(w, /private let motionWindowSize = 60/, "창 크기 소실");
  assert.match(w, /motionMagWindow\.append\(mag\)/, "창에 안 쌓는다");
  assert.match(w, /motionMagWindow\.removeFirst\(\)/, "상한이 없으면 창이 무한히 자란다");
});

test("⑥ 워치 — 창이 덜 차면 값을 만들지 않는다(0 을 보내지 않는다)", () => {
  const w = bare(watch);
  const from = w.indexOf("private var motionVariabilityMg: Int?");
  assert.ok(from > 0, "산출부 앵커 소실");
  const fn = w.slice(from, from + 500);
  assert.match(
    fn,
    /guard motionMagWindow\.count >= motionWindowSize else \{ return nil \}/,
    '★ "변동이 없다"(0)와 "못 쟀다"(없음)를 같은 값으로 보내면 판정이 오염된다',
  );
  assert.match(fn, /squareRoot\(\) \* 1000/, "밀리g 환산이 사라졌다");
});

test("⑦ 워치 — 심박 항목에 얹고 teardown 이 창을 버린다", () => {
  const w = bare(watch);
  const bat = w.indexOf("WKInterfaceDevice.current().batteryLevel");
  assert.ok(bat > 0, "심박 항목 앵커 소실");
  assert.match(
    w.slice(bat, bat + 900),
    /if let mv = motionVariabilityMg \{ pendingSamples\[idx\]\["mv"\] = mv \}/,
    "심박 항목에 안 얹는다 — 단독 항목으로 보내면 배치 내 ts 중복으로 서버가 조용히 버린다",
  );
  const td = w.indexOf("private func teardown()");
  assert.ok(td > 0, "teardown 앵커 소실");
  assert.match(
    w.slice(td, td + 1600),
    /motionMagWindow\.removeAll\(\)/,
    "안 버리면 재시작 직후 옛 세션 표본으로 계산된다",
  );
});

test("⑧ 폰 — 서버 이름으로 옮기되 이 값만으로 행을 만들지 않는다", () => {
  const p = bare(phone);
  assert.match(p, /let mv = s\["mv"\] as\? Int/, "워치 키를 안 읽는다");
  assert.match(p, /v\["motionVariabilityMg"\] = mv/, "매핑 소실");
  const from = p.indexOf("guard bpm != nil");
  assert.ok(from > 0, "guard 앵커 소실");
  const g = p.slice(from, p.indexOf("else { continue }", from));
  assert.doesNotMatch(g, /\bmv\b/, "★ guard 에 들어가면 생체 없는 행이 생긴다");
  assert.match(g, /still != nil/, "guard 본문을 못 잘랐다");
});

test("⑨ ★★ 판정·경보·화면 어디에도 쓰지 않는다", () => {
  // 값이 그럴듯하다고 판정에 올리기 딱 좋은 자리라 주석으로는 못 막는다.
  // 분포 검증(착용=steps>0 vs 미착용=배터리 상승)이 끝나기 전에는 순수 관측값이다.
  for (const rel of [
    ["lib", "severity.ts"],
    ["lib", "telegram.ts"],
    ["lib", "worker-signal.ts"],
    ["app", "components", "DemoDashboard.tsx"],
  ]) {
    const src = readFileSync(join(ROOT, ...rel), "utf8");
    const name = rel[rel.length - 1];
    // 앵커 — 파일이 비거나 옮겨가면 금지 검사가 조용히 통과한다(L-79).
    assert.ok(src.length > 500, `${name} 앵커 소실 — 빈 파일을 검사하고 통과할 뻔했다`);
    assert.doesNotMatch(src, /motionVariabilityMg|motion_var_mg/, `★ ${name} 에 판정 유입`);
  }
});
