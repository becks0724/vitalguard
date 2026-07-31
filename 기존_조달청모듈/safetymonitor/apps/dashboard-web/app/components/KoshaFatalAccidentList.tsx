// 산업재해 사망 속보 — KOSHA 사고사망 게시판(제품 존재 이유=경각심).
// 전체 폭 가로 슬라이딩 카드(자동 흐름·호버 시 정지·수동 좌우 스크롤). 2벌 복제로 seamless.
"use client";

import { useEffect, useState } from "react";

import { useMarqueeScroll } from "../hooks/useMarqueeScroll";

type Item = { id: string; title: string; date?: string; place?: string };
type Payload = {
  ok: boolean;
  source: "live" | "mock";
  items: Item[];
  fetchedAt: string;
  note?: string;
};

export function KoshaFatalAccidentList({
  onSourceChange,
  reloadKey = 0,
}: {
  onSourceChange?: (source: "live" | "mock") => void;
  reloadKey?: number; // 값이 바뀌면 다시 조회(패널 헤더 새로고침 버튼)
}) {
  const scrollRef = useMarqueeScroll<HTMLDivElement>(0.35, "x");
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/kosha/fatal-accidents")
        .then((r) => {
          // HTTP 오류(500 등)의 에러 JSON 을 정상 데이터로 커밋하지 않도록 catch 로 던짐
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((j: Payload) => {
          if (!alive) return;
          setData(j);
          onSourceChange?.(j.source);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 30 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [onSourceChange, reloadKey]);

  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted dark:text-on-dark-soft">불러오는 중…</p>
    );
  }

  return (
    <div ref={scrollRef} className="no-scrollbar overflow-x-auto overflow-y-hidden px-3 pb-3">
      <div className="flex w-max gap-2">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex gap-2" aria-hidden={copy === 1}>
            {items.map((it) => (
              // 한 줄 카드 — 폭은 내용에 맞추고(whitespace-nowrap) 줄바꿈만 막는다.
              // 고정 폭 + truncate 로 하면 긴 제목이 잘려 사고 내용을 못 읽는다.
              <article
                key={`${copy}-${it.id}`}
                className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-hairline bg-canvas px-3 py-2 dark:border-white/10 dark:bg-surface-dark"
              >
                <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-semantic-down" />
                {it.date ? (
                  <span className="font-mono text-[10px] tabular-nums text-muted dark:text-on-dark-soft">
                    {it.date}
                  </span>
                ) : null}
                {it.place ? (
                  <span className="text-[10px] text-muted dark:text-on-dark-soft">{it.place}</span>
                ) : null}
                <span className="text-xs font-medium text-ink dark:text-on-dark">{it.title}</span>
              </article>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
