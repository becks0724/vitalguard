// 사고 조사·보존 가드 — "사고 구간 3년 보존(2026-08-13 사용자 결정)"의 전제가 조용히 풀리면 실패한다.
//
// 왜 가드인가 — 보존은 지금 "지우는 코드가 없어서" 지켜지고 있다. 미래에 누군가 리텐션(자동
// 삭제)을 넣거나 사고 원장을 지우는 API 를 만들면, 타입·기능 테스트는 전부 통과한 채
// 사고 보고자료의 원천이 사라진다. 그 경계를 소스 불변식으로 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const db = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");
const incidentsRoute = readFileSync(
  join(ROOT, "app", "api", "admin", "incidents", "route.ts"),
  "utf8",
);
const dataRoute = readFileSync(
  join(ROOT, "app", "api", "admin", "incidents", "data", "route.ts"),
  "utf8",
);

test("incidents 테이블 — 3년 보존 룰(리텐션 도입 시 선조회·선제외)이 스키마 주석에 박혀 있다", () => {
  assert.match(db, /CREATE TABLE IF NOT EXISTS incidents/);
  assert.match(db, /3년 보존/, "보존 정책 문구가 사라짐");
  assert.match(db, /선조회/, "리텐션 도입자용 선제외 룰이 사라짐");
});

test("사고 원장은 append-only — incidents 를 지우는 SQL 이 db.ts 에 없다", () => {
  assert.doesNotMatch(db, /DELETE FROM incidents/i, "사고 원장 삭제 경로가 생김(감사 자료)");
  assert.doesNotMatch(db, /DROP TABLE[^;]*incidents/i);
});

test("생체 원시 데이터 — vital_samples 자동 삭제(리텐션)가 여전히 없다", () => {
  // 이 가드가 실패하는 날 = 리텐션이 도입된 날. 그때는 incidents 선조회 제외를 함께 구현하고
  // 이 가드를 "제외 로직 존재 확인"으로 교체해야 한다(그냥 지우면 보존 정책이 무너진다).
  assert.doesNotMatch(db, /DELETE FROM vital_samples/i, "원시 데이터 삭제 경로 발견 — incidents 구간 제외 필수");
});

test("사고 API 2종 — 관리자 게이트(hasAdminMenuAccess)가 모든 핸들러 앞에 있다", () => {
  for (const [name, src] of [
    ["incidents", incidentsRoute],
    ["incidents/data", dataRoute],
  ] as const) {
    const handlers = src.split(/export async function (?:GET|POST)/).slice(1);
    assert.ok(handlers.length > 0, `${name}: 핸들러 없음`);
    for (const h of handlers) {
      // 호출 존재가 아니라 **차단 관용구 전체**를 본다 — `true || hasAdminMenuAccess(...)` 같은
      // 우회는 호출 문자열이 남아 존재 검사를 통과한다(음성 대조에서 실증된 맹점).
      assert.match(
        h.slice(0, 300),
        /if \(!\(await hasAdminMenuAccess\(request\)\)\)/,
        `${name}: 인증 게이트 누락·변형`,
      );
    }
  }
});

test("조사 데이터 — 추정 체온은 저장값이 아니라 원시 심박 재계산(estimateCoreTempSeries)", () => {
  assert.match(dataRoute, /estimateCoreTempSeries\(/, "재계산 경로가 사라짐(저장 추정치는 모델 개선 시 보고서와 갈린다)");
  assert.match(dataRoute, /CORE_TEMP_LOOKBACK_MS/, "워밍업 lookback 이 사라짐(창 초입 공백)");
});

test("등록 검증 — workerId 문자셋·미래 시각 거부가 라우트에 있다", () => {
  assert.match(incidentsRoute, /WORKER_ID_RE/);
  assert.match(incidentsRoute, /미래 시각/);
});
