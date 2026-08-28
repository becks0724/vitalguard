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

// ── 안전 방향 ────────────────────────────────────────────────────────────────
// 경위 — 처음 이 자리에 *"형식이 깨져도 저 필드만 버린다"* 를 적고 허용목록에 등재했더니
// **가드가 빨간불을 냈고 그것이 옳았다.** 당시 스트립 로직은 `too_small`·`too_big` 이슈의
// **숫자 필드만** 지워서, 문자열은 등재해도 안 지워졌다. 그래서 일단 등재를 되돌리고
// **그때의 진짜 동작**(샘플 전체 거부)을 적어 뒀다.
//
// 그 뒤 사용자 지시로 **스트립 로직 자체를 고쳤다**(허용목록 필드는 이슈·타입을 안 가리고 버린다).
// 그러자 이 가드가 다시 빨개졌고, 그 실패 메시지가 *"넓어졌다면 주석과 허용목록을 함께 고치라"* 고
// 지시했다. 그대로 했다 — 등재를 복원하고 여기를 갱신했다.
// ⟹ 교훈은 [[L-123]]① 그대로다. **단언의 기대값을 "현재 동작" 에서 길어오되 그렇다고 적어 두면**
//    동작이 바뀔 때 가드가 다음 사람을 정확한 자리로 데려간다. 결함을 규범으로 굳히지 않는다.
test("깨진 값은 저 필드만 버리고 생체는 살린다", () => {
  const stripped: string[] = [];
  const r = parseResilientVitalSample(
    { ...base, heartRate: 88, batteryPct: 41, hrLastReviveAt: "재구독함" },
    (keys) => stripped.push(...keys),
  );
  assert.equal(r.heartRate, 88, "진단 필드 하나가 심박을 통째로 날렸다");
  assert.equal(r.batteryPct, 41, "같은 행의 다른 값도 함께 죽었다");
  assert.equal(r.hrLastReviveAt, undefined, "깨진 값이 그대로 통과했다");
  assert.ok(stripped.includes("hrLastReviveAt"), "스트립 통지에 이 키가 없다");
});

test("통제군 - 허용목록 밖의 시각 필드는 여전히 샘플을 거부시킨다", () => {
  // 이것이 없으면 위 초록불이 "스트립이 동작한다" 가 아니라 "무엇이든 다 통과한다" 여도 초록이다.
  // sessionStartedAt 은 성격이 같은 진단 시각인데 **등재돼 있지 않다** — 그래서 거부가 맞다.
  assert.throws(
    () => parseResilientVitalSample({ ...base, heartRate: 88, sessionStartedAt: "어제" }),
    "허용목록 밖까지 스트립한다 — 등재가 곧 보호라는 계약이 깨졌다",
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
