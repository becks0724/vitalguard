// 챗봇 전용 표현 계층.
// 공용 배치 규칙의 판정값만 받아 CLOVA 문맥과 규칙 폴백을 만든다.
// 공용 대시보드의 note/detail 문자열을 재사용하지 않아 채널별 표현이 서로 오염되지 않는다.
import type { RiskTagName } from "./assignment-rules";
import type { ConditionGrade, ConditionReasonCode } from "./worker-condition";

export type ChatAssignment = {
  workerId: string;
  condition: {
    grade: ConditionGrade;
    reasons: { code: ConditionReasonCode }[];
  };
  advice: {
    perTag: { tag: RiskTagName; allowed: boolean; pending: boolean }[];
  };
  environment: {
    warningSummary: string;
    gaspodSummary: string;
    notes: string[];
  };
  taskDoc: { tags: RiskTagName[]; updatedAt: string } | null;
};

const CHAT_GRADE_LABEL: Record<ConditionGrade, string> = {
  fit: "양호",
  caution: "주의",
  restricted: "제한",
  unknown: "미판정",
};

// 챗봇은 공용 화면의 생체·작업 해석 문구가 아니라, 코드별로 정한 안전 안내만 사용한다.
const CHAT_REASON_LABEL: Record<ConditionReasonCode, string> = {
  FALL_24H: "최근 24시간 낙상 경보 신호",
  SOS_24H: "최근 24시간 SOS 경보 신호",
  SPO2_DANGER_24H: "웨어러블 산소포화도 안전 기준 신호",
  HR_DANGER_24H: "웨어러블 작업부하 위험 신호",
  VITAL_ALERT_24H: "웨어러블 안전 경보 신호",
  SPO2_CAUTION_FREQ: "웨어러블 산소포화도 주의 신호",
  HR_CAUTION_FREQ: "웨어러블 작업부하 주의 신호",
  LONG_SHIFT: "최근 24시간 장시간 워치 착용 신호",
  UNACKED_ALERT: "대응 확인이 필요한 경보",
  NO_DATA: "최근 24시간 워치 데이터 없음",
  SITE_ENV: "현장 환경 안전 신호",
};

export type ChatAssignmentTaskSummary = {
  workerId: string;
  grade: string;
  reasonLabels: string[];
  allowedTags: RiskTagName[];
  blockedTags: RiskTagName[];
  pendingTags: RiskTagName[];
  conclusion: string;
};

/** 챗봇 UI·하네스에 공통으로 쓰는 서버 확정 작업 목록. */
export function toChatTaskSummary(assignment: ChatAssignment): ChatAssignmentTaskSummary {
  const allowedTags = assignment.advice.perTag.filter((tag) => tag.allowed).map((tag) => tag.tag);
  const blockedTags = assignment.advice.perTag
    .filter((tag) => !tag.allowed && !tag.pending)
    .map((tag) => tag.tag);
  const pendingTags = assignment.advice.perTag.filter((tag) => tag.pending).map((tag) => tag.tag);
  const conclusion =
    blockedTags.length > 0 && allowedTags.length === 0
      ? "등록된 고위험 작업은 배제 권고 대상입니다."
      : blockedTags.length > 0
        ? "일부 고위험 작업은 배제 권고 대상입니다."
        : pendingTags.length > 0
          ? "워치 데이터 확인 전 배치 판단을 보류합니다."
          : "등록된 고위험 작업은 배치 가능 권고 대상입니다.";

  return {
    workerId: assignment.workerId,
    grade: CHAT_GRADE_LABEL[assignment.condition.grade],
    reasonLabels: assignment.condition.reasons.map((reason) => CHAT_REASON_LABEL[reason.code]),
    allowedTags,
    blockedTags,
    pendingTags,
    conclusion,
  };
}

/** CLOVA에는 공용 화면용 문장·수치 대신 챗봇 전용 사실 DTO만 전달한다. */
export function toClovaChatContext(assignment: ChatAssignment) {
  const summary = toChatTaskSummary(assignment);
  return {
    workerId: summary.workerId,
    배치참고등급: summary.grade,
    안전신호: summary.reasonLabels,
    배치가능작업: summary.allowedTags,
    배제권고작업: summary.blockedTags,
    판단보류작업: summary.pendingTags,
    결론: summary.conclusion,
    현장환경: {
      기상특보: assignment.environment.warningSummary,
      가스감지기: assignment.environment.gaspodSummary,
      안내: assignment.environment.notes,
    },
    검토범위: assignment.taskDoc ? assignment.taskDoc.tags : "전체 위험작업 어휘(과업지시서 미등록)",
  };
}

/** CLOVA 실패·하네스 거절 시에도 같은 챗봇 전용 표현 계층을 사용한다. */
export function formatChatRuleFallback(assignments: readonly ChatAssignment[]): string {
  return assignments
    .map((assignment) => {
      const summary = toChatTaskSummary(assignment);
      const lines = [
        `작업자 ${summary.workerId} — 배치 참고 등급: ${summary.grade}`,
        `배치 가능 ${summary.allowedTags.length}종 · 배제 권고 ${summary.blockedTags.length}종`,
      ];
      for (const reason of summary.reasonLabels) lines.push(`- 안전 신호: ${reason}`);
      lines.push(summary.conclusion);
      if (summary.blockedTags.length > 0) {
        lines.push(`- 배제 권고 작업: ${summary.blockedTags.join(", ")}`);
      }
      if (summary.allowedTags.length > 0) {
        lines.push(`- 배치 가능 작업: ${summary.allowedTags.join(", ")}`);
      }
      if (summary.pendingTags.length > 0) {
        lines.push(`- 판단 보류 작업: ${summary.pendingTags.join(", ")}`);
      }
      if (assignment.environment.warningSummary !== "특보 없음") {
        lines.push(`- 현장 환경 안내: 기상특보 ${assignment.environment.warningSummary}`);
      }
      if (assignment.environment.gaspodSummary !== "감지기 미연결") {
        lines.push(`- 현장 환경 안내: 가스 감지기 ${assignment.environment.gaspodSummary}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}
