"use client";
// 감독관 배치 어시스턴트 챗 보드 — 사번으로 질문하면 컨디션 등급×위험작업 매칭 권고를 답변.
// 판정은 서버 규칙 엔진(결정적), LLM(HyperCLOVA X)은 언어화만. 세션 토큰(관제 로그인) 필요.
import { useCallback, useEffect, useRef, useState } from "react";

import { clearSessionToken, getSessionToken } from "./session-token";
import type { MascotState } from "./SiteAssistantMascot";
import { ASSIGNMENT_CHAT_CONTRACT, type AssignmentChatContract } from "../../lib/assignment-chat-contract";

// 규칙 엔진의 확정 판정 요약 — 신호등 배지는 LLM 문장이 아니라 이 값으로 그린다.
type VerdictBadge = {
  workerId: string;
  name?: string; // 실명 — 서버 workerNames 맵(결정적)에서만 온다
  grade: "fit" | "caution" | "restricted" | "unknown";
  blocked: number; // 배제 권고 태그 수
  allowed: number; // 배치 가능 태그 수
};

// 서버가 확정한 작업 목록. LLM 문장과 분리해 누락·환각 없이 표시한다.
type TaskSummary = {
  workerId: string;
  blockedTags: string[];
  allowedTags: string[];
  pendingTags: string[];
};

type LawArticleCard = {
  조: string;
  제목: string;
  개정이력?: string;
  원문: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  source?: "clova" | "rule";
  badges?: VerdictBadge[];
  taskSummaries?: TaskSummary[];
  candidates?: { workerId: string; name: string }[];
  lawArticles?: LawArticleCard[];
  workerNames?: Record<string, string>;
};

type ChatResponse = {
  ok: boolean;
  reply?: string;
  source?: "clova" | "rule";
  intents?: string[];
  disclaimer?: string;
  error?: string;
  assignments?: {
    workerId: string;
    condition: { grade: VerdictBadge["grade"] };
    advice: { perTag: { allowed: boolean; pending: boolean }[] };
  }[];
  taskSummaries?: TaskSummary[];
  candidates?: { workerId: string; name: string }[];
  lawArticles?: LawArticleCard[];
  workerNames?: Record<string, string>;
};

// 등급 → 신호등(대시보드 작업자 신호등과 동일 문법: 정상 정적·주의/위험 블링크).
const GRADE_BADGE: Record<
  VerdictBadge["grade"],
  { label: string; dot: string; chip: string }
> = {
  fit: {
    label: "양호",
    dot: "bg-emerald-500",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  },
  caution: {
    label: "주의",
    dot: "bg-amber-500 vital-blink-caution",
    chip: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  },
  restricted: {
    label: "제한",
    dot: "bg-red-500 vital-blink-danger",
    chip: "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
  },
  unknown: {
    label: "미판정",
    dot: "bg-zinc-400",
    chip: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300",
  },
};

// 서버 판정 작업 목록의 작업별 판정 셀 — 신호등 배지와 같은 색 문법을 재사용한다.
const TASK_VERDICT: Record<
  "blocked" | "allowed" | "pending",
  { label: string; dot: string; chip: string }
> = {
  blocked: {
    label: "배제 권고",
    dot: "bg-red-500",
    chip: "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
  },
  allowed: {
    label: "배치 가능",
    dot: "bg-emerald-500",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  },
  pending: {
    label: "판단 보류",
    dot: "bg-zinc-400",
    chip: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300",
  },
};

