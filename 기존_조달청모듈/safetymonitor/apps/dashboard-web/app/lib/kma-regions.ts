// 기상특보(t6/t7) 구역 문자열 파싱 순수 유틸 — 괄호 안 콤마를 보존하는 최상위 분리 + 시·도 head 매칭.
// server-only 인 kma.ts 에서 분리해 단위테스트 가능하게 유지.

// 구역 나열을 최상위 콤마로만 분리 — "경기도(안산, 시흥), 인천" → ["경기도(안산, 시흥)", "인천"].
// 단순 split(",") 은 괄호 안 시·군·구가 독립 토큰으로 흩어져("광주" 등) 시·도 매칭을 오염시킨다.
export function splitRegions(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") {
      depth++;
      cur += ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (ch === "," && depth === 0) {
      const t = cur.trim();
      if (t) out.push(t);
      cur = "";
    } else {
      cur += ch;
    }
  }
  const t = cur.trim();
  if (t) out.push(t);
  return out;
}

// 구역 토큰의 head(괄호 앞 본구역명)가 시·도 키워드를 포함하는지.
// head 한정 매칭이라 "경기도(…, 광주, …)" 괄호 안의 경기 광주시가 광주광역시로 오매칭되지 않고,
// 광주광역시는 t6 에서 head "광주" 단독 토큰으로 오므로 정확히 잡힌다.
export function regionMatchesSido(region: string, keywords: string[]): boolean {
  const head = (region.split("(")[0] ?? region).trim();
  return keywords.some((k) => head.includes(k));
}
