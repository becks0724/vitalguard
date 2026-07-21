"use client";
// 작업 배치 어시스턴트 플로팅 위젯 — 관제 홈 우하단 원형 말풍선 버튼(일반 챗봇 UX).
// 클릭으로 열기/접기, 열면 과업지시서 패널 + 배치 챗이 플로팅 창으로 뜬다.
// createPortal(body) — 캐러셀 transform 이 fixed 를 가두는 문제 회피(기존 모달 선례).
// z-[60]: 콘텐츠 위, 긴급 모달(z-[70])보다는 아래.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import AssignmentChatBoard from "./AssignmentChatBoard";
import AssignmentTaskDocPanel from "./AssignmentTaskDocPanel";

export default function AssignmentChatWidget() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <>
      {open ? (
        <div className="fixed bottom-24 right-5 z-[60] flex h-[680px] max-h-[calc(100vh-8rem)] w-[440px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 shadow-2xl dark:border-white/10 dark:bg-zinc-950">
          <div className="max-h-[45%] shrink-0 overflow-y-auto px-3 pt-3">
            <AssignmentTaskDocPanel />
          </div>
          <div className="min-h-0 flex-1 px-3 pb-3">
            <AssignmentChatBoard />
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "배치 어시스턴트 접기" : "배치 어시스턴트 열기"}
        className="fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-xl transition hover:bg-blue-500 active:scale-95"
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
    </>,
    document.body,
  );
}
