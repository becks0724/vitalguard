// 산업 안전뉴스 유틸 단위 테스트 — 태그·엔티티 제거·발행시각 파싱·상대시간·언론사 도메인·항목 파싱.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cleanText,
  decodeEntities,
  formatRelativeTime,
  hostnameOf,
  isExcludedNews,
  parseNaverNewsItem,
  parsePubDateMs,
  stripHtml,
} from "./news";

test("stripHtml — <b> 강조 제거", () => {
  assert.equal(stripHtml("<b>산업재해</b> 급증"), "산업재해 급증");
});

test("decodeEntities — &amp;/&quot;/&#39; 디코딩(중복 디코딩 없음)", () => {
  assert.equal(decodeEntities("노동&amp;안전"), "노동&안전");
  assert.equal(decodeEntities("&quot;중대재해&quot;"), '"중대재해"');
  assert.equal(decodeEntities("&#39;현장&#39;"), "'현장'");
  // &amp;lt; 는 한 번만 디코딩되어 &lt; 로 남아야 함(< 로 이중 디코딩 금지)
  assert.equal(decodeEntities("&amp;lt;"), "&lt;");
});

test("cleanText — 태그+엔티티+공백 정리", () => {
  assert.equal(cleanText("  <b>건설현장</b> 사고 &amp; 대책 "), "건설현장 사고 & 대책");
});

test("hostnameOf — www 제거, 실패 시 빈 문자열", () => {
  assert.equal(hostnameOf("https://www.yna.co.kr/view/123"), "yna.co.kr");
  assert.equal(hostnameOf("https://news.kbs.co.kr/a"), "news.kbs.co.kr");
  assert.equal(hostnameOf("not-a-url"), "");
});

test("parsePubDateMs — RFC-1123 파싱, 실패 시 undefined", () => {
  const ms = parsePubDateMs("Mon, 26 Sep 2016 07:50:00 +0900");
  assert.ok(ms !== undefined && ms > 0);
  assert.equal(parsePubDateMs("깨진 날짜"), undefined);
  assert.equal(parsePubDateMs(undefined), undefined);
});

test("formatRelativeTime — 방금/분/시간/일, 7일 이상은 날짜", () => {
  const now = Date.parse("2026-07-03T12:00:00+09:00");
  assert.equal(formatRelativeTime(now - 30_000, now), "방금 전");
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), "5분 전");
  assert.equal(formatRelativeTime(now - 3 * 3600_000, now), "3시간 전");
  assert.equal(formatRelativeTime(now - 2 * 86_400_000, now), "2일 전");
  // 10일 전 → yyyy.mm.dd
  assert.equal(formatRelativeTime(Date.parse("2026-06-23T12:00:00+09:00"), now), "2026.06.23");
  assert.equal(formatRelativeTime(undefined, now), "");
});

test("isExcludedNews — 증권·보험·법률 홍보·채용 노이즈 제외", () => {
  // 증권(테마주) — 제목에 제외어
  assert.equal(isExcludedNews("중대재해처벌법 관련주 급등", "안전 장비 업체 주목"), true);
  // 보험 재테크 — 요약에 제외어
  assert.equal(isExcludedNews("산재 대비 어떻게", "보험료 절감 노하우를 소개한다"), true);
  // 법률 서비스 홍보
  assert.equal(isExcludedNews("중대재해 전문 변호사가 말하는 대응법", ""), true);
  // 채용 공고
  assert.equal(isExcludedNews("안전관리자 채용 공고", "OO건설 모집"), true);
});

test("isExcludedNews — 정상 사고·정책 기사는 통과", () => {
  assert.equal(isExcludedNews("건설현장 추락 사고로 1명 사망", "고용노동부가 작업중지 명령"), false);
  assert.equal(isExcludedNews("밀폐공간 질식 사고 잇따라", "환기 조치 미비가 원인"), false);
  assert.equal(isExcludedNews("폭염 속 온열질환 산재 급증", "옥외 작업자 보호 대책 시행"), false);
});

test("parseNaverNewsItem — 링크는 네이버 우선·언론사는 원문 도메인·태그 제거", () => {
  const it = parseNaverNewsItem({
    title: "<b>중대재해</b> 처벌법 확대",
    originallink: "https://www.yna.co.kr/view/AKR123",
    link: "https://n.news.naver.com/article/001/000",
    description: "고용노동부는 <b>산업안전</b>보건 강화를…",
    pubDate: "Thu, 03 Jul 2026 09:00:00 +0900",
  });
  assert.equal(it.title, "중대재해 처벌법 확대");
  assert.equal(it.link, "https://n.news.naver.com/article/001/000"); // 네이버 우선
  assert.equal(it.source, "yna.co.kr"); // 원문 도메인
  assert.equal(it.description, "고용노동부는 산업안전보건 강화를…");
  assert.ok(it.pubDateMs !== undefined);
});
