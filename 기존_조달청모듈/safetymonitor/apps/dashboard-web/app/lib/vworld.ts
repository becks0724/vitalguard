// VWorld(국토부 공간정보 오픈플랫폼) 서버 헬퍼 — 주소 지오코딩 + 베이스(WMTS)·연속지적도(WMS) 타일 프록시 URL.
// 정책: 키(VWORLD_KEY)는 서버 전용(클라 비노출·프록시 경유), WMS 는 등록 도메인 Referer 검증 필수(실측),
//   지오코딩은 주소별 6h 캐시(도로명 실패 시 지번 1회 재시도), 미설정/실패는 configured/ok=false 로 graceful.
import "server-only";

import { buildAddresses, type VworldAddress } from "./address-format";

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

// 항공사진(위성) WMTS — 국토부 정사영상. Esri(국내 z18 안정)보다 고해상·z19 까지 더 확대. jpeg.
export function satelliteTileUrl(z: number, y: number, x: number): string {
  return `https://api.vworld.kr/req/wmts/1.0.0/${KEY}/Satellite/${z}/${y}/${x}.jpeg`;
}

// 항공사진 위 지명·경계 라벨 오버레이(Hybrid, 투명 png) — 위성만으론 안 보이는 지명 보강.
export function hybridTileUrl(z: number, y: number, x: number): string {
  return `https://api.vworld.kr/req/wmts/1.0.0/${KEY}/Hybrid/${z}/${y}/${x}.png`;
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

// ── 필지 경계 폴리곤 (연속지적도 GetFeature) ──
// 좌표가 속한 필지의 외곽 링을 반환. Referer 필수 실측(무 Referer=INCORRECT_KEY, 2026-07 프로브).
export type ParcelResult =
  | { ok: true; ring: { lat: number; lon: number }[]; addr: string }
  | { ok: false };

const PARCEL_TTL_MS = 6 * 60 * 60 * 1000;
const parcelCache = new Map<string, { at: number; result: ParcelResult }>();

export async function fetchParcelPolygon(lat: number, lon: number): Promise<ParcelResult> {
  if (!vworldConfigured()) return { ok: false };
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false };
  const cacheKey = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const cached = parcelCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PARCEL_TTL_MS) return cached.result;

  const url =
    "https://api.vworld.kr/req/data?service=data&request=GetFeature&data=LP_PA_CBND_BUBUN" +
    `&key=${KEY}&geomFilter=POINT(${lon} ${lat})&geometry=true&format=json&size=1&crs=EPSG:4326`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Referer: REGISTERED_REFERER },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as {
      response?: {
        status?: string;
        result?: {
          featureCollection?: {
            features?: {
              geometry?: { type?: string; coordinates?: unknown };
              properties?: { addr?: string };
            }[];
          };
        };
      };
    };
    const r = json.response;
    const feature = r?.result?.featureCollection?.features?.[0];
    if (r?.status !== "OK" || !feature?.geometry) return { ok: false };
    // MultiPolygon: coordinates[폴리곤][링][점][lon,lat] — 첫 폴리곤 외곽 링만 사용.
    const coords = feature.geometry.coordinates as number[][][][] | number[][][];
    const rawRing = feature.geometry.type === "MultiPolygon"
      ? (coords as number[][][][])[0]?.[0]
      : (coords as number[][][])[0];
    if (!Array.isArray(rawRing) || rawRing.length < 4) return { ok: false };
    const ring: { lat: number; lon: number }[] = [];
    for (const pt of rawRing) {
      const [plon, plat] = pt;
      if (!Number.isFinite(plat) || !Number.isFinite(plon)) return { ok: false };
      ring.push({ lat: plat as number, lon: plon as number });
    }
    const result: ParcelResult = { ok: true, ring, addr: feature.properties?.addr ?? "" };
    parcelCache.set(cacheKey, { at: Date.now(), result }); // 실패는 캐시하지 않음
    return result;
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// 좌표 → 주소(역지오코딩). 촬영 각인이 쓴다.
//
// ★ 왜 여기에 붙였는가 — 같은 키·같은 호스트·같은 정책이라 별도 모듈을 만들면 사본이 된다.
//   NCP Maps 도 후보였으나 상품 구독이 필요했고(실측 `401 errorCode 210`), VWorld 는
//   **이미 있는 키로 즉시 됐다.** 국토부 원본이라 주소 정확도도 이쪽이 낫다.

/** 각인용 한 줄은 `address-format.ts` 가 고른다 — 표기 규칙을 여기 섞지 않는다. */
export type ReverseGeocoded = {
  configured: boolean;
  road: string | null;
  jibun: string | null;
  display: string | null;
  note?: string;
};

/**
 * 좌표 한 건을 도로명·지번 주소로 바꾼다.
 *
 * 실패는 **던진다** — 호출자가 "주소 없음"과 "조회 실패"를 갈라야 하기 때문이다.
 * 빈 값으로 열화하면 앱이 기기 추정 폴백을 쓸지 판단할 근거를 잃는다.
 */
export async function reverseGeocode(lat: number, lon: number): Promise<ReverseGeocoded> {
  if (!vworldConfigured()) {
    return { configured: false, road: null, jibun: null, display: null, note: "VWORLD_KEY 미설정" };
  }
  // ⚠ `point` 는 **경도,위도**(x,y) 순서다. 뒤집으면 정상 200 으로 엉뚱한 지역이 온다
  //   ([[L-118]] 계열 — 상태코드로는 판별이 안 되는 고장). 가드가 이 순서를 못 박는다.
  // ⚠ `type=BOTH` 여야 도로명이 함께 온다. `PARCEL` 만 걸면 도로명은 영영 안 온다.
  const url =
    "https://api.vworld.kr/req/address?service=address&request=getAddress&version=2.0" +
    `&crs=epsg:4326&point=${lon},${lat}&format=json&type=BOTH&key=${KEY}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`VWorld 역지오코딩 HTTP ${res.status}`);
    const json = (await res.json()) as {
      response?: { status?: string; result?: VworldAddress[] };
    };
    const status = json.response?.status;
    // NOT_FOUND = 바다·미등록 구역. 실패가 아니라 **빈 결과**다(실측: 125,34 → NOT_FOUND).
    if (status === "NOT_FOUND") {
      return {
        configured: true,
        road: null,
        jibun: null,
        display: null,
        note: "좌표에 등록된 주소가 없습니다.",
      };
    }
    if (status !== "OK") throw new Error(`VWorld 역지오코딩 상태 ${status ?? "없음"}`);
    const { road, jibun, display } = buildAddresses(json.response?.result);
    return { configured: true, road, jibun, display };
  } finally {
    clearTimeout(timer);
  }
}
