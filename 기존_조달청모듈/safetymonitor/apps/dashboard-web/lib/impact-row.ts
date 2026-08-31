// 실시간 수집 표의 충격 판정(낙상 섀도)·낙상 행 표기 분류기 — 표시 전용(판정·집계·경보 미주입)
import type { VitalSample } from "@safetymonitor/schemas";

// 2026-08-31 사용자 결정 = 문구 A · 색 ③ · 배치 1(옵션 시트 383755c1). 원칙 셋 —
// ① 행 성격만 가른다: 서버 수신·링·워치 모듈은 그대로다. 후보 행을 링에서 빼면 낙상
//    "확인 중" 표시(DemoDashboard fallPendingByWorker)와 오탐 실측이 함께 죽는다.
// ② 없는 값을 안 채운다: 이 행의 생체 칸(`--` 넷·`≈` 추정 폴백)을 그리지 않는 것이
//    이 분류기의 존재 이유다. 08-31 실측에서 충격 행이 생체 행의 3.4배(249 vs 74)였다.
// ③ 내부 어휘(candidate·not_alerted·no_danger)는 title(툴팁)에만 — 보이는 글은 관제자 언어.
// ⚠ 경보 게이트 값(G 임계)은 워치 모듈 상수라 여기 어디에도 쓰지 않는다 — 웹에 박으면
//   모듈이 바꿀 때 표류한다. "기준 미만/이상" 판별은 숫자 비교가 아니라 모듈이 보낸
//   결말(fallPromptOutcome)·판정(fallTrace.decision)으로 한다.
export type ImpactRowView = {
  chip: string;
  text: string;
  /** 회색 꼬리 — 시험 단계 표기 등. 본문과 색을 가른다. */
  hint?: string;
  /** 색 ③ — 미경보 무채색 · 확인 열림 앰버 · 실경보 빨강. */
  tone: "neutral" | "caution" | "danger";
  /** 툴팁 — 내부 어휘는 여기에만 허용. */
  title: string;
};

/** 헤더 집계·행 분기가 공유하는 판별 — impactRowView 가 null 이 아닌 조건과 일치해야 한다. */
export function isImpactSample(sample: VitalSample): boolean {
  return sample.fallDetected === true || sample.fallCandidate === true;
}

export function impactRowView(sample: VitalSample, name: string): ImpactRowView | null {
  const g = sample.accelMagnitudeG != null ? `${sample.accelMagnitudeG.toFixed(1)}G` : null;
  // ① 실경보 — 워치가 경보 플래그를 실제로 보낸 낙상(recordAlert·모달과 같은 샘플). 빨강.
  if (sample.fallDetected === true) {
    return {
      chip: "낙상",
      tone: "danger",
      text: [name, g, "경보 발신"].filter(Boolean).join(" · "),
      title: "워치 낙상 경보(fallDetected) — 경보 이력·팝업과 같은 샘플",
    };
  }
  if (sample.fallCandidate !== true) return null;
  // ② 워치 확인 중(Apple 경로 후보) — 프롬프트 표시 중, 아직 결말 없음. 앰버.
  if (sample.fallDecision === "fall") {
    return {
      chip: "낙상",
      tone: "caution",
      text: [name, g, "워치 확인 중"].filter(Boolean).join(" · "),
      title: "낙상 후보(candidate · decision=fall) — 워치가 확인 프롬프트 표시 중",
    };
  }
  // ③ 워치 자체 기각(Apple 경로 음성 표본) — 임계 학습용으로만 남는 행. 무채색.
  if (sample.fallDecision === "rejected_no_corroboration" || sample.fallDecision === "rejected_timeout") {
    return {
      chip: "충격",
      tone: "neutral",
      text: [name, g, "워치 자체 기각 · 미경보"].filter(Boolean).join(" · "),
      title: `낙상 후보 기각(${sample.fallDecision}) — 임계 최적화 학습용 음성 표본`,
    };
  }
  // ④ 낙상 ML 섀도 후보(Wear OS) 미경보 — 사유를 모듈 판정으로 가른다. danger 인데 미경보
  //   = 경보 게이트(피크 G) 미달, no_danger = 패턴 기각(고 G 여도 낙상 아님 — 08-31 6.73G 실존).
  //   트레이스가 없는 구버전 행은 사유를 생략하고 "미경보" 만 적는다(모르는 것을 안 채운다).
  if (sample.fallPromptOutcome === "not_alerted") {
    const decision = typeof sample.fallTrace?.decision === "string" ? sample.fallTrace.decision : null;
    const reason =
      decision === "danger" ? "경보 기준 미만" : decision === "no_danger" ? "낙상 패턴 아님" : null;
    return {
      chip: "충격",
      tone: "neutral",
      text: [name, g, reason, "미경보"].filter(Boolean).join(" · "),
      title: `워치 낙상 모듈 후보(candidate) · 결말 not_alerted${decision ? ` · 판정 ${decision}` : ""} — 오탐 실측·학습용 수집`,
    };
  }
  // ⑤ 경보 게이트 통과 후보 — 워치에서 30초 확인창이 열렸다. 결말(취소/에스컬레이션)은 후속
  //   갱신이 DB 행만 보강하고 링에는 안 들어오므로(store 의 prompt_result 조기 반환) 이 행은
  //   결말을 모른다 — 그래서 "확인 열림" 까지만 적는다. 앰버.
  return {
    chip: "충격",
    tone: "caution",
    text: [name, g, "경보 기준 이상 · 30초 확인 열림"].filter(Boolean).join(" · "),
    hint: "(시험 단계 · 경보 미발송)",
    title: "워치 낙상 모듈 후보(candidate) · 경보 게이트 통과 — 결말은 DB·fall-export 에만 기록",
  };
}
