// 진단 필드 스트립 가드 — 허용목록이 **숫자에만 듣던** 결함의 수리를 못박는다
import assert from "node:assert/strict";
import test from "node:test";

import { parseResilientVitalSample } from "@safetymonitor/schemas";

// ★ 이 가드의 한 문장 보장 =
//   **허용목록에 올린 진단 필드는 타입과 무관하게 실제로 버려진다 — 등재가 곧 보호다.**
//
// 무엇이 고장나 있었나 (2026-08-28 발견) — `NON_SAFETY_STRIPPABLE_KEYS` 주석은
// *"새 필드를 추가할 때 여기 넣지 않으면 기본값은 거부다"* 라고 적어 등재를 보호로 약속하는데,
// 스트립 로직에는 `too_small|too_big` + `ZodNumber` 두 제약이 걸려 있어 **문자열·record 는
// 등재돼 있어도 안 지워졌다.** 10개 중 3개(`sessionEndError`·`watchDeviceModel`·`fallTrace`)가
// 무효였다. 즉 주석이 **있지도 않은 보호를 약속**하고 있었고, 그 셋 중 하나가 깨진 값으로
// 오면 진단 필드 하나가 생체 샘플을 통째로 죽였다.

const TS = "2026-08-28T00:00:00.000Z";
const base = { workerId: "EMP-0000", ts: TS, heartRate: 88, batteryPct: 41 };

/** 살아남았는가 + 그 키만 버려졌는가를 한 번에 본다. */
function stripsOnly(bad: Record<string, unknown>, key: string) {
  const stripped: string[] = [];
  const r = parseResilientVitalSample({ ...base, ...bad }, (keys) => stripped.push(...keys));
  assert.equal(r.heartRate, 88, `${key} 하나가 심박을 통째로 날렸다`);
  assert.equal(r.batteryPct, 41, `${key} 하나가 같은 행의 배터리까지 죽였다`);
  assert.equal(
    (r as Record<string, unknown>)[key],
    undefined,
    `${key} 의 깨진 값이 그대로 통과했다`,
  );
  assert.ok(
    stripped.includes(key),
    `${key} 가 스트립 통지에 없다 — 조용히 사라지면 다음 사람이 원인을 못 찾는다`,
  );
}

// ── 종전에 무효였던 세 종류 ──────────────────────────────────────────────────

test("문자열 길이 초과를 버린다 - sessionEndError", () => {
  stripsOnly({ sessionEndError: "가".repeat(200) }, "sessionEndError");
});

test("문자열 형식 위반을 버린다 - hrLastReviveAt", () => {
  // `invalid_string`(datetime) — 종전 로직은 이슈 코드 단계에서 이미 걸렀다.
  stripsOnly({ hrLastReviveAt: "재구독함" }, "hrLastReviveAt");
});

test("타입이 통째로 틀려도 버린다 - fallTrace", () => {
  // `invalid_type` — record 자리에 문자열. 모듈 교체로 모양이 바뀌는 필드라 실제로 있을 일이다.
  stripsOnly({ fallTrace: "위험" }, "fallTrace");
});

test("빈 문자열도 버린다 - watchDeviceModel", () => {
  // `too_small`(min 1) 이지만 문자열이라 종전 타입 검사에서 걸렸다.
  stripsOnly({ watchDeviceModel: "" }, "watchDeviceModel");
});

// ── 종전에 되던 것이 그대로 되는가 (회귀 방지) ───────────────────────────────

test("숫자 범위 위반은 종전대로 버린다", () => {
  stripsOnly({ steps: 99999 }, "steps");
});

// ── ★ 넓히면 안 되는 경계 ────────────────────────────────────────────────────
// 이 수리의 위험은 "너무 많이 버리게 되는 것" 이다. 두 경계를 못박는다.

test("비-이벤트 샘플의 생체값은 여전히 안 버린다", () => {
  // 허용목록 밖이다. 버리면 위험이 정상으로 보인다 — 거부되어 ts 가 늙는 쪽이 안전한 실패다.
  assert.throws(
    () => parseResilientVitalSample({ workerId: "EMP-0000", ts: TS, spo2: 40, heartRate: 80 }),
    "생체값을 스트립했다 — 이 수리가 안전 경계를 넘었다",
  );
});

test("이벤트 샘플의 생체값은 범위 위반만 버린다 - 타입 오류는 아니다", () => {
  // 이벤트(낙상·SOS)는 플래그가 경보를 살리므로 **범위** 위반 생체값은 종전대로 스트립한다.
  const ok = parseResilientVitalSample({
    workerId: "EMP-0000", ts: TS, fallDetected: true, spo2: 40,
  });
  assert.equal(ok.fallDetected, true);
  assert.equal(ok.spo2, undefined, "이벤트 샘플의 범위 위반 스트립이 깨졌다");

  // 그러나 **타입**이 통째로 틀린 생체값까지 조용히 지우지는 않는다 — 앱 결함이거나 남의
  // payload 이고, 지워서 경보만 살리면 무엇을 근거로 울렸는지가 사라진다.
  assert.throws(
    () =>
      parseResilientVitalSample({
        workerId: "EMP-0000", ts: TS, fallDetected: true, spo2: "낮음",
      }),
    "이벤트 샘플에서 타입 오류 생체값까지 스트립한다 — 넓히지 않기로 한 경계다",
  );
});
