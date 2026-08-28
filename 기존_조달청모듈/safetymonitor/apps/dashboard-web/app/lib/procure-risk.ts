// 사전 안전 리스크 종합 — 설명가능 가중 스코어(학습모델 아님).
// 기여도(breakdown)를 그대로 노출해 블랙박스가 되지 않게 한다.
import { PROCURE_KEYWORD_RULES } from "./procure-risk-tags";
import type { ConstructionType, NoticeDetail, RiskProfile, RiskTag } from "./safeprocure-types";
import { classifyConstructionType, evaluateSafetyCost } from "./safety-cost";

// 가중 상한(TRD §5.3): 위험작업40 + 안전관리비25 + 낙찰공기15 + 공종재해20 = 100.
const CAP = { 위험작업: 40, 안전관리비의심: 25, 낙찰공기: 15, 공종재해통계: 20 };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function durationDays(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

const TAG_RECO: Record<string, string> = {
  "고소작업": "고소·비계 작업 전 작업계획서와 추락방지설비(안전난간·안전대) 확인",
  "굴착/흙막이": "굴착·흙막이 가시설 구조검토 및 일일 계측관리 확인",
  "밀폐공간": "밀폐공간 작업 전 산소·유해가스 측정, 환기, 감시인 배치 확인",
  "전기/감전": "활선 인접 작업 정전·방호조치 및 절연보호구 착용 확인",
  "중장비/양중": "중장비 양중작업 신호수 배치 및 작업반경 통제 확인",
  "해체/철거": "해체계획서 검토 및 인접 구조물·낙하물 방지 대책 확인",
  "도장/화기": "화기작업 허가, 소화설비 비치 및 환기 확인",
  // 신설(procure-risk-tags.ts · 2026-08-27) — 권고가 없으면 기본 문구가 표시된다.
  "벌목": "벌도목 방향 통제·대피로 확보와 작업반경 내 접근 통제 확인",
  "예초/풀베기": "예초 작업 전 베임방지 보호구(안면보호구·보호장갑) 착용과 사면 전도 방지 확인",
  "도로상 작업": "차량 통행 병행 구간 신호수·교통안전시설(라바콘·싸인보드) 배치와 작업구간 통제 확인",
  "수중/하천": "하천·수중 작업 전 기상·수위 확인, 구명조끼 착용 및 급류 시 작업중지 기준 확인",
  "승강기": "승강로 개구부 추락 방지 조치와 전원 차단·잠금(LOTO) 절차 확인",
};

// 공종 재해 가중 — 사망사고 통계에서 파생(태그 심각도 3 = 유형별 구성비 6% 이상인 형태).
// 종전엔 손으로 적은 근사 목록({고소,굴착,밀폐,해체})이었고 "실 운영 시 통계로 대체" 주석이
// 있었다 — 2026-08-27 심각도 데이터 근거화와 함께 그 약속을 이행(단일 소스 = severityFromForm).
const HIGH_RISK_TAGS = new Set(PROCURE_KEYWORD_RULES.filter((r) => r.severity === 3).map((r) => r.tag));

// ⚠ 공사종류는 요율을 가르는 축이라 틀리면 기준액이 통째로 틀린다(특수 2.07% vs 건축 3.11%).
//   면허·과업문 추정은 휴리스틱이므로, 담당관이 근거 문서를 보고 확정했으면 그것이 이긴다.
export function buildRiskProfile(
  notice: NoticeDetail,
  tags: RiskTag[],
  confirmedType?: ConstructionType | null,
): RiskProfile {
  const constructionType = confirmedType ?? classifyConstructionType(notice.licenses, notice.taskText).type;

  // 대상액: 계약 대상액이 있으면 정밀, 없으면 추정가격 근사(→ 검토필요로 강등).
  const targetKnown = notice.targetAmount != null;
  const baseAmount = (notice.targetAmount ?? notice.estimatedPrice ?? 0) as number;
  const safetyCost = evaluateSafetyCost({
    constructionType,
    baseAmount,
    baseAmountIsApprox: !targetKnown,
    declaredCost: notice.declaredSafetyCost ?? null,
    durationDays: durationDays(notice.startDate, notice.endDate),
  });

  // 1) 위험작업 기여
  const sevSum = tags.reduce((s, t) => s + t.severity, 0);
  const c위험작업 = clamp(sevSum * 6, 0, CAP.위험작업);

  // 2) 안전관리비 의심 기여
  const c안전 =
    safetyCost.verdict === "과소계상_의심" ? CAP.안전관리비의심 : safetyCost.verdict === "검토필요" ? 10 : 0;

  // 3) 낙찰/공기 기여(저가낙찰·무리한 공기 프록시)
  const days = durationDays(notice.startDate, notice.endDate);
  let c낙찰 = 0;
  if (notice.winRate != null && notice.winRate < 80) c낙찰 += notice.winRate < 75 ? 10 : 6;
  const priceBn = (notice.estimatedPrice ?? 0) / 1_000_000_000;
  if (days != null && priceBn >= 3 && days < 240) c낙찰 += 5; // 30억↑인데 8개월 미만
  c낙찰 = clamp(c낙찰, 0, CAP.낙찰공기);

  // 4) 공종 재해통계 기여
  const highTags = tags.filter((t) => HIGH_RISK_TAGS.has(t.tag)).length;
  let c공종 = 8 + highTags * 4;
  if (constructionType === "중건설공사") c공종 += 4;
  c공종 = clamp(c공종, 0, CAP.공종재해통계);

  const breakdown = {
    위험작업: Math.round(c위험작업),
    안전관리비의심: Math.round(c안전),
    낙찰공기: Math.round(c낙찰),
    공종재해통계: Math.round(c공종),
  };
  const score = clamp(breakdown.위험작업 + breakdown.안전관리비의심 + breakdown.낙찰공기 + breakdown.공종재해통계, 0, 100);

  // topFactors — 기여 큰 순.
  const factorLabels: Record<keyof typeof breakdown, string> = {
    위험작업: "고위험 작업 다수",
    안전관리비의심: safetyCost.verdict === "과소계상_의심" ? "안전관리비 과소계상 의심" : "안전관리비 검토 필요",
    낙찰공기: "저가낙찰/짧은 공기",
    공종재해통계: "재해 다발 공종",
  };
  const topFactors = (Object.keys(breakdown) as (keyof typeof breakdown)[])
    .filter((k) => breakdown[k] > 0)
    .sort((a, b) => breakdown[b] - breakdown[a])
    .slice(0, 3)
    .map((k) => factorLabels[k]);

  // 권고 3개 — 안전관리비 이슈 우선, 다음 고severity 태그.
  const recos: string[] = [];
  if (safetyCost.verdict === "과소계상_의심")
    recos.push("안전관리비 명시액이 기준 대비 부족 의심 — 원가 명세서로 대상액·계상액 재확인");
  else if (safetyCost.verdict === "검토필요")
    recos.push("안전관리비 대상액·명시액 자료 보완 후 정밀 검증 필요(현재 공개데이터만으로 단정 불가)");
  for (const t of [...tags].sort((a, b) => b.severity - a.severity)) {
    if (recos.length >= 3) break;
    const r = TAG_RECO[t.tag];
    if (r && !recos.includes(r)) recos.push(r);
  }
  // ⚠ 3개를 채우려고 같은 문구를 반복하지 않는다(2026-08-27 사용자 지시 "표시 소음은 정리") —
  //   실측: 태그 1개 공고에서 기본 문구가 2줄 중복돼 권고가 소음이 됐다. 기본 문구는 한 번만.
  if (recos.length === 0) recos.push("착공 전 위험성평가 및 안전보건관리계획 수립 여부 확인");

  return { noticeId: notice.id, score, breakdown, topFactors, recommendations: recos.slice(0, 3), safetyCost, tags };
}
