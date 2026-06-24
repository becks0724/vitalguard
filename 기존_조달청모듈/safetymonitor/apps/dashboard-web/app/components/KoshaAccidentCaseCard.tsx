// 국내 재해사례 카드 — KOSHA 국내재해사례(callApiId 1060) 최신 건을 업종칩+제목+경위 요약으로 표시.
// 현장정보와 같은 박스(위젯 스택)에 들어가도록 h-full 고정 높이·내부 세로 스크롤 구성.
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useMarqueeScroll } from "../hooks/useMarqueeScroll";

type Item = { id: string; title: string; business?: string; summary?: string; detail?: string };
type Payload = {
  ok: boolean;
  source: "live" | "mock";
  items: Item[];
  fetchedAt: string;
  note?: string;
};

export function KoshaAccidentCaseCard({
  onSourceChange,
}: {
  // 데이터 출처(실시간/샘플) 를 부모(캐러셀 헤더 배지)로 올림. source 변경 시 호출.
  onSourceChange?: (source: "live" | "mock" | null) => void;
} = {}) {
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  // 세로 자동 스크롤(느리게). 호버/터치 시 정지 → 수동 스크롤 우선.
  const scrollRef = useMarqueeScroll<HTMLDivElement>(0.3, "y");

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/kosha/accident-cases")
        .then((r) => r.json())
        .then((j: Payload) => {
          if (alive) setData(j);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 30 * 60 * 1000); // 30분
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // 출처 변경을 부모로 통지 → 캐러셀 헤더 배지 갱신. onSourceChange 는 안정적(상위 setState)이라 무한루프 없음.
  useEffect(() => {
    onSourceChange?.(data?.source ?? null);
  }, [data?.source, onSourceChange]);

  const items = data?.items ?? [];

  // 외곽 박스·제목·출처 배지는 WidgetCarousel 헤더가 제공 → 여기선 리스트만(h-full 채움).
  return (
    <div className="flex h-full flex-col px-3 pb-3 pt-1.5">
      {/* 제목만 표시 + 세로 자동 스크롤(2벌 복제 seamless) + 수동 스크롤(호버 시 자동 정지) */}
      <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted dark:text-on-dark-soft">
            불러오는 중…
          </p>
        ) : (
          [0, 1].map((copy) => (
            <div key={copy} className="flex flex-col" aria-hidden={copy === 1}>
              {items.map((it) => (
                <button
                  key={`${copy}-${it.id}`}
                  type="button"
                  onClick={() => setSelected(it)}
                  title="클릭하여 사고 경위 전문 보기"
                  tabIndex={copy === 1 ? -1 : undefined}
                  className="mb-1 flex w-full items-center gap-1.5 rounded-lg bg-canvas px-2.5 py-1 text-left transition hover:ring-1 hover:ring-primary/40 dark:bg-surface-dark"
                >
                  {it.business && (
                    <span className="shrink-0 rounded bg-surface-card px-1.5 py-0.5 text-[10px] font-semibold text-ink">
                      {it.business}
                    </span>
                  )}
                  <span className="truncate text-xs font-semibold text-ink dark:text-on-dark">
                    {it.title}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {/* 캐러셀 페이지의 transform 이 fixed 의 컨테이닝 블록이 되어 박스 안에 갇히므로,
          모달은 createPortal 로 body 에 렌더해 전체 화면 오버레이로 띄운다. */}
      {selected &&
        typeof document !== "undefined" &&
        createPortal(
          <AccidentCaseDetailModal item={selected} onClose={() => setSelected(null)} />,
          document.body,
        )}
    </div>
  );
}

// 사고 경위 전문 팝업 — SOS 모달과 동일 패턴(틴트 헤더 바 + 섹션 본문 + ESC/배경 닫기).
// 재해 '사례'라 SOS 빨강 대신 amber(경고/사례) 톤. 첨부 PDF는 KOSHA 미제공이라 본문 텍스트로 대체.
function AccidentCaseDetailModal({ item, onClose }: { item: Item; onClose: () => void }) {
  // ESC 키로 닫기 (SOS 모달과 동일)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="국내 재해사례 상세"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 dark:bg-black/70"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-amber-500/70 bg-white shadow-2xl dark:border-amber-500/50 dark:bg-[#0d1117]"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-100 px-5 py-3 dark:bg-amber-500/10">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-amber-500 ring-1 ring-amber-300 dark:ring-white/30" />
            <h2 className="text-base font-bold text-amber-800 dark:text-amber-200">국내 재해사례</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-white/15 dark:text-zinc-400 dark:hover:bg-white/10"
          >
            닫기
          </button>
        </header>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <section>
            <h3 className="text-xs text-zinc-600 dark:text-zinc-400">사고 개요</h3>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="text-xl font-bold text-zinc-900 dark:text-white">{item.title}</span>
              {item.business && (
                <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  {item.business}
                </span>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-xs text-zinc-600 dark:text-zinc-400">사고 경위</h3>
            <p className="mt-2 whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-700 dark:border-white/10 dark:bg-white/[0.02] dark:text-zinc-300">
              {item.detail || item.summary || "(내용 없음)"}
            </p>
          </section>

          <p className="text-[11px] text-zinc-500">
            출처 KOSHA 국내재해사례
          </p>
        </div>
      </div>
    </div>
  );
}
