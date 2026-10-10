// 로그인 폼 칸 오토리사이징 가드 — 창이 낮아도 폼을 스크롤 대신 칸 높이에 맞춰 줄이는 배선을 고정한다
//
// ★ 무엇을 했나(2026-10-10 · 사용자 요청). 로그인 카드는 높이가 min(830px, 100dvh-5rem) 으로 갇혀 있고
//   폼(로고 136 · 문구 · 입력 둘 · 버튼 둘 · 링크 · 스토어 배지)은 그보다 길어, 창이 낮으면 오른쪽 칸이
//   스크롤되며 로고 위쪽이 잘려 보였다. `FitToViewport`(CSS zoom)에 **기준 상자**(boundsRef)와 **하한**
//   (minScale)을 더해, 폼 칸의 안쪽 높이에 맞춰 줄인다. 칸의 스크롤 상자는 남긴다 — 하한에서도 넘치는
//   극단에서 종전 동작으로 떨어지는 안전망이다.
//
// ★ 이 가드가 초록일 때 보장하는 것(한 문장) —
//   **로그인 폼 칸의 내용이 그 칸을 기준 상자로 FitToViewport 에 감싸이고, 하한은 상수 하나에서 나오며,
//   2단계 인증 팝업은 축소 밖(카드 기준)에 남는다. FitToViewport 는 기준 상자가 없으면 종전처럼 창 기준이다.**
//   보장하지 않는 것 = 실제 배율 값(런타임 수렴) — 2026-10-10 로컬 실측: 1366x768 0.885 · 1280x720 0.819 ·
//   1280x600 0.650 에서 칸 넘침 0px(통제군 = 배율 1 강제 시 83 · 131 · 251px) · 1920x1080·폰 390x844 는 1.000.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, "app", "components", f), "utf8");

/** 주석을 걷어낸 본문 — 이름이 주석에만 남아도 통과하는 약한 단언을 막는다([[L-104]]). */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

const login = codeOnly(read("LoginScreen.tsx"));
const fit = codeOnly(read("FitToViewport.tsx"));

test("★ 로그인 폼 칸 내용이 그 칸을 기준 상자로 오토리사이징에 물려 있다", () => {
  // 이름만 찾으면 import 만 남아도 통과한다 — 감싸는 지점과 기준 상자를 짚는다.
  assert.match(
    login,
    /<FitToViewport boundsRef=\{formColRef\} minScale=\{LOGIN_FIT_MIN_SCALE\}/,
    "폼 칸 내용이 FitToViewport 로 안 감싸였거나 기준 상자·하한을 안 준다",
  );
  assert.match(login, /ref=\{formColRef\}/, "기준 상자 ref 가 폼 칸에 안 붙었다 — 창 기준으로 되돌아간다");
  assert.match(login, /<\/FitToViewport>/, "닫는 태그가 없다");
});

test("★ 하한은 상수 하나에서 나오고 0 과 1 사이다", () => {
  const m = login.match(/const LOGIN_FIT_MIN_SCALE = ([0-9.]+);/);
  assert.ok(m, "LOGIN_FIT_MIN_SCALE 상수가 사라졌다");
  const v = Number(m![1]);
  assert.ok(v > 0 && v < 1, `하한 ${v} 가 0~1 밖이다 — 0 이면 끝없이 줄고 1 이면 아무것도 안 줄인다`);
});

test("★ 폼 칸의 스크롤 상자는 안전망으로 남는다", () => {
  // 하한에서도 넘치는 아주 낮은 창에서 종전처럼 스크롤로 떨어져야 한다 — 없애면 잘림으로 되돌아간다.
  assert.match(login, /ref=\{formColRef\}\s+className=\{`no-scrollbar flex w-full flex-col items-center overflow-y-auto/);
});

test("★ 2단계 인증 팝업은 축소 밖(카드 기준)에 남는다", () => {
  // zoom 안에 들어가면 카드 위로 떠오르는 팝업까지 같이 작아진다.
  const close = login.indexOf("</FitToViewport>");
  const prompt = login.indexOf("<TwoFactorPrompt");
  assert.ok(close > 0 && prompt > close, "TwoFactorPrompt 가 FitToViewport 안으로 들어갔다");
});

test("★ FitToViewport — 기준 상자가 있으면 그 안쪽 높이, 없으면 종전 창 높이 기준", () => {
  assert.match(fit, /let available = window\.innerHeight - gutterPx;/, "기본(창 기준) 경로가 바뀌었다 — 기존 모달·패널이 영향받는다");
  assert.match(
    fit,
    /available = bounds\.clientHeight - parseFloat\(cs\.paddingTop\) - parseFloat\(cs\.paddingBottom\);/,
    "기준 상자의 패딩을 빼지 않는다 — 패딩만큼 넘친다",
  );
  assert.match(fit, /Math\.max\(minScale, Math\.min\(1, cur \* \(available \/ rendered\)\)\)/, "하한 적용이 빠졌다");
  assert.match(fit, /minScale = 0,/, "minScale 기본값이 0 이 아니다 — 기존 호출부의 동작이 바뀐다");
});
