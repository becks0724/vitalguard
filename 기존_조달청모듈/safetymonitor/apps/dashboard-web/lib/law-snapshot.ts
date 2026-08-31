// 법령 조문 스냅샷 검색(순수) — 도메인 ③ "조문 스냅샷 RAG" 1단계.
//
// 설계(2026-08-31 리서치 브리핑 확정):
//  - 벡터 DB 없이 시작한다. 코퍼스는 레포에 버전 관리되는 JSON 스냅샷(data/law-snapshot/)이고,
//    법제처 라이브 API 에 의존하지 않는다 — 조문 단건 API 장애가 당일 실측됐다(스냅샷+동기화 확정).
//  - 검색은 결정적 토큰 매칭이다. 챗봇 답변의 조문 원문·시행일 표기는 서버 데이터 그대로이며,
//    LLM 은 요약·설명만 한다. 재수집은 scripts/law-snapshot-sync.mjs(수동 · OC 키 IP 등록 필요).
//  - 새 경계: 답변에는 표시판(시행일) 명시 + 법제처 원문 확인 안내를 병기한다(개정 추적).
import snapshot from "../data/law-snapshot/osh-rules.json";

export type LawArticle = {
  법령명: string;
  약칭: string;
  표시판: string;
  조: string;
  제목: string;
  개정이력: string;
  내용: string;
};

const ARTICLES: LawArticle[] = snapshot.조문.map((a) => ({
  법령명: snapshot.법령명,
  약칭: snapshot.약칭,
  표시판: snapshot.표시판,
  조: a.조,
  제목: a.제목,
  개정이력: a.개정이력,
  내용: a.내용,
}));

export const LAW_SNAPSHOT_NOTICE = snapshot.주의;
export const LAW_SNAPSHOT_EDITION = snapshot.표시판;
export const LAW_SNAPSHOT_COLLECTED_AT = snapshot.수집일;

/** "제560조"·"560조" 같은 조번호 직접 지정을 찾는다(정확 일치 우선). */
function byArticleNo(message: string): LawArticle[] {
  const m = message.match(/제?\s*(\d{1,3})\s*조(?:\s*의\s*(\d{1,2}))?/);
  if (!m) return [];
  const jo = `제${m[1]}조${m[2] ? `의${m[2]}` : ""}`;
  return ARTICLES.filter((a) => a.조 === jo);
}

/** 질문 토큰과 조문 제목·내용의 겹침 점수로 상위 조문을 고른다(결정적). */
export function searchLawArticles(message: string, limit = 3): LawArticle[] {
  const direct = byArticleNo(message);
  if (direct.length > 0) return direct.slice(0, limit);

  const tokens = [...new Set(message.match(/[가-힣A-Za-z0-9]{2,}/g) ?? [])].filter(
    (t) => !/^(알려|보여|말해|주세요|해줘|해주|무엇|뭐야|어떻|근거|조문|법령|규칙|규정|관련|대한|내용)$/.test(t),
  );
  if (tokens.length === 0) return [];
  const scored = ARTICLES.map((a) => {
    let score = 0;
    for (const t of tokens) {
      if (a.제목.includes(t)) score += 3;
      if (a.내용.includes(t)) score += 1;
    }
    return { a, score };
  })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
  return scored.slice(0, limit).map((x) => x.a);
}
