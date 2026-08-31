#!/usr/bin/env node
// 법령 조문 스냅샷 동기화(수동 실행) — data/law-snapshot/osh-rules.json 재수집 보조.
//
// 사용:
//   LAW_OC=<법제처 OC> node scripts/law-snapshot-sync.mjs
//
// ⚠ 법제처 DRF lawService API 는 OC 키에 등록된 서버 IP·도메인에서만 응답한다
//   (2026-08-31 실측: 미등록 IP 는 "사용자 정보 검증에 실패" JSON). 등록은 open.law.go.kr
//   마이페이지에서. 미등록 환경에서는 이 스크립트가 실패하며, 그 경우 law.go.kr 조문
//   페이지를 사람이 확인해 JSON 을 갱신한다(수집일·표시판 필드 갱신 필수).
//
// 동기화 주기(구현 설계 확정): 주 1회 수동 — 개정은 잦지 않고, 시행일 표기가 답변 경계다.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = resolve(here, "../data/law-snapshot/osh-rules.json");
const MST = "273603"; // 산업안전보건기준에 관한 규칙 — search_law 로 재확인 가능

const oc = process.env.LAW_OC?.trim();
if (!oc) {
  console.error("LAW_OC 환경변수가 필요합니다. 예: LAW_OC=rlaxorhs77 node scripts/law-snapshot-sync.mjs");
  process.exit(1);
}

/** 조번호("제560조"·"제619조의2") → DRF JO 파라미터(6자리). */
function joParam(jo) {
  const m = jo.match(/^제(\d{1,4})조(?:의(\d{1,2}))?$/);
  if (!m) throw new Error(`조번호 형식 오류: ${jo}`);
  return m[1].padStart(4, "0") + (m[2] ?? "0").padStart(2, "0");
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
let changed = 0;

for (const article of snapshot.조문) {
  const url = new URL("https://www.law.go.kr/DRF/lawService.do");
  url.searchParams.set("OC", oc);
  url.searchParams.set("target", "law");
  url.searchParams.set("MST", MST);
  url.searchParams.set("type", "JSON");
  url.searchParams.set("JO", joParam(article.조));
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const json = await res.json();
  if (json.result && /검증에 실패/.test(String(json.result))) {
    console.error(`✗ ${article.조} — OC 키 IP·도메인 미등록(API 거부). 수동 갱신 절차로 전환하세요.`);
    process.exit(2);
  }
  // DRF 응답 구조는 법령/조문 단위에 따라 다르다 — 조문 내용 필드를 찾으면 갱신, 못 찾으면 보존.
  const text = JSON.stringify(json);
  const content = json?.법령?.조문?.조문단위?.조문내용 ?? json?.조문내용 ?? null;
  if (typeof content === "string" && content.trim().length > 20) {
    article.내용 = content.trim();
    changed += 1;
    console.log(`✓ ${article.조} 갱신 (${content.length}자)`);
  } else {
    console.warn(`- ${article.조} 응답에서 조문내용 미발견(보존) · 응답 ${text.length}B`);
  }
}

if (changed > 0) {
  snapshot.수집일 = new Date().toISOString().slice(0, 10);
  snapshot.수집방법 = "법제처 DRF lawService API (scripts/law-snapshot-sync.mjs)";
  writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  console.log(`저장 완료 — ${changed}개 조문 갱신, 수집일 ${snapshot.수집일}`);
} else {
  console.log("갱신된 조문 없음 — 파일 보존");
}
