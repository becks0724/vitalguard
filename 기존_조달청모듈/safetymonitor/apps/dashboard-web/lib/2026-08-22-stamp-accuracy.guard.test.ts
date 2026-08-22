// 각인 좌표 계약 가드 — 불확실성을 밝히는가, 그리고 서버 파서가 그것을 여전히 읽는가
//
// ★ 왜 필요한가. 2026-08-22 10:17 지하 촬영에서 각인이 **44m 오차 좌표로 지번을 확정처럼**
//   찍었다(실제 계림동 1869 · 각인 계림동 463-8). 좌표 자체는 폴백이 동작해 비지 않았고,
//   주소 변환도 그 좌표의 올바른 역지오코딩이었다. 틀린 것은 **아무 불확실성도 안 밝힌 것**이다.
//
// ★ 이 가드가 초록일 때 보장하는 것(한 문장) —
//   **각인이 정확도를 함께 적고, 좌표 선택이 "최근"이 아니라 유효 반경으로 이뤄지며,
//   소수 자릿수가 서버 파서가 읽을 수 있는 하한 아래로 내려가지 않는다.**
//   보장하지 않는 것 = 그 좌표가 옳은가(지하에서는 둘 다 나쁠 수 있다 — 그래서 밝히는 것이다).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const RUNNER = join(here, "..", "..", "vitalguard_app", "ios", "Runner");
const media = readFileSync(join(RUNNER, "MediaCapture.swift"), "utf8");
const locp = readFileSync(join(RUNNER, "LocationProvider.swift"), "utf8");
const parser = readFileSync(join(here, "ocr-stamp.ts"), "utf8");

/** 주석을 걷어낸 본문에서만 검사한다 — 이름이 주석에 남아도 통과하면 가드가 아니다([[L-104]]). */
const codeOnly = (src: string) => src.replace(/^\s*\/\/.*$/gm, "").replace(/^\s*\/\/\/.*$/gm, "");
const mediaCode = codeOnly(media);
const locCode = codeOnly(locp);

test("★ 각인이 정확도를 함께 적는다 — 없으면 오차가 확정으로 읽힌다", () => {
  // 앵커 셋 — 꺼내는 곳 · 문구를 만드는 곳 · **실제로 줄에 붙이는 곳**.
  // ⚠ 앞의 둘만 보면 변이 시험에서 `+ accText` 만 지워도 통과했다(실제로 그랬다 · [[L-104]]).
  //   "이름이 파일 어딘가에 있다" 가 아니라 "그 값이 각인 줄에 실린다" 를 못 박아야 한다.
  assert.match(mediaCode, /locationAccuracyMeters/, "각인이 정확도 값을 아예 안 꺼낸다");
  assert.match(mediaCode, /±%\.0fm/, "정확도 문구를 만들지 않는다");
  const appended = mediaCode
    .split("\n")
    .filter((l) => l.includes("lines.append(") && l.includes("digits"));
  assert.equal(appended.length, 1, `좌표를 붙이는 줄이 ${appended.length}개다 — 각인 형식이 바뀌었다`);
  assert.match(appended[0]!, /\+ accText/, "정확도를 만들어 놓고 좌표 줄에 안 붙인다");
  assert.match(appended[0]!, /\+ suffix/, "좌표 나이를 좌표 줄에 안 붙인다");
  // 나이 표기는 08-19 에 들어간 것이다 — 함께 살아 있어야 한다(둘은 다른 축이다).
  assert.match(mediaCode, /분 전 좌표/, "좌표 나이 표기가 사라졌다");
});

test("★★ 소수 자릿수가 서버 파서 하한 아래로 안 내려간다 — 양끝을 재서 대조한다", () => {
  // 서버가 요구하는 최소 자릿수를 정규식에서 **뽑아낸다**. 리터럴 4 를 적으면
  // 파서가 바뀔 때 이 가드가 조용히 틀린 것을 지킨다([[L-101]]).
  const req = /\\d\{(\d+),\}/.exec(parser);
  assert.ok(req, "ocr-stamp.ts 의 GPS 정규식에서 자릿수 요구를 못 찾았다 — 파서 형식이 바뀌었다");
  const serverMin = Number(req[1]);

  const dg = /let digits\s*=\s*[^\n]*?\?\s*(\d+)\s*:\s*(\d+)/.exec(mediaCode);
  assert.ok(dg, "MediaCapture 에서 자릿수 분기를 못 찾았다 — 각인 형식이 바뀌었다");
  const appMin = Math.min(Number(dg[1]), Number(dg[2]));

  assert.ok(
    appMin >= serverMin,
    `앱이 최소 ${appMin}자리로 찍는데 서버 파서는 ${serverMin}자리 이상을 요구한다 — 좌표를 통째로 못 읽는다`,
  );
});

test("★ 좌표를 '최근'이 아니라 유효 반경으로 고른다 — 두 실측이 최근 우선을 반증했다", () => {
  // 08-20 18:33 최근 우선이 336m 짜리를 골랐다(폰은 149m 짜리를 들고 있었다).
  // 08-22 10:17 정확도만 우선이면 5분 전 17.9m(95m 떨어짐)를 골랐을 것이다.
  assert.match(locCode, /func effectiveRadiusM/, "유효 반경 계산이 없다");
  assert.match(locCode, /horizontalAccuracy \+ age \* walkSpeedMps/, "정확도와 나이를 합치지 않는다");
  const cached = locCode.slice(locCode.indexOf("private func cachedFix"));
  const body = cached.slice(0, cached.indexOf("\n    }"));
  assert.match(body, /effectiveRadiusM/, "cachedFix 가 유효 반경을 안 쓴다");
  assert.doesNotMatch(body, /\.max \{[^}]*timestamp/, "cachedFix 가 아직 '가장 최근'을 고른다 — 08-20 회귀");
});

test("★ 나빠도 거르지 않는다 — 거르면 '위치 미확보'로 되돌아간다", () => {
  // 2026-08-19 실측에서 품질 게이트가 지하 사진 두 장의 좌표를 통째로 비웠다.
  // 나쁜 좌표는 각인하고 ±로 밝히는 것이 옳다. 이 항목이 나머지보다 중요하다.
  const fn = locCode.slice(locCode.indexOf("func requestFreshFix"));
  const body = fn.slice(0, fn.indexOf("\n    /// [maxAgeSec]"));
  assert.match(body, /completion\(self\.payload\(from: best \?\? loc\)\)/, "새 fix 경로가 폴백 없이 끝난다");
  assert.doesNotMatch(
    body,
    /horizontalAccuracy[^\n]*\{\s*\n\s*completion\(nil\)/,
    "정확도로 걸러 nil 을 낸다 — 08-19 회귀",
  );
});

test("★ 서버 대조는 앱을 고친 뒤에도 남긴다 — 이미 찍힌 사진은 서버가 지킨다", () => {
  // 앱이 또 어긋나면 그것을 잡는 줄이 이것이다. 지우지 말 것.
  assert.match(parser, /gps/, "ocr-stamp 의 GPS 추출이 사라졌다");
});
