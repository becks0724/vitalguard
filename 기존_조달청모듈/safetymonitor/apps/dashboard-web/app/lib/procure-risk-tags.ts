// 안전조달 **전용** 위험작업 태그 (2026-08-27 사용자 결정 — "안전조달 검증에 한해서만 사용할
// 위험태그를 새로 만들어서 빼자").
//
// ★ 왜 분리했나 — 종전에 쓰던 lib/risk-tagging.ts 는 배치 어시스턴트(assignment)와 **공용**이라
//   조달 공고에 맞춰 사전을 넓히면 그쪽 판정까지 함께 움직인다. 이 모듈은 안전조달 검증만 쓴다
//   (소비처 = app/api/g2b/notice/[id] 하나 — 가드로 고정).
//
// ★ 사전의 근거 — 태그는 임의로 늘리지 않았다. 기존 7종(TRD §5.2)을 유지하고, 2026-08-27
//   나라장터 라이브 공고 목록에서 **실제로 관측된 공사인데 기존 사전이 못 잡은 것**만 추가했다.
//   각 신설 태그의 주석에 그 공고 제목을 남긴다. 새 유형이 또 관측되면 같은 방식으로 늘린다.
//
// ⚠ 입력의 한계(그대로임) — 태깅 입력은 공고 제목·주공종명·첨부파일명 결합 문자열이다
//   (g2b.ts taskText). 첨부 본문은 안 들어가므로, 제목 수준에 안 드러나는 위험은 여기서 못 잡는다.
// ⚠ risk-tagging.ts 와 달리 "server-only" 마커를 안 단다 — 룰 태깅이 순수 함수라 단위테스트가
//   이 모듈을 직접 import 하는데, 마커가 tsx 테스트 러너에서 해석되지 않는다(실측 MODULE_NOT_FOUND).
//   API 키는 호출 시점에 process.env 로만 읽으므로 클라이언트 번들에 인라인되지 않는다.
import type { RiskTag } from "./safeprocure-types";

type KeywordRule = { tag: string; severity: 1 | 2 | 3; form: FatalityForm; re: RegExp };

// ── 심각도의 근거 = 사망사고 통계(2026-08-27 사용자 결정 "모든 배지에서 심각도의 근거를
//    사망 사고율 데이터를 가져와서 봐야함") ─────────────────────────────────────────
//
// 출처(원문 PDF 를 내려받아 표를 그대로 옮김 — 수치 임의 가공 없음):
//   고용노동부 보도자료 「2025년(누적) 산업재해 현황 부가통계 — 재해조사 대상 사망사고 발생
//   현황」 잠정결과, 2026-03-31 발표. 유형별 사망자 표(전산업, 총 605명).
//   https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=19159
//
// ⚠ 이 데이터의 한계 셋 — 알고 쓰는 것과 모르고 쓰는 것은 다르다.
//   ① **구성비이지 사고율이 아니다** — 작업별 노출시간(분모)이 공표되지 않아 "작업 1시간당
//      치명률"은 어느 공식 통계로도 만들 수 없다. 질식 구성비(4.0%)가 낮은 것은 밀폐공간
//      작업량 자체가 적어서일 수 있다.
//   ② 전산업 기준 — 건설업 한정 유형별 표는 보도자료에 차트 이미지로만 있고 수표가 없다.
//   ③ 감전·익사는 **개별 미공표**("기타" 102명에 묶임 · 12월말 산재현황(승인 기준)도 동일).
//      개별치가 없는 형태는 숫자를 지어내지 않고 UNPUBLISHED 로 명시한다.
export type FatalityForm =
  | "떨어짐" | "물체에맞음" | "부딪힘" | "끼임" | "깔림뒤집힘" | "무너짐"
  | "화재폭발" | "질식중독" | "절단베임찔림" | "감전" | "빠짐익사";

