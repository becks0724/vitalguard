// 공고 과업텍스트 → 위험작업 태그 추출.
//  ① ANTHROPIC_API_KEY 있으면 Claude(haiku)로 구조화 추출(JSON),
//  ② 없거나 실패하면 룰 키워드 매칭으로 폴백,
//  ③ 모든 태그의 evidence 는 반드시 원문(taskText)의 부분문자열인지 검증(환각 방지).
import "server-only";
import type { RiskTag } from "./safeprocure-types";

type KeywordRule = { tag: string; severity: 1 | 2 | 3; re: RegExp };

// 룰 폴백 사전 (TRD §5.2).
const KEYWORD_RULES: KeywordRule[] = [
  { tag: "고소작업", severity: 3, re: /비계|고소|외벽|지붕|철골|옥상|케이블\s?트레이/ },
  { tag: "굴착/흙막이", severity: 3, re: /굴착|터파기|흙막이|토공|사면|굴삭/ },
  { tag: "밀폐공간", severity: 3, re: /맨홀|정화조|탱크|관거|밀폐|산소농도|환기/ },
  { tag: "전기/감전", severity: 2, re: /수배전|활선|감전|전기설비|정전\s?작업/ },
  { tag: "중장비/양중", severity: 2, re: /크레인|굴삭기|항타|양중|중장비|압쇄/ },
  { tag: "해체/철거", severity: 3, re: /해체|철거|발파/ },
  { tag: "도장/화기", severity: 2, re: /도장|용접|화기|방수/ },
];

/** 매칭된 키워드를 포함하는 문장을 근거로 추출(없으면 주변 스니펫). */
function findEvidence(text: string, re: RegExp): string {
  const sentences = text.split(/(?<=다\.)\s*|(?<=[.!?])\s+/).filter((s) => s.trim());
  for (const s of sentences) if (re.test(s)) return s.trim();
  const m = re.exec(text);
  if (m) return text.slice(Math.max(0, m.index - 15), m.index + 25).trim();
  return "";
}

/** 룰 기반 태깅. */
export function ruleTags(taskText: string): RiskTag[] {
  const out: RiskTag[] = [];
  for (const k of KEYWORD_RULES) {
    if (k.re.test(taskText)) {
      out.push({ tag: k.tag, severity: k.severity, evidence: findEvidence(taskText, k.re), source: "rule" });
    }
  }
  return out;
}

/** AI 태깅(Claude). 실패 시 throw → 호출부에서 룰 폴백.
 *  ⚠ 개인정보 주의: 공고 과업텍스트를 외부 LLM(Anthropic)으로 전송한다. 대상은 '공개 조달 공고'에 한정.
 *     비공개 첨부·민감정보가 섞일 수 있는 입력은 상용화 시 마스킹/옵트인/온프레미스 모델로 대체 필요. */
async function aiTags(taskText: string): Promise<RiskTag[]> {
  const key = process.env.ANTHROPIC_API_KEY as string;
  const system =
    "당신은 건설 안전 전문가다. 입력된 공사 공고 과업텍스트에서 위험작업을 식별한다. " +
    "다음 태그만 사용: 고소작업, 굴착/흙막이, 밀폐공간, 전기/감전, 중장비/양중, 해체/철거, 도장/화기. " +
    '오직 JSON 배열만 출력: [{"tag":string,"severity":1|2|3,"evidence":string}]. ' +
    "evidence 는 반드시 원문에 그대로 등장하는 문구(부분 인용)여야 한다. 원문에 없으면 그 태그를 넣지 마라.";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: `<공고과업>\n${taskText}\n</공고과업>` }],
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}`);
  const json = (await res.json()) as { content?: { text?: string }[] };
  const text = json.content?.[0]?.text ?? "";
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < 0) throw new Error("no JSON array in response");
  const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) throw new Error("not an array");

  const tags: RiskTag[] = [];
  for (const r of parsed) {
    const o = r as Record<string, unknown>;
    const tag = typeof o.tag === "string" ? o.tag : null;
    const sev = Number(o.severity);
    const evidence = typeof o.evidence === "string" ? o.evidence : "";
    if (!tag || ![1, 2, 3].includes(sev)) continue;
    // 환각 방지: 근거문장이 원문 부분문자열일 때만 채택.
    if (!evidence || !taskText.includes(evidence)) continue;
    tags.push({ tag, severity: sev as 1 | 2 | 3, evidence, source: "ai" });
  }
  if (tags.length === 0) throw new Error("no valid AI tags after verification");
  return tags;
}

/** 공개 진입점: AI 우선, 실패 시 룰 폴백. */
export async function extractRiskTags(taskText: string): Promise<RiskTag[]> {
  const hasKey = typeof process.env.ANTHROPIC_API_KEY === "string" && process.env.ANTHROPIC_API_KEY.length > 0;
  if (hasKey) {
    try {
      return await aiTags(taskText);
    } catch (err) {
      console.error("[risk-tagging] AI fallback to rules:", err);
    }
  }
  return ruleTags(taskText);
}
