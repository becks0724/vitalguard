// 나라장터 종합쇼핑몰 품목정보(조달청_종합쇼핑몰 품목정보 서비스) — 개인보호구 실단가 조회.
// 엔드포인트 = apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService (프로브로 확정, 2026-07-10).
//
// ★ 서비스 설계 제약(실측): 이 서비스의 목록 오퍼레이션들은 검색 API 가 아니라 "T-1 하루분 피드"다.
//   날짜 파라미터(inqryBgnDt/EndDt 등)는 어떤 이름으로 보내도 무시되고 항상 등록·접수 기준 최근
//   하루치만 반환한다(91일 창과 1일 창의 totalCount 동일로 확인). 품명 필터만 정확 일치로 작동:
//   - getDlvrReqDtlInfoList(납품요구상세·실거래): dtilPrdctClsfcNoNm(세부품명) — 필드 prdctIdntNoNm/prdctUprc/prdctUnit
//   - getMASCntrctPrdctInfoList(다수공급자 카탈로그): prdctClsfcNoNm(품명) — 필드 prdctSpecNm/cntrctPrceAmt/cntrctCorpNm
//   따라서 보호구처럼 거래 빈도가 낮은 품목은 당일 피드에 없을 수 있다 → 그 품목은 pending 으로 두고
//   계획 단가(리서치 기반)를 유지하며, 피드에 잡히는 날 자동으로 실단가로 전환된다.
//   (상용화 = 일일 피드를 DB 로 적재·축적하는 수집 파이프라인 — gaspod_telemetry 영속 패턴과 동일.)

const BASE = "https://apis.data.go.kr/1230000/at/ShoppingMallPrdctInfoService";

export type ShopPrice = {
  keyword: string; // 검색 키워드(세부품명/품명)
  name: string; // 실제 등록·거래 품목명
  spec: string | null; // 규격
  price: number; // 단가(원) — 표본 중위값 행
  corp: string | null; // 계약업체명
  count: number; // 표본 수
  src: "거래" | "카탈로그"; // 납품요구(실거래) vs MAS 등록
};

export type ShopPricesPayload = {
  source: "live" | "pending";
  prices: Record<string, ShopPrice>;
  note?: string;
};

// 키워드별 6시간 캐시(성공/무데이터 모두) — 피드가 하루 단위라 재조회 무의미.
const cache = new Map<string, { ts: number; data: ShopPrice | null }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function hasKey(): boolean {
  return Boolean(process.env.G2B_SERVICE_KEY);
}

function pickStr(row: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}
function pickNum(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function extractRows(json: unknown): Record<string, unknown>[] {
  const body = (json as { response?: { body?: unknown } })?.response?.body as
    | { items?: unknown }
    | undefined;
  const items = body?.items;
  if (Array.isArray(items)) return items as Record<string, unknown>[];
  const inner = (items as { item?: unknown })?.item;
  if (Array.isArray(inner)) return inner as Record<string, unknown>[];
  if (inner && typeof inner === "object") return [inner as Record<string, unknown>];
  return [];
}

function fmtDt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

async function fetchRows(op: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
  const url = new URL(`${BASE}/${op}`);
  url.searchParams.set("serviceKey", process.env.G2B_SERVICE_KEY as string);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "999");
  url.searchParams.set("type", "json");
  // 날짜는 피드 특성상 무시되지만 납품요구상세는 형식상 필수(누락 시 빈 404) → 최근 3일로 고정 전달.
  const now = new Date();
  url.searchParams.set("inqryDiv", "1");
  url.searchParams.set("inqryBgnDt", fmtDt(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)));
  url.searchParams.set("inqryEndDt", fmtDt(now));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  if (!res.ok || /Forbidden|API not found/i.test(text.slice(0, 100))) {
    throw new Error(`shop API ${res.status}: ${text.slice(0, 80)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`shop API 비JSON 응답: ${text.slice(0, 80)}`);
  }
  return extractRows(json);
}

type Parsed = { name: string; spec: string | null; price: number; corp: string | null };

// 키워드 1개 → 대표 품목·단가. 1순위 납품요구상세(실거래), 2순위 MAS 카탈로그(당일 등록·변경분).
async function lookupKeyword(keyword: string): Promise<ShopPrice | null> {
  const hit = cache.get(keyword);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;

  let src: ShopPrice["src"] = "거래";
  let parsed: Parsed[] = (await fetchRows("getDlvrReqDtlInfoList", { dtilPrdctClsfcNoNm: keyword }))
    .map((r) => ({
      name: pickStr(r, ["prdctIdntNoNm"]),
      spec: null as string | null,
      price: pickNum(r, ["prdctUprc"]),
      corp: pickStr(r, ["cntrctCorpNm", "corpNm"]),
    }))
    .filter((r): r is Parsed => Boolean(r.name && r.price));
  if (parsed.length === 0) {
    src = "카탈로그";
    parsed = (await fetchRows("getMASCntrctPrdctInfoList", { prdctClsfcNoNm: keyword }))
      .map((r) => ({
        name: [pickStr(r, ["prdctClsfcNoNm"]), pickStr(r, ["prdctSpecNm"])].filter(Boolean).join(" — ") || null,
        spec: pickStr(r, ["prdctSpecNm"]),
        price: pickNum(r, ["cntrctPrceAmt"]),
        corp: pickStr(r, ["cntrctCorpNm"]),
      }))
      .filter((r): r is Parsed => Boolean(r.name && r.price));
  }
  if (parsed.length === 0) {
    cache.set(keyword, { ts: Date.now(), data: null });
    return null;
  }
  // 대표값 = 단가 중위 행(저가 미끼·고급 규격 왜곡 회피).
  parsed.sort((a, b) => a.price - b.price);
  const mid = parsed[Math.floor(parsed.length / 2)]!;
  const data: ShopPrice = { keyword, name: mid.name, spec: mid.spec, price: mid.price, corp: mid.corp, count: parsed.length, src };
  cache.set(keyword, { ts: Date.now(), data });
  return data;
}

// 키워드 목록 → 키워드별 실단가. 하나라도 성공하면 live(부분 성공 허용).
export async function getShopPrices(keywords: string[]): Promise<ShopPricesPayload> {
  if (!hasKey()) return { source: "pending", prices: {}, note: "G2B 인증키 미설정" };
  const uniq = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 15);
  const results = await Promise.allSettled(uniq.map((k) => lookupKeyword(k)));
  const prices: Record<string, ShopPrice> = {};
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) prices[uniq[i]!] = r.value;
    else if (r.status === "rejected") failed += 1;
  });
  if (Object.keys(prices).length === 0) {
    return {
      source: "pending",
      prices: {},
      note:
        failed > 0
          ? "종합쇼핑몰 API 응답 실패 — 잠시 후 자동 재시도"
          : "당일 피드에 해당 품목 거래·등록 없음 — 발생 시 자동 반영(리서치 단가 유지)",
    };
  }
  return { source: "live", prices, note: "나라장터 종합쇼핑몰 실단가(중위값)" };
}
