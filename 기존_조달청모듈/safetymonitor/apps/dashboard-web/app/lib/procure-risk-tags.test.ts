// 안전조달 전용 위험태그 단위테스트 — 케이스는 전부 2026-08-27 나라장터 라이브 공고 실측 제목.
// (taskText 는 제목·주공종명·첨부파일명 결합이므로 제목 수준 문자열로 검증하는 것이 실사용과 같다.)
import assert from "node:assert/strict";
import { test } from "node:test";

import { FATALITY_STATS_2025, procureRuleTags, PROCURE_KEYWORD_RULES, severityFromForm } from "./procure-risk-tags";

const tagsOf = (text: string) => procureRuleTags(text).map((t) => t.tag);

test("실측 제목 — 기존 사전이 0태그였던 유형을 잡는다", () => {
  // 풀베기 2건 실측 — 종전 0태그 → 위험작업 0/40 이 '위험 없음'으로 읽혔다.
  // 벌목(벌도목에 맞음)과 예초(베임)는 사망 기전이 달라 태그를 갈랐다(2026-08-27 데이터 근거화).
  assert.deepEqual(tagsOf("2026년 풀베기사업(2차)(군내임회지구) · 조경식재공사"), ["예초/풀베기"]);
  assert.deepEqual(tagsOf("국유림 벌목 및 간벌 사업"), ["벌목"]);
  assert.ok(tagsOf("수도권제1순환(일산~퇴계원간)고속도로 2026년 도로표지 정비 공사").includes("도로상 작업"));
  assert.ok(tagsOf("2026년 교통사고 잦은 곳 개선공사(3공구)").includes("도로상 작업"));
  assert.ok(tagsOf("포항운하 침수방지시설 진출입로 공사").includes("수중/하천"));
  assert.ok(tagsOf("영천성남여자고등학교 본관동 장애인승강기 설치 공사").includes("승강기"));
  // 하수관로 — 종전 밀폐공간 사전("관거")이 못 잡던 실측 표기.
  assert.ok(tagsOf("노하처리분구 하수관로 정비사업(전기 및 계측제어)-총괄분").includes("밀폐공간"));
});

test("기존 7종 회귀 — 이름·매칭이 그대로다", () => {
  assert.ok(tagsOf("수배전반 전력감시용판넬 UPS 설치 전기공사").includes("전기/감전"));
  assert.ok(tagsOf("SILO(곡물창고) 옥상 안전난간 제작 설치 공사").includes("고소작업"));
  assert.ok(tagsOf("도림3지구 급경사지 붕괴위험지역 정비사업 — 사면 보강").includes("굴착/흙막이"));
});

test("근거 문장은 원문 부분문자열이다 — 환각 방지 계약", () => {
  const tags = procureRuleTags("2026년 풀베기사업(2차)(군내임회지구)");
  for (const t of tags) {
    assert.ok(t.evidence.length > 0, "근거가 비었다");
    assert.ok("2026년 풀베기사업(2차)(군내임회지구)".includes(t.evidence), "근거가 원문에 없다");
  }
});

// ⚠ 위험 없는 공고에 태그를 만들어내면 안 된다 — 점수 부풀리기 방지.
test("사전에 없는 유형은 0태그로 남는다", () => {
  assert.deepEqual(tagsOf("학내 건물명 및 번호 표지 설치 공사"), []);
});

// ── 심각도 = 사망사고 통계 파생(2026-08-27 사용자 결정) ─────────────────────
// 모든 태그의 심각도가 손배점이 아니라 severityFromForm(발생형태 구성비 밴딩) 파생값이어야 한다.
// 이 단언이 없으면 다음 사람이 태그 하나를 추가하며 근거 없는 숫자를 손으로 적는다.
test("모든 태그의 심각도가 사망 통계 파생값과 일치한다", () => {
  for (const r of PROCURE_KEYWORD_RULES) {
    assert.equal(r.severity, severityFromForm(r.form), `${r.tag}: 손배점 ${r.severity} ≠ 파생 ${severityFromForm(r.form)}`);
  }
});

// 밴딩 규칙 자체를 고정 — 원표 수치(2025 재해조사·전산업)와 등급 경계.
test("밴딩 — 공표 구성비 ≥6%=3 · <6%=2 · <1%=1 · 미공표=2", () => {
  assert.equal(severityFromForm("떨어짐"), 3); // 41.2%
  assert.equal(severityFromForm("무너짐"), 3); // 6.3% — 경계 바로 위
  assert.equal(severityFromForm("화재폭발"), 2); // 5.1%
  assert.equal(severityFromForm("질식중독"), 2); // 4.0% → 밀폐공간이 3→2 로 내려온 근거
  assert.equal(severityFromForm("절단베임찔림"), 1); // 0.46%
  assert.equal(severityFromForm("감전"), 2); // 개별 미공표 — 중간값
  assert.equal(severityFromForm("빠짐익사"), 2); // 개별 미공표 — 중간값
});

// 원표 대조 — 출처 표의 숫자가 코드에 그대로 있는지(옮겨 적다 틀리면 전부 틀린다).
// 고용노동부 2026-03-31 보도자료 유형별 표: 총 605명 중 개별 공표 8형태 합 = 565명.
test("통계 원표 수치 보존 — 개별 공표 형태의 합이 표와 맞는다", () => {
  const listed = Object.values(FATALITY_STATS_2025).filter((v) => v.deaths !== null);
  // 절단베임찔림(4)은 다른 통계(승인 기준) 출처라 재해조사 표 합산에서 뺀다.
  const sum = listed.reduce((s, v) => s + (v.deaths as number), 0) - 4;
  assert.equal(sum, 249 + 72 + 62 + 50 + 39 + 38 + 31 + 24);
});

// 권고 채우기 중복 금지(2026-08-27 "표시 소음은 정리") — 태그 1개 공고에서 기본 문구가
// 2줄 반복되던 실측 소음. 파일 텍스트로 못 박는다(같은 while 패딩이 되살아나면 빨간불).
import { readFileSync } from "node:fs";
import { join } from "node:path";
test("권고를 채우기용 반복으로 3개 만들지 않는다", () => {
  const src = readFileSync(join(import.meta.dirname, "procure-risk.ts"), "utf8");
  assert.doesNotMatch(src, /while \(recos\.length < 3\)/, "권고 반복 채우기가 되살아났다");
  assert.match(src, /if \(recos\.length === 0\) recos\.push/, "빈 권고 기본 문구 1회 규칙 소실");
});
