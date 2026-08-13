// 생체 이력 API 인증 가드 — 무인증 노출(2026-08-13 발견·수리)이 재발하면 실패한다.
//
// 경위 — 08-12 추세 실데이터화로 /api/mock/history 가 실측 심박·활동 시계열을 내주게 됐는데
// 게이트가 없어 사번만 알면 URL 만으로 조회 가능했다(라이브 200 실측). 모의 곡선 시절에는
// 무해했던 라우트가 데이터 성격이 바뀌며 구멍이 된 사례 — "경로의 민감도는 데이터가 정한다".
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const route = readFileSync(join(ROOT, "app", "api", "mock", "history", "route.ts"), "utf8");
const panel = readFileSync(join(ROOT, "app", "components", "VitalHistoryPanel.tsx"), "utf8");

test("history GET — 차단 관용구가 핸들러 앞에 있다(호출 존재가 아니라 게이트 형태를 본다)", () => {
  const handler = route.slice(route.indexOf("export async function GET"));
  assert.match(
    handler.slice(0, 500),
    /if \(!verifyBasicAuth\(request\)\)/,
    "생체 이력 인증 게이트 누락·변형 — 사번만으로 실측 시계열이 공개된다",
  );
});

test("패널 — 두 fetch(본 지표·심박 오버레이) 모두 세션 토큰을 동봉한다", () => {
  assert.match(panel, /import \{ getSessionToken \} from "\.\/LoginGate"/);
  const fetches = panel.match(/fetch\(`\/api\/mock\/history\?[^`]*`, \{ cache: "no-store", headers: authHeaders \}\)/g) ?? [];
  assert.equal(fetches.length, 2, `토큰 미동봉 history fetch 존재(동봉 ${fetches.length}/2)`);
});