/** 2025년 재해조사 대상 사망사고 유형별(전산업 605명) — 표의 숫자 그대로. null = 개별 미공표. */
export const FATALITY_STATS_2025: Record<FatalityForm, { deaths: number | null; sharePct: number | null }> = {
  "떨어짐": { deaths: 249, sharePct: 41.2 },
  "물체에맞음": { deaths: 72, sharePct: 11.9 },
  "부딪힘": { deaths: 62, sharePct: 10.2 },
  "끼임": { deaths: 50, sharePct: 8.3 },
  "깔림뒤집힘": { deaths: 39, sharePct: 6.4 },
  "무너짐": { deaths: 38, sharePct: 6.3 },
  "화재폭발": { deaths: 31, sharePct: 5.1 },
  "질식중독": { deaths: 24, sharePct: 4.0 }, // 보도자료 각주 명시(기타 세부)
  // 절단·베임·찔림 — 재해조사 표엔 없어 승인 기준(고용노동부 「2025.12월말 산업재해 현황」,
  // 정책자료실 bbs_seq=20260301471, 전산업 872명) 표의 4명(0.46%)을 쓴다. 출처가 다름을 명시.
  "절단베임찔림": { deaths: 4, sharePct: 0.46 },
  "감전": { deaths: null, sharePct: null }, // 개별 미공표 — 두 통계 모두 '기타' 묶음
  "빠짐익사": { deaths: null, sharePct: null }, // 개별 미공표 — 동일
};

/**
 * 구성비 → 심각도 밴딩(선언된 규칙 — 임의 조정 금지):
 *   ≥6% = 3  (떨어짐·물체에맞음·부딪힘·끼임·깔림·무너짐 — 표에 개별 열로 실린 상위 형태)
 *   <6% 개별 공표 = 2  (화재폭발 5.1 · 질식중독 4.0)
 *   <1% 개별 공표 = 1  (절단베임찔림 0.46)
 *   개별 미공표(null) = 2  — 상향도 하향도 근거가 없어 중간값. 개별치 확보 시 갱신.
 */
export function severityFromForm(form: FatalityForm): 1 | 2 | 3 {
  const share = FATALITY_STATS_2025[form].sharePct;
  if (share === null) return 2;
  if (share >= 6) return 3;
  if (share >= 1) return 2;
  return 1;
}

// 태그 → 주 발생형태 매핑 근거는 각 행 주석에. severity 는 전부 severityFromForm 파생값이다
// (테스트가 "손으로 적은 값 ≠ 파생값" 을 잡는다).
export const PROCURE_KEYWORD_RULES: KeywordRule[] = [
  // ── 기존 7종(이름 유지 — TAG_RECO·공종재해 가중이 이름으로 매칭된다)
  { tag: "고소작업", severity: 3, form: "떨어짐", re: /비계|고소|외벽|지붕|철골|옥상|케이블\s?트레이/ },
  // 굴착·흙막이 사망 기전 = 토사 붕괴 매몰(무너짐 6.3%).
  { tag: "굴착/흙막이", severity: 3, form: "무너짐", re: /굴착|터파기|흙막이|토공|사면|굴삭/ },
  // 밀폐공간 = 질식·중독 4.0% → **3에서 2로 하향**(데이터 반영 · 한계① 유의 — 구성비가 낮은
  // 것은 노출량 때문일 수 있으나, 공표 수치가 이것뿐이라 이것을 따른다).
  // "하수관로|하수도" 키워드는 「노하처리분구 하수관로 정비사업」(2026-08-27 실측)에서 추가.
  { tag: "밀폐공간", severity: 2, form: "질식중독", re: /맨홀|정화조|탱크|관거|밀폐|산소농도|환기|하수관로|하수도/ },
  { tag: "전기/감전", severity: 2, form: "감전", re: /수배전|활선|감전|전기설비|정전\s?작업/ },
  // 중장비·양중 = 부딪힘 10.2%·깔림 6.4%·물체에맞음 11.9% 전부 상위 형태 → **2에서 3으로 상향**.
  { tag: "중장비/양중", severity: 3, form: "부딪힘", re: /크레인|굴삭기|항타|양중|중장비|압쇄/ },
  { tag: "해체/철거", severity: 3, form: "무너짐", re: /해체|철거|발파/ },
  { tag: "도장/화기", severity: 2, form: "화재폭발", re: /도장|용접|화기|방수/ },

  // ── 신설(2026-08-27 라이브 공고 실측 유형) — 태그별 근거 공고는 종전 주석분 유지.
  // 벌목과 예초를 갈랐다 — 사망 기전이 다르다. 벌목 = 쓰러지는 벌도목에 맞음(물체에맞음 11.9%,
  // 보도자료가 임업 증가 사례로 명시) / 예초·풀베기 = 절단·베임(0.46%).
  { tag: "벌목", severity: 3, form: "물체에맞음", re: /벌목|간벌|벌도목|임도/ },
  { tag: "예초/풀베기", severity: 1, form: "절단베임찔림", re: /풀베기|예초|숲\s?가꾸기|가지치기/ },
  // 도로상 작업 = 통행 차량 부딪힘 10.2%. 근거 공고: 고속도로 도로표지 정비·교통사고 잦은 곳.
  { tag: "도로상 작업", severity: 3, form: "부딪힘", re: /도로표지|차선|중앙분리대|가드레일|교통사고\s?잦은|과속방지/ },
  // 수중·하천 = 빠짐·익사 — **개별 미공표라 2**(종전 3은 근거 없는 배점이라 내림).
  { tag: "수중/하천", severity: 2, form: "빠짐익사", re: /하천|수중|준설|호안|침수|배수펌프/ },
  // 승강기 = 승강로 추락(떨어짐 41.2%).
  { tag: "승강기", severity: 3, form: "떨어짐", re: /승강기|엘리베이터|에스컬레이터/ },
];

