// 오른 층 — 화면에서 뺐지만 **수집은 계속한다**
//
// 2026-08-20 사용자 결정. 기기가 층을 거의 안 센다(건강 앱 08-19 하루 1층 · 우리 DB 도착은
// 전 기간 2건뿐이고 둘 다 세션 시작 직후였다). 유력한 원인은 상시 `HKWorkoutSession`
// (`locationType = .indoor`)이 고도 기반 지표를 막는 것인데, **그 구성은 폰 강제종료·잠금
// 생존의 근거라 바꾸지 않는다.** 그래서 화면에서만 빼고 수집·저장은 그대로 둔다.
//
// ⚠ 이 결정의 위험은 하나다 — **"화면에 안 쓰니 수집 코드도 지우자"**.
//   지우면 나중에 원인이 풀렸을 때 되살릴 재료가 없고, 지운 사실조차 조용하다.
//   그래서 사슬 네 고리(워치 쿼리 → 워치 페이로드 → 폰 매핑 → 서버 컬럼)를 전부 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(fileURLToPath(new URL(".", import.meta.url)));
const ROOT = join(here, "..");
const APP = join(ROOT, "..", "vitalguard_app");
const watch = readFileSync(join(APP, "ios", "VitalWatch", "WatchStreamer.swift"), "utf8");
const phone = readFileSync(join(APP, "ios", "Runner", "VitalPipeline.swift"), "utf8");
const recv = readFileSync(join(APP, "ios", "Runner", "PhoneReceiver.swift"), "utf8");
const main = readFileSync(join(APP, "lib", "main.dart"), "utf8");
const db = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");
const bare = (s: string) => s.replace(/^\s*(\/\/|--).*$/gm, "");

test("★ 수집 사슬 네 고리가 전부 살아 있다 — 화면에서 뺐다고 지우면 안 된다", () => {
  assert.match(watch, /func startFlightsQuery\(/, "워치 앵커 쿼리가 사라졌다");
  assert.match(bare(watch), /updateHandler = \{/, "갱신 핸들러가 사라졌다 — 첫 결과만 오고 끝난다");
  assert.match(bare(watch), /reported: &flightsReported, key: "flt"/, "워치 페이로드에서 빠졌다");
  assert.match(bare(phone), /v\["flightsClimbed"\]/, "폰이 서버 필드로 안 옮긴다");
  // 폰 표시 스냅숏도 누계를 계속 쌓는다 — 화면에 안 그릴 뿐 값은 살아 있어야 한다.
  assert.match(bare(recv), /snapshot\.flights \+= flt/, "폰 스냅숏 누계가 끊겼다");
  assert.match(bare(db), /flights_climbed/, "DB 매핑이 사라졌다");
});

test("★ 화면에는 값을 그리지 않는다 — 뺀 결정이 되돌아가지 않게", () => {
  const code = bare(main);
  assert.doesNotMatch(
    code,
    /label: '오른 층', value:/,
    "격자에 오른 층 값 칸이 다시 생겼다",
  );
  // 빈 자리로 두지도 않는다 — 사유 줄이 남아 있어야 다음 사람이 "빠뜨린 것" 으로 안 읽는다.
  assert.match(code, /'오른 층', '수집만/, "사유 줄이 사라졌다 — 빈 자리는 빠뜨림으로 읽힌다");
});

test("★ 워치 표본 필터가 남아 있다 — 지우면 아이폰 계단이 이중 계상된다", () => {
  // 워치 HealthKit 에는 아이폰이 기록한 계단도 동기화된다. 거르지 않으면 같은 계단을 두 번 센다.
  const fn = watch.slice(watch.indexOf("private func ingestFlights("));
  assert.match(
    fn.slice(0, fn.indexOf("\n    }")),
    /isAppleWatchSample\(s\)/,
    "출처 필터가 빠졌다 — 폰만 들고 이동한 것도 워치 활동으로 잡힌다",
  );
});

test("★ 첫 실행 가드가 남아 있다 — 과거 며칠치가 한꺼번에 합산되지 않게", () => {
  const fn = watch.slice(watch.indexOf("private func startFlightsQuery("));
  const body = fn.slice(0, fn.indexOf("\n    }"));
  assert.match(body, /flightsAnchor == nil/, "앵커 없음 분기가 사라졌다");
  assert.match(body, /predicateForSamples\(withStart: Date\(\)/, "첫 실행 시점 가드가 사라졌다");
});
