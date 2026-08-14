// 공공데이터 E-Gen(국립중앙의료원 병의원 정보) 응답 파싱·진료시간 포맷·인근 병원 매칭 순수 유틸(I/O 없음).
// 서버(egen-hospital)·테스트가 공유하므로 네트워크 금지 — 순수 함수만.
import { haversineKm, type Hospital } from "./hospital";

// 시·도 단축명(extractRegion 산출) → E-Gen Q0(정식 시·도명) 역매핑.
export const SIDO_FULL: Record<string, string> = {
  서울: "서울특별시",
  부산: "부산광역시",
  대구: "대구광역시",
  인천: "인천광역시",
  광주: "광주광역시",
  대전: "대전광역시",
  울산: "울산광역시",
  세종: "세종특별자치시",
  경기: "경기도",
  강원: "강원특별자치도",
  충북: "충청북도",
  충남: "충청남도",
  전북: "전북특별자치도",
  전남: "전라남도",
  경북: "경상북도",
  경남: "경상남도",
  제주: "제주특별자치도",
};

// "광주 동구" → { sido: "광주광역시", sidoShort: "광주", sigungu: "동구" }. 시·군·구 없으면 sigungu 빈 문자열.
// sidoShort = E-Gen 주소 표기 불일치(광주=「전남광주통합특별시」·전남 등) 시 정식명 대신 재시도할 단축명.
export function egenRegionParams(region: string): {
  sido: string;
  sidoShort: string;
  sigungu: string;
} {
  const toks = (region ?? "").trim().split(/\s+/).filter(Boolean);
  const short = toks[0] ?? "";
  const sido = SIDO_FULL[short] ?? short;
  const sigungu = toks.slice(1).join(" ");
  return { sido, sidoShort: short, sigungu };
}

export type EgenPlace = {
  name: string;
  tel: string;
  hours: string; // 포맷된 진료시간(빈 문자열 = 정보 없음)
  lat?: number;
  lon?: number;
};

