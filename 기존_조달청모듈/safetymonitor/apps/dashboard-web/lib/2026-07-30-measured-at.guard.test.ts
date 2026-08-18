// 측정 시각 가드 — "5초마다 실측"과 "직전 값을 5초마다 복사"를 서버가 구분할 수 있게 유지한다.
//
// 무슨 일이 있었나(2026-07-30 조사). 워치는 새 심박이 올 때마다 전송하면서 SpO2 는 캐시된
// 마지막 값을 신선도 검사 없이 함께 붙인다(`send(heartRate: bpm, spo2: self.latestSpO2)`).
// 그 결과 SpO2 19만 4천 건이 실제로는 1,390 번의 측정을 복사한 것이었고, 한 값이 45,669 행
// 연속으로 붙은 구간도 있었다. ts 는 **전송 시각**이라 서버는 이를 알 방법이 없었다.
//
// 값만 비교해서 "바뀐 행만 실측"으로 세면 안 된다 — 같은 값이 나온 진짜 재측정을 버린다.
// 구분할 수 있는 건 **측정 시각**뿐이다. GPS 는 이미 locationTimestamp 로 그렇게 하고 있다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { VitalSampleSchema } from "@safetymonitor/schemas";

const root = resolve(__dirname, "..");
const dbSource = readFileSync(resolve(root, "lib/db.ts"), "utf8");
const storeSource = readFileSync(resolve(root, "app/api/app/vital/store.ts"), "utf8");

test("측정 시각 필드를 스키마가 받는다", () => {
  const shape = VitalSampleSchema.shape as Record<string, unknown>;
  for (const field of ["heartRateMeasuredAt", "spo2MeasuredAt"]) {
    assert.ok(shape[field], `${field} 가 없으면 앱이 보내도 zod 가 조용히 버린다`);
  }
});

test("워치가 이미 보내던 필드도 받는다(그동안 버려지던 것)", () => {
  const shape = VitalSampleSchema.shape as Record<string, unknown>;
  for (const field of ["heartbeat", "locationTimestamp", "watchDeviceModel"]) {
    assert.ok(shape[field], `${field} 는 워치가 이미 보내는 값이다 — 받지 않으면 계속 버려진다`);
  }
});

test("측정 시각은 ISO datetime 만 받는다(전송 시각과 같은 형식)", () => {
  const ok = VitalSampleSchema.safeParse({
    workerId: "EMP-test", ts: "2026-07-30T05:00:00.000Z",
    heartRate: 80, spo2: 97,
    heartRateMeasuredAt: "2026-07-30T05:00:00.000Z",
    spo2MeasuredAt: "2026-07-30T04:55:00.000Z",
  });
  assert.equal(ok.success, true, ok.success ? "" : JSON.stringify(ok.error.issues));
  const bad = VitalSampleSchema.safeParse({
    workerId: "EMP-test", ts: "2026-07-30T05:00:00.000Z", spo2MeasuredAt: "5분 전",
  });
  assert.equal(bad.success, false, "형식이 자유로우면 나중에 비교가 안 된다");
});

test("측정 시각이 DB 컬럼으로 저장된다(raw_json 안에만 남으면 조회가 안 된다)", () => {
  for (const col of [
    "heart_rate_measured_at",
    "spo2_measured_at",
    "heartbeat",
    "watch_device_model",
  ]) {
    assert.match(dbSource, new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`), `${col} 컬럼 필요`);
    assert.match(dbSource, new RegExp(`${col}:`), `${col} 를 persistSample 이 채워야 한다`);
  }
});

test("스키마에 없는 필드가 오면 조용히 버리지 않고 경고한다", () => {
  // 이 침묵이 accelerationMagnitudeG·mlFallPipelineActive·heartbeat 를 연달아 잃게 했다.
  assert.match(
    storeSource,
    /warnUnknownFields\(input\)/,
    "addSample 진입 시 미지 필드를 검사해야 한다",
  );
  assert.match(
    storeSource,
    /스키마에 없는 필드 수신/,
    "버려진다는 사실이 로그 문구로 드러나야 한다",
  );
  assert.match(
    storeSource,
    /Object\.keys\(VitalSampleSchema\.shape\)/,
    "알려진 필드 목록을 손으로 복제하면 스키마와 갈라진다 — shape 에서 파생할 것",
  );
});
