// 산업재해 사망 속보 목록 — KOSHA 사고사망 게시판(제품 존재 이유=경각심).
// 하단 한 줄 마퀴 티커를 안전뉴스 탭의 목록형으로 대체(docs/safety-news-tab/context-notes.md N-03).
"use client";

import { useEffect, useState } from "react";

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
}: {
  onSourceChange?: (source: "live" | "mock") => void;
}) {
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
  }, [onSourceChange]);

  const items = data?.items ?? [];

  return (
    <div className="no-scrollbar h-full overflow-y-auto px-3 pb-3 pt-1.5">
      {items.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted dark:text-on-dark-soft">불러오는 중…</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-start gap-2 rounded-lg bg-semantic-down/5 px-2.5 py-1.5 dark:bg-semantic-down/10"
            >
              <span aria-hidden className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-semantic-down" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[10px] text-muted dark:text-on-dark-soft">
                  {it.date ? <span className="font-mono tabular-nums">{it.date}</span> : null}
                  {it.place ? <span className="truncate">{it.place}</span> : null}
                </div>
                <p className="text-xs font-medium leading-snug text-ink dark:text-on-dark">
                  {it.title}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
