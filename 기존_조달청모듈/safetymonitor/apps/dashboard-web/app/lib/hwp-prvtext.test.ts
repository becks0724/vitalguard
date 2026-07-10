// 별표1 요율 파싱·대조 단위 테스트 — 법제처 별표1 HWP PrvText 실측 샘플(제2025-11호) 기반.
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRateTableFromPrvText, diffRates } from "./hwp-prvtext";
import { SAFETY_COST_RATES } from "./safety-cost";

// 제2025-11호 별표1 PrvText 실측(2026-07-10, flSeq=149052615에서 추출) — 구조 그대로.
const REAL_PRVTEXT = `【별표 1】

공사종류 및 규모별 산업안전보건관리비 계상기준표

                                                              (단위: 원)
<          구 분 공사종류><대상액 5억원 미만인  경우  적용 비율(%)><대상액 5억원 이상  50억원 미만인 경우 ><대상액50억원 이상인 경우  적용 비율(%)><영 별표5에 따른 보건관리자 선임 대상 건설공사의  적용비율(%)><적용 비율     (%)><기초액>
<건  축  공  사 토  목  공  사 중 건 설 공사  특 수 건 설 공 사><3.11% 3.15% 3.64% 2.07%><2.28% 2.53% 3.05% 1.59%><4,325,000원 3,300,000원 2,975,000원 2,450,000원><2.37% 2.60% 3.11% 1.64%><2.64% 2.73% 3.39% 1.78%>`;

test("실측 PrvText 파싱 — 4공종 × 3구간 요율·기초액 정확 추출", () => {
  const parsed = parseRateTableFromPrvText(REAL_PRVTEXT);
  assert.ok(parsed, "파싱 성공해야 함");
  assert.deepEqual(parsed["건축공사"], { under5: 0.0311, mid: { rate: 0.0228, base: 4_325_000 }, over50: 0.0237 });
  assert.deepEqual(parsed["토목공사"], { under5: 0.0315, mid: { rate: 0.0253, base: 3_300_000 }, over50: 0.026 });
  assert.deepEqual(parsed["중건설공사"], { under5: 0.0364, mid: { rate: 0.0305, base: 2_975_000 }, over50: 0.0311 });
  assert.deepEqual(parsed["특수건설공사"], { under5: 0.0207, mid: { rate: 0.0159, base: 2_450_000 }, over50: 0.0164 });
});

test("실측 PrvText vs 내장 요율표 — 완전 일치(diff 0건)", () => {
  const parsed = parseRateTableFromPrvText(REAL_PRVTEXT);
  assert.ok(parsed);
  assert.deepEqual(diffRates(parsed), []);
});

test("요율 개정 시 diff 감지 — 건축 50억이상 2.37→2.50 변경 가정", () => {
  const changed = REAL_PRVTEXT.replace("2.37%", "2.50%");
  const parsed = parseRateTableFromPrvText(changed);
  assert.ok(parsed);
  const diffs = diffRates(parsed);
  assert.equal(diffs.length, 1);
  assert.match(diffs[0]!, /건축공사 50억이상/);
});

test("계상기준표 아닌 텍스트 → null (수동 대조 폴백)", () => {
  assert.equal(parseRateTableFromPrvText("【별표 3】 공사진척에 따른 사용기준 50% 70% 90%"), null);
});

test("퍼센트 토큰 부족(표 구조 변경) → null", () => {
  assert.equal(parseRateTableFromPrvText("계상기준표 <3.11% 2.28%> <4,325,000원>"), null);
});

test("타당성 범위 밖 요율(파싱 오류 의심) → null", () => {
  const weird = REAL_PRVTEXT.replace("3.11%", "31.10%");
  assert.equal(parseRateTableFromPrvText(weird), null);
});

// 검증 데이터 자체의 무결성 — 내장 요율표가 4공종을 모두 갖는지(파서 순서 가정의 전제).
test("내장 요율표 4공종 존재", () => {
  for (const t of ["건축공사", "토목공사", "중건설공사", "특수건설공사"] as const) {
    assert.ok(SAFETY_COST_RATES[t]);
  }
});
