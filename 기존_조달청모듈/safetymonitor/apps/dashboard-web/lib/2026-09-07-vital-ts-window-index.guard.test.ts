// 생체 시간창 필터가 인덱스를 타는가 — `ts` 는 text 라 캐스트하면 42만 행 Seq Scan 이 된다.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// ★ 이 가드의 한 문장 보장 =
//   **`vital_samples` 의 "최근 N분/시간" 창 필터에 `ts::timestamptz` 캐스트를 다시 쓰지 않는다.**
//
// 왜 (2026-09-07 실사고) — 라이브가 5xx 를 뿜었다. `/api/calendar/media` 500 ·
// `/api/alerts`·`/api/aed/*` 503 · `api/monitor` 응답 **32초**(최대 49초).
// 원인은 그 라우트들이 아니라 **DB 커넥션 풀 고갈**이었고, 풀을 말린 것은 아래 형태였다.
//
//   WHERE ts::timestamptz > (now() - $1::interval)
//
// `ts` 가 text 라 **행마다 캐스트**가 붙어 `idx_vs_ts` 를 못 탄다. 프로덕션 EXPLAIN 실측:
//   옛: Gather Merge + Workers 2 + Sort   cost 123,399..136,779
//   새: Index Scan using idx_vs_ts        cost      0.43..7.39      ← 약 18,500배
// 병렬 Sort 가 work_mem 을 넘겨 temp 로 쏟아졌고(누적 11GB·1,385파일 · DB 본체는 1,160MB),
// 끝내 `could not resize shared memory segment: No space left on device` 까지 났다.
// 같은 형태가 6곳에 있었고 그중 37건이 동시에 11초씩 돌고 있었다.
//
// 처방 = 하한을 **같은 형식의 문자열**로 만들어 비교한다(`tsSinceLiteral`). `ts` 는 ISO-8601 UTC
// 밀리초 3자리(`canonicalIsoMs` 가 적재 시 정규화)라 **사전순 = 시간순**이고, 상수 대 컬럼 비교라
// 인덱스를 그대로 탄다. CLAUDE.md 가 "처방 후보 ⓐ" 로 적어둔 것이다.
//
// ⚠ 이 가드는 **창 필터**만 막는다. `to_timestamp($n)` 범위 조회나 KST 달력일 집계처럼
//   캐스트가 남아 있는 곳이 아직 있고(2026-09-07 기준 28곳), 그것들은 호출 빈도가 낮아 이번
//   사고에 관여하지 않았다. 그쪽을 손볼 때도 같은 판단(인덱스를 타는가)을 먼저 하라.

const DB_TS = readFileSync(join(process.cwd(), "lib/db.ts"), "utf8");

test("① 창 필터에 ts::timestamptz 캐스트가 없다 (인덱스 무력화 회귀 차단)", () => {
  const hits = [...DB_TS.matchAll(/\bts::timestamptz\s*>\s*\(\s*now\(\)/g)];
  assert.equal(
    hits.length,
    0,
    `창 필터에 캐스트가 ${hits.length}곳 되살아났다 — Seq Scan 이 되어 커넥션 풀을 말린다. tsSinceLiteral() 을 쓸 것`,
  );
});

test("② tsSinceLiteral 헬퍼가 있고 UTC 로 접어 밀리초 3자리 형식을 만든다", () => {
  const m = DB_TS.match(/const tsSinceLiteral = \(intervalParam: string\) =>\s*\n?\s*`([^`]+)`/);
  assert.ok(m, "tsSinceLiteral 헬퍼가 없다");
  const body = m![1]!;
  // now() 는 서버 타임존이라 UTC 로 접지 않으면 하한이 9시간 어긋난다.
  assert.match(body, /AT TIME ZONE 'UTC'/, "UTC 변환이 빠졌다 — 하한이 타임존만큼 어긋난다");
  // ts 의 정준 형식과 한 글자도 달라선 안 된다(사전순 비교의 전제).
  assert.match(body, /YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"/, "ts 정준 형식(밀리초 3자리 Z)과 다르다");
  assert.match(body, /\$\{intervalParam\}::interval/, "interval 파라미터 바인딩이 빠졌다");
});

test("③ 창 필터 6곳이 모두 헬퍼를 쓴다 (사고 당시 무거웠던 함수들)", () => {
  // `v.ts` 처럼 별칭이 붙는 곳이 있다(lastSeenByWorker).
  const uses = [...DB_TS.matchAll(/(?:\w+\.)?ts > \$\{tsSinceLiteral\("\$\d"\)\}/g)];
  assert.ok(uses.length >= 6, `헬퍼 사용이 ${uses.length}곳뿐이다 — 6곳(recentHeartRates·recentHrEnergy·recentSamplesForWorkers·latestRestingHeartRate·latestSpo2ByWorker·lastSeenByWorker)이어야 한다`);
});

test("④ 사고 당시 DB 를 점유하던 세 함수가 헬퍼를 쓴다", () => {
  // active 실측: recentHeartRates 37건·11초 / latestSpo2ByWorker 21건·8초 / recentHrEnergy 4건·12초
  for (const fn of ["recentHeartRates", "recentHrEnergy", "latestSpo2ByWorker", "lastSeenByWorker"]) {
    const i = DB_TS.indexOf(`function ${fn}`);
    assert.ok(i > 0, `${fn} 을 찾지 못했다`);
    // 본문 = 이 선언부터 **다음 함수 선언 직전**까지. 고정 길이로 자르면 CTE 가 긴 함수
    // (lastSeenByWorker 는 선언~필터 2,851자)에서 조용히 빗나간다 — 실제로 한 번 빗나갔다.
    const after = DB_TS.slice(i + 10);
    const next = after.search(/\n(?:export )?(?:async )?function \w+/);
    const body = next === -1 ? after : after.slice(0, next);
    assert.ok(
      /(?:\w+\.)?ts > \$\{tsSinceLiteral\(/.test(body),
      `${fn} 이 헬퍼를 쓰지 않는다 — 이 함수가 사고 때 DB 를 점유했다`,
    );
    assert.ok(
      !/ts::timestamptz\s*>\s*\(\s*now\(\)/.test(body),
      `${fn} 에 캐스트 창 필터가 남아 있다`,
    );
  }
});
