// xlsx(= ZIP + XML) 최소 리더 — 의존성 0. lib/hwp-prvtext.ts(CFB 파서)와 같은 결.
// 용도: 나라장터 공고 첨부 「설계내역서·공내역서」에서 원가 행을 읽는다(lib/spec-cost-parse.ts).
//   범용 스프레드시트 파서가 아니다 — 값 읽기 전용이며 서식·수식 계산·차트는 다루지 않는다.
// ⚠ 수식 셀은 **캐시된 값(<v>)** 만 읽는다. 캐시가 없으면(=한 번도 계산 안 된 파일) null 이다.
//   공란 내역서가 정확히 그 경우라, "빈 칸"과 "못 읽음"을 구분하려면 호출부가 셀 존재 여부를 본다.
import { inflateRawSync } from "node:zlib";

const U8 = (b: Uint8Array, o: number) => b[o] ?? 0;
const u16 = (b: Uint8Array, o: number) => U8(b, o) | (U8(b, o + 1) << 8);
const u32 = (b: Uint8Array, o: number) => (U8(b, o) | (U8(b, o + 1) << 8) | (U8(b, o + 2) << 16) | (U8(b, o + 3) << 24)) >>> 0;

/** ZIP 중앙디렉터리를 훑어 { 파일명 → 압축해제 바이트 } 를 만든다. zip64·암호화는 미지원(내역서는 해당 없음). */
export function unzip(data: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  // EOCD(0x06054b50) 는 꼬리에서 뒤로 찾는다(주석 최대 65535B + 헤더 22B).
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (u32(data, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return out;
  const count = u16(data, eocd + 10);
  let p = u32(data, eocd + 16);
  const dec = new TextDecoder("utf-8");
  for (let n = 0; n < count && p + 46 <= data.length; n++) {
    if (u32(data, p) !== 0x02014b50) break;
    const method = u16(data, p + 10);
    const compSize = u32(data, p + 20);
    const nameLen = u16(data, p + 28);
    const extraLen = u16(data, p + 30);
    const cmtLen = u16(data, p + 32);
    const lho = u32(data, p + 42);
    const name = dec.decode(data.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + cmtLen;
    // 로컬 헤더에서 실제 데이터 시작점을 다시 잰다(중앙디렉터리의 extra 길이와 다를 수 있다).
    if (u32(data, lho) !== 0x04034b50) continue;
    const lNameLen = u16(data, lho + 26);
    const lExtraLen = u16(data, lho + 28);
    const start = lho + 30 + lNameLen + lExtraLen;
    const raw = data.subarray(start, start + compSize);
    try {
      out.set(name, method === 0 ? raw : new Uint8Array(inflateRawSync(raw)));
    } catch {
      // 한 항목이 깨져도 나머지는 읽는다 — 내역서는 시트가 여러 장이다.
    }
  }
  return out;
}

/** 시트 한 장 — 셀은 "행,열"(1-based) 키의 문자열 맵. 빈 셀은 키 자체가 없다. */
export type Sheet = { name: string; cells: Map<string, string> };
export const cellKey = (row: number, col: number) => `${row},${col}`;

function colIndex(ref: string): number {
  let c = 0;
  for (const ch of ref) c = c * 26 + (ch.charCodeAt(0) - 64);
  return c;
}
function unesc(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

/** xlsx 바이트 → 시트 배열(문서 순서). 읽을 수 없으면 빈 배열. */
export function readXlsx(data: Uint8Array): Sheet[] {
  const files = unzip(data);
  if (files.size === 0) return [];
  const dec = new TextDecoder("utf-8");
  const text = (n: string) => {
    const b = files.get(n);
    return b ? dec.decode(b) : null;
  };

  // 공유 문자열 — 대부분의 라벨이 여기 들어 있다.
  const shared: string[] = [];
  const ssXml = text("xl/sharedStrings.xml");
  if (ssXml) {
    for (const si of ssXml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      const parts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [];
      shared.push(unesc(parts.map((t) => t.replace(/<[^>]*>/g, "")).join("")));
    }
  }

  // 시트 이름 ↔ 파일 매핑(workbook + rels). 실패하면 파일명을 이름으로 쓴다.
  const nameByTarget = new Map<string, string>();
  const wb = text("xl/workbook.xml");
  const rels = text("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const relTarget = new Map<string, string>();
    for (const m of rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      relTarget.set(m[1]!, m[2]!.replace(/^\/?xl\//, ""));
    }
    for (const m of wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"/g)) {
      const t = relTarget.get(m[2]!);
      if (t) nameByTarget.set(`xl/${t}`, unesc(m[1]!));
    }
  }

  const sheets: Sheet[] = [];
  const paths = [...files.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  for (const path of paths) {
    const xml = text(path);
    if (!xml) continue;
    const cells = new Map<string, string>();
    for (const m of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = colIndex(m[1]!);
      const row = Number(m[2]);
      const attr = m[3] ?? "";
      const inner = m[4] ?? "";
      let val: string | null = null;
      const v = inner.match(/<v>([\s\S]*?)<\/v>/);
      if (v) {
        const raw = v[1]!;
        if (/\bt="s"/.test(attr)) {
          const i = Number(raw);
          val = Number.isInteger(i) && i >= 0 && i < shared.length ? shared[i]! : raw;
        } else {
          val = unesc(raw);
        }
      } else {
        const t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        if (t) val = unesc(t[1]!.replace(/<[^>]*>/g, ""));
      }
      if (val !== null && val !== "") cells.set(cellKey(row, col), val);
    }
    sheets.push({ name: nameByTarget.get(path) ?? path.split("/").pop()!, cells });
  }
  return sheets;
}
