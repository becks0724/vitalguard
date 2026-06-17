// 실시간 산업재해 사망 속보 — KOSHA 사고사망 게시판을 한 줄 티커로(제품 존재 이유=경각심).
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

export function KoshaAccidentTicker() {
  const scrollRef = useMarqueeScroll<HTMLDivElement>(0.35);
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/kosha/fatal-accidents")
        .then((r) => r.json())
        .then((j: Payload) => {
          if (alive) setData(j);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 30 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-semantic-down/30 bg-semantic-down/5 dark:border-semantic-down/30 dark:bg-semantic-down/10">
      <div className="flex min-w-0 items-center">
        <div className="flex shrink-0 items-center gap-1.5 bg-semantic-down px-3 py-2 text-xs font-semibold text-white">
          <span className="inline-block h-2 w-2 rounded-full bg-white vital-blink-danger" />
          산업재해 속보
        </div>
        <span className="shrink-0 px-2 text-[10px] font-semibold text-semantic-down">
          {data?.source === "live" ? "KOSHA 실시간" : "샘플"}
        </span>
        <div
          ref={scrollRef}
          className="no-scrollbar relative flex min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden py-2"
        >
          <div className="flex w-max items-center">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex items-center whitespace-nowrap" aria-hidden={copy === 1}>
                {items.map((it) => (
                  <span key={`${copy}-${it.id}`} className="flex items-center gap-1.5 px-4 text-xs">
                    {it.date ? (
                      <span className="font-mono tabular-nums text-muted dark:text-on-dark-soft">{it.date}</span>
                    ) : null}
                    {it.place ? <span className="text-body dark:text-on-dark-soft">{it.place}</span> : null}
                    <span className="font-medium text-ink dark:text-on-dark">{it.title}</span>
                    <span aria-hidden className="select-none pl-2 text-semantic-down/40">
                      ·
                    </span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
