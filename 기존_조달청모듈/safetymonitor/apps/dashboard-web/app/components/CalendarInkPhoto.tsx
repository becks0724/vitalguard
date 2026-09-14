"use client";

import { useEffect, useRef, useState } from "react";
import { loadCalendarInk } from "../../lib/calendar-ink";
import { InkOverlay } from "./InkOverlay";
import { getSessionToken } from "./session-token";
import styles from "./CalendarInkPhoto.module.css";

/** annotationId가 있는 사진 전용. 부모의 key로 사진/최신 잉크 변경 시 앞면부터 연다. */
export function CalendarInkPhoto({ src, alt, annotationId }: {
  src: string;
  alt: string;
  annotationId: string;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const requestSeq = useRef(0);
  const [data, setData] = useState<unknown>(undefined);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => { requestSeq.current++; }, []);

  const flip = async () => {
    if (loading) return;
    if (flipped || data !== undefined) {
      setFlipped(!flipped);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setFailed(false);
    try {
      const ink = await loadCalendarInk(annotationId, getSessionToken());
      if (seq !== requestSeq.current) return;
      setData(ink);
      setFlipped(true);
    } catch {
      if (seq === requestSeq.current) setFailed(true);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };
  const label = loading ? "표시 불러오는 중…" : flipped ? "원본 보기" : failed ? "표시 다시 불러오기" : "표시본 보기";

  return (
    <div>
      <button
        type="button"
        className={styles.photo}
        onClick={flip}
        disabled={loading}
        aria-label={label}
        aria-pressed={flipped}
        aria-busy={loading}
      >
        <span className={`${styles.rotator} ${flipped ? styles.flipped : ""}`}>
          <img src={src} alt={alt} className={`${styles.image} ${styles.front}`} aria-hidden={flipped} />
          <span className={styles.back} aria-hidden={!flipped}>
            <img ref={imageRef} src={src} alt={`${alt} (표시본)`} className={styles.image} />
            {data !== undefined && <InkOverlay data={data} imageRef={imageRef} src={src} />}
          </span>
        </span>
      </button>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-white">
        <span role="status">{loading ? label : flipped ? "표시본 · 사진을 누르면 원본으로 돌아갑니다" : "원본 · 사진을 누르면 표시본이 나옵니다"}</span>
        <button
          type="button"
          onClick={flip}
          disabled={loading}
          aria-pressed={flipped}
          className="rounded-lg bg-white/15 px-3 py-1.5 font-semibold hover:bg-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-60"
        >
          {label}
        </button>
      </div>
      {failed && <p role="alert" className="mt-2 text-xs text-white">표시를 불러오지 못했습니다. 다시 시도해 주세요.</p>}
    </div>
  );
}