const TAG_NAMES = PROCURE_KEYWORD_RULES.map((r) => r.tag);

/** 매칭된 키워드를 포함하는 문장을 근거로 추출(없으면 주변 스니펫). */
function findEvidence(text: string, re: RegExp): string {
  const sentences = text.split(/(?<=다\.)\s*|(?<=[.!?])\s+/).filter((s) => s.trim());
  for (const s of sentences) if (re.test(s)) return s.trim();
  const m = re.exec(text);
  if (m) return text.slice(Math.max(0, m.index - 15), m.index + 25).trim();
  return "";
}

/** 룰 기반 태깅(순수 함수 — 테스트 대상). */
export function procureRuleTags(taskText: string): RiskTag[] {
  const out: RiskTag[] = [];
  for (const k of PROCURE_KEYWORD_RULES) {
    if (k.re.test(taskText)) {
      out.push({ tag: k.tag, severity: k.severity, evidence: findEvidence(taskText, k.re), source: "rule" });
    }
  }
  return out;
}

/** AI 태깅(Claude) — 사전과 같은 태그 목록만 허용. 실패 시 throw → 룰 폴백.
 *  ⚠ 개인정보 주의: 공개 조달 공고 텍스트에 한정해 외부 LLM 으로 전송한다(risk-tagging.ts 와 동일 경계). */
async function aiTags(taskText: string): Promise<RiskTag[]> {
  const key = process.env.ANTHROPIC_API_KEY as string;
  const system =
    "당신은 건설 안전 전문가다. 입력된 공사 공고 과업텍스트에서 위험작업을 식별한다. " +
    `다음 태그만 사용: ${TAG_NAMES.join(", ")}. ` +
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
    // 사전 밖 태그는 버린다 — AI 가 새 이름을 만들면 권고·가중 매핑이 조용히 빈다.
    if (!tag || !TAG_NAMES.includes(tag) || ![1, 2, 3].includes(sev)) continue;
    // 환각 방지: 근거문장이 원문 부분문자열일 때만 채택.
    if (!evidence || !taskText.includes(evidence)) continue;
    tags.push({ tag, severity: sev as 1 | 2 | 3, evidence, source: "ai" });
  }
  if (tags.length === 0) throw new Error("no valid AI tags after verification");
  return tags;
}

/** 공개 진입점(안전조달 전용): AI 우선, 실패 시 룰 폴백. */
export async function extractProcureRiskTags(taskText: string): Promise<RiskTag[]> {
  const hasKey = typeof process.env.ANTHROPIC_API_KEY === "string" && process.env.ANTHROPIC_API_KEY.length > 0;
  if (hasKey) {
    try {
      return await aiTags(taskText);
    } catch (err) {
      console.error("[procure-risk-tags] AI fallback to rules:", err);
    }
  }
  return procureRuleTags(taskText);
}
