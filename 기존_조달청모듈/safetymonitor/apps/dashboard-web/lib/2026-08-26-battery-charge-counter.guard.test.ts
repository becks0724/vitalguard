// 배터리 충전카운터 가드 — 워치가 보낸 µAh 가 파싱·저장 끝까지 살아 가는가(L-115 양 끝 단언)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { VitalSampleSchema } from "@safetymonitor/schemas";

// ★ 이 가드의 한 문장 보장 = **batteryChargeUah 가 무음으로 사라지지 않는다.**
//   같은 파일(vital-stream.ts)의 주석이 locationAccuracyMeters 로 정확히 그 사고를 기록해 뒀다 —
//   스키마에 없어 Zod 가 무음 strip 했고 raw_json 은 파싱 **후** 객체라 거기에도 안 남아,
//   21만 GPS 행 어디에도 품질 지표가 없다. 같은 함정을 이 필드가 다시 밟지 않게 한다.

test("스키마가 충전카운터를 통과시킨다", () => {
  const parsed = VitalSampleSchema.parse({
    workerId: "EMP-0000",
    ts: "2026-08-26T00:00:00.000Z",
    batteryChargeUah: 388908,
  });
  assert.equal(parsed.batteryChargeUah, 388908, "Zod 가 충전카운터를 strip 했다");
});

test("정수·범위 계약을 지킨다", () => {
  const base = { workerId: "EMP-0000", ts: "2026-08-26T00:00:00.000Z" };
  // 음수는 잔량이 아니다.
  assert.throws(() => VitalSampleSchema.parse({ ...base, batteryChargeUah: -1 }));
  // 소수는 µAh 단위에서 의미가 없다(기기가 정수로 준다).
  assert.throws(() => VitalSampleSchema.parse({ ...base, batteryChargeUah: 1.5 }));
  // 0 은 "다 썼다"가 아니라 "못 읽었다" 이므로 앱이 안 보낸다 — 다만 스키마는 막지 않는다
  // (막으면 진짜 0 을 보내는 기기가 생겼을 때 행 전체가 거부된다).
  assert.equal(VitalSampleSchema.parse({ ...base, batteryChargeUah: 0 }).batteryChargeUah, 0);
});

test("없어도 통과한다 - 기존 앱을 깨지 않는다", () => {
  const parsed = VitalSampleSchema.parse({
    workerId: "EMP-0000",
    ts: "2026-08-26T00:00:00.000Z",
    batteryPct: 84,
  });
  assert.equal(parsed.batteryChargeUah, undefined);
  assert.equal(parsed.batteryPct, 84, "기존 필드가 함께 죽었다");
});

// ── 저장 끝단 ────────────────────────────────────────────────────────────────
// 파싱만 보면 "만들어지는가" 까지밖에 못 본다. 끝까지 가는지는 저장부를 봐야 한다(L-115③).
const db = readFileSync("lib/db.ts", "utf8");

test("저장 매핑이 열에 싣는다", () => {
  assert.match(
    db,
    /battery_charge_uah:\s*sample\.batteryChargeUah\s*\?\?\s*null/,
    "persistSample 이 충전카운터를 열에 안 싣는다 — 파싱은 되는데 DB 엔 안 남는다",
  );
});

test("열이 실제로 만들어진다", () => {
  assert.match(
    db,
    /ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS battery_charge_uah BIGINT/,
    "열 추가 DDL 이 없다 — 매핑만 있으면 INSERT 가 터진다",
  );
});

test("BIGINT 여야 한다", () => {
  // 폰 배터리는 수천 mAh = 수천만 µAh 라 INTEGER(21억) 여유가 좁고, 무엇보다 이 열은
  // 워치·폰이 공유한다. 좁게 잡으면 나중에 조용히 넘친다.
  const line = db.split("\n").find((l) => l.includes("battery_charge_uah BIGINT"));
  assert.ok(line, "battery_charge_uah 가 BIGINT 가 아니다");
});
