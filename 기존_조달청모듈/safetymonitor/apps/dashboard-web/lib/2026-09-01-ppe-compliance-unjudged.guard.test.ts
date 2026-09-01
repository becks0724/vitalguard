// PPE 준수율 판정 불가 가드 — 머리류를 하나도 못 본 프레임을 "준수율 100%" 로 표시하지 않게 유지한다.
//
// 무슨 일이 있었나(2026-09-01). 엣지는 head+helmet 이 0 이면 compliance_rate 에 기본값 100 을
// 넣는다(cctv-ai/edge/gopro_ppe_edge.py:117). "전원 착용" 이 아니라 "하나도 못 봄" 인데
// 관제 화면에는 초록 점 + 준수율 100% 로 떴다. 조경 현장 실사진 59장으로 프로덕션 동일 조건
// (640x360 · conf 0.30 · v5)에서 재보니 46장이 이 상태였고, 안전모 검출은 작업자 73명에
// 단 1개였다 — 화면의 100% 는 한 번도 "안전모를 봤다" 는 뜻이 아니었다.
// 안전조끼 "미착용 0" 이 판정 결과로 읽혔던 것(2026-07-30)과 같은 종류의 사고다.
// 근거 = ml/ppe-detection/context-notes.md 트랙 H.
//
// 왜 가드 테스트인가 — CctvQuadView 는 React 컴포넌트라 tsx --test 로 렌더 테스트가 불가하다
// (test 스크립트가 lib/·app/api/mock/·app/lib/ 만 돌린다). 되돌리면 여기서 실패하도록
// 소스 불변식을 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(join(ROOT, "app", "components", "CctvQuadView.tsx"), "utf8");

// PpeDetectionStrip 함수 본문 — 다음 최상위 function 직전까지.
function stripBody(): string {
  const start = source.indexOf("function PpeDetectionStrip");
  assert.ok(start >= 0, "PpeDetectionStrip 을 찾지 못함");
  const end = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("판정 여부는 안전모·맨머리 검출 합이 0보다 클 때만 참이다", () => {
  const body = stripBody();
  assert.match(
    body,
    /const\s+judged\s*=\s*\(stats\?\.hardhat_count\s*\?\?\s*0\)\s*\+\s*\(stats\?\.no_hardhat_count\s*\?\?\s*0\)\s*>\s*0/,
    "judged 계산이 없다 — 머리류 0건과 전원 착용을 구분하지 못한다",
  );
});

test("준수율 퍼센트는 judged 일 때만 렌더한다", () => {
  const body = stripBody();
  assert.match(
    body,
    /judged\s*\?\s*\(/,
    "준수율 렌더가 judged 로 분기하지 않는다 — 근거 없는 100% 가 다시 뜬다",
  );
  assert.match(body, /판정 불가/, "판정 불가 표시가 없다");
  const pct = body.indexOf("Math.round(stats.compliance_rate)");
  const gate = body.indexOf("judged ? (");
  assert.ok(gate >= 0 && gate < pct, "compliance_rate 표시가 judged 분기 밖에 있다");
});

test("상태 점은 판정 불가일 때 초록이 아니다", () => {
  const body = stripBody();
  assert.match(
    body,
    /!stats\s*\|\|\s*!judged\s*\?\s*"bg-zinc-500"/,
    "판정 불가에서 점이 중립색이 아니다 — 초록 점이 '정상' 으로 읽힌다",
  );
});
