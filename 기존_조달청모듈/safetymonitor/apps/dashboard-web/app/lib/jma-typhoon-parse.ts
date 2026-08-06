// 일본 기상청(JMA) 태풍 예보 JSON 파싱 순수 유틸 — specifications.json → TrackPoint[].
// server-only 인 jma-typhoon.ts 에서 분리해 단위테스트 가능하게 유지(레포 관례: typhoon.ts↔typhoon-parse.ts).
//
// ★ 이 진로는 **참고 표시 전용**이다. 작업중지·경보 등급 판정은 기상청 단독으로 유지한다
//   (국내 예보·특보의 공식 주체는 기상청이다). 판정에 섞으면 두 기관이 갈릴 때
//   현장이 무엇을 따라야 하는지가 사라진다.
//
// ⚠️ JMA 는 **지나온 경로를 주지 않는다** — 실황(実況)·추정·예보뿐이다.
//    그래서 참고 진로는 '현재 위치에서 앞으로'만 그려진다(기상청 진로의 실선 구간에 대응하는 것이 없다).
import type { TrackPoint } from "./typhoon-parse";

// JMA 응답 원소 — 우리가 실제로 읽는 필드만 선언한다(응답에는 더 많은 필드가 있다).
type JmaEntry = {
  part?: unknown; // "title" | { jp, en }
  typhoonNumber?: string;
  name?: { jp?: string; en?: string };
  issue?: { JST?: string; UTC?: string };
  position?: { deg?: unknown };
  pressure?: string;
  maximumWind?: { sustained?: Record<string, string> };
  probabilityCircleRadius?: { km?: number };
  advancedHours?: number;
  validtime?: { JST?: string; UTC?: string };
};

export type JmaTyphoon = {
  seq: number; // 태풍 순번 — 기상청 typSeq 와 맞물린다(JMA "2613" 뒤 2자리 = 13)
  numberRaw: string; // "2613" — 원본 태풍번호(연도 2자리 + 순번 2자리)
  name?: string; // 태풍명(일본어 가타카나)
  nameEn?: string;
  issueJst?: string; // 발표 시각(ISO, JST)
  track: TrackPoint[]; // 실황 → 예보 시간순
  currentIndex: number; // track 중 실황(現在) 위치
};

// JMA 태풍번호("2613") → 순번(13). 연도 2자리를 떼어 기상청 typSeq 와 같은 축으로 만든다.
// 형식이 다르면 null — 매칭을 포기할 뿐 다른 태풍에 잘못 붙이지 않는다.
export function jmaSeqOf(typhoonNumber: string): number | null {
  if (!/^\d{4}$/.test(typhoonNumber)) return null;
  const n = Number(typhoonNumber.slice(2));
  return n > 0 ? n : null;
}

// ISO 시각("2026-08-06T15:00:00+09:00") → 우리 tm 포맷(KST yyyyMMddHHmm).
// 기상청 typTm 과 같은 표기여야 화면·정렬이 한 축에서 돈다.
export function isoJstToTm(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}` : "";
}

function firstNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// [lat, lon] 좌표쌍인지 확인. JMA 는 position.deg 를 배열로 주는데,
// 형식이 어긋난 원소를 그대로 통과시키면 지도에 NaN 마커가 찍힌다(조용한 오작동).
function degPair(v: unknown): { lat: number; lon: number } | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const lat = Number(v[0]);
  const lon = Number(v[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// 실황 엔트리인가 — `advancedHours` 가 0 인 것이 実況이다.
// part 의 일본어 문자열("実況")로 판정하지 않는다. 남이 쓰는 문장은 계약이 아니다(D-25).
function isAnalysis(e: JmaEntry): boolean {
  return e.advancedHours === 0;
}

// specifications.json(배열) → 태풍 1건. 좌표가 하나도 없으면 null(표시할 진로가 없다).
export function parseJmaSpecifications(raw: unknown): JmaTyphoon | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const entries = raw as JmaEntry[];

  const title = entries.find((e) => e.part === "title");
  const numberRaw = String(title?.typhoonNumber ?? "");
  const seq = jmaSeqOf(numberRaw);
  if (seq === null) return null;

  const pts: { tm: string; sortKey: string; analysis: boolean; p: TrackPoint }[] = [];
  for (const e of entries) {
    const pos = degPair(e.position?.deg);
    if (!pos) continue;
    const jst = e.validtime?.JST ?? "";
    const tm = isoJstToTm(jst);
    if (!tm) continue;
    pts.push({
      tm,
      sortKey: e.validtime?.UTC ?? jst,
      analysis: isAnalysis(e),
      p: {
        tm,
        lat: pos.lat,
        lon: pos.lon,
        pressureHpa: firstNumber(e.pressure),
        maxWindMs: firstNumber(e.maximumWind?.sustained?.["m/s"]),
        // 70% 확률반경 — 기상청 radPr 과 같은 의미(중심이 있을 범위, 강풍 범위 아님).
        radPr: e.probabilityCircleRadius?.km !== undefined ? String(e.probabilityCircleRadius.km) : undefined,
      },
    });
  }
  if (pts.length === 0) return null;

  pts.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  // 실황이 없으면(형식 변경 등) 첫 점을 현재로 본다 — 진로 자체는 그릴 수 있다.
  const idx = pts.findIndex((x) => x.analysis);
  return {
    seq,
    numberRaw,
    name: title?.name?.jp,
    nameEn: title?.name?.en,
    issueJst: title?.issue?.JST,
    track: pts.map((x) => x.p),
    currentIndex: idx >= 0 ? idx : 0,
  };
}

// targetTc.json → 조회할 tropicalCyclone ID 목록("TC2615" 등). 형식이 어긋난 원소는 버린다.
export function parseTargetTc(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => (e as { tropicalCyclone?: unknown })?.tropicalCyclone)
    .filter((v): v is string => typeof v === "string" && /^TC\d{4}$/.test(v));
}
