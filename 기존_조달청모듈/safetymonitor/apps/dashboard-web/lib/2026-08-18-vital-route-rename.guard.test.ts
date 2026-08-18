// 생체 경로 개명 가드(2026-08-18) — "mock" 이름 소멸과 수집 진입점 단일화가 되돌아가면 실패한다.
//
// 경위 — 프로덕션 생체 수집 경로 이름이 `/api/mock/vital` 이라 **우리 문서와 테스트 인프라가 그것을
// 목업으로 알고 있었다**(실물 오해 3건). 동시에 구 iOS 앱이 그 경로를 14곳에 하드코딩하고 있어
// 재로그인만 하면 다시 POST 한다 — `source` 로는 구/신 앱을 구분할 수 없으므로(둘 다
// "VitAlGuard-WatchVitals") **확실한 차단 수단은 경로뿐이다**. 그래서 경로를 없앴다.
//
// 축 = 앱이 쓰는 것 `/api/app/*` · 관제가 쓰는 것 `/api/monitor/*`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const monitorRoute = readFileSync(join(ROOT, "app", "api", "monitor", "vital", "route.ts"), "utf8");
const dash = readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8");
const panel = readFileSync(join(ROOT, "app", "components", "VitalHistoryPanel.tsx"), "utf8");

test("★ 앵커 — 관제 경로가 본체의 GET 을 실제로 재수출한다", () => {
  // 아래 금지 검사(POST 없음)는 파일이 비어도 참이 된다. 먼저 대상이 살아 있음을 고정한다(L-79).
  assert.match(
    monitorRoute,
    /export \{ GET \} from "\.\.\/\.\.\/app\/vital\/route"/,
    "관제 GET 재수출이 사라졌다 — 아래 금지 검사가 공허해진다",
  );
});

test("수집 진입점은 하나 — 관제 경로가 POST 를 재수출하지 않는다", () => {
  // 여기에 POST 를 더하면 수집 경로가 둘로 갈리고, 그 상태가 정확히 개명 전이다.
  // ⚠ 주석을 걷어낸 본문에서만 검사한다 — 그러지 않으면 "POST 를 재수출하지 않는다"고 적은
  // 그 파일의 설명 주석을 가드가 위반으로 잡는다(2026-08-16 같은 형태로 한 번 겪었다).
  const body = monitorRoute.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(
    body,
    /\bPOST\b/,
    "관제 경로에 POST 가 붙었다 — 수집 진입점은 POST /api/app/vital 하나로 유지한다",
  );
});

test("`/api/mock/` 경로가 부활하지 않았다 — 구 앱 차단은 경로로만 가능하다", () => {
  assert.equal(
    existsSync(join(ROOT, "app", "api", "mock")),
    false,
    "app/api/mock/ 이 되살아났다 — 구 앱이 다시 POST 할 수 있고 '목업' 오해도 함께 돌아온다",
  );
});

test("관제 화면이 새 경로를 부른다(옛 경로 잔존 금지)", () => {
  assert.match(dash, /fetch\("\/api\/monitor\/vital"/, "관제 폴링이 새 경로를 안 쓴다");
  assert.match(panel, /\/api\/monitor\/vital\/history\?/, "이력 조회가 새 경로를 안 쓴다");
  for (const [name, src] of [
    ["DemoDashboard", dash],
    ["VitalHistoryPanel", panel],
  ] as const) {
    assert.doesNotMatch(src, /fetch\([`"]\/api\/mock\//, `${name} 에 옛 /api/mock 호출이 남아 있다`);
  }
});
