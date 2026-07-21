// POST /api/assignment/chat — 감독관 배치 어시스턴트(챗).
// 구조: 서버가 규칙 엔진의 판정 데이터(등급·사유·태그별 권고)를 확정 계산 →
//       국내 LLM(HyperCLOVA X)이 그 데이터만 근거로 자연어 답변(판정 관여 금지) →
//       LLM 미설정/실패 시 결정적 텍스트 폴백(요율표 폴백과 동일 철학).
// 개인정보 경계: LLM 에는 가명 ID(사번)·등급·사유코드·매칭 결과만 전달.
//   이름·원시 생체(심박 수치 등)는 전달하지 않는다. 국내 사업자(네이버클라우드)라 국외이전 비해당.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import {
  assessWorker,
  formatAssignment,
  type WorkerAssignment,
} from "../../../../lib/assignment-service";
import { CONDITION_DISCLAIMER, GRADE_LABEL } from "../../../../lib/worker-condition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLOVA_MODEL = process.env.CLOVA_MODEL ?? "HCX-005";
const MAX_WORKERS_PER_QUERY = 3;

const SYSTEM_PROMPT =
  "당신은 건설 현장 감독관을 보조하는 작업 배치 어시스턴트다. " +
  "함께 제공되는 '판정 데이터'는 규칙 엔진이 계산한 확정 결과다. 다음을 반드시 지켜라: " +
  "1) 판정 데이터에 없는 사실을 만들지 말 것. 등급·배제 사유·근거를 바꾸거나 새로 판정하지 말 것. " +
  "2) 의료적 진단·건강 상태 단정 표현을 쓰지 말 것 — '안전 기준 충족 여부' 관점으로만 서술할 것. " +
  "3) 답변은 간결한 한국어로, 배치 가능/배제 권고를 먼저 요약하고 사유·근거를 뒤에 붙일 것. " +
  "4) 답변 끝에 '최종 배치 결정 권한은 감독관에게 있습니다.' 한 줄을 반드시 포함할 것. " +
  "5) 마크다운 문법(**, ##, - 목록 기호 등)을 쓰지 말 것 — 순수 평문으로만 작성할 것.";

/** LLM 전달용 최소 데이터(가명 ID·등급·사유 라벨·태그 권고·환경 요약만 — 원시 생체 비포함). */
function toLlmContext(a: WorkerAssignment) {
  return {
    workerId: a.workerId,
    grade: GRADE_LABEL[a.condition.grade],
    reasons: a.condition.reasons.map((r) => ({ label: r.label, detail: r.detail })),
    note: a.advice.note,
    environment: {
      기상특보: a.environment.warningSummary,
      가스감지기: a.environment.gaspodSummary,
      안내: a.environment.notes,
    },
    // 과업지시서가 등록돼 있으면 그 태그만 검토 대상(없으면 전체 어휘).
    taskScope: a.taskDoc ? a.taskDoc.tags : "전체 위험작업 어휘(과업지시서 미등록)",
    tags: a.advice.perTag.map((t) => ({
      tag: t.tag,
      recommendation: t.pending ? "보류(데이터 없음)" : t.allowed ? "배치 가능" : "배제 권고",
      blockedBy: t.blockedBy.map((b) => b.label),
      basis: t.basis,
    })),
  };
}

async function clovaReply(question: string, contexts: unknown[]): Promise<string> {
  const key = process.env.CLOVA_API_KEY;
  if (!key) throw new Error("CLOVA_API_KEY not set");
  const res = await fetch(
    `https://clovastudio.stream.ntruss.com/v3/chat-completions/${CLOVA_MODEL}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `[판정 데이터]\n${JSON.stringify(contexts, null, 1)}\n\n[감독관 질문]\n${question}`,
          },
        ],
        temperature: 0.1,
        topP: 0.8,
        maxTokens: 900,
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw new Error(`clova HTTP ${res.status}`);
  const json = (await res.json()) as { result?: { message?: { content?: string } } };
  const text = json.result?.message?.content?.trim();
  if (!text) throw new Error("clova empty response");
  // 마크다운 금지 프롬프트를 어기는 경우가 있어 후처리로 강제(**강조**·## 헤딩 제거).
  return text.replace(/\*\*/g, "").replace(/^#{1,4}\s*/gm, "");
}

export async function POST(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let message = "";
  try {
    const body = (await request.json()) as { message?: unknown };
    message = typeof body.message === "string" ? body.message.trim() : "";
  } catch {
    /* fallthrough → 400 */
  }
  if (!message) {
    return NextResponse.json({ ok: false, error: "message required" }, { status: 400 });
  }

  // 질문에서 작업자 ID 추출(EMP-…/VW-… 사번 패턴, 가명 ID).
  const ids = [...new Set(message.match(/\b(?:EMP|VW)-[A-Za-z0-9_-]+/gi) ?? [])].slice(
    0,
    MAX_WORKERS_PER_QUERY,
  );
  if (ids.length === 0) {
    return NextResponse.json({
      ok: true,
      reply:
        "질문에서 작업자 ID(사번)를 찾지 못했습니다. 예: \"EMP-6861 오늘 밀폐공간 배치 가능해?\" 처럼 사번을 포함해 질문해 주세요.",
      source: "rule",
      disclaimer: CONDITION_DISCLAIMER,
    });
  }

  let assignments: WorkerAssignment[];
  try {
    assignments = await Promise.all(ids.map((id) => assessWorker(id)));
  } catch (err) {
    console.error("[assignment-chat] assess failed:", err);
    return NextResponse.json({ ok: false, error: "assessment_failed" }, { status: 500 });
  }

  const fallbackText =
    assignments.map(formatAssignment).join("\n\n") +
    "\n\n최종 배치 결정 권한은 감독관에게 있습니다.";

  try {
    const reply = await clovaReply(message, assignments.map(toLlmContext));
    return NextResponse.json({
      ok: true,
      reply,
      source: "clova",
      assignments,
      disclaimer: CONDITION_DISCLAIMER,
    });
  } catch (err) {
    console.error("[assignment-chat] CLOVA fallback to rule text:", err);
    return NextResponse.json({
      ok: true,
      reply: fallbackText,
      source: "rule",
      assignments,
      disclaimer: CONDITION_DISCLAIMER,
    });
  }
}
