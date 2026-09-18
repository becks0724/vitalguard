// 내보내기 미리보기 SQL 집계(countSamplesBySeverity)의 판정 조건이 TS overallStatus 와 동일한지
// 경계값 전수 대조 — SQL WHERE 절을 순수 함수로 미러링해 임계 이관 오류를 테스트로 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  SEVERITY_SQL_PARAMS,
  overallStatus,
  type SeveritySqlParams,
  type StatusInputs,
} from "./severity.js";

// db.ts countSamplesBySeverity 의 dangerCond/cautionCond 를 그대로 옮긴 미러.
// SQL 과 동일하게 IS NOT NULL 가드 + 파라미터 바인딩 값만 사용한다(숫자 하드코딩 금지).
function sqlBucket(
  row: StatusInputs,
  p: SeveritySqlParams,
): "danger" | "caution" | "other" {
  const danger =
    row.fall_detected === 1 ||
    row.manual_sos === 1 ||
    (row.heart_rate !== null &&
      (row.heart_rate >= p.hrDangerHigh || row.heart_rate <= p.hrDangerLow)) ||
    (row.spo2 !== null && row.spo2 < p.spo2Danger) ||
    (row.skin_temp_c !== null && row.skin_temp_c >= p.skinDanger);
  if (danger) return "danger";
  const caution =
    (row.heart_rate !== null &&
      (row.heart_rate >= p.hrCautionHigh || row.heart_rate <= p.hrCautionLow)) ||
    (row.spo2 !== null && row.spo2 < p.spo2Caution) ||
    (row.skin_temp_c !== null && row.skin_temp_c >= p.skinCaution);
  return caution ? "caution" : "other";
}

function tsBucket(row: StatusInputs): "danger" | "caution" | "other" {
  const s = overallStatus(row);
  return s === "danger" || s === "caution" ? s : "other";
}

// 임계 경계 ±1 과 대표값 — HR(40/50/110/130), SpO₂(88/92), 피부온(38.0/38.5 — 변환 없이 그대로)
// ★ 2026-09-18 — 종전 표는 오프셋 0.5 를 전제한 손목 37.0/37.5 근처였다. 오프셋을 뺐으므로
//   새 임계 38.0·38.5 를 실제로 넘나드는 값으로 바꾼다. 안 바꾸면 모든 행이 normal 로 몰려
//   체온 축이 시험되지 않은 채 초록으로 통과한다(경계를 안 건드리는 표는 통제군이 죽은 것이다).
const HR_VALUES = [null, 30, 39, 40, 41, 49, 50, 51, 75, 109, 110, 111, 129, 130, 131];
const SPO2_VALUES = [null, 80, 87.9, 88, 91.9, 92, 95];
const TEMP_VALUES = [null, 35.0, 37.4, 37.9, 38.0, 38.1, 38.4, 38.5, 38.6, 39.5];
const FLAG_VALUES = [null, 0, 1];

test("SQL 집계 조건 = TS overallStatus 경계값 전수 일치", () => {
  let cases = 0;
  for (const hr of HR_VALUES) {
    for (const spo2 of SPO2_VALUES) {
      for (const temp of TEMP_VALUES) {
        for (const sos of FLAG_VALUES) {
          for (const fall of FLAG_VALUES) {
            const row: StatusInputs = {
              heart_rate: hr,
              spo2,
              skin_temp_c: temp,
              manual_sos: sos,
              fall_detected: fall,
            };
            assert.equal(
              sqlBucket(row, SEVERITY_SQL_PARAMS),
              tsBucket(row),
              `불일치 row=${JSON.stringify(row)}`,
            );
            cases += 1;
          }
        }
      }
    }
  }
  // 전수 조합이 실제로 돌았는지 (그리드 축소 실수 방지)
  assert.equal(
    cases,
    HR_VALUES.length * SPO2_VALUES.length * TEMP_VALUES.length * FLAG_VALUES.length * FLAG_VALUES.length,
  );
});

// ★ 통제군 — 위 전수 대조가 "전부 normal" 로 조용히 통과하지 않았는지 본다.
// 경계를 안 건드리는 값 표를 쓰면 SQL 과 TS 가 둘 다 틀려도 일치해 버린다.
test("체온 축이 실제로 danger·caution·normal 을 모두 냈다", () => {
  const buckets = new Set(
    TEMP_VALUES.filter((t): t is number => t !== null).map((t) =>
      sqlBucket(
        { heart_rate: 75, spo2: 98, skin_temp_c: t, manual_sos: 0, fall_detected: 0 },
        SEVERITY_SQL_PARAMS,
      ),
    ),
  );
  assert.ok(buckets.has("danger"), "체온만으로 danger 를 내는 값이 표에 있어야 한다");
  assert.ok(buckets.has("caution"), "체온만으로 caution 를 내는 값이 표에 있어야 한다");
  assert.ok(buckets.has("other"), "체온이 normal 인 값도 표에 있어야 한다");
});

test("SQL 파라미터 = 판정 함수 임계 상수와 동일 값 (단일 소스 파생 확인)", () => {
  // 값 자체를 다시 하드코딩해 검증하면 소스가 셋이 된다 — 여기서는 형태·관계만 확인.
  const p = SEVERITY_SQL_PARAMS;
  assert.ok(p.hrDangerHigh > p.hrCautionHigh, "HR danger 상한 > caution 상한");
  assert.ok(p.hrDangerLow < p.hrCautionLow, "HR danger 하한 < caution 하한");
  assert.ok(p.spo2Danger < p.spo2Caution, "SpO₂ danger < caution");
  assert.ok(p.skinDanger > p.skinCaution, "피부온 danger > caution");
});
