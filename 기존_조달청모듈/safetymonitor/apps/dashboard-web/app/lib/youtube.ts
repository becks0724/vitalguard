// YouTube Data API v3 클라이언트 — 기상특보/예비특보 관련 영상을 공식 채널 한정으로 검색.
// 정책(하이브리드): 라이브 검색 + 공식 채널(channelId) 한정 + safeSearch=strict (안전 제품이라 무큐레이션 차단).
//   - YOUTUBE_API_KEY 미설정 → configured:false (대시보드 무중단, UI 가 키 미설정 안내).
//   - YOUTUBE_OFFICIAL_CHANNEL_IDS(쉼표구분) 있으면 채널별 검색 후 병합(채널 한정).
//     비었으면 일반 검색 + safeSearch=strict 로 폴백(channelLimited:false 로 표시).
//   - 쿼터 절약: 쿼리별 결과를 3시간 캐시(특보는 수시간 단위 변동).
import "server-only";

export type WarningVideo = {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail: string | null;
  publishedAt: string | null;
};

export type WarningVideoResult = {
  configured: boolean; // YOUTUBE_API_KEY 설정 여부
  channelLimited: boolean; // 공식 채널 한정 검색이었는지
  query: string;
  videos: WarningVideo[];
  note?: string;
};

type CacheEntry = { ts: number; data: WarningVideoResult };
const g = globalThis as typeof globalThis & {
  __smYoutubeCache?: Map<string, CacheEntry>;
};
const cache = g.__smYoutubeCache ?? (g.__smYoutubeCache = new Map());
const TTL_MS = 3 * 60 * 60 * 1000; // 3시간 — 특보 변동 주기 + 쿼터 절약
const PER_CHANNEL = 4; // 채널당 최대 결과
const MAX_TOTAL = 6; // 병합 후 최대 노출
const GENERAL_FETCH = 25; // 일반 검색 후 뉴스사 필터링용 후보 수(검색 1콜=100units 동일)

function apiKey(): string | null {
  return process.env.YOUTUBE_API_KEY?.trim() || null;
}

// 공식 채널 ID 화이트리스트(UC... 형식, 쉼표구분, 엄격 모드). 비었으면 뉴스사 이름 필터로 폴백.
// 채널 ID 확인법: 채널 페이지 URL 또는 channels.list?forHandle=@핸들 → items[].id.
function officialChannels(): string[] {
  return (process.env.YOUTUBE_OFFICIAL_CHANNEL_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// 주요 뉴스사 channelTitle 화이트리스트(이름 부분일치). 채널 ID 없이 방송사 보도만 통과시킴.
// 기본값 = 사용자 지정 방송사. .env.local 의 YOUTUBE_NEWS_CHANNEL_NAMES 로 재정의 가능.
const DEFAULT_NEWS_CHANNELS = "KBS,SBS,MBC,JTBC,YTN,연합뉴스,채널A,channelA,Yonhap";
function newsChannelNames(): string[] {
  return (process.env.YOUTUBE_NEWS_CHANNEL_NAMES ?? DEFAULT_NEWS_CHANNELS)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
function matchesNews(channelTitle: string, names: string[]): boolean {
  const t = channelTitle.toLowerCase();
  return names.some((n) => t.includes(n.toLowerCase()));
}

// 검색어 — 기상 재난 종류(+등급). 뉴스사 한정이라 별도 수식어 없이 종류만으로 관련 보도 충분.
// 예: 호우경보 / 강풍주의보 / 태풍 예비특보. 지역은 전국(regionCode=KR)으로 한정 안 함.
export function buildQuery(
  type: string,
  level?: string,
  kind: "warning" | "preliminary" = "warning",
): string {
  if (kind === "preliminary") return `${type} 예비특보`;
  return `${type}${level ?? ""}`.trim();
}

type SearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
  };
};

// YouTube snippet 은 제목/채널명을 HTML escape(&#39; &amp; 등)해서 반환 → 표시용으로 디코딩.
function decodeHtml(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&") // &amp; 는 마지막에(중복 디코딩 방지)
    .trim();
}

function parseItems(items: SearchItem[]): WarningVideo[] {
  const out: WarningVideo[] = [];
  for (const it of items) {
    const id = it.id?.videoId;
    if (!id) continue;
    out.push({
      id,
      title: decodeHtml(it.snippet?.title ?? "(제목 없음)"),
      channelTitle: decodeHtml(it.snippet?.channelTitle ?? ""),
      thumbnail:
        it.snippet?.thumbnails?.medium?.url ?? it.snippet?.thumbnails?.default?.url ?? null,
      publishedAt: it.snippet?.publishedAt ?? null,
    });
  }
  return out;
}

async function searchOnce(
  key: string,
  q: string,
  channelId?: string,
  maxResults?: number,
): Promise<WarningVideo[]> {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: String(maxResults ?? (channelId ? PER_CHANNEL : MAX_TOTAL)),
    q,
    order: "relevance",
    safeSearch: "strict",
    videoEmbeddable: "true",
    relevanceLanguage: "ko",
    regionCode: "KR",
    key,
  });
  if (channelId) params.set("channelId", channelId);
  const url = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
  // 6초 타임아웃 — googleapis 무응답 시 무한 hang 방지(대시보드 무중단).
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!res.ok) return []; // 403(쿼터)·기타 오류는 빈 결과로 강등(대시보드 무중단)
  const json = (await res.json()) as { items?: SearchItem[] };
  return parseItems(json.items ?? []);
}

export async function searchWarningVideos(q: string): Promise<WarningVideoResult> {
  const key = apiKey();
  const channels = officialChannels();
  if (!key) {
    return {
      configured: false,
      channelLimited: channels.length > 0,
      query: q,
      videos: [],
      note: ".env.local 에 YOUTUBE_API_KEY 설정 필요",
    };
  }

  const news = newsChannelNames();
  // 채널 한정 방식 — ① channelId 화이트리스트(엄격) ② 없으면 뉴스사 channelTitle 필터 ③ 둘 다 없으면 일반.
  const mode: "id" | "news" | "open" =
    channels.length > 0 ? "id" : news.length > 0 ? "news" : "open";

  const cacheKey = `${q}::${mode}::${channels.join(",")}::${news.join(",")}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.data;

  let videos: WarningVideo[] = [];
  try {
    if (mode === "id") {
      // 채널별 검색 후 병합 — 공식 채널 ID 한정.
      // allSettled 로 채널별 실패 격리(한 채널 오류/타임아웃이 전체 손실로 번지지 않게).
      const settled = await Promise.allSettled(channels.map((c) => searchOnce(key, q, c)));
      videos = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    } else {
      // 일반 검색(전국 KR·한국어·safeSearch) 후 뉴스사 channelTitle 로 필터(news 모드).
      const raw = await searchOnce(key, q, undefined, mode === "news" ? GENERAL_FETCH : MAX_TOTAL);
      videos = mode === "news" ? raw.filter((v) => matchesNews(v.channelTitle, news)) : raw;
    }
  } catch {
    videos = [];
  }

  // id 중복 제거 후 상위 N.
  const seen = new Set<string>();
  videos = videos.filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true))).slice(0, MAX_TOTAL);

  const data: WarningVideoResult = {
    configured: true,
    channelLimited: mode !== "open",
    query: q,
    videos,
    note:
      mode === "id" ? "공식 채널 한정" : mode === "news" ? "주요 뉴스 채널 한정" : "일반 검색(safeSearch)",
  };
  cache.set(cacheKey, { ts: Date.now(), data });
  return data;
}
