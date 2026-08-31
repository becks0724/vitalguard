// iPhone·웹 대시보드가 함께 읽는 배치 어시스턴트의 기능 계약.
// 화면별 색상·말풍선 등 디자인은 각 클라이언트가 소유하고, 문구·추천 질문·응답 버전만 서버가 소유한다.
export const ASSIGNMENT_CHAT_CONTRACT_VERSION = "2026-08-31";

export const ASSIGNMENT_CHAT_CONTRACT = {
  version: ASSIGNMENT_CHAT_CONTRACT_VERSION,
  welcomeMessage:
    '작업자 배치와 현장 정보를 질문해 주세요.\n· 배치: "EMP-6861 오늘 고소작업 배치 가능해?"\n· 현장: "현재 체감온도 대응 조치는?", "재난문자 온 거 있어?"\n· 조달·법령: "안전모 단가 알려줘", "제560조 보여줘"\n등급·배제 권고는 최근 24시간 워치 실측 기반의 안전 기준 참고 정보입니다.',
  // 예시 칩 — 기능군별 1개씩(배치 2 · 환경 · 경보 · 조달 · 법령)으로 기능 폭을 유도한다.
  suggestions: [
    "전체 작업자 컨디션 확인해줘",
    "EMP-6861 오늘 밀폐공간 배치 가능해?",
    "현재 체감온도 대응 조치는?",
    "미확인 경보 몇 건이야?",
    "안전모 단가 알려줘",
    "제560조 보여줘",
  ],
  inputPlaceholder: "질문을 입력하세요",
  requestLabel: "질문",
  loadingMessage: "조회 중…",
  genericError: "응답 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  sessionExpired: "로그인 세션이 만료되었습니다. 잠시 후 로그인 화면으로 이동합니다.",
  disclaimer: "본 답변은 안전 기준·법령 참고 정보이며 의료적·법률적 판단이 아닙니다. 최종 배치 결정 권한은 감독관에게 있습니다.",
} as const;

export type AssignmentChatContract = typeof ASSIGNMENT_CHAT_CONTRACT;
