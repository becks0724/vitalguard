// 7-세그먼트 숫자 표시 — 헤더 시계·공정률·무사고·작업자 수가 함께 쓴다(2026-08-28 사용자 지시).
//
// ★ 도트 격자(DotMatrix)에서 갈아탄 이유 = **작은 크기에서 도트로는 답이 없었다.**
//   이 화면은 devicePixelRatio=1 이라 소수 픽셀이 안티앨리어싱으로 흐려지는데, 정수만 쓰면
//   높이가 14px 다음 곧바로 21px 로 뛴다. 그 사이에서 "작고·떨어져 있고·굵은" 조합이
//   존재하지 않았다(원 → 사각 픽셀로 바꿔 한 번 완화했으나 여전히 좁았다).
//   세그먼트는 획 하나가 면적을 가지므로 12px 높이에서도 굵기가 남는다.
//
// ⚠ SVG 벡터라 크기를 바꿔도 격자 정렬을 신경 쓸 필요가 없다 — height 만 주면 된다.
"use client";

import { memo } from "react";

// 세그먼트 배치(표준 7-seg)
//    aaa
//   f   b
//   f   b
//    ggg
//   e   c
//   e   c
//    ddd
type Seg = "a" | "b" | "c" | "d" | "e" | "f" | "g";

const DIGITS: Record<string, readonly Seg[]> = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c"],
  "2": ["a", "b", "g", "e", "d"],
  "3": ["a", "b", "g", "c", "d"],
  "4": ["f", "g", "b", "c"],
  "5": ["a", "f", "g", "c", "d"],
  "6": ["a", "f", "g", "e", "c", "d"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g"],
  "9": ["a", "b", "c", "d", "f", "g"],
  "-": ["g"],
};

// 글리프 좌표계 — 실제 크기는 바깥에서 height 로 정하고 여기서는 비율만 잡는다.
//
// ★ 비율은 21st.dev `@jakapatb/7-segment-number` 렌더를 **픽셀로 재서** 맞췄다(2026-08-28).
//   첫 판(W=10·T=2.4·P=0.8)은 눈대중이라 형태가 눈에 띄게 달랐다 — 사용자가 나란히 놓고 지적했다.
//     항목        21st 실측   내 첫 판   고침
//     폭:높이     1:2.17      1:1.80    → 1:2.17  (폭이 넓어 뚱뚱했다)
//     두께/높이   0.150       0.133     → 0.150
//     두께/폭     0.326       0.240     → 0.326   (획이 가늘어 흐릿했다)
//   ⚠ 셋 중 **두께/폭**이 인상을 가장 크게 가른다 — 폭을 줄이고 두께를 키워야 그 비율이 산다.
const W = 8.3; // 글자 폭  (H/2.17)
const H = 18; // 글자 높이
const T = 2.7; // 획 두께  (0.150H · 0.326W)
// 세그먼트 사이 틈 — 획 두께에 비례해 잡는다.
// 21st 실측은 두께의 1/8 수준으로 **아주 좁다**. 첫 판의 0.8(=T/3)은 너무 벌어져 획이
// 따로 놀았고, T/5 도 아직 헐거웠다. 좁을수록 한 글자로 뭉쳐 읽힌다.
const P = T / 8;

// ⚠ viewBox 여백. 좌표가 0~W·0~H 경계에 정확히 닿아 있어 **획 바깥쪽이 반 픽셀 잘렸다**
//   (2026-08-28 실측: x 0.00~10.00 / y 0.00~18.00). SVG 는 경계 밖을 그리지 않으므로
//   안티앨리어싱 여유만큼 상자를 넓혀 준다. 이 값을 0 으로 되돌리면 잘림이 재발한다.
const PAD = 0.5;

// 가로 획 — 양 끝이 뾰족한 육각형. (x,y)는 획의 좌상단.
function hBar(x: number, y: number, w: number): string {
  const h = T / 2;
  return [
    [x + h, y],
    [x + w - h, y],
    [x + w, y + h],
    [x + w - h, y + T],
    [x + h, y + T],
    [x, y + h],
  ]
    .map(([px, py]) => `${px},${py}`)
    .join(" ");
}

// 세로 획 — 위아래가 뾰족한 육각형.
function vBar(x: number, y: number, h: number): string {
  const t = T / 2;
  return [
    [x + t, y],
    [x + T, y + t],
    [x + T, y + h - t],
    [x + t, y + h],
    [x, y + h - t],
    [x, y + t],
  ]
    .map(([px, py]) => `${px},${py}`)
    .join(" ");
}

