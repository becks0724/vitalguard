// VWorld(국토부 공간정보 오픈플랫폼) 서버 헬퍼 — 주소 지오코딩 + 베이스(WMTS)·연속지적도(WMS) 타일 프록시 URL.
// 정책: 키(VWORLD_KEY)는 서버 전용(클라 비노출·프록시 경유), WMS 는 등록 도메인 Referer 검증 필수(실측),
//   지오코딩은 주소별 6h 캐시(도로명 실패 시 지번 1회 재시도), 미설정/실패는 configured/ok=false 로 graceful.
import "server-only";

const KEY = process.env.VWORLD_KEY ?? "";
// VWorld 인증키의 등록 서비스 URL — WMS 가 이 도메인을 Referer 로 요구한다(불일치 시 INCORRECT_KEY).
const REGISTERED_REFERER = "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app";

export function vworldConfigured(): boolean {
  return KEY.length > 0;
}

export type GeocodeResult = { ok: true; lat: number; lon: number; refined: string } | { ok: false };

const GEOCODE_TTL_MS = 6 * 60 * 60 * 1000;
const geocodeCache = new Map<string, { at: number; result: GeocodeResult }>();

async function geocodeOnce(address: string, type: "road" | "parcel"): Promise<GeocodeResult> {
  const url =
    "https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0" +
    `&crs=epsg:4326&address=${encodeURIComponent(address)}&refine=true&simple=false&format=json` +
    `&type=${type}&key=${KEY}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as {
      response?: {
        status?: string;
        refined?: { text?: string };
        result?: { point?: { x?: string; y?: string } };
      };
    };
    const r = json.response;
    const lat = Number(r?.result?.point?.y);
    const lon = Number(r?.result?.point?.x);
    if (r?.status !== "OK" || !Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false };
    return { ok: true, lat, lon, refined: r.refined?.text ?? "" };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

// 주소 → WGS84 좌표. 도로명(type=road) 우선, 실패 시 지번(type=parcel) 1회 재시도.
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  if (!vworldConfigured()) return { ok: false };
  const trimmed = address.trim();
  if (trimmed.length < 5 || trimmed.length > 120) return { ok: false };
  const cached = geocodeCache.get(trimmed);
  if (cached && Date.now() - cached.at < GEOCODE_TTL_MS) return cached.result;
  let result = await geocodeOnce(trimmed, "road");
  if (!result.ok) result = await geocodeOnce(trimmed, "parcel");
  // 실패는 캐시하지 않음 — 일시 장애 후 즉시 재시도 가능하게.
  if (result.ok) geocodeCache.set(trimmed, { at: Date.now(), result });
  return result;
}

// ── 타일 프록시용 업스트림 URL (256px 슬리피 그리드 기준) ──
const R = 20037508.342789244; // 웹 메르카토르 반주(m)

export function baseTileUrl(z: number, y: number, x: number): string {
  return `https://api.vworld.kr/req/wmts/1.0.0/${KEY}/Base/${z}/${y}/${x}.png`;
}

// 연속지적도(lp_pa_cbnd_bubun) WMS GetMap — 타일 xyz → EPSG:3857 BBOX 환산.
export function cadastralTileUrl(z: number, y: number, x: number): string {
  const n = 2 ** z;
  const span = (2 * R) / n;
  const minx = -R + x * span;
  const maxx = minx + span;
  const maxy = R - y * span;
  const miny = maxy - span;
  return (
    "https://api.vworld.kr/req/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0" +
    "&LAYERS=lp_pa_cbnd_bubun&STYLES=lp_pa_cbnd_bubun&CRS=EPSG:3857" +
    `&BBOX=${minx},${miny},${maxx},${maxy}` +
    `&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true&key=${KEY}`
  );
}

// 업스트림 타일 fetch — WMS Referer 검증 포함(WMTS 에도 무해).
export async function fetchTile(url: string): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Referer: REGISTERED_REFERER },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) return null; // WMS 예외 XML 등은 실패 처리
    return { body: await res.arrayBuffer(), contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
