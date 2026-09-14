"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { containImageRect, drawInk, readInk } from "../../lib/ink-render";

export function InkOverlay({ data, imageRef, src }: {
  data: unknown;
  imageRef: RefObject<HTMLImageElement | null>;
  src: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ink = useMemo(() => readInk(data), [data]);

  useEffect(() => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const paint = (width: number, height: number) => {
      const rect = containImageRect(image.naturalWidth, image.naturalHeight, width, height);
      // 재로딩/깨진 이미지에는 이전 좌표의 표시를 남기지 않는다.
      canvas.width = rect ? Math.max(1, Math.round(width * window.devicePixelRatio)) : 0;
      canvas.height = rect ? Math.max(1, Math.round(height * window.devicePixelRatio)) : 0;
      if (!rect) return;
      context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      drawInk(context, ink, rect);
    };
    const measure = () => {
      // getBoundingClientRect는 Y회전 중 폭이 줄어든다. 변형 전 CSS 크기로 측정한다.
      const style = window.getComputedStyle(image);
      paint(Number.parseFloat(style.width), Number.parseFloat(style.height));
    };
    const observer = new ResizeObserver(([entry]) => {
      if (entry) paint(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(image);
    image.addEventListener("load", measure);
    image.addEventListener("error", measure);
    window.addEventListener("resize", measure); // DPR 변경에도 다시 그린다.
    measure(); // 캐시된 이미지의 load 이벤트를 기다리지 않는다.
    return () => {
      observer.disconnect();
      image.removeEventListener("load", measure);
      image.removeEventListener("error", measure);
      window.removeEventListener("resize", measure);
    };
  }, [imageRef, ink, src]);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      {ink.status !== "ready" && (
        <span role="status" className="absolute inset-x-2 bottom-2 rounded-lg bg-black/80 p-2 text-center text-xs text-white">
          {ink.status === "unsupported"
            ? "다른 앱 버전에서 만든 표시입니다. 현재 버전에서는 표시할 수 없습니다."
            : "표시 데이터를 읽을 수 없습니다."}
        </span>
      )}
    </>
  );
}
