// 워치 배터리 전송 가드 — 신규 앱에서 0건이던 결손을 다시 열지 않게 못 박는다.
//
// 무엇이 있었나(2026-08-18). 신규 앱 **10,189행 중 `battery_pct` 가 0건**이었다. 구 앱은 보내던
// 필드이고 서버 트리오(스키마 `batteryPct` · 컬럼 `battery_pct` · insert 매핑)는 **이미 완비**돼
// 있었다 — 워치가 안 보낸 것뿐이다. `motionStillSec` 과 정확히 같은 형태의 결손이다.
//
// 왜 편의가 아니라 진단 축인가. 같은 날 긴 공백 3건(208·174·69분)이 전부 **수집 정지**로
// 확정됐는데(복귀 시 버스트 없음 · 최장지연 4·5·9초 · 공백 창 폰 POST 2건 vs 직전·직후 125·123건)
// **원인을 가를 신호가 하나도 없었다** — 방전인지 충전인지 앱 종료인지 모른다. 배터리 레벨의
// 시간 변화가 방전(급락)과 충전(상승)을 가른다. 그래서 "관제에서 배터리를 못 본다" 는 편의
// 결손이 아니라 **진단 축 부재**다.
//
// 이 가드가 지키는 것 넷.
//  ① 워치가 배터리 모니터링을 켠다 — 안 켜면 `batteryLevel` 이 `-1`(= "모름")을 돌려준다.
//  ② `-1` 을 싣지 않는다 — 서버 스키마(0~100)가 스트립하고, 활동량 허용목록 계열이라
//     **그 행의 다른 필드까지 함께 잃을 수 있다**.
//  ③ 심박 항목에 얹는다(단독 항목 금지) — 배치 내 ts 중복으로 서버가 조용히 버리고,
//     "생체는 없는데 배터리만 있는 행" 이 생겨 미수신 판별을 더 흐린다.
//  ④ 폰이 서버 스키마 이름으로 옮긴다 — 워치 키 `bat` 은 서버가 모른다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const IOS = join(ROOT, "..", "vitalguard_app", "ios");
const watch = readFileSync(join(IOS, "VitalWatch", "WatchStreamer.swift"), "utf8");
const phone = readFileSync(join(IOS, "Runner", "VitalPipeline.swift"), "utf8");
const schema = readFileSync(
  join(ROOT, "..", "..", "packages", "schemas", "src", "vital-stream.ts"),
  "utf8",
);
const db = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");

const bare = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("★ 앵커 — 서버 트리오가 살아 있다(스키마·컬럼·insert)", () => {
  assert.match(schema, /batteryPct:\s*z\.number\(\)/, "스키마 필드가 사라졌다");
  assert.match(db, /battery_pct INTEGER/, "DB 컬럼 DDL 이 사라졌다");
  assert.match(db, /battery_pct:\s*sample\.batteryPct/, "insert 매핑이 사라졌다");
});

test("① 워치가 배터리 모니터링을 켠다", () => {
  assert.match(
    bare(watch),
    /isBatteryMonitoringEnabled = true/,
    "모니터링을 안 켜면 batteryLevel 이 -1 만 돌려준다 — 값이 영영 안 온다",
  );
});

test("② -1(모름)을 싣지 않는다", () => {
  const w = bare(watch);
  assert.match(
    w,
    /let level = WKInterfaceDevice\.current\(\)\.batteryLevel[\s\S]{0,200}?if level >= 0/,
    "음수 가드가 사라졌다 — -1 이 실리면 서버가 그 행의 다른 필드까지 스트립할 수 있다",
  );
});

test("③ 심박 항목에 얹는다 — 단독 항목을 만들지 않는다", () => {
  const w = bare(watch);
  const i = w.indexOf('"bat"');
  assert.ok(i > 0, "배터리 전송이 사라졌다");
  // 얹는 자리가 '심박 항목 찾기' 안이어야 한다.
  const around = w.slice(Math.max(0, i - 300), i + 100);
  assert.match(
    around,
    /pendingSamples\.lastIndex\(where: \{ \$0\["bpm"\] is Double \}\)/,
    "배터리를 단독 항목으로 만든다 — 배치 내 ts 중복으로 서버가 조용히 버린다",
  );
  assert.doesNotMatch(
    around,
    /pendingSamples\.append\(\[[^\]]*"bat"/,
    "배터리만 담은 행을 새로 만든다",
  );
});

test("④ 폰이 서버 스키마 이름으로 옮긴다", () => {
  const p = bare(phone);
  assert.match(p, /let bat = s\["bat"\] as\? Int/, "워치 키를 안 읽는다");
  assert.match(p, /if let bat \{ v\["batteryPct"\] = bat \}/, "서버 스키마 이름으로 안 옮긴다");
});

test("⑤ 근거가 소스에 남아 있다(지우면 다음 사람이 '안 쓰는 값'으로 걷어낸다)", () => {
  assert.match(watch, /수집 정지/, "왜 필요한지가 워치 소스에서 사라졌다");
  assert.match(phone, /0건/, "결손 규모 근거가 폰 소스에서 사라졌다");
});
