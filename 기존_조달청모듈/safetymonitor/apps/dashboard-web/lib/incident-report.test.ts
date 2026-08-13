// 사고 조사 보고 헬퍼 단위 테스트 — 창 계산·CSV 직렬화 경계 고정.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  INCIDENT_WINDOW_HOURS,
  isIncidentWindowHours,
  incidentWindow,
  buildIncidentCsv,
  type IncidentReportData,
} from "./incident-report";

const AT = Date.parse("2026-08-13T03:00:00.000Z");

test("incidentWindow — 전후 대칭(24h = 전 12h·후 12h)", () => {
  const w = incidentWindow(AT, 24);
  assert.equal(AT - w.fromMs, 12 * 3_600_000);
  assert.equal(w.toMs - AT, 12 * 3_600_000);
});

test("hours 화이트리스트 — 6·12·24·48 만 허용", () => {
  for (const h of INCIDENT_WINDOW_HOURS) assert.equal(isIncidentWindowHours(h), true);
  for (const h of [0, 1, 3, 36, 72, 168, NaN]) assert.equal(isIncidentWindowHours(h), false);
});

function sampleData(): IncidentReportData {
  return {
    workerId: "EMP-6861",
    workerName: "장우진",
    occurredAt: "2026-08-13T03:00:00.000Z",
    windowFromMs: AT - 12 * 3_600_000,
    windowToMs: AT + 12 * 3_600_000,
    heartRate: [
      { tsMs: AT + 60_000, value: 120 },
      { tsMs: AT - 60_000, value: 95 },
    ],
    coreTempEst: [{ tsMs: AT, value: 37.8 }],
    spo2: [{ tsMs: AT + 120_000, value: 91 }],
    activeEnergyKcal: [{ tsMs: AT - 300_000, value: 1.25 }],
    events: [
      { ts: "2026-08-13T03:00:30.000Z", type: "fall", ackAt: "2026-08-13T03:02:00.000Z", ackBy: "관제,팀" },
      { ts: "2026-08-13T03:05:00.000Z", type: "sos", ackAt: null, ackBy: null },
    ],
  };
}

test("CSV — 메타 헤더(사고 시각·창·재계산 명시) + 컬럼 헤더 포함", () => {
  const csv = buildIncidentCsv(sampleData(), "2026-08-13T05:00:00.000Z");
  assert.match(csv, /^# VitAlGuard 사고 조사 자료/);
  assert.match(csv, /# 사고 시각,2026-08-13T03:00:00\.000Z/);
  assert.match(csv, /재계산\(Buller 2013/);
  assert.match(csv, /\n시각,항목,값,비고\n/);
});

test("CSV — 데이터 행이 시각 오름차순으로 섞여 정렬된다(항목별 블록 아님)", () => {
  const csv = buildIncidentCsv(sampleData(), "2026-08-13T05:00:00.000Z");
  const rows = csv.split("\n").filter((l) => !l.startsWith("#") && !l.startsWith("시각") && l);
  const times = rows.map((l) => Date.parse(l.split(",")[0]!));
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i]! >= times[i - 1]!);
  // 활동에너지(-5분)가 첫 행, 미대응 SOS(+5분)가 마지막 행.
  assert.match(rows[0]!, /활동에너지/);
  assert.match(rows[rows.length - 1]!, /이벤트:sos/);
});

test("CSV — 이벤트 행에 대응(ack) 정보·미대응 표기, 콤마 포함 값은 따옴표 이스케이프", () => {
  const csv = buildIncidentCsv(sampleData(), "2026-08-13T05:00:00.000Z");
  assert.match(csv, /이벤트:fall,,"대응 2026-08-13T03:02:00\.000Z \(관제,팀\)"/);
  assert.match(csv, /이벤트:sos,,미대응/);
});
