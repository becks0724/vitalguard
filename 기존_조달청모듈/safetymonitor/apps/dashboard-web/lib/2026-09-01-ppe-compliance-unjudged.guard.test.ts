// PPE 표시 가드 — 안전모를 보지 않고 "준수" 를 주장하지 않게 유지한다.
//
// 무슨 일이 있었나(2026-09-01). 엣지는 head+helmet 이 0 이면 compliance_rate 에 기본값 100 을
// 넣는다(cctv-ai/edge/gopro_ppe_edge.py:117). "전원 착용" 이 아니라 "하나도 못 봄" 인데
// 관제 화면에는 초록 점 + 준수율 100% 로 떴다.
//
// CAM-03 실측으로 원인이 갈렸다. 맨머리 59프레임에서 head 100%(conf 0.94), 안전모 착용
// 356프레임에서 head 0% · helmet 0%. 미착용은 완전히 갈리는데 **안전모 자체는 한 번도
// 못 본다**. 그래서 이 모델은 준수 확인기가 아니라 위반 검출기이고, 화면은
// "위반 N건 / 위반 없음 / 대상 없음" 세 갈래여야 한다. 준수율은 안전모를 실제로 본
// (hardhat_count > 0) 때만 말할 수 있다.
// 안전조끼 "미착용 0" 이 판정 결과로 읽혔던 2026-07-30 사고와 같은 종류다.
// 근거 = ml/ppe-detection/context-notes.md 트랙 H-2·H-3.
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

test("판정은 위반·위반없음·대상없음 세 갈래이고 작업자 수로 갈린다", () => {
  const body = stripBody();
  assert.match(
    body,
    /ppeState\s*=\s*!stats\s*\?\s*"unknown"\s*:\s*violations\s*>\s*0\s*\?\s*"violation"\s*:\s*persons\s*>\s*0\s*\?\s*"clear"\s*:\s*"empty"/,
    "세 갈래 판정이 없다 — 작업자 0명과 위반 0건을 구분하지 못한다",
  );
  for (const label of ["위반 없음", "대상 없음"]) {
    assert.ok(body.includes(label), `"${label}" 표시가 없다`);
  }
});

test("준수율은 안전모를 실제로 본 때만 말한다", () => {
  const body = stripBody();
  const pct = body.indexOf("Math.round(stats.compliance_rate)");
  assert.ok(pct >= 0, "준수율 표시를 찾지 못함");
  const gate = body.indexOf('(stats.hardhat_count ?? 0) > 0 &&');
  assert.ok(
    gate >= 0 && gate < pct,
    "준수율이 hardhat_count > 0 조건 밖에 있다 — 안전모를 못 본 상태에서 근거 없는 100% 가 다시 뜬다",
  );
});

test("상태 점은 위반 없음일 때만 초록이다", () => {
  const body = stripBody();
  assert.match(
    body,
    /ppeState\s*===\s*"violation"\s*\?\s*"bg-red-500"\s*:\s*ppeState\s*===\s*"clear"\s*\?\s*"bg-emerald-400"\s*:\s*"bg-zinc-500"/,
    "상태 점이 세 갈래를 따르지 않는다 — 작업자가 없는데 초록이 뜨면 '정상' 으로 읽힌다",
  );
});