export default function AssignmentChatBoard({
  onChipHover,
  onMascotState,
}: {
  /** 예시 칩 hover 보고 — 마스코트 입모양만 바꾼다(자세는 그대로). */
  onChipHover?: (hovering: boolean) => void;
  /** 마스코트 상태 보고 — 표시·부유는 위젯 레이어(AssignmentChatWidget)가 소유한다. */
  onMascotState?: (state: MascotState) => void;
} = {}) {
  const [contract, setContract] = useState<AssignmentChatContract>(ASSIGNMENT_CHAT_CONTRACT);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: ASSIGNMENT_CHAT_CONTRACT.welcomeMessage,
      source: "rule",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  // 직전 단일 서버 판정의 가명 사번만 보관한다. 대화 전문/이름은 보내지 않아 주입·개인정보 표면을 늘리지 않는다.
  const [followUpWorkerIds, setFollowUpWorkerIds] = useState<string[]>([]);
  // 직전 현장 답변의 의도들 — 서버가 준 값만 되돌려보낸다(followUpWorkerIds 와 같은 철학).
  const [followUpIntents, setFollowUpIntents] = useState<string[]>([]);
  // 마스코트 상태는 보고만 한다 — 트리거는 전부 서버 응답의 결정적 필드에서만 파생(텍스트 추측 최소).
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const token = getSessionToken();
    if (!token) return;
    void fetch("/api/assignment/chat", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { contract?: AssignmentChatContract }) : null))
      .then((json) => {
        if (!json?.contract) return;
        setContract(json.contract);
        setMessages((previous) =>
          previous.length === 1 && previous[0]?.role === "assistant"
            ? [{ ...previous[0], text: json.contract!.welcomeMessage }]
            : previous,
        );
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // 응답 → 마스코트 상태. 우선순위: 오류/폴백(sorry) > 배제 권고(alert) > 보류·무권한(hold)
  // > 전원 정상(proud·엄지척) > 설명(answering). 판정은 텍스트 추측이 아니라 결정적 필드(grade)로.
  const mascotStateFor = (json: ChatResponse): MascotState => {
    const reply = json.reply ?? "";
    const assignments = json.assignments ?? [];
    if (!json.ok || reply.startsWith("⚠")) return "sorry";
    if (assignments.some((a) => a.condition.grade === "restricted")) return "alert";
    if (reply.includes("열람 권한이 없습니다") || reply.includes("답변을 보류합니다")) return "hold";
    if (assignments.length > 0 && assignments.every((a) => a.condition.grade === "fit")) return "proud";
    return "answering";
  };

  const send = useCallback(
    async (raw?: string) => {
      const question = (raw ?? input).trim();
      if (!question || busy) return;
      setInput("");
      setMessages((prev) => [...prev, { role: "user", text: question }]);
      setBusy(true);
      // 질문 접수 인사 → 0.9초 뒤 로딩(생각) 자세로(전환·복귀 타이밍은 위젯이 소유).
      onMascotState?.("greet");
      window.setTimeout(() => onMascotState?.("thinking"), 900);
      try {
        const token = getSessionToken();
        const res = await fetch("/api/assignment/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ message: question, followUpWorkerIds, followUpIntents }),
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
        const badges: VerdictBadge[] = (json.assignments ?? []).map((a) => ({
          workerId: a.workerId,
          name: json.workerNames?.[a.workerId],
          grade: a.condition.grade,
          blocked: a.advice.perTag.filter((t) => !t.allowed && !t.pending).length,
          allowed: a.advice.perTag.filter((t) => t.allowed).length,
        }));
        // 후속 문맥은 마지막 답변의 성격을 따라간다 — 작업자 1명 답변이면 그 사번을,
        // 현장 답변이면 그 의도들을 반송하고, 나머지(전체 요약·도움말)는 둘 다 비운다.
        const responseAssignments = json.assignments ?? [];
        const soleAssignment =
          responseAssignments.length === 1 ? responseAssignments[0] : undefined;
        setFollowUpWorkerIds(soleAssignment ? [soleAssignment.workerId] : []);
        setFollowUpIntents(soleAssignment ? [] : (json.intents ?? []));
        onMascotState?.(mascotStateFor(json));
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: json.reply as string,
            source: json.source,
            badges,
            taskSummaries: json.taskSummaries,
            candidates: json.candidates,
            lawArticles: json.lawArticles,
            workerNames: json.workerNames,
          },
        ]);
      } catch {
        onMascotState?.("sorry");
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
    [busy, followUpIntents, followUpWorkerIds, input, onMascotState],
  );

  return (
    <div className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
      <header className="border-b border-zinc-200 px-5 py-4 dark:border-white/10">
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
          VitAlGuard 현장 어시스턴트
        </h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          작업자 배치·현장 환경(가스 감지기·기상)·조달 정보·법령 조문까지 — 판정과 수치는 서버
          규칙 엔진이 확정하고, 답변 문장만 국내 LLM(HyperCLOVA X)이 작성합니다. 원시
          생체데이터는 외부로 전송되지 않습니다.
        </p>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === "user" ? "flex justify-end" : "flex flex-col items-start gap-1.5"}
          >
            {/* 판정 배지 — 말풍선 밖 독립 행, 아래 말풍선 폭(85%) 기준 중앙 정렬 */}
            {m.role === "assistant" && m.badges && m.badges.length > 0 ? (
              <div className="flex w-[85%] max-w-full flex-wrap justify-center gap-1.5">
                {m.badges.map((b) => {
                  const meta = GRADE_BADGE[b.grade];
                  return (
                    // 세그먼트형 배지 — 판정(볼드)·요약(일반)을 배지 전체 높이 구분선(border)으로 분리
                    <span
                      key={b.workerId}
                      className={
                        "inline-flex max-w-full items-stretch overflow-hidden rounded-lg border text-[11px] " +
                        meta.chip
                      }
                    >
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1 font-semibold">
                        <span className={"h-2.5 w-2.5 shrink-0 rounded-full " + meta.dot} />
                        {b.workerId}
                        {b.name ? `(${b.name})` : ""} · {meta.label}
                      </span>
                      <span className="inline-flex items-center whitespace-nowrap border-l border-inherit px-3 py-1 font-normal opacity-80">
                        {b.grade === "unknown"
                          ? "판단 보류"
                          : `배제 권고 ${b.blocked}종 · 배치 가능 ${b.allowed}종`}
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : null}
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
            {m.role === "assistant" && m.taskSummaries && m.taskSummaries.length > 0 ? (
              <div className="w-[85%] max-w-full overflow-hidden rounded-xl border border-zinc-200 bg-white text-xs dark:border-white/10 dark:bg-white/5">
                <div className="border-b border-zinc-200 px-3 py-2 font-semibold text-zinc-800 dark:border-white/10 dark:text-zinc-100">
                  서버 판정 작업 목록
                </div>
                {m.taskSummaries.map((summary) => {
                  const rows = [
                    ...summary.blockedTags.map((tag) => ({ tag, kind: "blocked" as const })),
                    ...summary.allowedTags.map((tag) => ({ tag, kind: "allowed" as const })),
                    ...summary.pendingTags.map((tag) => ({ tag, kind: "pending" as const })),
                  ];
                  return (
                    <div key={summary.workerId} className="border-b border-zinc-100 last:border-b-0 dark:border-white/5">
                      <div className="bg-zinc-50 px-3 py-1 font-medium text-zinc-600 dark:bg-white/5 dark:text-zinc-300">
                        {summary.workerId}
                        {m.workerNames?.[summary.workerId] ? `(${m.workerNames[summary.workerId]})` : ""}
                      </div>
                      {rows.length > 0 ? (
                        <table className="w-full border-collapse">
                          <tbody>
                            {rows.map((row, ri) => {
                              const meta = TASK_VERDICT[row.kind];
                              return (
                                <tr
                                  key={`${row.tag}-${ri}`}
                                  className="border-t border-zinc-100 first:border-t-0 dark:border-white/5"
                                >
                                  <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-200">{row.tag}</td>
                                  <td className="px-3 py-1.5 text-right">
                                    <span
                                      className={
                                        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium " +
                                        meta.chip
                                      }
                                    >
                                      <span className={"h-1.5 w-1.5 rounded-full " + meta.dot} />
                                      {meta.label}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      ) : (
                        <div className="px-3 py-1.5 text-zinc-400">등록된 위험작업 없음</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
            {m.role === "assistant" && m.lawArticles && m.lawArticles.length > 0 ? (
              // 법령 조문 원문 카드 — 서버 스냅샷 원문의 결정적 표시(모델 문장과 독립).
              <div className="w-[85%] max-w-full overflow-hidden rounded-xl border border-zinc-200 bg-white text-xs dark:border-white/10 dark:bg-white/5">
                <div className="border-b border-zinc-200 px-3 py-2 font-semibold text-zinc-800 dark:border-white/10 dark:text-zinc-100">
                  법령 조문 원문 (산업안전보건기준에 관한 규칙)
                </div>
                {m.lawArticles.map((article) => (
                  <div key={article.조} className="border-b border-zinc-100 last:border-b-0 dark:border-white/5">
                    <div className="bg-zinc-50 px-3 py-1 font-medium text-zinc-600 dark:bg-white/5 dark:text-zinc-300">
                      {article.조} ({article.제목}){article.개정이력 ? ` · ${article.개정이력}` : ""}
                    </div>
                    <div className="whitespace-pre-line px-3 py-1.5 leading-relaxed text-zinc-700 dark:text-zinc-200">
                      {article.원문}
                    </div>
                  </div>
                ))}
                <div className="px-3 py-1.5 text-[10px] text-zinc-400">
                  발췌 원문 — 전체 원문은 법제처(국가법령정보센터)에서 확인
                </div>
              </div>
            ) : null}
            {m.role === "assistant" && m.candidates && m.candidates.length > 0 ? (
              <div className="flex max-w-[85%] flex-wrap gap-2">
                {m.candidates.map((candidate) => (
                  <button
                    key={candidate.workerId}
                    type="button"
                    onClick={() => void send(`${candidate.workerId} 컨디션 알려줘`)}
                    disabled={busy}
                    className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-left text-xs font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-40 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-200 dark:hover:bg-blue-500/20"
                  >
                    {candidate.name} · {candidate.workerId}
                  </button>
                ))}
              </div>
            ) : null}
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
          {contract.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                // 자리표시자가 든 예시 칩은 전송하면 "확인 불가" 거절만 나온다 —
                // 입력창에 채워 이름·사번만 바꿔 보내게 한다(특정인 예시 금지 결정의 짝).
                if (s.includes("(작업자 이름)") || s.includes("(사번)")) {
                  setInput(s);
                  return;
                }
                void send(s);
              }}
              disabled={busy}
              // 칩에 마우스를 올리면 마스코트가 입을 벌린다 — "이거 물어보려고?" 하는 반응.
              onMouseEnter={() => onChipHover?.(true)}
              onMouseLeave={() => onChipHover?.(false)}
              onFocus={() => onChipHover?.(true)}
              onBlur={() => onChipHover?.(false)}
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
            placeholder={contract.inputPlaceholder}
            className="flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            aria-label={contract.requestLabel}
            title={contract.requestLabel}
            className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-full bg-blue-600 text-white disabled:opacity-40"
          >
            {/* 전송 = 원형 노드 + 위쪽 화살표(텍스트 라벨은 aria/title 로 유지) */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
              <path d="M12 19V5" />
              <path d="M5 12l7-7 7 7" />
            </svg>
          </button>
        </form>
        <p className="mt-2 text-[10px] leading-relaxed text-zinc-400">
          {disclaimer ??
            contract.disclaimer}
        </p>
      </div>
    </div>
  );
}
