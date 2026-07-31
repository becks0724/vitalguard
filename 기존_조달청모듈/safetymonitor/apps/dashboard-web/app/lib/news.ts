// 산업 안전뉴스 순수 유틸 — 네이버 뉴스검색 항목 파싱(HTML 태그·엔티티 제거)·발행시각·상대시간·언론사 도메인 추출.
// 서버(naver-news)·클라(NewsPanel)·테스트가 공유하므로 순수 함수만(네트워크 금지).

export type NewsItem = {
  title: string; // 태그·엔티티 제거된 기사 제목
  link: string; // 기사 링크(네이버 우선, 없으면 원문)
  description: string; // 요약(태그·엔티티 제거)
  source: string; // 언론사 도메인(originallink 호스트, www 제거) — 없으면 ""
  pubDateMs?: number; // 발행시각(파싱 성공 시 epoch ms)
  image?: string; // 기사 대표 이미지(og:image) — 네이버 API 가 안 주므로 서버가 별도 추출(og-image.ts)
};

export type NewsResult = {
  configured: boolean; // 네이버 검색 API 키 설정 여부
  items: NewsItem[]; // 발행시각 내림차순(최신 우선)
  fetchedAt: string; // 서버 조회 시각 ISO
  authError?: boolean; // 키는 있으나 인증 실패(401/403) — "결과 없음"과 구분
  note?: string;
};

export type NaverNewsRaw = {
  title?: string;
  originallink?: string; // 언론사 원문 URL(도메인 추출용)
  link?: string; // 네이버 뉴스 링크
  description?: string;
  pubDate?: string; // RFC-1123 예: "Mon, 26 Sep 2016 07:50:00 +0900"
};

// HTML 태그 제거(뉴스검색 title/description 은 <b>강조</b> 포함).
export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

// HTML 엔티티 디코딩(&amp; &quot; &#39; 등). &amp; 는 마지막(중복 디코딩 방지).
export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// 태그 제거 + 엔티티 디코딩 + 공백 정리.
export function cleanText(s: string): string {
  return decodeEntities(stripHtml(s)).trim();
}

// URL 에서 언론사 식별용 호스트명 추출(www 제거). 파싱 실패 시 "".
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// RFC-1123 발행시각 문자열 → epoch ms(파싱 실패 시 undefined).
export function parsePubDateMs(pubDate?: string): number | undefined {
  if (!pubDate) return undefined;
  const ms = Date.parse(pubDate);
  return Number.isFinite(ms) ? ms : undefined;
}

// 상대시간 표기(방금 전 / N분 전 / N시간 전 / N일 전, 7일 이상은 yyyy.mm.dd).
export function formatRelativeTime(pubMs: number | undefined, nowMs: number): string {
  if (pubMs === undefined || !Number.isFinite(pubMs)) return "";
  const diff = nowMs - pubMs;
  if (diff < 60_000) return "방금 전";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  const d = new Date(pubMs);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}.${mm}.${dd}`;
}

// 네이버 뉴스검색 item 1건 → NewsItem. 링크는 네이버 우선, 언론사는 원문 도메인.
export function parseNaverNewsItem(raw: NaverNewsRaw): NewsItem {
  return {
    title: cleanText(raw.title ?? ""),
    link: (raw.link || raw.originallink || "").trim(),
    description: cleanText(raw.description ?? ""),
    source: hostnameOf(raw.originallink || raw.link || ""),
    pubDateMs: parsePubDateMs(raw.pubDate),
  };
}
