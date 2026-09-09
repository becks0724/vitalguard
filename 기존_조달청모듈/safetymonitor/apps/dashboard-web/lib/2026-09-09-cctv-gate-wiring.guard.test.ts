// 구조적 재발 방지 — CAM-03 게이트 직결 배선의 불변식 가드.
//
// 왜 가드 테스트인가 — 두 결함 모두 tsc·lint·기존 테스트가 전부 통과하는 채로 존재할 수 있다.
// 렌더 테스트 인프라(Playwright·testing-library)가 이 저장소에 없으므로 소스 불변식으로 고정한다.
// 같은 방식의 선례 = lib/2026-09-01-ppe-compliance-unjudged.guard.test.ts
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const stream = readFileSync(join(ROOT, "app", "components", "CctvGateStream.tsx"), "utf8");
// 주석에는 "왜 <img> 가 아닌가" 같은 설명이 들어 있다 — 코드만 보도록 걷어낸다.
const streamCode = stream.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const quad = readFileSync(join(ROOT, "app", "components", "CctvQuadView.tsx"), "utf8");

test("표를 URL 이 아니라 Authorization 헤더로 보낸다", () => {
  // URL 에 실린 표는 접근 로그·브라우저 기록·복사된 링크로 새는 bearer 자격이고,
  // 탈취자가 정상 사용자보다 먼저 제시하면 통과한다(적대검증 red-2 HIGH).
  assert.ok(
    /Authorization: `Bearer \$\{t\.ticket\}`/.test(stream),
    "게이트 요청은 Authorization 헤더로 표를 보내야 한다",
  );
  for (const bad of ["?tk=", "?ticket=", "&tk=", "&ticket="]) {
    assert.ok(
      !stream.includes(bad),
      `표를 URL 쿼리(${bad})로 보내면 로그·기록으로 샌다`,
    );
  }
});

test("게이트 영상은 <img> 로 그리지 않는다 — <img> 는 헤더를 못 붙인다", () => {
  assert.ok(
    !/<img\b/.test(streamCode),
    "<img> 는 Authorization 을 붙일 수 없어 표를 URL 로 밀어내게 된다",
  );
  assert.ok(/<canvas\b/.test(streamCode), "게이트 영상은 canvas 로 그린다");
});

test("게이트 주소는 CAM-03 만 쓴다 — 전역 주소를 덮지 않는다", () => {
  // NEXT_PUBLIC_AI_CCTV_API 하나를 CAM-01·02·03 과 서버 낙상 폴러(lib/cctv-fall-poller.ts)가
  // 공유한다. 그 값을 젯슨으로 돌리면 넷이 함께 젯슨을 보게 되고 젯슨엔 /cctv/stats2 가 없다.
  assert.ok(
    quad.includes('const CAM03_GATE_API = process.env.NEXT_PUBLIC_CAM03_GATE_API'),
    "게이트 주소는 CAM-03 전용 환경변수여야 한다",
  );
  assert.ok(
    quad.includes('const AI_CCTV_API = process.env.NEXT_PUBLIC_AI_CCTV_API'),
    "기존 전역 주소는 그대로 남아 있어야 한다(CAM-01·02·폴러가 쓴다)",
  );
  const cam01 = quad.match(/\{ id: "CAM-01",[^}]*\}/)?.[0] ?? "";
  const cam02 = quad.match(/\{ id: "CAM-02",[^}]*\}/)?.[0] ?? "";
  for (const [name, line] of [["CAM-01", cam01], ["CAM-02", cam02]] as const) {
    assert.ok(line.includes("aiApi: AI_CCTV_API"), `${name} 은 기존 주소를 유지해야 한다`);
    assert.ok(!line.includes("gateApi"), `${name} 에 게이트를 붙이면 젯슨에 없는 경로를 부른다`);
  }
});

test("게이트 미설정이면 종전 경로 그대로 — 배선만으로 지금이 깨지지 않는다", () => {
  assert.ok(
    quad.includes('process.env.NEXT_PUBLIC_CAM03_GATE_API || ""'),
    "미설정 기본값은 빈 문자열이어야 한다",
  );
  assert.ok(
    quad.includes("gateApi: CAM03_GATE_API || undefined"),
    "빈 값이면 gateApi 를 아예 두지 않아 기존 <img> 경로를 탄다",
  );
  assert.ok(
    quad.includes("if (cam.gateApi) return <GateCameraScreen"),
    "gateApi 가 있을 때만 게이트 렌더로 간다",
  );
});

test("로그인이 없으면 표를 요청하지 않는다", () => {
  // 표 발급은 세션 토큰이 있어야 성립한다. 토큰 없이 부르면 401 만 쌓인다.
  assert.ok(
    /const token = getSessionToken\(\);\s*\n\s*if \(!token\) return null;/.test(stream),
    "세션 토큰이 없으면 발급 요청 자체를 하지 않아야 한다",
  );
});
