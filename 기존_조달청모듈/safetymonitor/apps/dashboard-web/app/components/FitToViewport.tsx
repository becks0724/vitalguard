// 뷰포트보다 긴 내용을 화면 비율에 맞춰 자동 축소해 한 화면에 담는다 — 스크롤 대신 오토리사이징.
"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

// 왜 CSS zoom 인가 —
//
// ① 글자 크기를 줄이는 방식(루트 폰트 축소)은 이 코드베이스에서 통하지 않는다. 화면 글자의 절반가량이
//    `text-[11px]` 같은 px 리터럴이라 루트 폰트를 줄여도 따라오지 않고 비율이 오히려 깨진다.
// ② `transform: scale` 은 **레이아웃 박스를 줄이지 않는다**. 눈에는 다 들어와 있는데 부모는 여전히
//    넘친다고 보고 스크롤바를 띄운다. 게다가 가로도 같이 줄어 카드가 쪼그라든다(실측 448px → 206px).
// ③ `zoom` 은 레이아웃에 반영된다. 내용이 넓은 폭으로 배치된 뒤 축소돼 **카드 폭은 그대로 유지되고
//    글자·여백만 작아진다**(실측 448px 유지). 스크롤바도 생기지 않고 클릭 좌표도 정상이다.
//
// 측정 주의 — zoom 이 걸린 요소의 `offsetHeight` 는 축소가 **반영되지 않은** 값을 준다(Chrome 실측
// 1827 vs 실제 830). 반드시 `getBoundingClientRect().height` 로 렌더된 높이를 재야 한다.
//
// zoom 안에 position:fixed 자손이 있으면 기준이 바뀐다. 현재 적용 대상 모달들은 fixed 가 전부
// **오버레이 루트**(이 컴포넌트 바깥)라 해당 없음 — 새로 적용할 때 패널 내부를 먼저 확인한다.

// 목표 높이에 근접하면 멈춘다 — 없으면 경계에서 미세하게 커졌다 작아졌다 반복한다.
const SHRINK_MARGIN_PX = 1; // 이만큼 넘칠 때만 더 줄인다
const GROW_MARGIN_PX = 8; // 이만큼 남을 때만 다시 키운다
const MIN_STEP = 0.002; // 변화가 이보다 작으면 수렴으로 본다
const MAX_PASSES = 12; // 진동 안전장치

export default function FitToViewport({
  children,
  className,
  // 오버레이 래퍼의 상하 여백(px). 기본 32 = 바깥 p-4 상하 합.
  gutterPx = 32,
}: {
  children: ReactNode;
  className?: string;
  gutterPx?: number;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  // 렌더 결과를 보고 배율을 고쳐 잡는 수렴식이라 최신 배율을 렌더와 별개로 들고 있어야 한다.
  const scaleRef = useRef(1);
  const passesRef = useRef(0);

  const measure = useCallback(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const rendered = inner.getBoundingClientRect().height;
    if (rendered === 0) return;
    const available = window.innerHeight - gutterPx;
    const cur = scaleRef.current;

    // 배율 1 로 이미 들어가면 손대지 않는다(대다수 화면에서 이 경로 = 기존과 완전히 동일).
    if (cur >= 1 && rendered <= available) return;
    const tooTall = rendered > available + SHRINK_MARGIN_PX;
    const tooSmall = cur < 1 && rendered < available - GROW_MARGIN_PX;
    if (!tooTall && !tooSmall) {
      passesRef.current = 0;
      return;
    }
    if (passesRef.current >= MAX_PASSES) return;

    const next = Math.min(1, cur * (available / rendered));
    if (Math.abs(next - cur) < MIN_STEP) {
      passesRef.current = 0;
      return;
    }
    passesRef.current += 1;
    scaleRef.current = next;
    setScale(next);
  }, [gutterPx]);

  // 첫 페인트 전에 재어 큰 상태가 한 프레임 보이는 깜빡임을 줄인다.
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const onResize = () => {
      passesRef.current = 0; // 창 크기가 바뀌면 다시 수렴할 기회를 준다
      measure();
    };
    // 내용이 나중에 늘어나는 경우(응급실 목록·보호자 정보 등 비동기 로드)와 배율 적용 후 재측정을
    // 모두 이 옵저버가 몰아서 처리한다.
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [measure]);

  return (
    <div className={className}>
      {/* 숫자로 주면 React 가 단위를 붙일지 여부가 버전에 달리므로 문자열로 못박는다. */}
      <div ref={innerRef} style={{ zoom: String(scale) }}>
        {children}
      </div>
    </div>
  );
}
