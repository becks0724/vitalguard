// CSV 내보내기 골든마스터 — 조달 제출 양식(현장정보 블록·빈 줄·헤더·행·따옴표 규칙)을 바이트 단위로 고정.
// 스트리밍 전환·리팩터가 형식을 깨면 여기서 즉시 실패한다. 분할 스트리밍 = 단일 조립 동일성도 검증.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { ExportRow, SiteInfoRow } from "./db.js";
import { csvCell, csvPrologue, rowsToCsvChunk } from "./export-csv.js";

const BASE_ROW: Omit<
  ExportRow,
  "id" | "worker_id" | "worker_name" | "employee_id" | "ts" | "received_at"
> = {
  job_title: null,
  guardian_name: null,
  guardian_phone: null,
  heart_rate: null,
  spo2: null,
  skin_temp_c: null,
  ambient_temp_c: null,
  battery_pct: null,
  manual_sos: null,
  fall_detected: null,
  latitude: null,
  longitude: null,
  hrv_sdnn_ms: null,
  resting_heart_rate: null,
  active_energy_kcal: null,
  steps: null,
  walking_heart_rate: null,
  flights_climbed: null,
  respiratory_rate: null,
};

const SITE_ROWS: SiteInfoRow[] = [
  {
    id: 1,
    snapshot_date: "2026-07-01",
    recorded_at: "2026-07-01T00:00:00.000Z",
    company_name: "(주)VitAlGuard",
    site_name: "스마트인재개발원 신축 공사",
    construction_type: "건축 (신축)",
    address: "광주광역시 동구 중앙로 196",
    start_date: "2026-03-24",
    completion_date: "2026-10-06",
  },
];

// A: 정상 전형값 · B: 특수문자(쉼표·따옴표)+SOS 위험 · C: 3메트릭 모두 주의
const ROWS: ExportRow[] = [
  {
    ...BASE_ROW,
    id: 1,
    worker_id: "EMP-1",
    worker_name: "장우진",
    employee_id: "EMP-1",
    ts: "2026-07-01T00:00:00.000Z",
    received_at: "2026-07-01T00:00:01.000Z",
    heart_rate: 75,
    spo2: 98,
    skin_temp_c: 36.0,
    battery_pct: 80,
    manual_sos: 0,
    fall_detected: 0,
    latitude: 35.1,
    longitude: 126.9,
  },
  {
    ...BASE_ROW,
    id: 2,
    worker_id: "EMP-2",
    worker_name: '김"수,영',
    employee_id: "EMP-2",
    job_title: "철근, 반장",
    guardian_name: "이보호",
    guardian_phone: "010-1234-5678",
    ts: "2026-07-01T00:01:00.000Z",
    received_at: "2026-07-01T00:01:01.000Z",
    heart_rate: 140,
    manual_sos: 1,
    fall_detected: 0,
  },
  {
    ...BASE_ROW,
    id: 3,
    worker_id: "EMP-3",
    worker_name: "양지후",
    employee_id: "EMP-3",
    ts: "2026-07-01T00:02:00.000Z",
    received_at: "2026-07-01T00:02:01.000Z",
    heart_rate: 115,
    spo2: 91,
    skin_temp_c: 37.1,
  },
];

// EMP-1 만 관제 웹 직급 오버라이드 존재(효과값 규칙: 오버라이드 ?? 폰 발신값)
const PROFILES: Record<string, string> = { "EMP-1": "현장소장" };

const EXPECTED =
  "현장정보(관리자 저장 기준 일 1회 snapshot)\n" +
  "snapshot_date,recorded_at,company_name,site_name,construction_type,address,start_date,completion_date\n" +
  "2026-07-01,2026-07-01T00:00:00.000Z,(주)VitAlGuard,스마트인재개발원 신축 공사,건축 (신축),광주광역시 동구 중앙로 196,2026-03-24,2026-10-06\n" +
  "\n" +
  "생체데이터\n" +
  "id,received_at,worker_id,worker_name,employee_id,job_title,guardian_name,guardian_phone,ts,heart_rate,spo2,skin_temp_c,ambient_temp_c,battery_pct,manual_sos,fall_detected,latitude,longitude,hr_status,spo2_status,temp_status,overall_status\n" +
  "1,2026-07-01T00:00:01.000Z,EMP-1,장우진,EMP-1,현장소장,,,2026-07-01T00:00:00.000Z,75,98,36,,80,0,0,35.1,126.9,정상,정상,정상,정상\n" +
  '2,2026-07-01T00:01:01.000Z,EMP-2,"김""수,영",EMP-2,"철근, 반장",이보호,010-1234-5678,2026-07-01T00:01:00.000Z,140,,,,,1,0,,,위험,대기,대기,위험\n' +
  "3,2026-07-01T00:02:01.000Z,EMP-3,양지후,EMP-3,,,,2026-07-01T00:02:00.000Z,115,91,37.1,,,,,,,주의,주의,주의,주의\n";

test("골든마스터 — 현장정보 블록 + 생체데이터 + 상태 라벨 바이트 동일", () => {
  const doc = csvPrologue(SITE_ROWS) + rowsToCsvChunk(ROWS, PROFILES);
  assert.equal(doc, EXPECTED);
});

test("스트리밍 분할 = 단일 조립 동일 — 배치 경계가 형식에 영향 없음", () => {
  const whole = csvPrologue(SITE_ROWS) + rowsToCsvChunk(ROWS, PROFILES);
  const first = ROWS[0];
  assert.ok(first);
  const chunked =
    csvPrologue(SITE_ROWS) +
    rowsToCsvChunk([first], PROFILES) +
    rowsToCsvChunk(ROWS.slice(1), PROFILES) +
    rowsToCsvChunk([], PROFILES);
  assert.equal(chunked, whole);
});

test("csvCell — RFC 4180 인용 규칙", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(0), "0");
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
});
