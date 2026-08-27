// 워치 상단 시계 — 비공식 API 로 시스템 시계를 숨기고 직접 그리는 **짝**을 지킨다
//
// 이 가드가 초록이면 보장되는 것 = 워치 1면에서 시계는 **정확히 하나** 그려진다.
// ⚠ 한쪽만 남으면 화면이 곧바로 망가진다 — 모디파이어만 남으면 시계가 **하나도** 없고,
//   내 시계만 남으면 시스템 시계와 겹쳐 **둘**이 된다. 둘 다 사용자가 바로 알아챈다.
// ⚠ 이 가드는 **소스의 짝**만 본다. OS 업데이트로 밑줄 API 가 동작을 멈추는 경우는 코드로
//   못 잡는다 — 그건 실기기에서 "시계가 둘" 로 나타나고, 그때 볼 자리를 주석에 적어 뒀다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const view = readFileSync(
  join(ROOT, "..", "vitalguard_app", "ios", "VitalWatch", "ContentView.swift"),
  "utf8",
);

// ⚠ **주석을 걸러 낸 뒤 본다.** 이 파일의 복구법 주석이 `Text(Self.clock(now))` 를 글자
//   그대로 적고 있어서, 안 거르면 진짜 코드를 지워도 주석이 정규식을 만족시킨다
//   (변이 시험에서 실제로 통과해 버렸다 — 가드가 제 문서를 코드로 읽었다).
// ⚠ 정규식으로 `//` 를 지우지 않는다 — URL 의 `//` 를 먹는다([[L-119]]). **줄 단위**로 뺀다.
const code = view
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("//"))
  .join("\n");

const hidesSystemClock = /\._statusBarHidden\(true\)/.test(code);
const drawsOwnClock = /Text\(Self\.clock\(now\)\)/.test(code);

test("★ 시스템 시계를 숨기면 내 시계를 그린다 — 짝이 깨지면 시계가 둘이거나 없다", () => {
  assert.equal(
    hidesSystemClock,
    drawsOwnClock,
    hidesSystemClock
      ? "시스템 시계를 숨겨 놓고 직접 그리지 않는다 — 화면에 시계가 하나도 없다"
      : "직접 그리는 시계만 있고 시스템 시계를 안 숨긴다 — 시계가 둘로 보인다",
  );
});

test("비공식 API 라는 사실과 고장 증상이 코드에 적혀 있다", () => {
  // 다음 사람이 이 줄을 만날 때 "왜 밑줄이냐" 와 "깨지면 어떻게 보이냐" 를 코드에서 답해야 한다.
  assert.match(view, /비공식 API/);
  assert.match(view, /시계가 \*\*둘\*\* 보인다/);
});

test("시계 갱신이 걸려 있다 — 안 걸면 앱을 켠 시각에 멈춘다", () => {
  assert.match(view, /Timer\.publish\(every: \d+, on: \.main, in: \.common\)\.autoconnect\(\)/);
  assert.match(view, /\.onReceive\(clockTick\)/);
});
