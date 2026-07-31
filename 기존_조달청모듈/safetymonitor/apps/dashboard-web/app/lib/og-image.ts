// 기사 링크 → 대표 이미지(og:image) 추출 — 네이버 뉴스검색 API 가 이미지를 주지 않아 직접 뽑는다.
// 링크 미리보기(카톡·슬랙)와 같은 수준의 공개 메타데이터 조회이며, 본문은 저장하지 않는다.
// 실패(차단·부재·타임아웃)는 정상 경로다 — 호출부가 대체 시각물로 폴백한다.
import "server-only";

// 기사 대표 이미지는 바뀌지 않으므로 길게 캐시한다(뉴스 목록 캐시 15분보다 훨씬 길게).
const TTL_MS = 6 * 60 * 60 * 1000;
// 응답 본문을 통째로 들고 있지 않도록 앞부분만 검사 — og:image 는 <head> 에 있다.
const MAX_SCAN_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 3500;

type Entry = { ts: number; url: string | null };
const g = globalThis as typeof globalThis & { __smOgImageCache?: Map<string, Entry> };
const cache = g.__smOgImageCache ?? (g.__smOgImageCache = new Map());

// <meta property="og:image" content="…"> — 속성 순서가 뒤바뀐 표기도 받는다.
const OG_PATTERNS = [
  /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
];

function pickOgUrl(html: string, pageUrl: string): string | null {
  for (const re of OG_PATTERNS) {
    const m = re.exec(html);
    const raw = m?.[1]?.trim();
    if (!raw) continue;
    try {
      // 상대경로·프로토콜 생략(//host/…) 대응. https 가 아니면 버린다(CSP img-src 가 https 만 허용).
      const abs = new URL(raw, pageUrl);
      if (abs.protocol !== "https:") return null;
      return abs.toString();
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchOgImage(link: string): Promise<string | null> {
  try {
    const res = await fetch(link, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        // 정직하게 우리를 식별한다(위장하지 않는다). Range 는 지원하면 앞부분만 받고, 무시돼도 동작한다.
        "User-Agent": "VitAlGuardBot/1.0 (safety dashboard link preview)",
        Accept: "text/html,application/xhtml+xml",
        Range: `bytes=0-${MAX_SCAN_BYTES - 1}`,
      },
    });
    if (!res.ok && res.status !== 206) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) return null;
    const html = (await res.text()).slice(0, MAX_SCAN_BYTES);
    return pickOgUrl(html, res.url || link);
  } catch {
    return null; // 타임아웃·차단·DNS 실패 — 대체 시각물로 간다
  }
}

// 링크 목록 → { link: 이미지 URL | null }. 캐시 적중분은 요청하지 않는다.
// 개별 실패가 전체를 막지 않도록 allSettled 로 모은다.
export async function ogImagesFor(links: string[]): Promise<Map<string, string | null>> {
  const now = Date.now();
  const out = new Map<string, string | null>();
  const todo: string[] = [];
  for (const link of links) {
    const hit = cache.get(link);
    if (hit && now - hit.ts < TTL_MS) out.set(link, hit.url);
    else todo.push(link);
  }
  const results = await Promise.allSettled(todo.map((l) => fetchOgImage(l)));
  todo.forEach((link, i) => {
    const r = results[i];
    const url = r?.status === "fulfilled" ? r.value : null;
    cache.set(link, { ts: now, url });
    out.set(link, url);
  });
  return out;
}
