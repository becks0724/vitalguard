// 가로/세로 티커 자동 스크롤 훅 — CSS transform 대신 실제 scrollLeft 를 rAF 로 전진시켜
// 자동 흐름과 수동 스크롤이 같은 스크롤 위치를 공유하게 한다(작업자 캐러셀과 동일 방식).
// ★ 핵심: posRef(float) 에 누적하고 scrollLeft 엔 "쓰기만" 한다. el.scrollLeft 는 정수로
//   반올림돼 읽으면 1px 미만 증가분이 0 으로 깎임(소수 픽셀 유실) → read-back 금지.
// 콘텐츠 2벌 복제 → 한 벌 폭(scrollWidth/2)마다 되감아 seamless.
// 호버/터치 동작은 hoverSpeedFactor 로 결정 — 0(기본)=정지(수동 우선), >0=감속(InfiniteSlider 방식).
// rAF 가 매 프레임 ref 를 읽고 콜백 ref 로 리스너를 붙이므로 노드가 늦게 mount 돼도 작동.
"use client";

import { useCallback, useEffect, useRef } from "react";

// axis="x" 가로(scrollLeft·scrollWidth) / "y" 세로(scrollTop·scrollHeight). 기본 가로(기존 호출 호환).
// hoverSpeedFactor: 0(기본)=호버 시 정지(기존 동작, 수동 스크롤 이어가기). >0=호버 시 speed×factor 로 감속(정지 안 함).
export function useMarqueeScroll<T extends HTMLElement>(
  speedPxPerFrame = 0.5,
  axis: "x" | "y" = "x",
  hoverSpeedFactor = 0,
) {
  const elRef = useRef<T | null>(null);
  const posRef = useRef(0); // float 누적 위치 — scroll 반올림 회피
  const pausedRef = useRef(false); // 정지 모드(hoverSpeedFactor<=0)에서만 사용
  const hoverRef = useRef(false); // 호버 중 여부 — 감속 모드(hoverSpeedFactor>0)에서 사용

  const totalOf = (el: T) => (axis === "x" ? el.scrollWidth : el.scrollHeight);
  const posOf = (el: T) => (axis === "x" ? el.scrollLeft : el.scrollTop);
  const setPos = (el: T, v: number) => {
    if (axis === "x") el.scrollLeft = v;
    else el.scrollTop = v;
  };

  const onEnter = useCallback(() => {
    hoverRef.current = true;
    // 감속 모드면 정지하지 않고 tick 에서 속도만 낮춘다. 정지 모드면 멈춘다.
    if (hoverSpeedFactor <= 0) pausedRef.current = true;
  }, [hoverSpeedFactor]);

  const onLeave = useCallback(() => {
    hoverRef.current = false;
    if (hoverSpeedFactor <= 0) {
      // 정지 모드 — 수동 스크롤로 바뀐 실제 위치에서 자동 이어가기
      const el = elRef.current;
      if (el) {
        const half = totalOf(el) / 2;
        posRef.current = half > 0 ? posOf(el) % half : posOf(el);
      }
      pausedRef.current = false;
    }
  }, [hoverSpeedFactor]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = elRef.current;
      if (el && !pausedRef.current) {
        const half = totalOf(el) / 2; // 2벌 복제 → 한 벌 길이
        if (half > 0) {
          // 감속 모드 + 호버 중이면 속도를 factor 배로 낮춰 천천히 흐른다.
          const sp =
            hoverRef.current && hoverSpeedFactor > 0
              ? speedPxPerFrame * hoverSpeedFactor
              : speedPxPerFrame;
          let next = posRef.current + sp;
          if (next >= half) next -= half; // 한 벌 끝 → 되감기(seamless)
          posRef.current = next;
          setPos(el, next); // 쓰기만(read-back 안 함)
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speedPxPerFrame, axis, hoverSpeedFactor]);

  // 콜백 ref — 노드 attach/detach 시점에 호버·터치 리스너를 붙이고 뗌
  const setRef = useCallback(
    (node: T | null) => {
      const prev = elRef.current;
      if (prev) {
        prev.removeEventListener("mouseenter", onEnter);
        prev.removeEventListener("mouseleave", onLeave);
        prev.removeEventListener("touchstart", onEnter);
        prev.removeEventListener("touchend", onLeave);
      }
      elRef.current = node;
      if (node) {
        node.addEventListener("mouseenter", onEnter);
        node.addEventListener("mouseleave", onLeave);
        node.addEventListener("touchstart", onEnter, { passive: true });
        node.addEventListener("touchend", onLeave, { passive: true });
      }
    },
    [onEnter, onLeave],
  );

  return setRef;
}
