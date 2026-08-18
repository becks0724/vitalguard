// 워치 세션 자동 재개 가드 — "복구할 자리에서 정리만 하던" 결함을 다시 열지 않게 못 박는다.
//
// 무엇이 있었나(2026-08-18 · docs/vital-absence-triage/checklist.md §4-6).
// 수집이 하루에도 몇 번씩 멎었고, 처음엔 앱 프로세스가 죽는 줄 알았다. 워치 크래시·jetsam
// 리포트를 열어 보니 **틀렸다** — pid 7601 이 29시간 유지된 채 공백 넷(69·300·921·174분)을
// 그대로 통과했고 jetsam 피살은 0건이다. 앱은 죽지 않는다. `HKWorkoutSession` 이 끝나면
// **우리 코드가 스스로 수집을 접고**, 그러면 백그라운드 앱이 되어 watchOS 가 suspend·동결한다.
// 그 뒤로는 사람이 앱을 열고 [시작] 을 누를 때까지 영영 안 돌아온다 — 08-17 에 그 상태가
// **하루 6.4시간**이었다.
//
// 종전 코드는 `guard toState == .ended` 뒤에 곧장 `teardown()` 이었다. **사유를 묻지 않았다.**
// 앱이 아직 살아 있는 그 순간이 유일한 자동 복구 지점인데, 거기서 정리를 하고 있었다.
//
// ⚠ 왜 플래그가 필요한가. 사용자의 [정지]도 `session.end()` 라 델리게이트가 보는 그림이
// 시스템 종료와 **완전히 같다**. 표식이 없으면 사람이 끈 것까지 되살아나 정지 버튼이 죽는다.
//
// 이 가드가 지키는 것 일곱.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const watch = readFileSync(
  join(ROOT, "..", "vitalguard_app", "ios", "VitalWatch", "WatchStreamer.swift"),
  "utf8",
);
// 주석을 걷어낸 본문에서만 검사한다 — 설명 주석의 낱말이 가드를 통과시키면 안 된다(2026-08-16 선례).
const bare = watch.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// 델리게이트의 `.ended` 분기 본문만 잘라 낸다 — 파일 어딘가에 낱말이 있는 것과
// "그 분기 안에 있는 것"은 다르다.
const endedBody = (() => {
  const from = bare.indexOf("guard toState == .ended");
  const to = bare.indexOf("didFailWithError", from);
  assert.ok(from > 0 && to > from, "앵커 소실 — .ended 분기를 찾지 못했다");
  return bare.slice(from, to);
})();

test("★ 앵커 — 세션 델리게이트와 teardown 이 살아 있다", () => {
  assert.match(bare, /HKWorkoutSessionDelegate/, "델리게이트 채택이 사라졌다");
  assert.match(bare, /func teardown\(\)/, "teardown 이 사라졌다");
  assert.match(bare, /func autoResume\(/, "autoResume 이 사라졌다");
});

test("① 사용자 정지는 표식을 남긴다 — 없으면 시스템 종료와 구별 불가", () => {
  const stop = bare.slice(bare.indexOf("func stop()"), bare.indexOf("func autoResume("));
  assert.match(stop, /stopRequestedByUser = true/, "stop() 이 표식을 안 남긴다");
  assert.ok(
    stop.indexOf("stopRequestedByUser = true") < stop.indexOf("session?.end()"),
    "표식을 end() 뒤에 세우면 델리게이트가 먼저 돌아 사람이 끈 것까지 되살아난다",
  );
});

test("② 세션이 끝나면 사유를 묻고, 내가 끝낸 게 아니면 다시 시작한다", () => {
  assert.match(endedBody, /autoResume\(/, "★ 이 트랙의 결함 — .ended 에서 재개하지 않는다");
  assert.match(endedBody, /if !byUser/, "사유를 묻지 않고 무조건 재개하면 [정지] 가 죽는다");
});

test("③ 사유는 teardown 보다 먼저 붙잡는다 — 뒤에 읽으면 다음 세션 것과 섞인다", () => {
  const capture = endedBody.indexOf("let byUser = stopRequestedByUser");
  const clear = endedBody.indexOf("teardown()");
  assert.ok(capture >= 0, "사유를 지역 변수로 붙잡지 않는다");
  assert.ok(capture < clear, "teardown 뒤에 읽으면 표식이 이미 다음 세션 것이다");
});

test("④ 세션 오류도 같은 처방을 받는다", () => {
  const fail = bare.slice(bare.indexOf("didFailWithError"));
  assert.match(fail, /autoResume\(/, "오류로 끝난 세션이 복구되지 않는다");
  assert.match(fail, /if !byUser/, "오류 경로에서도 사용자 정지는 되살리지 않는다");
});

test("⑤ 폭주 방지 — 무제한 재시작이 아니다", () => {
  const fn = bare.slice(bare.indexOf("func autoResume("), bare.indexOf("func beginWorkout()"));
  assert.match(fn, /autoResumeMaxBurst/, "연속 실패 상한이 없다");
  assert.match(fn, /guard autoResumeBurst <= autoResumeMaxBurst else/, "상한 검사가 없다");
  assert.match(fn, /autoResumeMinAliveSec/, "'재개 직후 또 끝남'을 가리는 시간 기준이 없다");
});

test("⑥ 새 세션은 표식을 되돌린 자리에서 출발한다", () => {
  const begin = bare.slice(bare.indexOf("func beginWorkout()"));
  assert.match(
    begin.slice(0, 400),
    /stopRequestedByUser = false/,
    "안 되돌리면 [정지] 한 번 뒤로는 시스템 종료가 영영 복구되지 않는다",
  );
});

test("⑦ 사람이 [시작] 을 누르면 포기 상태가 풀린다", () => {
  const start = bare.slice(bare.indexOf("func start()"), bare.indexOf("func stop()"));
  assert.match(start, /autoResumeBurst = 0/, "포기 뒤 수동 시작이 카운터를 안 푼다");
});
