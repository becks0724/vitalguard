// 플립 디스크(도트 매트릭스) 숫자 표시 — 헤더 시계·공정률·무사고·작업자 수가 함께 쓴다.
//
// ★ 원본은 shadcn 배포용 데모(FlipDiskMatrix)였다. 거기서 **시계 표시만** 남기고 걷어냈다:
//   모드 스위처 4종(time/text/wave/noise) · 텍스트 입력칸 · 31×11 고정 격자.
//   관제 화면에 wave·noise 가 있을 이유가 없고, 341개 노드에 각각 3D transform 을 거는 것은
//   이미 무거운 대시보드에 부담이다. 여기서는 **글자 수만큼만** 열을 만든다(8자 시계 = 47열×7행).
//
// ⚠ 이 컴포넌트는 **읽는 사람이 숫자를 빨리 봐야 하는 자리**에 쓴다. 그래서 원본의 600ms
//   스프링 전환을 쓰지 않는다 — 초가 매초 바뀌는데 600ms 를 튀면 읽는 동안 계속 흔들린다.
//   바뀐 칸만 180ms 로 뒤집는다(안 바뀐 칸은 DOM 이 그대로라 애니메이션이 안 돈다).
"use client";

import { memo, useMemo } from "react";

// 5×7 비트맵 — 숫자·콜론·마침표·퍼센트·공백만. 한글과 괄호는 넣지 않았다(도트로 안 그린다).
// ⚠ 글리프를 늘릴 때는 반드시 5비트 폭을 지킬 것. 폭이 어긋나면 그 글자만 밀려 보인다.
const GLYPHS: Record<string, number[]> = {
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  "3": [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  ":": [0b00000, 0b00100, 0b00000, 0b00000, 0b00000, 0b00100, 0b00000],
  // ⚠ 온점은 **한 점**이다(2026-08-28 사용자 지시). 2×2 블록으로 그리면 네 점이 켜져
  //    숫자보다 무거워 보이고, 소수점이 아니라 얼룩처럼 읽힌다.
  ".": [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00100],
  // ⚠ '%' 는 화면에서 쓰지 않는다(2026-08-28 사용자 지시) — 5×7 로는 두 블록과 대각선이 뭉쳐
  //    얼룩으로 읽힌다. 공정률은 숫자만 도트로 그리고 %는 글꼴로 붙인다(GaugeRow unit).
  //    글리프는 지우지 않고 남긴다: 지우면 누가 값에 %를 섞었을 때 조용히 공백이 된다.
  "%": [0b11000, 0b11001, 0b00010, 0b00100, 0b01000, 0b10011, 0b00011],
  "-": [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
  " ": [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

// 문자열 → 점 격자. 글자 사이 1열을 비운다(원본과 같은 간격 규칙).
// ⚠ 글자 수만큼만 폭을 만든다 — 고정 격자에 가운데 정렬하던 원본과 다르다. 자리마다 길이가
//   달라(시계 8자 · 공정률 5자 · 인원 2자) 고정폭이면 좌우가 텅 빈다.
export function textToDots(text: string): boolean[][] {
  const chars = text.split("");
  const cols = Math.max(1, chars.length * (GLYPH_W + 1) - 1);
  const grid = Array.from({ length: GLYPH_H }, () => Array<boolean>(cols).fill(false));

  chars.forEach((ch, i) => {
    const bits = GLYPHS[ch] ?? GLYPHS[" "]!;
    const ox = i * (GLYPH_W + 1);
    for (let y = 0; y < GLYPH_H; y += 1) {
      for (let x = 0; x < GLYPH_W; x += 1) {
        if (ox + x < cols) grid[y]![ox + x] = Boolean(bits[y]! & (1 << (GLYPH_W - 1 - x)));
      }
    }
  });
  return grid;
}

// 점 하나 — 켜짐/꺼짐만 받는다. memo 라 값이 그대로면 리렌더가 없다(초가 바뀌어도 대부분의 칸은 그대로다).
//
// showOff = 꺼진 점을 바탕에 남길지(2026-08-28 사용자 결정).
//   true  — 플립 디스크 판. 안 뒤집힌 디스크가 남아 전광판으로 읽힌다. **헤더 시계에만** 쓴다.
//   false — 켜진 점만. 숫자가 또렷해지고 화면이 조용해진다. 읽는 값(공정률·무사고·인원)에 쓴다.
// ⚠ 어느 쪽이든 꺼진 칸의 **자리는 차지한다**(투명 span). 안 그러면 값에 따라 폭이 흔들려
//   '1'과 '8'의 자리 너비가 달라진다.
const Dot = memo(function Dot({
  on,
  size,
  showOff,
  pixel,
}: {
  on: boolean;
  size: number;
  showOff: boolean;
  pixel: boolean;
}) {
  // 켜지지도 않고 바탕도 안 그리면 자리만 잡는다 — 3D 레이어를 만들 이유가 없다(노드 절약).
  if (!on && !showOff) {
    return <span aria-hidden="true" style={{ width: size, height: size }} className="inline-block" />;
  }

  // ★ 켜진 점만 그리는 자리(showOff=false)는 **3D 를 쓰지 않는다.**
  //   꺼진 면이 투명이라 뒤집힘이 "회전"이 아니라 "없다가 생김"으로 보여 연출이 성립하지 않는데,
  //   perspective·preserve-3d 가 걸린 요소는 별도 레이어로 래스터화된다. 거기에 부모 scale 이
  //   겹치면 저해상도로 굳은 레이어가 축소돼 **점이 뭉개진다**(2026-08-28 사용자 제보 · scale 0.7).
  //   평면 원으로 그리면 축소해도 벡터 그대로 선명하고 노드도 3개에서 1개로 준다.
  if (!showOff) {
    return (
      <span
        aria-hidden="true"
        style={{ width: size, height: size }}
        className={`inline-block bg-ink dark:bg-on-dark ${pixel ? "" : "rounded-full"}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, perspective: size * 4 }}
      className="relative inline-block"
    >
      <span
        className="absolute inset-0 transition-transform duration-[180ms] ease-out"
        style={{
          transformStyle: "preserve-3d",
          transform: on ? "rotateX(180deg)" : "rotateX(0deg)",
        }}
      >
        {/* 꺼진 면 — 바탕에 눌린 홈처럼. showOff=false 면 투명하게 둬 켜진 점만 보이게 한다. */}
        <span
          className={`absolute inset-0 rounded-full ${showOff ? "bg-hairline dark:bg-white/10" : ""}`}
          style={{ backfaceVisibility: "hidden" }}
        />
        {/* 켜진 면 — 글자색. 뒤집혀 있어 rotateX(180deg) 일 때 보인다. */}
        <span
          className="absolute inset-0 rounded-full bg-ink dark:bg-on-dark"
          style={{ backfaceVisibility: "hidden", transform: "rotateX(180deg)" }}
        />
      </span>
    </span>
  );
});

// 도트 표시. size = 점 지름(px), gap = 점 사이 간격(px).
export function DotMatrix({
  text,
  size = 3,
  gap = 1,
  showOff = false,
  digitsOnly = false,
  scale = 1,
  rowGap,
  pixel = false,
  label,
  className = "",
}: {
  text: string;
  size?: number;
  gap?: number;
  /**
   * 격자를 정수 픽셀로 그린 뒤 전체를 축소하는 비율(1 = 그대로).
   * ★ 크기를 줄이고 싶을 때 size·gap 에 소수를 넣지 말고 **이 값**을 쓴다 — 소수 격자는
   *   점마다 물리 픽셀 스냅이 달라져 분포가 끊긴다. scale 은 레이아웃 뒤 한 덩어리로
   *   적용되어 균일함이 유지된다(2026-08-28 실측).
   */
  scale?: number;
  /**
   * 세로 간격만 따로. 지정하지 않으면 gap 과 같다.
   * ★ 작게 그릴 때 0 을 주면 세로획이 이어져 읽히고 좌우는 떨어져 도트로 남는다 —
   *   DPR 1 화면에서 점을 1px 까지 줄이면 선명하지만 너무 성기어 안 읽히는데,
   *   그 사이를 메우는 수단이다(2026-08-28 실측).
   */
  rowGap?: number;
  /**
   * 점을 **사각 픽셀**로 그린다(기본은 원형 디스크).
   * ★ 작은 크기에서 원은 안티앨리어싱으로 모서리가 깎여 흐려지고, 면적도 사각형의 79%(π/4)라
   *   같은 크기인데 가늘어 보인다. 사각형은 픽셀 격자에 정확히 떨어져 1px 에서도 또렷하다.
   *   전광판도 원래 사각 픽셀이다 — 시계(플립 디스크 연출)만 원형을 쓴다.
   */
  pixel?: boolean;
  /**
   * 숫자만 도트로 그리고 그 밖의 글자(`:` `.` `%`)는 글꼴로 둔다(2026-08-28 사용자 지시).
   * 시계처럼 구분자가 많은 값에 쓴다 — 콜론까지 도트로 그리면 숫자와 무게가 같아져
   * 시·분·초의 경계가 흐려진다.
   * ⚠ 공정률은 이 옵션을 쓰지 않는다(전부 도트 · 사용자 결정) — 값 하나가 통으로 읽혀야 한다.
   */
  digitsOnly?: boolean;
  /**
   * 꺼진 점을 바탕에 남길지. 기본은 false(켜진 점만).
   * ★ true 는 헤더 시계 전용이다 — 매초 뒤집히는 것이 보여야 살아 있는 시계로 읽힌다.
   *   몇 시간에 한 번 바뀌는 값(공정률·무사고)에 켜면 뒤집힘은 볼 일이 없고 잡음만 남는다.
   */
  showOff?: boolean;
  /** 스크린 리더가 읽을 값 — 점 격자는 aria-hidden 이라 이 문자열이 유일한 접근 경로다. */
  label: string;
  className?: string;
}) {
  // 숫자 덩어리와 구분자를 번갈아 쪼갠다 — "14:18:10" → ["14", ":", "18", ":", "10"].
  // ⚠ 자릿수 단위가 아니라 **덩어리 단위**로 쪼갠다. 한 자씩 쪼개면 글자 사이 1열 여백이
  //   사라져 숫자가 붙어 보인다(격자를 이어 그려야 그 여백이 유지된다).
  const segments = useMemo(
    () => (digitsOnly ? (text.match(/\d+|\D+/g) ?? []) : [text]),
    [text, digitsOnly],
  );

  if (digitsOnly) {
    return (
      <span role="img" aria-label={label} className={`inline-flex items-center ${className}`}>
        {segments.map((seg, i) =>
          /^\d+$/.test(seg) ? (
            <DotGrid key={`${i}-${seg}`} text={seg} size={size} gap={gap} showOff={showOff} scale={scale} rowGap={rowGap} pixel={pixel} />
          ) : (
            // 구분자는 글꼴 — 도트 높이의 중앙에 오도록 flex 가운데 정렬에 맡긴다.
            // ⚠ 색을 반드시 명시한다. 도트는 bg-ink 로 자기 색을 갖는데 글꼴은 상속이라,
            //   부모가 muted 계열이면 구분자만 회색으로 옅어져 **안 보인다**(실측: rgb(96,100,108)).
            // ⚠ 크기도 도트 높이(7·size+6·gap)에 맞춘다. 기본 글꼴 크기로 두면 도트의 절반이
            //   안 되어 시·분·초가 붙어 보인다.
            <span
              key={`${i}-${seg}`}
              aria-hidden="true"
              className="px-[2px] font-mono font-semibold leading-none text-ink dark:text-on-dark"
              style={{ fontSize: Math.round((7 * size + 6 * gap) * 0.7) }}
            >
              {seg}
            </span>
          ),
        )}
      </span>
    );
  }

  return (
    <span role="img" aria-label={label} className={`inline-flex items-center ${className}`}>
      <DotGrid text={text} size={size} gap={gap} showOff={showOff} scale={scale} rowGap={rowGap} pixel={pixel} />
    </span>
  );
}

// 격자 하나 — 라벨·접근성은 바깥(DotMatrix)이 맡고 여기는 점만 그린다.
function DotGrid({
  text,
  size,
  gap,
  showOff,
  scale,
  rowGap,
  pixel,
}: {
  text: string;
  size: number;
  gap: number;
  showOff: boolean;
  scale: number;
  rowGap?: number;
  pixel: boolean;
}) {
  const dots = useMemo(() => textToDots(text), [text]);
  const cols = dots[0]?.length ?? 0;

  // ★ 정수 픽셀로 고정한다(2026-08-28) — 소수 크기·간격을 주면 브라우저가 점마다 물리 픽셀에
  //   스냅하면서 어떤 간격은 0px, 어떤 간격은 1px 로 반올림돼 **격자가 끊겨 보인다.**
  //   높이를 정확히 맞추려고 gap=0.5 를 썼다가 실제로 그 증상이 났다(사용자 제보).
  //   여기서 막아 두면 호출부가 무심코 소수를 넘겨도 같은 증상이 재발하지 않는다.
  const px = Math.max(1, Math.round(size));
  const gapPx = Math.max(0, Math.round(gap));
  // 세로 간격은 따로 받는다 — 지정이 없으면 가로와 같다.
  // ★ 작게 그릴 때 세로만 붙이면 가독성과 격자감을 함께 얻는다: 숫자는 세로획이 많아 위아래가
  //   이어지면 획이 살고, 좌우는 떨어져 있어 도트로 보인다(2026-08-28 · DPR 1 에서 실측).
  const rowGapPx = rowGap === undefined ? gapPx : Math.max(0, Math.round(rowGap));

  // 축소 전 실제 크기. scale 을 걸면 레이아웃 크기는 그대로라 주변이 밀리므로 바깥 상자로 보정한다.
  const naturalW = cols * px + Math.max(0, cols - 1) * gapPx;
  const naturalH = GLYPH_H * px + (GLYPH_H - 1) * rowGapPx;

  const grid = (
    <span
      aria-hidden="true"
      className="inline-grid"
      style={{
        gridTemplateColumns: `repeat(${cols}, ${px}px)`,
        rowGap: `${rowGapPx}px`,
        columnGap: `${gapPx}px`,
        lineHeight: 0,
        // ★ scale 은 **레이아웃이 끝난 뒤** 한 덩어리로 적용된다 — 점마다 따로 반올림되지 않아
        //   격자가 균일한 채로 작아진다. 크기를 줄이려고 size·gap 에 소수를 넣으면 점마다
        //   물리 픽셀 스냅이 달라져 분포가 끊긴다(2026-08-28 실측).
        ...(scale !== 1 ? { transform: `scale(${scale})`, transformOrigin: "left top" } : {}),
        // ⚠ inline-grid 의 기본 baseline 은 **마지막 행**에 걸린다 — 옆 글자와 나란히 두면
        //   도트가 글자보다 아래로 처진다. middle 로 고정해 두 요소의 세로 중앙을 맞춘다.
        //   (부모가 flex 면 align-items 가 이기므로 이 값은 무시되고, inline 문맥에서만 쓰인다)
        verticalAlign: "middle",
      }}
    >
      {dots.map((row, y) =>
        row.map((on, x) => (
          // ⚠ key 에 on 을 넣지 않는다 — 넣으면 값이 바뀔 때 remount 되어 transition 이 안 돈다
          //   (뒤집히지 않고 즉시 갈아끼워진다). 위치만 key 로 두고 transform 이 바뀌게 한다.
          <Dot key={`${y}-${x}`} on={on} size={px} showOff={showOff} pixel={pixel} />
        )),
      )}
    </span>
  );

  if (scale === 1) return grid;
  // 축소한 만큼 자리도 줄인다 — scale 만 걸면 원래 크기의 자리를 그대로 차지해 옆이 벌어진다.
  return (
    <span
      aria-hidden="true"
      className="inline-block"
      style={{
        width: naturalW * scale,
        height: naturalH * scale,
        verticalAlign: "middle",
      }}
    >
      {grid}
    </span>
  );
}