// E-Gen XML 태그 1개 추출(값이 CDATA 로 감싸질 수 있음).
function tag(block: string, name: string): string {
  const m = block.match(
    new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`),
  );
  return m?.[1]?.trim() ?? "";
}

// "0900" → "09:00", 4자리 아니면 빈 문자열(휴무/미기재).
export function hhmm(v: string): string {
  const s = (v ?? "").replace(/\D/g, "");
  if (s.length !== 4) return "";
  return `${s.slice(0, 2)}:${s.slice(2)}`;
}

const DAY_LABEL = ["월", "화", "수", "목", "금", "토", "일"];

// E-Gen dutyTime{1..7}s/{1..7}c(월~일 시작/종료) → "월–금 09:00–17:30 · 토 09:00–13:00 · 일 휴무" 컴팩트 표기.
export function formatDutyHours(times: { start: string; end: string }[]): string {
  const days = times.slice(0, 7).map((t) => {
    const s = hhmm(t.start);
    const e = hhmm(t.end);
    return s && e ? `${s}–${e}` : ""; // 빈 = 휴무
  });
  if (days.every((d) => !d)) return "";
  const parts: string[] = [];
  let i = 0;
  while (i < 7) {
    const cur = days[i];
    let j = i;
    while (j + 1 < 7 && days[j + 1] === cur) j++;
    const label = i === j ? DAY_LABEL[i] : `${DAY_LABEL[i]}–${DAY_LABEL[j]}`;
    parts.push(cur ? `${label} ${cur}` : `${label} 휴무`);
    i = j + 1;
  }
  return parts.join(" · ");
}

// E-Gen <item> 1블록 → EgenPlace(좌표 필드명은 서비스별로 달라 방어적 폴백).
export function parseEgenItem(block: string): EgenPlace {
  const name = tag(block, "dutyName");
  const tel = tag(block, "dutyTel1");
  const times = Array.from({ length: 7 }, (_, k) => ({
    start: tag(block, `dutyTime${k + 1}s`),
    end: tag(block, `dutyTime${k + 1}c`),
  }));
  const latRaw =
    tag(block, "wgs84Lat") || tag(block, "latitude") || tag(block, "YPos");
  const lonRaw =
    tag(block, "wgs84Lon") || tag(block, "longitude") || tag(block, "XPos");
  const lat = latRaw ? Number(latRaw) : NaN;
  const lon = lonRaw ? Number(lonRaw) : NaN;
  return {
    name,
    tel,
    hours: formatDutyHours(times),
    lat: Number.isFinite(lat) ? lat : undefined,
    lon: Number.isFinite(lon) ? lon : undefined,
  };
}

// E-Gen 응답의 totalCount(그 조건의 전체 건수). 없으면 -1 = 알 수 없음.
// 받은 건수와 비교해 **응답이 잘렸는지** 판정하는 데 쓴다 — 조용한 절단을 막는 유일한 단서다.
export function parseEgenTotalCount(xml: string): number {
  const m = xml.match(/<totalCount>\s*(\d+)\s*<\/totalCount>/);
  return m?.[1] === undefined ? -1 : Number(m[1]);
}

// E-Gen 응답 XML 전체 → EgenPlace[](<item> 블록 분해, 이름 없는 항목 제외).
export function parseEgenXml(xml: string): EgenPlace[] {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return blocks.map(parseEgenItem).filter((p) => p.name);
}

// 정식명·단축명 두 조회 결과 합치기(이름+전화 기준 중복 제거).
//
// ★ 왜 "한쪽이 0이면 다른 쪽" 이 아니라 합치는가 (2026-08-14 실측) —
//   E-Gen 은 Q0 를 주소 부분일치로 매칭하는데 2026 행정구역 개편으로 표기가 갈렸다.
//   그래서 **양쪽 다 비어 있지 않은데 한쪽만 사실상 쓸모없는** 상태가 생긴다.
//     광주 동구 = 정식명 1건 / 단축명 234건   ← 옛 표기로 남은 잔여 1건이 "0이면 재시도" 를 막았다
//     전남 목포시 = 정식명 0건 / 단축명 290건
//     충북 청주시 = 정식명 1130건 / 단축명 0건   ← 반대 방향(약칭이 정식명의 부분문자열이 아님)
//     충남 천안시 = 정식명 847건 / 단축명 1건   ← 같은 함정의 거울상
//   즉 어느 쪽을 우선해도 대칭으로 같은 함정에 빠지고, 임계값("N건 미만이면 재시도")은
//   지역마다 다른 잔여 건수에 기대는 추측이다. 둘 다 받아 합치면 순서·임계 판단이 아예 사라진다.
export function mergeEgenPlaces(a: EgenPlace[], b: EgenPlace[]): EgenPlace[] {
  const seen = new Map<string, EgenPlace>();
  for (const p of [...a, ...b]) {
    const key = `${normName(p.name)}|${p.tel}`;
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
}

// 이름 정규화(태그·괄호·공백 제거) — 좌표 매칭 실패 시 포함 매칭용.
export function normName(s: string): string {
  return (s ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

// Naver 병원 1건에 대응하는 E-Gen 장소 찾기.
//
// ★ 이름이 맞는 후보만 본다. 좌표는 신원을 정하지 못하고 **동명 후보를 가르는 데만** 쓴다.
//   종전엔 "150m 내 최근접" 을 이름보다 우선했는데, 도심에서는 그 안에 무관한 의원이 여럿이다.
//   2026-08-14 실측 — 전남대학교병원 응급의료센터 기준 이상명내과의원 84m · 전남대학교병원 147m.
//   최근접 규칙이 **응급 패널에 내과의원 번호(062-232-7675)를 붙였다.**
//   응급 연락처에서 남의 번호는 빈칸보다 나쁘므로, 못 찾으면 null 로 두는 쪽을 택한다.
export function matchEgenPlace(
  h: Pick<Hospital, "name" | "lat" | "lon">,
  places: EgenPlace[],
): EgenPlace | null {
  const hn = normName(h.name);
  if (!hn) return null;
  // 이름 포함(정규화 후 서로 포함 — "전남대학교병원" ⊂ "전남대학교병원응급의료센터")
  const named = places.filter((p) => {
    const pn = normName(p.name);
    return pn !== "" && (pn.includes(hn) || hn.includes(pn));
  });
  if (named.length === 0) return null;
  if (named.length === 1) return named[0] ?? null;
  // 동명 후보가 여럿이면(지점·분원) 좌표로 가른다. 좌표가 없으면 첫 후보.
  if (h.lat === undefined || h.lon === undefined) return named[0] ?? null;
  let best: EgenPlace | null = null;
  let bestD = Infinity;
  for (const p of named) {
    if (p.lat === undefined || p.lon === undefined) continue;
    const d = haversineKm(h.lat, h.lon, p.lat, p.lon);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ?? named[0] ?? null;
}
