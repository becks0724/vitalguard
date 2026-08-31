import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  LAW_SNAPSHOT_COLLECTED_AT,
  LAW_SNAPSHOT_EDITION,
  LAW_SNAPSHOT_NOTICE,
  searchLawArticles,
} from "./law-snapshot";

test("스냅샷은 표시판(시행일)·수집일·법제처 확인 안내를 반드시 갖는다", () => {
  // 개정 추적 경계 — 시행일 없는 조문 인용이 법령 RAG 의 대표 사고 유형이다.
  assert.match(LAW_SNAPSHOT_EDITION, /시행 \d{4}\. \d{1,2}\. \d{1,2}\./, "표시판에 시행일이 없다");
  assert.match(LAW_SNAPSHOT_COLLECTED_AT, /^\d{4}-\d{2}-\d{2}$/, "수집일 형식 오류");
  assert.ok(LAW_SNAPSHOT_NOTICE.includes("법제처"), "법제처 원문 확인 안내가 없다");
});

test("조번호 직접 지정은 정확 일치로 그 조문만 돌려준다", () => {
  const hits = searchLawArticles("제560조 내용 알려줘");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.조, "제560조");
  const sub = searchLawArticles("제619조의2가 뭐야?");
  assert.equal(sub.length, 1);
  assert.equal(sub[0]!.조, "제619조의2");
});

test("키워드 검색 — 폭염은 정의(559)·조치(560)를, 밀폐공간은 618 계열을 찾는다", () => {
  const heat = searchLawArticles("폭염작업 휴식 의무 근거 조문").map((a) => a.조);
  assert.ok(heat.includes("제560조"), `폭염 조치 조문 누락: ${heat}`);
  assert.ok(heat.includes("제559조"), `폭염 정의 조문 누락: ${heat}`);
  const gas = searchLawArticles("밀폐공간 산소 농도 측정 근거").map((a) => a.조);
  assert.ok(gas.includes("제619조의2"), `측정 조문 누락: ${gas}`);
  const wind = searchLawArticles("강풍 타워크레인 중지 조문").map((a) => a.조);
  assert.ok(wind.includes("제37조"), `강풍 조문 누락: ${wind}`);
});

test("스냅샷 조문 원문은 검증된 핵심 수치를 보존한다", () => {
  // 회귀 방지 — 동기화 스크립트가 원문을 덮어써도 임계 수치가 사라지면 안 된다.
  const [art560] = searchLawArticles("제560조");
  assert.ok(art560!.내용.includes("31도") || art560!.내용.includes("폭염작업"), "560조 폭염 연결 소실");
  assert.ok(art560!.내용.includes("33도"), "560조 33도 휴식 기준 소실");
  assert.ok(art560!.내용.includes("2시간") && art560!.내용.includes("20분"), "560조 휴식 시간 소실");
  const [art618] = searchLawArticles("제618조");
  assert.ok(art618!.내용.includes("18퍼센트"), "618조 산소결핍 기준 소실");
});

test("스냅샷 밖 질문은 빈 결과 — 조문을 지어내지 않는다", () => {
  assert.deepEqual(searchLawArticles("제999조 알려줘"), []);
  assert.deepEqual(searchLawArticles("상속세 면제 한도"), []);
});
