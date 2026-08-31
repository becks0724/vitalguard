"use client";
// 작업 배치 어시스턴트 플로팅 위젯 — 관제 홈 우하단 원형 말풍선 버튼(일반 챗봇 UX).
// 열면 챗 창만 표시, 과업지시서(PDF 업로드·나라장터 문서) 패널은 챗 상단 '과업지시서' 버튼으로
// 좌측 슬라이드 서랍으로 여닫는다. createPortal(body) — 캐러셀 transform 간섭 회피(기존 모달 선례).
// z-[60]: 콘텐츠 위, 긴급 모달(z-[70])보다는 아래.
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import AssignmentChatBoard from "./AssignmentChatBoard";
import AssignmentTaskDocPanel from "./AssignmentTaskDocPanel";
import { SiteAssistantMascot, type MascotState } from "./SiteAssistantMascot";

// ── 떠다니는 마스코트(반응형 호버링) ───────────────────────────────────────────
// 앵커는 뷰포트 픽셀이 아니라 카드 박스와 동일한 fixed 레이어 안의 % 좌표라, 해상도가
// 바뀌어 카드가 줄어도 같은 상대 위치를 지킨다.
// 이동은 전부 사용자 상호작용의 의미를 따른다(2026-08-31 사용자 지시 — 무작위 유영은
// 어지러워서 폐기). 대기·질문 접수·생각 중 = 헤더 타이틀 위 근무 위치, 답변 계열 =
// 최신 답변 말풍선 옆으로 내려가 손끝으로 가리킨다(답변 도착 신호). 상태가 풀리면
// (위젯의 6초 decay) 근무 위치로 복귀한다. 제자리 부유(둥실)만 상시 유지.
const MASCOT_ANCHORS = {
  // ↖ 기본 근무 위치 — 헤더 타이틀을 가리지 않도록 카드 상단선 위로 걸터앉힌다(2026-08-31 교정).
  //    top 이 음수라 마스코트 아랫부분이 카드 상단선에 겹치지 않는다.
  home: { left: "4%", top: "-7%" },
  answer: { left: "-3%", top: "60%" }, // ← 최신 답변 말풍선 왼쪽(자동 스크롤로 최신 답변이 하단에 온다)
} as const;

// 답변 계열 상태 — 이때만 답변 옆으로 내려간다(각 상태의 팔 포즈가 어조를 전달).
const ANSWER_STATES: ReadonlySet<MascotState> = new Set(["answering", "alert", "sorry", "hold", "proud"]);

function FloatingMascot({ chipHover, state }: { chipHover: boolean; state: MascotState }) {
  const anchor = ANSWER_STATES.has(state) ? MASCOT_ANCHORS.answer : MASCOT_ANCHORS.home;
  return (
    <motion.div
      animate={{ left: anchor.left, top: anchor.top }}
      initial={false}
      style={{ position: "absolute", transform: "translate(-50%, -50%)" }}
      transition={{ duration: 1.4, ease: "easeInOut" }}
    >
      {/* 제자리 부유 — 이동과 별개의 둥실 리듬(주기를 다르게 둬 유기적으로). */}
      <motion.div
        animate={{ y: [0, -7, 0], rotate: [0, 1.6, 0, -1.6, 0] }}
        transition={{
          y: { duration: 3.2, ease: "easeInOut", repeat: Infinity },
          rotate: { duration: 6.1, ease: "easeInOut", repeat: Infinity },
        }}
      >
        <SiteAssistantMascot mouthOverride={chipHover ? "open" : undefined} size={104} state={state} />
      </motion.div>
    </motion.div>
  );
}

export default function AssignmentChatWidget() {
  const [open, setOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mascotState, setMascotState] = useState<MascotState>("idle");
  // 예시 칩 hover — 입모양만 바꾸므로 자세(mascotState)와 분리해서 들고 있는다.
  const [chipHover, setChipHover] = useState(false);

  // 답변 계열 자세는 6초 뒤 대기(근무 위치 복귀)로 수렴 — 다음 상호작용이 오면 그쪽이 우선.
  useEffect(() => {
    if (mascotState === "idle" || mascotState === "thinking" || mascotState === "greet") return;
    const timer = window.setTimeout(() => setMascotState("idle"), 6_000);
    return () => window.clearTimeout(timer);
  }, [mascotState]);

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
            <AssignmentChatBoard onChipHover={setChipHover} onMascotState={setMascotState} />
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

          {/* 마스코트 부유 레이어 — 챗 카드와 "같은 박스"를 겹쳐(pointer-events 없음) 그 안의
              % 앵커로 유영시킨다. 카드가 해상도 따라 줄면 앵커도 함께 따라간다(사용자 결정 08-31).
              카드보다 한 층 위(z-[62])라 모서리에 걸터앉은 듯 보이고, 클릭은 전부 통과한다. */}
          <div
            aria-hidden="true"
            className="pointer-events-none fixed bottom-5 right-5 z-[62] hidden h-[640px] max-h-[calc(100vh-7rem)] w-[440px] max-w-[calc(100vw-2.5rem)] sm:block"
          >
            <FloatingMascot chipHover={chipHover} state={mascotState} />
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
