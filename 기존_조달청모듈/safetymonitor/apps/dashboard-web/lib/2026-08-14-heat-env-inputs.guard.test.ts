// 온열 환경·강도 입력(MET·일광) 수집 경로 가드 — 한 곳만 끊겨도 값이 조용히 사라진다.
//   워치 앵커드 쿼리 → 폰 키 파싱 → 스키마 → DB 컬럼, 네 단계가 모두 살아 있어야 도착한다.
//   특히 폰 guard 조건에서 키가 빠지면 **이 둘만 실린 배치가 통째로 버려진다**(무음 유실).
//   결정 = docs/heat-env-inputs/context-notes.md
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP = join(ROOT, "..", "vitalguard_app", "ios");
const watch = readFileSync(join(APP, "VitalWatch", "WatchStreamer.swift"), "utf8");
const phone = readFileSync(join(APP, "Runner", "VitalPipeline.swift"), "utf8");
const schema = readFileSync(
  join(ROOT, "..", "..", "packages", "schemas", "src", "vital-stream.ts"),
  "utf8",
);
const db = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");

test("① 워치 — discreteInputs 에 physicalEffort·timeInDaylight 가 살아 있다", () => {
  const i = watch.indexOf("private lazy var discreteInputs");
  assert.ok(i >= 0, "discreteInputs 배열이 사라짐");
  const block = watch.slice(i, watch.indexOf("}()", i));
  assert.match(block, /forIdentifier: \.physicalEffort/, "MET 수집이 빠짐");
  assert.match(block, /forIdentifier: \.timeInDaylight/, "일광 시간 수집이 빠짐");
  assert.match(block, /key: "pe"/, "pe 키가 바뀜 — 폰 파싱과 어긋난다");
  assert.match(block, /key: "dl"/, "dl 키가 바뀜 — 폰 파싱과 어긋난다");
});

test("② ★ 폰 guard 조건에 두 키가 있다 — 빠지면 단독 배치가 통째로 버려진다", () => {
  const i = phone.indexOf("guard bpm != nil");
  assert.ok(i >= 0, "배치 guard 가 사라짐");
  const g = phone.slice(i, phone.indexOf("else { continue }", i));
  assert.match(g, /pe != nil/, "MET 만 실린 배치가 무음 폐기된다");
  assert.match(g, /dl != nil/, "일광만 실린 배치가 무음 폐기된다");
});

test("③ 폰 — 서버 스키마 이름으로 매핑한다", () => {
  assert.match(phone, /v\["physicalEffortMet"\] = pe/, "MET 매핑이 빠짐");
  assert.match(phone, /v\["timeInDaylightMin"\] = dl/, "일광 매핑이 빠짐");
});

test("④ 스키마 — 필드와 상한이 그대로다", () => {
  assert.match(schema, /physicalEffortMet: z\.number\(\)\.min\(0\)\.max\(30\)\.optional\(\)/);
  assert.match(schema, /timeInDaylightMin: z\.number\(\)\.min\(0\)\.max\(1440\)\.optional\(\)/);
});

test("⑤ DB — 컬럼 추가와 insert 매핑이 둘 다 있다", () => {
  assert.match(
    db,
    /ADD COLUMN IF NOT EXISTS physical_effort_met DOUBLE PRECISION/,
    "컬럼 마이그레이션이 빠지면 기존 DB 에 자리가 없다",
  );
  assert.match(db, /ADD COLUMN IF NOT EXISTS time_in_daylight_min DOUBLE PRECISION/);
  assert.match(db, /physical_effort_met: sample\.physicalEffortMet \?\? null/, "insert 매핑이 빠짐");
  assert.match(db, /time_in_daylight_min: sample\.timeInDaylightMin \?\? null/, "insert 매핑이 빠짐");
});
