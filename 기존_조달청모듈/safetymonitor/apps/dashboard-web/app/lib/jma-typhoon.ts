// 일본 기상청(JMA) 태풍 예보 클라이언트 — 참고 진로 표시 전용. 인증키 불필요·신청 불필요.
//
// 출처 표기 의무 — 「出典：気象庁ホームページ」(公共データ利用規約 1.0). 화면 범례에 명시한다.
// 상업 이용은 허용되나 가공 시 "편집·가공했다"는 표시가 필요하다.
//
// ⚠️ 이 JSON 은 JMA **웹사이트가 쓰는 엔드포인트**이지 공표된 API 계약이 아니다.
//    형식이 예고 없이 바뀔 수 있으므로 파싱 실패는 **정상 경로**로 취급한다 — 참고 진로만
//    사라지고 기상청 기반 판정·화면은 그대로 동작해야 한다(여기서 throw 하면 태풍 패널 전체가 죽는다).
//    계약이 필요해지면 공식 경로는 気象庁防災情報XML(Atom)이고 XML 파싱 비용이 붙는다.
//
// ⚠️ 과도한 요청 금지 — JMA 는 일 10GB 초과 다운로드 시 IP 를 차단한다. 30분 캐시로 억제한다.
import "server-only";

import { parseJmaSpecifications, parseTargetTc, type JmaTyphoon } from "./jma-typhoon-parse";

export type { JmaTyphoon };

const BASE = "https://www.jma.go.jp/bosai/typhoon/data";
const TIMEOUT_MS = 6000;

type CacheEntry = { ts: number; data: JmaTyphoon[] };
const g = globalThis as typeof globalThis & { __smJmaTyphoonCache?: CacheEntry };
// 발표 간격이 3시간(24시간 예보는 1시간)이라 30분이면 충분하다. 기상청 캐시와 같은 주기.
const TTL_MS = 30 * 60 * 1000;

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // 네트워크·타임아웃·형식 오류 — 참고 진로 없이 계속 간다
  }
}

// 발효 중인 태풍의 JMA 참고 진로. 실패·비시즌이면 빈 배열(정상 상태).
export async function getJmaTyphoons(): Promise<JmaTyphoon[]> {
  const hit = g.__smJmaTyphoonCache;
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.data;

  const ids = parseTargetTc(await getJson(`${BASE}/targetTc.json`));
  // 조회 대상이 없으면(비시즌) 빈 배열도 캐시한다 — 태풍이 없는 동안 매 폴링마다 나가지 않게.
  const results = await Promise.all(
    ids.map(async (id) => parseJmaSpecifications(await getJson(`${BASE}/${id}/specifications.json`))),
  );
  const data = results.filter((r): r is JmaTyphoon => r !== null);
  g.__smJmaTyphoonCache = { ts: Date.now(), data };
  return data;
}
