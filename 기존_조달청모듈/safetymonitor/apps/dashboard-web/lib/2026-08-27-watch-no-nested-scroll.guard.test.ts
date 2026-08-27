// 워치 면 안에 세로 스크롤을 겹치지 않는다 — 겹치면 크라운이 안쪽에 먹혀 면 이동이 죽는다
//
// 이 가드가 초록이면 보장되는 것 = 세로 페이징 컨테이너 **하나만** 크라운을 갖는다.
// ⚠ 실기기 제보로 확인한 실사고(2026-08-27) — 설정 면에 `ScrollView` 를 넣었더니 그 면에서
//   크라운을 돌려도 위 면으로 못 올라갔다. 안쪽은 스크롤할 것이 없어 아무 일도 안 일어나고,
//   바깥으로 넘겨주지도 않는다. 화면은 멀쩡해 보이는데 조작만 죽는 형태라 눈으로는 안 잡힌다.
// ⚠ 시트(`sheet`)는 별개 표현이라 그 안의 스크롤은 괜찮다 — 이 가드가 보는 것은 **면 본문**이다.
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

// ⚠ 주석을 **줄 단위로** 걸러 낸다. 이 파일의 설명 주석이 `ScrollView` 를 글자 그대로 적고
//   있어서, 안 거르면 주석만으로 가드가 빨개진다. 정규식으로 `//` 를 지우지 않는다(L-119).
const code = view
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("//"))
  .join("\n");

/// `private var <name>: some View {` 부터 같은 들여쓰기의 닫는 괄호까지.
function pageBody(name: string): string {
  const head = `    private var ${name}: some View {`;
  const start = code.indexOf(head);
  assert.notEqual(start, -1, `${name} 를 못 찾았다 — 이름이 바뀌었으면 이 가드도 고친다`);
  const end = code.indexOf("\n    }\n", start);
  assert.notEqual(end, -1, `${name} 의 끝을 못 찾았다`);
  return code.slice(start, end);
}

const PAGES = [
  "vitalsPage",
  "heartRatePage",
  "spo2Page",
  "energyPage",
  "transmitPage",
  "settingsPage",
];

test("★ 면 본문에는 세로 스크롤을 두지 않는다 — 크라운은 바깥 페이징이 갖는다", () => {
  for (const page of PAGES) {
    assert.doesNotMatch(
      pageBody(page),
      /ScrollView\s*[({]/,
      `${page} 안에 ScrollView 가 있다 — 그 면에서 크라운으로 면 이동이 죽는다`,
    );
  }
});

test("[양성 통제군] 바깥 컨테이너는 실제로 세로 페이징 ScrollView 다", () => {
  // 이 단언이 없으면 위 0건이 "안 겹친다" 인지 "파일이 딴 것" 인지 못 가른다.
  assert.match(code, /ScrollView\(\.vertical\)/);
  assert.match(code, /\.scrollTargetBehavior\(\.paging\)/);
});
