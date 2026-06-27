// 통신사 선택 공유 로직 — 일반 3사 + 알뜰폰(호스트망 선택). 저장값은 "알뜰폰(KT)" 형식으로 결합.
//   알뜰폰도 KT/SKT/LG U+ 망을 임대해 쓰므로, 알뜰폰 선택 시 망을 추가로 고른다.
export const CARRIERS = ["SKT", "KT", "LG U+", "알뜰폰"];
export const MVNO_NETS = ["KT", "SKT", "LG U+"]; // 알뜰폰이 임대해 쓰는 호스트망(MVNO)

// 저장 통신사 문자열 분해 — "알뜰폰(KT)" → {base:'알뜰폰', mvno:'KT'} / "SKT" → {base:'SKT', mvno:''}.
export function parseCarrier(c: string | null): { base: string; mvno: string } {
  if (!c) return { base: "", mvno: "" };
  const m = c.match(/^알뜰폰\(([^)]+)\)$/);
  if (m) return { base: "알뜰폰", mvno: m[1] ?? "" };
  return { base: c, mvno: "" };
}

// 통신사 base + 알뜰폰 망 → 저장 문자열. 일반 3사는 그대로, 알뜰폰은 "알뜰폰(망)"(망 미선택 시 "알뜰폰").
export function composeCarrier(base: string, mvno: string): string {
  if (base !== "알뜰폰") return base;
  return mvno ? `알뜰폰(${mvno})` : "알뜰폰";
}
