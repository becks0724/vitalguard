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

// ── 2026-08-20 추가 · 실내·지하 좌표 미확보 대응 ────────────────────────────────
// 실측 — 지하주차장 18:40·실내 18:41 두 장 모두 각인이 `위치 미확보` 였고, 같은 날 실외
// 17:16·17:17·23:38 은 좌표가 들어왔다. 원인은 신호가 아니라 **요구 등급**이다.
// `requestLocation()` 은 요구 정확도를 만족하는 fix 만 주는데 실내 Wi-Fi 측위는 30~65m 라
// 10m 요구를 영영 못 채운다. 아래 셋이 풀리면 같은 자리에서 다시 빈 좌표가 된다.

test("★ 일회성 요청은 10m 등급을 요구하지 않는다 — 실내에서 콜백이 영영 안 온다", () => {
  const cls = loc.slice(loc.indexOf("final class OneShotLocator"));
  assert.ok(cls.length > 200, "OneShotLocator 를 못 찾았다 — 가드를 다시 맞춰야 한다");
  assert.doesNotMatch(
    cls,
    /desiredAccuracy\s*=\s*kCLLocationAccuracyNearestTenMeters/,
    "10m 등급으로 되돌아갔다 — 지하·실내에서 각인 좌표가 통째로 빈다",
  );
  assert.match(
    cls,
    /desiredAccuracy\s*=\s*kCLLocationAccuracyHundredMeters/,
    "100m 등급이 아니다 — 각인은 '어느 현장인가' 라 확보율이 정밀도보다 중요하다",
  );
});

test("★ 신선도 창과 타임아웃이 실내에서 버틸 만큼 넓다", () => {
  const sig = loc.slice(loc.indexOf("func requestFreshFix("));
  const head = sig.slice(0, sig.indexOf(") {"));
  const fresh = head.match(/freshEnoughSec:\s*TimeInterval\s*=\s*(\d+)/);
  const timeout = head.match(/timeout:\s*TimeInterval\s*=\s*(\d+)/);
  // ⚠ `noUncheckedIndexedAccess: true` — 캡처 그룹은 `string | undefined` 다.
  const freshVal = fresh?.[1];
  const timeoutVal = timeout?.[1];
  assert.ok(freshVal && timeoutVal, "기본값을 못 읽었다 — 시그니처가 바뀌었다");
  assert.ok(
    Number(freshVal) >= 300,
    `신선도 창이 ${freshVal}초다 — 60초로 되돌리면 직전 좌표를 못 쓴다`,
  );
  assert.ok(
    Number(timeoutVal) >= 12,
    `타임아웃이 ${timeoutVal}초다 — 실내 측위는 8초 안에 안 온다`,
  );
});

test("★ 새 fix 가 실패하면 마지막으로 알던 좌표로 되돌아간다", () => {
  const fn = loc.slice(loc.indexOf("func requestFreshFix("));
  const body = fn.slice(0, fn.indexOf("\n    /// [maxAgeSec]"));
  assert.ok(body.length > 200, "requestFreshFix 본문을 못 잘랐다");
  assert.doesNotMatch(
    body,
    /guard let self, let loc else \{ completion\(nil\); return \}/,
    "실패 즉시 nil 로 끝낸다 — 실내에서 각인이 항상 빈다",
  );
  // ⚠ 전체 검색으로는 못 가른다 — 함수 **머리의 선조회**가 같은 문자열이라, 실패 분기에서
  //   폴백을 지워도 통과한다(작성 중 음성 대조로 실제 확인). **실패 분기 안**을 본다.
  const elseAt = body.indexOf("guard let loc else {");
  assert.notEqual(elseAt, -1, "새 fix 실패 분기가 사라졌다");
  const failBranch = body.slice(elseAt, body.indexOf("\n                }", elseAt));
  assert.match(
    failBranch,
    /cachedFix\(within: freshEnoughSec\)/,
    "실패 분기에 캐시 폴백이 없다 — 실내에서 각인이 항상 빈다",
  );
  // 시스템이 들고 있는 마지막 좌표까지 봐야 추적이 꺼진 상태에서도 값이 나온다.
  const cached = loc.slice(loc.indexOf("private func cachedFix("));
  assert.match(
    cached.slice(0, cached.indexOf("\n    }")),
    /oneShot\.lastKnown/,
    "우리 latestFix 만 본다 — 추적이 꺼져 있으면 비어 있어 아무 도움이 안 된다",
  );
});
