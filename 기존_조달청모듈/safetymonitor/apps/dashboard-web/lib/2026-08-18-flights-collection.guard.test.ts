// 오른층(계단) 수집 가드 — 신규 앱에서 0건이던 결함을 다시 열지 않게 못 박는다.
//
// 무엇이 있었나(2026-08-18 실측). 구 앱 시절엔 오던 오른층이 신규 앱에서 **한 건도 안 왔다**
// (`source=VitAlGuard-WatchVitals` 계단행 816 · 마지막 08-01 → 08-16 이후 0건 · 같은 구간 걸음은
// 1,132건 정상). 스키마·DB 컬럼·insert 매핑·워치 전송 코드가 **전부 있는데 값만 0** 이었다.
// 원인은 읽는 경로다 — `HKLiveWorkoutBuilder.statistics(for:)` 는 워크아웃이 수집한 것만 주는데
// 이 앱의 구성이 `locationType = .indoor` 라 고도 기반 지표가 수집에서 빠진다(걸음은 실내에서도
// 수집되므로 온다). 그래서 저장소를 직접 읽는 앵커 쿼리로 바꿨다.
//
// 왜 이 값이 필요한가 — 온열 판정의 **활동 배제 신호**다. 2026-08-18 실측 정답
// (긴장·흡연·계단)에서 추정 심부체온이 경고선을 세 번 넘었는데 원인이 온열이 아니었고,
// 계단은 걸음 수 대비 부하가 훨씬 큰데 잡히지 않아 활동 강도가 과소평가됐다.
// 상세 = `apps/dashboard-web/docs/heat-activity-axis/checklist.md` §2-3·§2-4.
//
// 이 가드가 지키는 것 넷.
//  ① 앵커 쿼리가 소스로 남는다(빌더로 되돌아가면 .indoor 에서 다시 0건이 된다).
//  ② 빌더와 앵커를 **동시에** 켜지 않는다 — 둘 다 켜면 같은 계단이 두 번 세어진다.
//  ③ 워치 표본만 합산한다 — 워치 HealthKit 에는 아이폰이 기록한 계단도 동기화되므로
//     거르지 않으면 이중 계상되거나 폰만 들고 이동한 것이 워치 활동으로 잡힌다.
//  ④ 서버 계약(5초 구간 증분)을 유지한다 — 구 앱처럼 하루 누계를 보내면 서버 상한에서 스트립된다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WATCH = join(ROOT, "..", "vitalguard_app", "ios", "VitalWatch", "WatchStreamer.swift");
const watch = readFileSync(WATCH, "utf8");
const code = watch.replace(/^\s*\/\/.*$/gm, "").replace(/^\s*\/\/\/.*$/gm, "");

test("★ 앵커 — 앵커 쿼리가 존재하고 기동된다(아래 금지 검사의 전제)", () => {
  assert.match(code, /private func startFlightsQuery\(\)/, "오른층 앵커 쿼리가 사라졌다");
  assert.match(code, /self\.startFlightsQuery\(\)/, "쿼리를 기동하지 않는다 — 정의만 있으면 값은 안 온다");
  assert.match(code, /HKAnchoredObjectQuery\([\s\S]{0,200}?type: flightsType/, "앵커 쿼리 대상이 오른층이 아니다");
});

test("① 첫 실행 과거 재생 차단 — 앵커 없으면 지금 이후만", () => {
  const fn = code.slice(code.indexOf("private func startFlightsQuery"));
  assert.match(
    fn.slice(0, 700),
    /flightsAnchor == nil[\s\S]{0,160}?predicateForSamples\(withStart: Date\(\)/,
    "첫 실행 가드가 없다 — 과거 며칠치가 한 배치에 합산된다",
  );
});

test("② 빌더와 이중 계상 금지 — enableCollection·statistics 에서 오른층이 빠져 있다", () => {
  assert.doesNotMatch(
    code,
    /enableCollection\(for: flightsType/,
    "워크아웃 빌더가 오른층을 다시 수집한다 — 앵커 쿼리와 겹쳐 같은 계단이 두 번 세어진다",
  );
  assert.doesNotMatch(
    code,
    /statistics\(for: flightsType\)/,
    "빌더 통계로 오른층을 다시 읽는다 — 앵커 쿼리와 겹친다",
  );
  // 걸음은 반대로 빌더가 계속 소스여야 한다(회귀 방지 대조군).
  assert.match(code, /enableCollection\(for: stepsType/, "걸음까지 빌더에서 빠졌다");
});

test("③ 워치 표본만 합산 — 아이폰이 기록한 계단을 걸러낸다", () => {
  const fn = code.slice(code.indexOf("private func ingestFlights"));
  assert.match(
    fn.slice(0, 600),
    /isAppleWatchSample\(s\)/,
    "출처 필터가 사라졌다 — 아이폰 계단이 섞여 이중 계상된다",
  );
  assert.match(code, /private static func isAppleWatchSample/, "필터 구현이 사라졌다");
});

test("④ 서버 계약 유지 — 누적에 더하고 증분은 appendCountDelta 가 뽑는다", () => {
  const fn = code.slice(code.indexOf("private func ingestFlights"));
  assert.match(fn.slice(0, 600), /sessionFlights \+= v/, "누적 갱신이 사라졌다");
  assert.match(
    code,
    /appendCountDelta\(session: sessionFlights, reported: &flightsReported, key: "flt"\)/,
    "증분 전송 계약이 깨졌다 — 하루 누계를 보내면 서버 상한(500)에서 스트립된다",
  );
});
