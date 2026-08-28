// 심박 재구독 시각 가드 — 워치가 보낸 hrLastReviveAt 이 파싱·저장 끝까지 살아 가는가(L-115 양 끝 단언)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { VitalSampleSchema, parseResilientVitalSample } from "@safetymonitor/schemas";

// ★ 이 가드의 한 문장 보장 =
//   **`hrLastReviveAt` 이 무음으로 사라지지도, 생체 샘플을 죽이지도 않는다.**
//
// 왜 이 필드가 있는가 — 갤럭시 워치는 하루 17구간·2.4시간 동안 착용 중인데 수집 tick 이 멈춘다.
// 그 구간을 되살리는 `reviveHrIfStalled` 가 **돌고도 실패한 것**과 **아예 안 돈 것**이
// DB 에서 똑같이 "행이 없다" 로 보이는데, 둘은 조치가 정반대다. 앱 안의 `hrRevives` 카운터는
// 로그로만 쓰여 os_log 를 떠야 읽히는데 08-28 실측에서 그 회수 경로가 막혔다(무선 디버깅 미광고).
// 그래서 시각 하나를 표본에 실어 **두 행의 비교만으로** 그 사이 재구독 유무를 내게 한다.

const TS = "2026-08-28T00:00:00.000Z";
const base = { workerId: "EMP-0000", ts: TS };

test("스키마가 재구독 시각을 통과시킨다", () => {
  const parsed = VitalSampleSchema.parse({
    ...base,
    hrLastReviveAt: "2026-08-28T06:21:00.000Z",
  });
  assert.equal(
    parsed.hrLastReviveAt,
    "2026-08-28T06:21:00.000Z",
    "Zod 가 재구독 시각을 strip 했다 — fallTrace 가 밟은 그 함정이다",
  );
});

test("없어도 통과한다 - 없음이 곧 '한 번도 재구독 안 함' 이다", () => {
  const parsed = VitalSampleSchema.parse({ ...base, heartRate: 88 });
  assert.equal(parsed.hrLastReviveAt, undefined);
  assert.equal(parsed.heartRate, 88, "기존 필드가 함께 죽었다");
});

// ── 안전 방향 — 실제 동작을 적는다(희망이 아니라) ─────────────────────────────
// 처음에 이 자리에 *"형식이 깨져도 저 필드만 버린다"* 를 적고 `NON_SAFETY_STRIPPABLE_KEYS` 에
// 등재했는데, **가드가 빨간불을 냈고 그것이 옳았다.** 스트립 로직은 `too_small`·`too_big`
// 이슈의 **숫자 필드만** 지운다(vital-stream.ts `:337`·`:346`). 시각 문자열은 허용목록에
// 적어도 안 지워진다 — 그래서 등재를 되돌리고, 여기에 **진짜 동작**을 못박는다.
//
// ⚠ 이것은 이 필드만의 성질이 아니다 — 허용목록의 `sessionEndError`(문자열)·`fallTrace`(record)도
//   같은 이유로 **등재돼 있으나 실제로는 스트립되지 않는다**(별건 · 이 트랙에서 안 고친다).
test("깨진 값은 샘플 전체를 거부시킨다 - 다른 시각 필드와 같은 규칙이다", () => {
  assert.throws(
    () => parseResilientVitalSample({ ...base, heartRate: 88, hrLastReviveAt: "재구독함" }),
    "동작이 바뀌었다 — 스트립이 문자열까지 넓어졌다면 위 주석과 허용목록을 함께 고쳐야 한다",
  );
  // 통제군 — 같은 모양의 기존 시각 필드도 똑같이 거부한다. 즉 이 필드가 유별난 것이 아니다.
  assert.throws(() =>
    parseResilientVitalSample({ ...base, heartRate: 88, sessionStartedAt: "어제" }),
  );
});

test("앱은 깨진 값을 만들 수 없다 - IsoMs 를 거친다", () => {
  // 위 거부가 실무에서 위험하지 않은 근거. 워치는 Long 을 IsoMs.format 으로 찍으므로
  // 임의 문자열이 나올 자리가 없다. 근거를 안 적으면 다음 사람이 "위험한 필드" 로 읽는다.
  const wear = readFileSync(
    "../vitalguard_app/android/wear/src/main/kotlin/com/vitalguard/wear/pipeline/SampleBuilder.kt",
    "utf8",
  );
  assert.match(
    wear,
    /v\["hrLastReviveAt"\]\s*=\s*IsoMs\.format\(it\)/,
    "워치가 IsoMs 를 안 거치고 싣는다 — 임의 문자열이 들어올 자리가 생긴다",
  );
});

// ── 저장 끝단 ────────────────────────────────────────────────────────────────
// 파싱만 보면 "만들어지는가" 까지밖에 못 본다. 끝까지 가는지는 저장부를 봐야 한다(L-115③).
// ⚠ 이 필드는 전용 열이 없다 — `fallTrace` 와 같이 raw_json 경로로 간다(마이그레이션 없음).
//   그래서 단언 대상도 열 DDL 이 아니라 **파싱된 표본이 통째로 직렬화되는 자리**다.
const db = readFileSync("lib/db.ts", "utf8");

test("파싱된 표본이 통째로 raw_json 에 실린다", () => {
  assert.match(
    db,
    /raw_json:\s*JSON\.stringify\(sample\)/,
    "raw_json 이 파싱된 표본을 직렬화하지 않는다 — 전용 열이 없는 필드는 여기서만 남는다",
  );
});
