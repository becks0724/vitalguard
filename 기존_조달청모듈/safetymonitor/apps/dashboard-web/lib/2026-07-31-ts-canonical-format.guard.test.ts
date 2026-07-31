// ts 포맷 정규화 가드.
//
// 왜 필요한가 — ts 는 DB 에서 TEXT 이고 `ORDER BY ts` · `WHERE ts >= $1` · `MAX(ts)` 가 전부
// 문자열 비교로 돈다. 고정폭 ISO-UTC 는 사전순 = 시간순이 보장되지만, 밀리초 없는
// '2026-07-30T23:01:46Z' 가 섞이면 그 보장이 깨진다 — '.'(0x2E) < 'Z'(0x5A) 라
// '…46.500Z' 가 '…46Z' 보다 앞으로 정렬돼 시간이 거꾸로 간다.
//
// 2026-07-31 라이브 실측: vital_samples 331,658행 중 27,191행(8.2%)이 밀리초 없는 형식이었고,
// 전송 간격을 LAG 로 계산했더니 음수가 나와 발견했다. 영향 범위는 정렬만이 아니다 —
// 범위 필터·커서 페이지네이션·ML 내보내기(ORDER BY ts ASC)가 같은 결함을 공유한다.
//
// z.string().datetime() 은 두 형식을 모두 통과시키므로 검증만으로는 못 막는다.
// 정규화(transform)를 되돌리는 변경을 테스트 실패로 차단한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VitalSampleSchema, canonicalIsoMs } from "@safetymonitor/schemas";

test("밀리초 없는 ISO 를 3자리 고정폭으로 정규화한다", () => {
  assert.equal(canonicalIsoMs("2026-07-30T23:01:46Z"), "2026-07-30T23:01:46.000Z");
  assert.equal(canonicalIsoMs("2026-07-30T23:01:46.5Z"), "2026-07-30T23:01:46.500Z");
  assert.equal(canonicalIsoMs("2026-07-30T23:01:46.123Z"), "2026-07-30T23:01:46.123Z");
});

test("정규화는 멱등이다", () => {
  const once = canonicalIsoMs("2026-07-30T23:01:46Z");
  assert.equal(canonicalIsoMs(once), once);
});

test("정규화 결과는 항상 24자 고정폭", () => {
  for (const s of ["2026-01-02T03:04:05Z", "2026-12-31T23:59:59.999Z", "2026-07-30T23:01:46.5Z"]) {
    assert.equal(canonicalIsoMs(s).length, 24, s);
  }
});

// 이 불변식이 깨지면 문자열 정렬이 시간순과 어긋난다 — 버그의 본체.
test("정규화 후에는 문자열 정렬 == 시간 정렬", () => {
  const raw = ["2026-07-30T23:01:46.500Z", "2026-07-30T23:01:46Z", "2026-07-30T23:01:47Z"];
  // 정규화 전: 사전순이 시간순과 어긋난다(회귀의 근거)
  assert.notDeepEqual([...raw].sort(), [raw[1], raw[0], raw[2]]);
  // 정규화 후: 일치한다
  const norm = raw.map(canonicalIsoMs);
  const byString = [...norm].sort();
  const byTime = [...norm].sort((a, b) => Date.parse(a) - Date.parse(b));
  assert.deepEqual(byString, byTime);
});

test("VitalSampleSchema 가 파싱 시점에 ts 를 정규화한다", () => {
  const parsed = VitalSampleSchema.parse({
    workerId: "EMP-admin6861",
    ts: "2026-07-30T23:01:46Z",
    heartRate: 88,
  });
  assert.equal(parsed.ts, "2026-07-30T23:01:46.000Z");
});

test("DB 가 비표준 ts 를 거부하도록 CHECK 제약이 걸려 있다", () => {
  const src = readFileSync("lib/db.ts", "utf8");
  assert.match(src, /chk_vital_ts_iso_ms/, "ts 포맷 CHECK 제약이 사라졌다");

  const m = src.match(/CHECK \(ts ~ '([^']+)'\)/);
  assert.ok(m, "CHECK 식을 찾지 못했다");
  const pattern = m[1]!;

  // 백슬래시 금지 — 이 SQL 은 템플릿 리터럴이라 '\d' 가 JS 단계에서 'd' 로 죽어 제약이
  // 조용히 무력화된다. 실제로 한 번 그렇게 작성했다가 lint 가 잡았다.
  assert.doesNotMatch(pattern, /\\/, "정규식에 백슬래시가 있으면 템플릿 리터럴에서 죽는다");

  // 식이 의도대로 동작하는지 값으로 확인 — 문자열 존재가 아니라 판정을 검사한다.
  const re = new RegExp(pattern);
  assert.ok(re.test("2026-07-30T23:01:46.500Z"), "표준 형식을 거부하면 안 된다");
  assert.ok(!re.test("2026-07-30T23:01:46Z"), "밀리초 없는 형식을 통과시키면 안 된다");
  assert.ok(!re.test("2026-07-30T23:01:46.5Z"), "밀리초 1자리를 통과시키면 안 된다");
});

test("스키마의 ts 정규화 transform 이 제거되지 않았다", () => {
  const src = readFileSync("../../packages/schemas/src/vital-stream.ts", "utf8");
  assert.match(src, /ts: z\.string\(\)\.datetime\(\)\.transform\(canonicalIsoMs\)/,
    "ts 가 정규화 없이 원문 그대로 저장되는 상태로 되돌아갔다");
});
