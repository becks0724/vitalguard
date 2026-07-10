// HWP 5.x 바이너리에서 PrvText(미리보기 평문) 스트림만 추출하는 최소 CFB 파서 — 의존성 0.
// 용도: 법제처 별표 HWP(요율표)에서 텍스트를 뽑아 요율 검증(lib/moleg.ts). 범용 HWP 파서 아님.
// HWP 5.x = MS CFB(Compound File Binary) 컨테이너, PrvText 스트림은 무압축 UTF-16LE.
// ponytail: DIFAT 헤더 109개 초과(>6.8MB급 파일)는 미지원 — 별표 HWP는 수십 KB라 도달 불가.

import { SAFETY_COST_RATES, type RateRow } from "./safety-cost";
import type { ConstructionType } from "./safeprocure-types";

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECT = 0xffffffff;

function u16(buf: Uint8Array, off: number): number {
  return buf[off]! | (buf[off + 1]! << 8);
}
function u32(buf: Uint8Array, off: number): number {
  return (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0;
}

/** HWP(CFB) 바이트에서 PrvText 를 UTF-16LE 로 디코드해 반환. 구조가 어긋나면 null. */
export function extractHwpPrvText(data: Uint8Array): string | null {
  try {
    if (data.length < 512 || !CFB_MAGIC.every((b, i) => data[i] === b)) return null;
    const sectorSize = 1 << u16(data, 30);
    const dirStart = u32(data, 48);
    const miniCutoff = u32(data, 56);
    const miniFatStart = u32(data, 60);

    // FAT (헤더 DIFAT 109개 한정 — 소형 파일 전용)
    const fatBytes: number[] = [];
    for (let i = 0; i < 109; i++) {
      const s = u32(data, 76 + i * 4);
      if (s === FREE_SECT) break;
      for (let o = 0; o < sectorSize; o++) fatBytes.push(data[512 + s * sectorSize + o] ?? 0);
    }
    const fatArr = new Uint8Array(fatBytes);
    const fatAt = (i: number) => u32(fatArr, i * 4);
    const fatLen = fatArr.length / 4;

    const chain = (start: number): Uint8Array => {
      const parts: Uint8Array[] = [];
      let s = start;
      while (s !== END_OF_CHAIN && s !== FREE_SECT && s < fatLen) {
        parts.push(data.subarray(512 + s * sectorSize, 512 + (s + 1) * sectorSize));
        s = fatAt(s);
      }
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let off = 0;
      for (const p of parts) {
        out.set(p, off);
        off += p.length;
      }
      return out;
    };

    // 디렉터리 엔트리(128B)에서 PrvText·Root Entry 탐색
    const dir = chain(dirStart);
    let prv: { start: number; size: number } | null = null;
    let root: { start: number } | null = null;
    for (let i = 0; i + 128 <= dir.length; i += 128) {
      const nameLen = u16(dir, i + 64);
      if (nameLen === 0) continue;
      let name = "";
      for (let c = 0; c < nameLen - 2; c += 2) name += String.fromCharCode(u16(dir, i + c));
      const start = u32(dir, i + 116);
      const size = u32(dir, i + 120);
      if (name === "PrvText") prv = { start, size };
      if (name === "Root Entry") root = { start };
    }
    if (!prv) return null;

    let raw: Uint8Array;
    if (prv.size >= miniCutoff) {
      raw = chain(prv.start).subarray(0, prv.size);
    } else {
      // 미니스트림(64B 단위, Root Entry 스트림 안)
      if (!root) return null;
      const mini = chain(root.start);
      const miniFat = chain(miniFatStart);
      const parts: Uint8Array[] = [];
      let s = prv.start;
      while (s !== END_OF_CHAIN && s !== FREE_SECT && s * 4 < miniFat.length) {
        parts.push(mini.subarray(s * 64, (s + 1) * 64));
        s = u32(miniFat, s * 4);
      }
      const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let off = 0;
      for (const p of parts) {
        joined.set(p, off);
        off += p.length;
      }
      raw = joined.subarray(0, prv.size);
    }

    let text = "";
    for (let i = 0; i + 1 < raw.length; i += 2) text += String.fromCharCode(u16(raw, i));
    return text;
  } catch {
    return null;
  }
}

// ── 별표1(계상기준표) 요율 파싱·대조 — 순수 함수(단위테스트 대상) ─────────
// PrvText 실측(제2025-11호): 퍼센트 토큰이 [5억미만 4개][5~50억 요율 4개][50억이상 4개][보건관리자 4개]
// 순으로, 기초액이 "4,325,000원" 형태 4개로 나온다. 공종 순서 = 건축·토목·중건설·특수건설(별표1 행 순서).
const RATE_TYPE_ORDER: ConstructionType[] = ["건축공사", "토목공사", "중건설공사", "특수건설공사"];

/** 별표1 PrvText → 요율표. 레이아웃이 어긋나면 null(수동 대조 폴백). */
export function parseRateTableFromPrvText(text: string): Record<ConstructionType, RateRow> | null {
  if (!text.includes("계상기준표")) return null;
  // "2.28" → 228bp → 0.0228 — 문자열/100 직접 나눗셈의 부동소수점 오차(0.02279…)로
  // 내장 요율표 리터럴과 불일치 오탐이 나지 않도록 정수 경유.
  const pcts = [...text.matchAll(/(\d+\.\d+)\s*%/g)].map((m) => Math.round(Number(m[1]) * 100) / 10_000);
  const bases = [...text.matchAll(/(\d[\d,]{3,})\s*원/g)].map((m) => Number(m[1]!.replace(/,/g, "")));
  if (pcts.length < 12 || bases.length < 4) return null;
  // 요율 타당성 가드(0.5%~10%) — 표 구조 변경으로 엉뚱한 숫자를 집어오는 사고 방지.
  if (pcts.slice(0, 12).some((r) => r < 0.005 || r > 0.1)) return null;
  const out = {} as Record<ConstructionType, RateRow>;
  RATE_TYPE_ORDER.forEach((t, i) => {
    out[t] = { under5: pcts[i]!, mid: { rate: pcts[4 + i]!, base: bases[i]! }, over50: pcts[8 + i]! };
  });
  return out;
}

/** 파싱된 고시 요율 vs 내장 요율표(SAFETY_COST_RATES) 차이 목록. 빈 배열 = 완전 일치. */
export function diffRates(parsed: Record<ConstructionType, RateRow>): string[] {
  const pct = (r: number) => `${(r * 100).toFixed(2)}%`;
  const diffs: string[] = [];
  for (const t of RATE_TYPE_ORDER) {
    const a = SAFETY_COST_RATES[t];
    const b = parsed[t];
    if (a.under5 !== b.under5) diffs.push(`${t} 5억미만: 내장 ${pct(a.under5)} vs 고시 ${pct(b.under5)}`);
    if (a.mid.rate !== b.mid.rate) diffs.push(`${t} 5~50억 요율: 내장 ${pct(a.mid.rate)} vs 고시 ${pct(b.mid.rate)}`);
    if (a.mid.base !== b.mid.base) diffs.push(`${t} 기초액: 내장 ${a.mid.base.toLocaleString()}원 vs 고시 ${b.mid.base.toLocaleString()}원`);
    if (a.over50 !== b.over50) diffs.push(`${t} 50억이상: 내장 ${pct(a.over50)} vs 고시 ${pct(b.over50)}`);
  }
  return diffs;
}
