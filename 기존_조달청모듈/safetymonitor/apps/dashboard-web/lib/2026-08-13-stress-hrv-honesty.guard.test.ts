// 스트레스 칩 정직성 가드 — 없는 근거를 있다고 말하면 실패한다.
//
// 배경(2026-08-13 실기기 실증) — 스트레스 지수는 HRV 가 있어야 심박과 독립인 신호를 갖는다.
// 그런데 이 앱은 상시 `HKWorkoutSession` 으로 수집을 유지하고, watchOS 는 워크아웃 중
// 심호흡 세션을 거부한다("심호흡 세션을 시작하려면 먼저 운동을 종료하십시오"). 배경 HRV 측정도
// 일어나지 않아 실사용에서는 HRV 가 사실상 안 들어온다.
// ★ 수집 코드는 정상이다 — 세션을 끄고 심호흡을 돌리자 32.46ms 가 서버까지 도착했다.
//   즉 구조 제약이지 결함이 아니고, 아키텍처가 바뀌면 그대로 쓸 수 있다.
//
// 종전 툴팁은 조건 없이 "활동 보정 초과심박 + HRV" 라고 적어 **없는 근거를 있다고 말했다**.
// 관제자가 독립 신호가 반영된 줄로 오독하면 같은 정보(심박)를 두 번 세게 된다.
// 이 레포가 반복해 고쳐 온 계열이다 — "미수신인데 준수율 100%", "한 번도 안 받았는데 정상 4명".
//
// 렌더 인프라가 없어 문구는 조용히 되돌아간다(tsc·기존 테스트 전부 통과). 소스 불변식으로 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const dash = readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8");

// 칩 함수 구간만 본다 — 파일 전체를 대상으로 하면 **설명 주석**이 매칭돼 가드가 통과한다
// (2026-08-13 시간축 가드에서 실제로 겪었다).
function chipBody(): string {
  const from = dash.indexOf("function StressChip");
  assert.ok(from > 0, "StressChip 을 찾지 못했다 — 가드 재작성 필요");
  const to = dash.indexOf("\nfunction ", from + 10);
  return dash.slice(from, to > from ? to : undefined);
}

test("칩이 HRV 반영 여부를 인자로 받는다", () => {
  assert.match(
    chipBody(),
    /function StressChip\(\{ result, hrvBacked \}/,
    "hrvBacked 가 사라지면 문구가 다시 고정된다",
  );
});

test("HRV 없는 지수를 'HRV 포함'으로 설명하지 않는다", () => {
  const body = chipBody();
  // 삼항으로 갈라야 한다 — 무조건 HRV 를 적으면 없는 근거를 주장하는 것이다.
  assert.match(body, /hrvBacked\s*\n?\s*\?/, "조건부 문구가 아니라 고정 문구로 되돌아갔다");
  assert.match(body, /심박 파생|심박 기반/, "HRV 미반영 상태를 설명하는 문구가 없다");
});

test("HRV 미반영일 때는 호버 없이도 보이게 칩에 표시한다", () => {
  // 툴팁만으로는 부족하다 — 호버하지 않는 관제자가 다수다.
  assert.match(
    chipBody(),
    /\{!hrvBacked && <span/,
    "칩 본문 표기가 사라졌다 — 툴팁만 남으면 대부분의 사용자에게 안 보인다",
  );
});

test("hrvBacked 는 샘플의 실제 HRV 유무에서 나온다(하드코딩 금지)", () => {
  assert.match(
    dash,
    /hrvBacked: inputs\.hrvSdnnMs !== undefined/,
    "판정이 상수로 굳으면 HRV 가 들어와도 '심박 기반'으로 표시된다",
  );
  assert.doesNotMatch(dash, /hrvBacked=\{(true|false)\}/, "호출부에서 값을 고정했다");
});

test("판정·경보에는 손대지 않았다(표시 전용)", () => {
  // 지수의 성격을 밝히는 작업이지 임계·경보를 바꾸는 작업이 아니다.
  // StressChip 은 문구·색만 다루고 알림 경로를 건드리지 않는다.
  const body = chipBody();
  assert.doesNotMatch(body, /recordAlert|sendTelegram|notify/, "칩이 경보 경로를 건드린다");
});
