// 좌측 패널 오토리사이징 가드 — 축소가 걸린 채로 경보 모달이 패널 안에 갇히지 않게 고정한다
//
// ★ 무엇을 했나(2026-08-21). 좌측 고정 패널(현장 환경)은 내용이 창보다 길면 **스크롤**했다.
//   원래는 잘려서 손도 못 댔고, 그걸 스크롤로 고친 것이 종전 상태다. 여기에 한 겹 더 얹어
//   `FitToViewport`(CSS zoom)로 축소해 한 화면에 담는다. 스크롤 상자는 **남겨 둔다** —
//   축소가 끝까지 못 가는 극단에서 종전 동작으로 떨어지게 하는 안전망이다.
//
// ★ 이 가드가 초록일 때 보장하는 것(한 문장) —
//   **현장 환경 패널이 창 높이 기준으로 축소되고(같은 상수로), 그 안에서 띄우는 전체화면 모달
//   둘은 zoom 밖(body)으로 포털돼 뷰포트 기준을 유지한다.**
//   보장하지 않는 것 = 축소가 실제로 몇 배가 되는가(런타임 수렴) · 다른 다섯 패널의 거동.
//
// ⚠ 왜 포털이 계약인가. `zoom` 안의 `position:fixed` 는 기준이 뷰포트가 아니라 **축소된
//   좌표계**로 바뀐다. 포털을 되돌리면 전체화면 경보가 패널 폭(296px)으로 쪼그라드는데,
//   **화면에는 그냥 작은 팝업으로 보여 결함으로 안 읽힌다**([[L-105]] 계열 — 보이는데 틀린 것).
//   2026-08-21 실측 = 포털 후 부모 BODY · 1920x750 = 뷰포트 정확히 일치.
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
    .join("\n");
}

const panels = codeOnly(read("SiteSidePanels.tsx"));

test("★ 현장 환경 패널이 오토리사이징에 실제로 물려 있다", () => {
  // 이름만 찾으면 import 만 남아도 통과한다 — **감싸는 지점**을 짚는다.
  assert.match(
    panels,
    /<FitToViewport gutterPx=\{PANEL_GUTTER_PX\}>/,
    "env 분기가 FitToViewport 로 안 감싸였거나 gutter 를 상수로 안 준다",
  );
  assert.match(panels, /<\/FitToViewport>/, "닫는 태그가 없다");
});

test("★ 넘침 한계와 축소 기준이 같은 상수에서 나온다 — 손으로 두 번 적으면 갈린다", () => {
  assert.match(
    panels,
    /const PANEL_GUTTER_PX = PANEL_TOP_PX \+ PANEL_BOTTOM_GAP_PX;/,
    "gutter 상수가 사라졌다",
  );
  // 스크롤 상자가 리터럴로 되돌아가면(예: max-h-[calc(100vh-13rem)]) 두 값이 조용히 갈린다.
  assert.match(
    panels,
    /maxHeight: `calc\(100vh - \$\{PANEL_GUTTER_PX\}px\)`/,
    "스크롤 상자가 상수를 안 쓴다 — 축소 기준과 갈릴 수 있다",
  );
  assert.ok(
    !/max-h-\[calc\(100vh-13rem\)\]/.test(panels),
    "리터럴 13rem 이 되살아났다 — 상수와 갈리는 두 번째 출처다",
  );
});

test("★ 스크롤 안전망을 걷어내지 않는다 — 축소 실패 시 '잘림'으로 되돌아간다", () => {
  assert.match(panels, /className="overflow-y-auto"/, "스크롤 상자가 사라졌다");
});

for (const file of ["WeatherRuleModal.tsx", "WeatherAlertToast.tsx"]) {
  test(`★ ${file} 은 body 로 포털한다 — zoom 좌표계에 갇히면 안 된다`, () => {
    const src = codeOnly(read(file));
    assert.match(src, /import \{ createPortal \} from "react-dom";/, "포털 import 가 없다");
    // 선언만 있고 안 쓰면 없는 것과 같다([[L-91]]) — 반환 지점과 대상까지 짚는다.
    assert.match(src, /return createPortal\(/, "반환이 포털을 안 탄다");
    assert.match(src, /document\.body,/, "body 로 안 보낸다");
    assert.match(
      src,
      /if \(typeof document === "undefined"\) return null;/,
      "SSR 가드가 없다 — 서버 렌더에서 document 를 만진다",
    );
  });
}