const HALF = (H - T) / 2; // 세로 획 하나의 길이(가운데 획 기준 위/아래)

const SEG_POINTS: Record<Seg, string> = {
  a: hBar(T / 2 + P, 0, W - T - P * 2),
  g: hBar(T / 2 + P, HALF - T / 2, W - T - P * 2),
  d: hBar(T / 2 + P, H - T, W - T - P * 2),
  f: vBar(0, T / 2 + P, HALF - T / 2 - P * 2),
  b: vBar(W - T, T / 2 + P, HALF - T / 2 - P * 2),
  e: vBar(0, HALF + T / 2 + P, HALF - T / 2 - P * 2),
  c: vBar(W - T, HALF + T / 2 + P, HALF - T / 2 - P * 2),
};

// 글자 하나 — 숫자·콜론·온점·하이픈. 그 밖의 글자는 빈칸으로 그린다.
// ⚠ 한글은 여기서 못 그린다. 단위('일'·'명')는 호출부가 글꼴로 붙인다.
const Glyph = memo(function Glyph({ ch, dim }: { ch: string; dim: boolean }) {
  // 콜론 — 폭을 좁게 잡아 시·분·초가 붙지 않게 한다.
  if (ch === ":") {
    const r = T / 2;
    return (
      <svg viewBox={`${-PAD} ${-PAD} ${W / 2 + PAD * 2} ${H + PAD * 2}`} height="100%" style={{ display: "block" }} aria-hidden="true">
        <circle cx={W / 4} cy={HALF / 2 + T} r={r} fill="currentColor" />
        <circle cx={W / 4} cy={H - HALF / 2 - T} r={r} fill="currentColor" />
      </svg>
    );
  }
  if (ch === ".") {
    // ⚠ 반지름을 T/2 로 두면 14px 높이에서 1px 미만이 되어 **아예 안 보인다**(실측).
    //   획 두께와 같은 지름(=T)으로 잡아야 숫자와 무게가 맞는다. 자리는 d 획 높이에 맞춘다.
    return (
      <svg viewBox={`${-PAD} ${-PAD} ${W / 2 + PAD * 2} ${H + PAD * 2}`} height="100%" style={{ display: "block" }} aria-hidden="true">
        <circle cx={W / 4} cy={H - T / 2} r={T * 0.75} fill="currentColor" />
      </svg>
    );
  }

  const on = DIGITS[ch] ?? [];
  return (
    <svg viewBox={`${-PAD} ${-PAD} ${W + PAD * 2} ${H + PAD * 2}`} height="100%" style={{ display: "block" }} aria-hidden="true">
      {(Object.keys(SEG_POINTS) as Seg[]).map((s) => {
        const lit = on.includes(s);
        // dim = 꺼진 획을 아주 옅게 남긴다(전자시계 판처럼). 기본은 아예 안 그린다.
        if (!lit && !dim) return null;
        return (
          <polygon
            key={s}
            points={SEG_POINTS[s]}
            fill="currentColor"
            opacity={lit ? 1 : 0.12}
          />
        );
      })}
    </svg>
  );
});

export function SevenSegment({
  text,
  height = 14,
  dim = false,
  label,
  className = "",
}: {
  text: string;
  /** 글자 높이(px). 폭은 비율로 따라온다. */
  height?: number;
  /**
   * 꺼진 획을 옅게 남길지. 기본은 안 그린다.
   * ★ true 는 값이 자주 바뀌는 자리(시계)에 어울린다 — 판이 보여야 전자시계로 읽힌다.
   *   드물게 바뀌는 값(공정률·무사고)에 켜면 잡음만 된다.
   */
  dim?: boolean;
  /** 스크린 리더가 읽을 값 — SVG 는 aria-hidden 이라 이 문자열이 유일한 접근 경로다. */
  label: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={`inline-flex items-center ${className}`}
      // gap 은 글자 크기에 비례 — 크기를 바꿔도 자간이 따라 움직인다.
      style={{ height, gap: Math.max(1, Math.round(height * 0.09)) }}
    >
      {text.split("").map((ch, i) => (
        <Glyph key={`${i}-${ch}`} ch={ch} dim={dim} />
      ))}
    </span>
  );
}
