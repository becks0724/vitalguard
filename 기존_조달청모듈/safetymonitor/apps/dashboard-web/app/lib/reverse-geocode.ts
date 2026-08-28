// 좌표 → 한국 주소. NCP Maps Reverse Geocoding 호출부 — 키는 서버에만 둔다.
//
// ★ 왜 서버인가(사용자 결정 2026-08-28 · docs/ocr-address-geocode/context-notes.md).
//   각인 주소를 앱이 직접 지오코딩하면 키가 앱 바이너리에 박힌다. 서버를 거치면 키가 안 나가고,
//   **지오코더를 갈아도 앱 재배포가 필요 없다.**
//
// ⚠ 자격증명은 병원 검색과 **같은 NCP 계정 키**를 쓴다(`NAVER_SEARCH_CLIENT_ID/SECRET`).
//   실측으로 인증은 통과하고 상품 구독만 없었다 — `401 {"errorCode":"210",
//   "details":"A subscription to the API is required."}`. 콘솔에서 Maps 를 구독하면 그대로 붙는다.
//   구독 전에는 `configured:true` 인 채 호출이 실패하므로 라우트가 502 로 가른다.
import "server-only";

import { buildAddresses, type NcpResult } from "./address-format";

const ENDPOINT = "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc";
const TIMEOUT_MS = 5000;

export type ReverseGeocoded = {
  configured: boolean;
  road: string | null;
  jibun: string | null;
  /** 앱이 각인에 그대로 찍는 한 줄. 표기 규칙은 `address-format.ts` 가 정한다. */
  display: string | null;
  note?: string;
};

function creds(): { id: string; secret: string } | null {
  const id = process.env.NAVER_SEARCH_CLIENT_ID?.trim();
  const secret = process.env.NAVER_SEARCH_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

export function isReverseGeocodeConfigured(): boolean {
  return creds() !== null;
}

/**
 * 좌표 한 건을 도로명·지번 주소로 바꾼다.
 *
 * 실패는 **던진다** — 호출자가 "주소 없음"과 "조회 실패"를 갈라야 하기 때문이다.
 * 빈 값으로 열화하면 앱이 기기 추정 폴백을 쓸지 판단할 근거를 잃는다.
 */
export async function reverseGeocode(lat: number, lon: number): Promise<ReverseGeocoded> {
  const c = creds();
  if (!c) {
    return {
      configured: false,
      road: null,
      jibun: null,
      display: null,
      note: "NAVER_SEARCH_CLIENT_ID/SECRET 미설정",
    };
  }

  // ⚠ `coords` 는 **경도,위도** 순서다. 뒤집으면 정상 200 으로 엉뚱한 지역이 온다([[L-118]] 계열 —
  //   상태코드로는 판별이 안 되는 고장). 가드가 이 순서를 못 박는다.
  const url = `${ENDPOINT}?coords=${lon},${lat}&output=json&orders=roadaddr,addr`;
  const res = await fetch(url, {
    headers: {
      "X-NCP-APIGW-API-KEY-ID": c.id,
      "X-NCP-APIGW-API-KEY": c.secret,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`NCP 역지오코딩 HTTP ${res.status} — ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    status?: { code?: number; message?: string };
    results?: NcpResult[];
  };

  // code 3 = 해당 좌표에 주소가 없다(바다·미등록 구역). 실패가 아니라 **빈 결과**다.
  if (json.status?.code === 3) {
    return {
      configured: true,
      road: null,
      jibun: null,
      display: null,
      note: "좌표에 등록된 주소가 없습니다.",
    };
  }
  if (json.status?.code !== 0) {
    throw new Error(
      `NCP 역지오코딩 상태 ${json.status?.code} — ${json.status?.message ?? "사유 없음"}`,
    );
  }

  const { road, jibun, display } = buildAddresses(json.results);
  return { configured: true, road, jibun, display };
}
