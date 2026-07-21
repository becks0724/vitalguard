"use client";
// 감독관 배치 어시스턴트 챗 보드 — 사번으로 질문하면 컨디션 등급×위험작업 매칭 권고를 답변.
// 판정은 서버 규칙 엔진(결정적), LLM(HyperCLOVA X)은 언어화만. 세션 토큰(관제 로그인) 필요.
import { useCallback, useEffect, useRef, useState } from "react";

import { clearSessionToken, getSessionToken } from "./LoginGate";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  source?: "clova" | "rule";
};

type ChatResponse = {
  ok: boolean;
  reply?: string;
  source?: "clova" | "rule";
  disclaimer?: string;
  error?: string;
};

const SUGGESTIONS = [
  "EMP-6861 오늘 밀폐공간 배치 가능해?",
  "EMP-6861 컨디션 등급이랑 배제 작업 알려줘",
];

export default function AssignmentChatBoard() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text:
        "작업자 사번(EMP-…)을 포함해 질문해 주세요.\n예: \"EMP-6861 오늘 고소작업 배치 가능해?\"\n등급·배제 권고는 최근 24시간 워치 실측 기반의 안전 기준 참고 정보입니다.",
      source: "rule",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = useCallback(
    async (raw?: string) => {
      const question = (raw ?? input).trim();
      if (!question || busy) return;
      setInput("");
      setMessages((prev) => [...prev, { role: "user", text: question }]);
      setBusy(true);
      try {
        const token = getSessionToken();
        const res = await fetch("/api/assignment/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ message: question }),
        });
        if (res.status === 401) {
          // 서버가 거부한 낡은 토큰이 남아 있으면 LoginGate 가 로그인 화면을 안 띄우고 계속 401 에 갇힘
          // → 토큰을 지우고 새로고침해 이 탭에서 바로 재로그인하게 한다.
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              text: "로그인 세션이 만료되었습니다. 잠시 후 로그인 화면으로 이동합니다.",
              source: "rule",
            },
          ]);
          window.setTimeout(() => {
            clearSessionToken();
            window.location.reload();
          }, 1500);
          return;
        }
        const json = (await res.json()) as ChatResponse;
        if (!json.ok || !json.reply) {
          throw new Error(json.error ?? `HTTP ${res.status}`);
        }
        if (json.disclaimer) setDisclaimer(json.disclaimer);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: json.reply as string, source: json.source },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: "응답 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
            source: "rule",
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, input],
  );

  return (
    <div className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
      <header className="border-b border-zinc-200 px-5 py-4 dark:border-white/10">
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
          작업 배치 어시스턴트
        </h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          컨디션 등급(결정적 규칙) × 위험작업 매칭 × 현장 환경(가스 감지기·기상특보) — 판정은
          규칙 엔진, 답변 문장만 국내 LLM(HyperCLOVA X)이 작성합니다. 원시 생체데이터는 외부로
          전송되지 않습니다.
        </p>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[80%] whitespace-pre-line rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm text-white"
                  : "max-w-[85%] whitespace-pre-line rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-2.5 text-sm text-zinc-800 dark:bg-white/10 dark:text-zinc-100"
              }
            >
              {m.text}
              {m.role === "assistant" && m.source ? (
                <div className="mt-1.5 text-[10px] text-zinc-400">
                  {m.source === "clova" ? "HyperCLOVA X · 판정은 규칙 엔진" : "규칙 엔진 응답"}
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-zinc-100 px-4 py-2.5 text-sm text-zinc-400 dark:bg-white/10">
              판정 조회 중…
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-zinc-200 px-5 py-3 dark:border-white/10">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void send(s)}
              disabled={busy}
              className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-500 hover:bg-zinc-50 disabled:opacity-40 dark:border-white/10 dark:text-zinc-400 dark:hover:bg-white/5"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="예: EMP-6861 오늘 밀폐공간 배치 가능해?"
            className="flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            질문
          </button>
        </form>
        <p className="mt-2 text-[10px] leading-relaxed text-zinc-400">
          {disclaimer ??
            "본 등급은 안전 기준 참고 정보이며 의료적 판단이 아닙니다. 최종 배치 결정 권한은 감독관에게 있습니다."}
        </p>
      </div>
    </div>
  );
}
