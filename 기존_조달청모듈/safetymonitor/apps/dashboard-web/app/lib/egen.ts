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

// "광주 동구" → { sido: "광주광역시", sigungu: "동구" }. 시·군·구 없으면 sigungu 빈 문자열.
export function egenRegionParams(region: string): { sido: string; sigungu: string } {
  const toks = (region ?? "").trim().split(/\s+/).filter(Boolean);
  const short = toks[0] ?? "";
  const sido = SIDO_FULL[short] ?? short;
  const sigungu = toks.slice(1).join(" ");
  return { sido, sigungu };
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

// E-Gen 응답 XML 전체 → EgenPlace[](<item> 블록 분해, 이름 없는 항목 제외).
export function parseEgenXml(xml: string): EgenPlace[] {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return blocks.map(parseEgenItem).filter((p) => p.name);
}

// 이름 정규화(태그·괄호·공백 제거) — 좌표 매칭 실패 시 포함 매칭용.
export function normName(s: string): string {
  return (s ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

const MATCH_KM = 0.15; // 150m — 같은 병원으로 볼 좌표 근접 임계

// Naver 병원 1건에 대응하는 E-Gen 장소 찾기(좌표 근접 우선, 없으면 이름 포함 매칭).
export function matchEgenPlace(
  h: Pick<Hospital, "name" | "lat" | "lon">,
  places: EgenPlace[],
): EgenPlace | null {
  // 1) 좌표 근접(임계 내 최근접)
  if (h.lat !== undefined && h.lon !== undefined) {
    let best: EgenPlace | null = null;
    let bestD = Infinity;
    for (const p of places) {
      if (p.lat === undefined || p.lon === undefined) continue;
      const d = haversineKm(h.lat, h.lon, p.lat, p.lon);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best && bestD <= MATCH_KM) return best;
  }
  // 2) 이름 포함(정규화 후 서로 포함 — "전남대학교병원" ⊂ "전남대학교병원응급의료센터")
  const hn = normName(h.name);
  if (hn) {
    for (const p of places) {
      const pn = normName(p.name);
      if (pn && (pn.includes(hn) || hn.includes(pn))) return p;
    }
  }
  return null;
}
