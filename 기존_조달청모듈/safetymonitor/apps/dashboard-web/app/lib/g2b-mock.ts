// 데모용 샘플 공사 공고 5건 — 인증키 없이도 심사 시연이 끊기지 않도록 내장(KOSHA 목업 패턴).
// 과소계상_의심 / 정상 / 검토필요 케이스를 고루 포함해 룰엔진 분기를 모두 보여준다.
// taskText 에는 위험작업 키워드가 들어 있어 룰 기반 태깅의 근거문장으로 쓰인다.
import type { NoticeDetail } from "./safeprocure-types";

export const MOCK_NOTICES: NoticeDetail[] = [
  {
    id: "20260612-001",
    title: "○○구 공공청사 외벽 보수공사",
    kind: "공사",
    agency: "○○구청",
    region: "대전",
    estimatedPrice: 1_450_000_000,
    startDate: "2026-07-01",
    endDate: "2026-11-30",
    licenses: ["건축공사업"],
    taskText:
      "노후 공공청사 외벽 균열 보수 및 재도장 공사. 외벽 작업을 위한 강관비계 설치·해체가 수반되며, 옥상 방수 및 고소작업이 포함된다. 작업 구간 하부 보행자 통행 통제 필요.",
    contractAmount: null,
    winRate: 78.5,
    // 계약 단계에서 대상액·명시 안전관리비 확보된 케이스 → 정밀 검증(과소계상 의심)
    targetAmount: 1_200_000_000,
    declaredSafetyCost: 12_000_000,
  },
  {
    id: "20260610-014",
    title: "△△ 하수관로 정비공사",
    kind: "공사",
    agency: "△△시 상하수도사업본부",
    region: "충남",
    estimatedPrice: 3_200_000_000,
    startDate: "2026-08-01",
    endDate: "2027-03-31",
    licenses: ["토목공사업"],
    taskText:
      "노후 하수관로 교체를 위한 굴착 및 흙막이 가시설 설치 공사. 맨홀 등 밀폐공간 내부 점검·작업이 포함되며, 산소농도 측정 및 환기가 요구된다. 도심 굴착에 따른 교통 통제 구간 발생.",
    contractAmount: null,
    winRate: 81.2,
    targetAmount: null, // 공고 단계만 → 검토필요
    declaredSafetyCost: null,
  },
  {
    id: "20260608-027",
    title: "□□ 지하철 역사 환기구 신설공사",
    kind: "공사",
    agency: "□□교통공사",
    region: "서울",
    estimatedPrice: 8_500_000_000,
    startDate: "2026-09-01",
    endDate: "2027-08-31",
    licenses: ["토목공사업", "지하철·궤도 관련"],
    taskText:
      "지하철 역사 환기구 신설을 위한 지하 굴착 및 구조물 공사. 대형 굴삭기·크레인 등 중장비 양중작업과 전기 수배전 설비 연결작업이 포함된다. 야간 작업 구간 존재.",
    contractAmount: null,
    winRate: 79.0,
    targetAmount: null,
    declaredSafetyCost: null,
  },
  {
    id: "20260605-009",
    title: "◇◇ 정수장 전기설비 개량공사",
    kind: "공사",
    agency: "◇◇시 수도사업소",
    region: "경기",
    estimatedPrice: 600_000_000,
    startDate: "2026-07-15",
    endDate: "2026-12-15",
    licenses: ["전기공사업"],
    taskText:
      "정수장 노후 수배전반 교체 및 전기설비 개량. 활선 인접 작업 및 감전 위험 구간이 존재하여 정전 작업계획 수립이 필요하다. 일부 고소 케이블 트레이 작업 포함.",
    contractAmount: null,
    winRate: 84.3,
    targetAmount: 520_000_000,
    declaredSafetyCost: 11_000_000, // 기준액 이상 → 정상
  },
  {
    id: "20260603-031",
    title: "▽▽ 노후건물 해체 및 철거공사",
    kind: "공사",
    agency: "▽▽군청",
    region: "전남",
    estimatedPrice: 450_000_000,
    startDate: "2026-07-10",
    endDate: "2026-09-30",
    licenses: ["건설폐기물처리업", "해체공사"],
    taskText:
      "노후 청사 건물 해체 및 철거. 구조물 해체 시 분진·소음과 함께 중장비 압쇄작업이 수반되며, 인접 건물 보호 및 작업자 추락·낙하물 방지 대책이 요구된다.",
    contractAmount: null,
    winRate: 76.8,
    targetAmount: null,
    declaredSafetyCost: null,
  },
];
