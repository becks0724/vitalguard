// 이력·커버리지 시간 기준 가드(A-1) — 기록이 다시 '폰 수신 시각'으로 돌아가지 않게 못 박는다.
//
// 무엇이 있었나(2026-08-18 시험 B 실측). 워치는 20분 내내 12건/분을 쟀는데, 전달이 5분 32초
// 끊겼다가 복구되자 그 사이 측정이 **복구 순간 한 분에 73건으로 뭉쳤다**. 집계가 `ts`(폰 수신)
// 기준이라 화면은 그것을 **"5분 미수집"** 으로 그렸다 — 커버 `ts` 15분 vs 측정 21분.
// **수집은 끊긴 적이 없다. 전달만 끊겼다.** 기록이 사실과 다른 것을 말하고 있었다.
//
// 이 가드가 지키는 것 셋.
//  ① 버킷·집계는 측정 시각(`COALESCE(heart_rate_measured_at, ts)`).
//     `COALESCE` 가 필수다 — 측정 시각이 없는 행(실측 0.9%)이 통째로 빠지면 그게 새 구멍이 된다.
//  ② WHERE 는 `ts` 로 남는다. 인덱스가 전부 `ts` 에 있고 측정 시각에는 없어서, 옮기면 인덱스를
//     못 탄다(EXPLAIN 실측 = 두 방식 모두 Bitmap Index Scan on uq_vs_worker_ts · +1.6%).
//  ③ 근거가 소스에 남는다 — 지우면 다음 사람이 "일관성"을 이유로 WHERE 까지 옮긴다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const db = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");

/** 함수 본문만 잘라낸다 — 파일 전체를 보면 다른 함수의 문자열이 섞여 검사가 공허해진다. */
function body(name: string): string {
  const i = db.indexOf(`export async function ${name}`);
  assert.ok(i > 0, `${name} 이 사라졌다`);
  const end = db.indexOf("\n}", i);
  assert.ok(end > i, `${name} 본문 경계를 못 찾았다`);
  return db.slice(i, end);
}

const MEASURED = /COALESCE\(heart_rate_measured_at, ts\)/;

/**
 * SELECT~GROUP BY 구간만 잘라낸다(WHERE 앞). 여기가 '무엇을 언제로 세는가' 를 정하는 자리다.
 *
 * ★ 함수 전체에서 COALESCE 존재만 보면 **부분 회귀를 놓친다** — 실제로 이 가드의 첫 판은
 * 그렇게 짰다가 음성 대조에서 걸렸다(`day` 는 ts 로 되돌리고 `minutes` 만 남긴 주입이 통과했다).
 * 그 상태는 둘 중 어느 쪽보다도 나쁘다 — 날짜 버킷과 분 계산이 서로 다른 시각을 쓰게 된다.
 */
function selectClause(name: string): string {
  const b = body(name);
  const w = b.indexOf("WHERE");
  assert.ok(w > 0, `${name}: WHERE 를 못 찾았다 — 쿼리 구조가 바뀌었다`);
  return b.slice(0, w);
}

for (const fn of ["heartRateBucketAverages", "activeEnergyBucketSums", "dailyCoverageMinutes"]) {
  test(`① ${fn} — 버킷·집계가 전부 측정 시각 기준이다(부분 회귀 포함)`, () => {
    const sel = selectClause(fn);
    assert.match(
      sel,
      MEASURED,
      "폰 수신 시각으로 되돌아갔다 — 전달이 끊겼다 복구되면 그 구간이 '미수집'으로 그려진다",
    );
    // `COALESCE(…, ts)::timestamptz` 는 `ts)::` 라 아래 패턴에 안 걸린다 — 맨 `ts::` 만 잡는다.
    assert.doesNotMatch(
      sel,
      /[^)]ts::timestamptz/,
      "집계식 일부가 아직 ts 다 — 날짜 버킷과 분 계산이 서로 다른 시각을 쓰게 된다",
    );
  });
}

test("② WHERE 는 ts 로 남는다 — 인덱스가 ts 에만 있다", () => {
  for (const fn of ["heartRateBucketAverages", "activeEnergyBucketSums", "dailyCoverageMinutes"]) {
    const b = body(fn);
    assert.match(
      b,
      /AND ts::timestamptz >= to_timestamp\(\$2\)[\s\S]*?AND ts::timestamptz < to_timestamp\(\$3\)/,
      `${fn} 의 조회 범위가 ts 를 벗어났다 — 인덱스를 못 타 풀스캔이 된다`,
    );
    assert.doesNotMatch(
      b,
      /WHERE[\s\S]*?COALESCE\(heart_rate_measured_at, ts\)::timestamptz >=/,
      `${fn} 이 WHERE 를 측정 시각으로 옮겼다`,
    );
  }
});

test("③ 근거가 소스에 남아 있다(지우면 WHERE 까지 옮기는 '정리'가 들어온다)", () => {
  assert.match(db, /시험 B/, "실측 근거가 사라졌다");
  assert.match(db, /uq_vs_worker_ts/, "인덱스 근거가 사라졌다");
  assert.match(db, /전달만 끊겼다/, "무엇을 고친 것인지가 사라졌다");
});
