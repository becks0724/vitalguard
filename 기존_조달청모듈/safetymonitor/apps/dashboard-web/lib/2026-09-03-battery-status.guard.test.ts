// 배터리 충전상태 가드 — 워치가 보낸 상태가 파싱·저장·**병합**까지 살아 가는가(L-115 양 끝 단언)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { VitalSample } from "@safetymonitor/schemas";
import { VitalSampleSchema } from "@safetymonitor/schemas";

import { mergeLatestByWorker } from "../app/api/app/vital/store";

// ★ 이 가드의 한 문장 보장 = **배터리 3종(%, µAh, 상태)이 실시간 스냅숏까지 함께 간다.**
//
// 왜 병합까지 보는가(2026-09-03 실사고). `batteryChargeUah` 는 스키마·컬럼·insert 매핑이
// 다 있는데 `mergeLatestByWorker` 에만 줄이 없어서, **DB 에는 들어가고 실시간 스냅숏에서만
// 조용히 사라지고 있었다.** 08-26 가드는 "저장 끝단" 까지만 봐서 이것을 못 잡았다 —
// 관제 화면이 읽는 것은 저장이 아니라 병합 결과다. 그 한 칸이 비어 있었다.

const TS = "2026-09-03T00:00:00.000Z";
const s = (partial: Partial<VitalSample> & { workerId: string; ts: string }): VitalSample =>
  partial as VitalSample;

test("스키마가 충전상태를 통과시킨다", () => {
  const parsed = VitalSampleSchema.parse({ workerId: "EMP-0000", ts: TS, batteryStatus: 3 });
  assert.equal(parsed.batteryStatus, 3, "Zod 가 충전상태를 strip 했다");
});

test("정수·범위 계약을 지킨다 - Android BATTERY_STATUS_* 는 1..5 다", () => {
  const base = { workerId: "EMP-0000", ts: TS };
  // 0 과 Int.MIN_VALUE 는 BatteryManager 의 "못 읽음" 표식이다. 상태로 저장되면 안 된다.
  assert.throws(() => VitalSampleSchema.parse({ ...base, batteryStatus: 0 }));
  assert.throws(() => VitalSampleSchema.parse({ ...base, batteryStatus: 6 }));
  assert.throws(() => VitalSampleSchema.parse({ ...base, batteryStatus: 2.5 }));
  // 다섯 값은 모두 유효하다 — 4(미충전)를 막으면 배터리 보호 모드로 독 위에 앉은 워치가
  // 통째로 거부된다(이 워치의 상한은 90%).
  for (const v of [1, 2, 3, 4, 5]) {
    assert.equal(VitalSampleSchema.parse({ ...base, batteryStatus: v }).batteryStatus, v);
  }
});

test("없어도 통과한다 - 기존 앱을 깨지 않는다", () => {
  const parsed = VitalSampleSchema.parse({ workerId: "EMP-0000", ts: TS, batteryPct: 84 });
  assert.equal(parsed.batteryStatus, undefined);
  assert.equal(parsed.batteryPct, 84, "기존 필드가 함께 죽었다");
});

// ── 저장 끝단 ────────────────────────────────────────────────────────────────
const db = readFileSync("lib/db.ts", "utf8");

test("저장 매핑이 열에 싣는다", () => {
  assert.match(
    db,
    /battery_status:\s*sample\.batteryStatus\s*\?\?\s*null/,
    "persistSample 이 충전상태를 열에 안 싣는다 — 파싱은 되는데 DB 엔 안 남는다",
  );
});

test("열이 실제로 만들어진다", () => {
  assert.match(
    db,
    /ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS battery_status SMALLINT/,
    "열 추가 DDL 이 없다 — 매핑만 있으면 INSERT 가 터진다",
  );
});

// ── 병합 끝단 ────────────────────────────────────────────────────────────────
// ★ 08-26 가드에 없던 축이다. 관제 화면이 읽는 것은 DB 가 아니라 이 결과다.

test("★ 병합이 배터리 3종을 모두 옮긴다", () => {
  const [m] = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: TS, heartRate: 88, batteryPct: 87, batteryChargeUah: 412787, batteryStatus: 3 }),
  ]);
  assert.equal(m!.batteryPct, 87);
  assert.equal(m!.batteryChargeUah, 412787, "µAh 가 병합에서 사라졌다 — 소모율을 낼 재료가 없어진다");
  assert.equal(m!.batteryStatus, 3, "충전상태가 병합에서 사라졌다 — 차트 음영을 그릴 수 없다");
});

test("★ 배터리 3종은 newer 가 undefined 키를 실어도 sticky 다", () => {
  // ⚠ 스프레드만으로는 부족한 자리다. `{...older, ...newer}` 는 newer 에 **키가 없으면**
  //   older 를 남기지만, 키가 `undefined` 로 **있으면** 덮어 버린다 — store.ts 의
  //   heartRateMeasuredAt 주석이 08-15 실측으로 기록한 그 함정이다.
  //   그래서 이 시험은 키를 명시적으로 undefined 로 실어 보낸다. 키를 빼고 시험하면
  //   스프레드가 통과시켜 **명시 sticky 줄이 없어도 초록불이 뜬다**(09-03 변이로 확인).
  const [m] = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-09-03T00:00:00.000Z", batteryPct: 87, batteryChargeUah: 412787, batteryStatus: 2 }),
    {
      workerId: "EMP-1", ts: "2026-09-03T00:02:00.000Z", heartRate: 90,
      batteryPct: undefined, batteryChargeUah: undefined, batteryStatus: undefined,
    } as unknown as VitalSample,
  ]);
  assert.equal(m!.heartRate, 90, "최신 표본이 안 이겼다");
  assert.equal(m!.batteryPct, 87, "잔량 sticky 가 깨졌다");
  assert.equal(m!.batteryChargeUah, 412787, "µAh sticky 가 깨졌다 — 명시 줄이 없으면 여기서 죽는다");
  assert.equal(m!.batteryStatus, 2, "충전상태 sticky 가 깨졌다 — 명시 줄이 없으면 여기서 죽는다");
});
