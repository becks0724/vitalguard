// 촬영 각인 선결조건 가드 — 카메라 권한 문구와 일회성 좌표 요청을 고정한다
//
// ★ 둘 다 **없어도 빌드가 통과하고 화면도 멀쩡하다**. 드러나는 곳이 실기기뿐이라 소스로 못 박는다.
//   ① 권한 문구가 없으면 카메라를 부르는 순간 iOS 가 앱을 죽인다. 이 레포는 같은 형태를 이미
//      겪었다 — HealthKit 문구가 짧아 `requestAuthorization` 에서 크래시(SETUP.md).
//   ② 정지 상태에서는 `currentFix()` 가 nil 이다. `distanceFilter` 100m 가 새 fix 를 막고
//      (실측 fix 간 124·147·105·100m) `maxFixAgeSec` 300초가 지나면 값이 사라진다(실측 295·295·210초).
//      ⟹ 촬영 각인에 좌표를 넣으려면 **그 순간 요청**하는 경로가 반드시 있어야 한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(fileURLToPath(new URL(".", import.meta.url)));
const APP = join(here, "..", "..", "vitalguard_app");
const plist = readFileSync(join(APP, "ios", "Runner", "Info.plist"), "utf8");
const loc = readFileSync(join(APP, "ios", "Runner", "LocationProvider.swift"), "utf8");

test("★ 카메라 사용 설명 문구가 있고, 라벨이 아니라 문장이다", () => {
  const m = plist.match(/<key>NSCameraUsageDescription<\/key>\s*<string>([\s\S]*?)<\/string>/);
  assert.ok(m, "NSCameraUsageDescription 이 없다 — 카메라를 부르는 순간 앱이 종료된다");
  // ⚠ 이 레포는 `noUncheckedIndexedAccess: true` 라 캡처 그룹이 `string | undefined` 다.
  //   그냥 `m[1].trim()` 하면 typecheck 가 막는다(공유 트리 push 게이트에서 실측).
  //   "키만 있고 값이 빈 경우" 와 "문구가 짧은 경우" 를 다른 메시지로 가른다.
  const captured = m[1];
  assert.ok(captured, "문구가 비어 있다 — 키만 있고 값이 없다");
  const text = captured.trim();
  // 짧은 라벨("카메라")로 넣으면 HealthKit 때처럼 런타임 예외가 난다.
  assert.ok(
    text.length >= 20,
    `문구가 너무 짧다(${text.length}자) — 서술형이어야 한다: ${text}`,
  );
});

test("★ 촬영용 일회성 좌표 요청이 있다", () => {
  assert.match(
    loc,
    /func requestFreshFix\(/,
    "일회성 요청 경로가 사라졌다 — 정지 상태에서는 각인에 좌표가 안 들어간다",
  );
  assert.match(
    loc,
    /manager\.requestLocation\(\)/,
    "requestLocation 호출이 없다 — 거리필터·자동 일시정지를 우회할 수단이 이것뿐이다",
  );
});

test("★ 일회성 요청에 추적 여부 가드를 붙이지 않는다", () => {
  const fn = loc.slice(loc.indexOf("func requestFreshFix("));
  const body = fn.slice(0, fn.indexOf("\n    private lazy var oneShot"));
  assert.ok(body.length > 100, "함수 본문을 못 잘랐다 — 가드를 다시 맞춰야 한다");
  assert.doesNotMatch(
    body,
    /if\s+!running/,
    "didExitRegion 의 `if !running` 가드를 복사했다 — 근무 중(추적 on)에는 요청이 안 나간다",
  );
});

test("★ 일회성 측위기는 추적용 매니저와 분리돼 있고 타임아웃이 있다", () => {
  assert.match(
    loc,
    /private final class OneShotLocator/,
    "추적용 매니저를 그대로 쓰면 촬영이 근무 중 추적 설정을 흔들고 유휴 판정을 오발동시킨다",
  );
  const one = loc.slice(loc.indexOf("private final class OneShotLocator"));
  assert.match(
    one,
    /asyncAfter\(deadline:/,
    "타임아웃이 없다 — requestLocation 이 무응답이면 촬영 화면이 영원히 기다린다",
  );
});
