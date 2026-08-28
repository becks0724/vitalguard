// NCP 역지오코딩 응답을 한국 주소 문자열로 조립하는 순수 함수. I/O 는 reverse-geocode.ts 가 맡는다.
//
// ★ 왜 순수부를 따로 두는가 — 네트워크 없이 파서를 시험할 수 있어야 한다.
//   `hospital.ts`(순수) / `naver-local.ts`(server-only) 와 같은 가름이다.
//
// ★ 애플 지오코더를 버린 이유(2026-08-28 실측 · docs/ocr-address-geocode/context-notes.md).
//   같은 좌표에서 애플은 `광주광역시 금남로3가 15-2` 를 냈고 실제는 `전남광주 동구 금남로3가 1-10`
//   이었다. 광역명(통합 전 옛 이름)·자치구(누락)·지번(다른 필지) 세 축이 동시에 틀렸다.

export type NcpRegion = {
  area1?: { name?: string };
  area2?: { name?: string };
  area3?: { name?: string };
  area4?: { name?: string };
};

export type NcpLand = {
  /** 지번 구분 — "1" 일반 · "2" 산. 도로명(roadaddr)에서는 의미가 없다. */
  type?: string;
  number1?: string;
  number2?: string;
  /** 도로명(roadaddr) 에서만 채워진다. */
  name?: string;
  addition0?: { type?: string; value?: string };
};

export type NcpResult = { name?: string; region?: NcpRegion; land?: NcpLand };

export type Addresses = {
  /** 도로명주소 — 시도 + 시군구 + 도로명 + 건물번호. */
  road: string | null;
  /** 지번주소 — 시도 + 시군구 + 읍면동 + 번지. */
  jibun: string | null;
};

const t = (s?: string) => (s ?? "").trim();

/** `번호1-번호2`. 번호2 가 비었거나 0 이면 붙이지 않는다. */
function num(land?: NcpLand): string {
  const a = t(land?.number1);
  if (!a) return "";
  const b = t(land?.number2);
  return b && b !== "0" ? `${a}-${b}` : a;
}

/**
 * 도로명·지번을 **각각** 만든다.
 *
 * ⚠ 하나로 뭉개지 않는다 — 애플의 실패가 정확히 그것이었다. `thoroughfare` 가 도로명일 때도
 *   있고 법정동일 때도 있어서, 한 칸에 담으면 무엇을 보고 있는지 알 수 없게 된다.
 *
 * ⚠ 광역(area1)과 자치구(area2)는 **두 주소 모두에** 들어간다. 자치구를 빠뜨린 것이
 *   애플 경로의 세 결함 중 하나였다.
 */
export function buildAddresses(results: NcpResult[] | undefined | null): Addresses {
  let road: string | null = null;
  let jibun: string | null = null;

  for (const r of results ?? []) {
    const g = r.region;
    const head = [t(g?.area1?.name), t(g?.area2?.name)].filter(Boolean);
    const n = num(r.land);

    if (r.name === "roadaddr") {
      const street = t(r.land?.name);
      // 도로명이 없으면 도로명주소가 아니다. 번호만 이어 붙이면 엉뚱한 문자열이 된다.
      if (!street || !n) continue;
      const line = [...head, street, n].join(" ");
      // 건물명은 있으면 붙인다 — 현장에서 사람이 읽는 데 가장 도움이 된다.
      const building = t(r.land?.addition0?.value);
      road = building ? `${line} (${building})` : line;
    } else if (r.name === "addr") {
      const dong = t(g?.area3?.name);
      if (!dong || !n) continue;
      // "산" 지번은 표기가 다르다. 빠뜨리면 다른 필지가 된다.
      const mountain = t(r.land?.type) === "2" ? "산 " : "";
      jibun = [...head, dong, `${mountain}${n}`].join(" ");
    }
  }

  return { road, jibun };
}
