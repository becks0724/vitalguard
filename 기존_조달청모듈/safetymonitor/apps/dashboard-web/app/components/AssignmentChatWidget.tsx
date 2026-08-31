"use client";
// 작업 배치 어시스턴트 플로팅 위젯 — 관제 홈 우하단 원형 말풍선 버튼(일반 챗봇 UX).
// 열면 챗 창만 표시, 과업지시서(PDF 업로드·나라장터 문서) 패널은 챗 상단 '과업지시서' 버튼으로
// 좌측 슬라이드 서랍으로 여닫는다. createPortal(body) — 캐러셀 transform 간섭 회피(기존 모달 선례).
// z-[60]: 콘텐츠 위, 긴급 모달(z-[70])보다는 아래.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import AssignmentChatBoard from "./AssignmentChatBoard";
import AssignmentTaskDocPanel from "./AssignmentTaskDocPanel";

export default function AssignmentChatWidget() {
  const [open, setOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    // `assignment-chat-dock` — 탭별로 이 위젯을 숨기는 표식(globals.css).
    //   위젯은 body 로 포털돼 DemoDashboard 밖에 있고 page.tsx 는 서버 컴포넌트라
    //   탭 상태를 프롭으로 못 내린다. body 데이터 속성 + CSS 로 잇는다.
    //   자식이 전부 position:fixed 라 감싸는 div 가 레이아웃에 영향을 주지 않는다.
    <div className="assignment-chat-dock">
      {open ? (
        <>
          {/* 과업지시서 서랍 — 챗 카드 '뒤'(낮은 z)에 깔려 있다가 왼쪽으로 천천히 슬라이드되어 나온다 */}
          <div
            aria-hidden={!docOpen}
            className={
              "fixed bottom-5 right-[460px] z-[60] h-[640px] max-h-[calc(100vh-7rem)] w-[440px] max-w-[calc(100vw-30rem)] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-3 shadow-2xl transition-transform duration-700 ease-out dark:border-white/10 dark:bg-zinc-950 " +
              (docOpen ? "translate-x-0" : "pointer-events-none translate-x-[440px]")
            }
          >
            <AssignmentTaskDocPanel />
          </div>

          {/* 챗 창 — 서랍보다 높은 z(서랍이 카드 뒤에서 나오는 효과) */}
          <div className="fixed bottom-5 right-5 z-[61] h-[640px] max-h-[calc(100vh-7rem)] w-[440px] max-w-[calc(100vw-2.5rem)]">
            <AssignmentChatBoard />
            {/* 과업지시서 서랍 토글 — 카드 왼쪽 테두리 중앙의 ‹ › 버튼 */}
            <button
              type="button"
              onClick={() => setDocOpen((v) => !v)}
              aria-expanded={docOpen}
              aria-label={docOpen ? "과업지시서 접기" : "과업지시서 열기"}
              title={docOpen ? "과업지시서 접기" : "과업지시서 열기"}
              className="absolute -left-4 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 shadow-lg transition hover:bg-zinc-50 hover:text-zinc-700 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <svg
                className={
                  "h-4 w-4 transition-transform duration-700 " + (docOpen ? "rotate-180" : "")
                }
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>
        </>
      ) : null}

      <button
        type="button"
        onClick={() =>
          setOpen((v) => {
            if (v) setDocOpen(false); // 접을 때 서랍도 함께 닫기
            return !v;
          })
        }
        aria-label={open ? "현장 어시스턴트 접기" : "현장 어시스턴트 열기"}
        className={
          "fixed right-5 z-[61] flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-xl transition-all duration-500 ease-out hover:bg-blue-500 active:scale-95 " +
          // 접힘 = 우측 하단 / 열림 = 챗 카드 우측 상단 위로 이동(카드가 bottom-5 로 내려온 기준 추적)
          (open ? "bottom-[calc(min(640px,100vh-7rem)+1.75rem)]" : "bottom-5")
        }
      >
        {open ? (
          // 접기 — X
          <svg
            className="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        ) : (
          // 열기 — 말풍선
          <svg
            className="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        )}
      </button>
    </div>,
    document.body,
  );
}
