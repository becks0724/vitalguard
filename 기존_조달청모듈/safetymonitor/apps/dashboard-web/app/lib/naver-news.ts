// 네이버 뉴스검색(NCP NAVER API HUB · naverapihub.apigw.ntruss.com/search/v1/news) — 산업현장·산업재해·산업안전 법규 실시간 기사.
// 정책: Client ID/Secret(= NCP API HUB 키·헤더 X-NCP-APIGW-API-KEY-ID/KEY, 인근 병원과 동일 키) 서버 보관,
//   주제별 검색(최신순)→발행시각 정렬·중복제거, 15분 캐시.
//   - NAVER_SEARCH_CLIENT_ID/SECRET 미설정 → configured:false (대시보드 무중단, 패널이 키 미설정 안내).
import "server-only";

import {
  parseNaverNewsItem,
  type NaverNewsRaw,
  type NewsItem,
  type NewsResult,
} from "./news";

type CacheEntry = { ts: number; data: NewsResult };
const g = globalThis as typeof globalThis & {
  __smNewsCache?: Map<string, CacheEntry>;
};
const cache = g.__smNewsCache ?? (g.__smNewsCache = new Map());
const TTL_MS = 15 * 60 * 1000; // 15분 — 뉴스는 수시 갱신되나 쿼터 절약 위해 캐시
const PER_QUERY = 20; // 쿼리당 최대(뉴스검색 display 최대 100, 절약)
const MAX_TOTAL = 30; // 병합 후 최대 노출

// 산업 안전 뉴스 검색어 — 산업현장·산업재해·산업안전 법규.
const QUERIES = ["산업재해", "중대재해처벌법", "산업안전보건", "건설현장 사고"];

function creds(): { id: string; secret: string } | null {
  const id = process.env.NAVER_SEARCH_CLIENT_ID?.trim();
  const secret = process.env.NAVER_SEARCH_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

export function isNaverNewsConfigured(): boolean {
  return creds() !== null;
}

async function searchOne(
  query: string,
  headers: Record<string, string>,
): Promise<{ items: NaverNewsRaw[]; status: number }> {
  const url = `https://naverapihub.apigw.ntruss.com/search/v1/news?query=${encodeURIComponent(
    query,
  )}&display=${PER_QUERY}&start=1&sort=date&format=json`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { items: [], status: res.status };
    const json = (await res.json()) as { items?: NaverNewsRaw[] };
    return { items: Array.isArray(json.items) ? json.items : [], status: 200 };
  } catch {
    return { items: [], status: 0 }; // 개별 쿼리 실패는 부분 격리(전체 무너지지 않게)
  }
}

export async function searchSafetyNews(): Promise<NewsResult> {
  const c = creds();
  const fetchedAt = new Date().toISOString();
  if (!c) {
    return {
      configured: false,
      items: [],
      fetchedAt,
      note: "NAVER_SEARCH_CLIENT_ID/SECRET 미설정",
    };
  }

  const hit = cache.get("news");
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.data;

  const headers = {
    "X-NCP-APIGW-API-KEY-ID": c.id,
    "X-NCP-APIGW-API-KEY": c.secret,
  };

  const seenLink = new Set<string>();
  const seenTitle = new Set<string>(); // 같은 헤드라인이 여러 쿼리/매체에 잡히는 중복 제거
  const items: NewsItem[] = [];
  let authFailed = false; // 401/403 — 키는 있으나 인증 실패

  for (const query of QUERIES) {
    const { items: raws, status } = await searchOne(query, headers);
    if (status === 401 || status === 403) authFailed = true;
    for (const raw of raws) {
      const it = parseNaverNewsItem(raw);
      if (!it.title || !it.link) continue;
      const tkey = it.title.replace(/\s+/g, " ").trim();
      if (seenLink.has(it.link) || seenTitle.has(tkey)) continue;
      seenLink.add(it.link);
      seenTitle.add(tkey);
      items.push(it);
    }
  }

  // 발행시각 내림차순(최신 우선), 미상은 뒤로.
  items.sort((a, b) => (b.pubDateMs ?? 0) - (a.pubDateMs ?? 0));

  const data: NewsResult = {
    configured: true,
    items: items.slice(0, MAX_TOTAL),
    fetchedAt,
    ...(authFailed && items.length === 0
      ? {
          authError: true,
          note: "네이버 인증 실패(401/403) — 검색 API Client ID/Secret 확인",
        }
      : {}),
  };
  // 인증 실패는 캐시하지 않는다(키 교정 즉시 반영되게).
  if (!data.authError) cache.set("news", { ts: Date.now(), data });
  return data;
}
