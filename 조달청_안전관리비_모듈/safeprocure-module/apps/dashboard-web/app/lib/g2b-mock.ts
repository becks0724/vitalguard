// 데모용 샘플 공사 공고 6건 — 인증키 없이도 심사 시연이 끊기지 않도록 내장(KOSHA 목업 패턴).
// 과소계상_의심 / 정상 / 검토필요 케이스를 고루 포함해 룰엔진 분기를 모두 보여준다.
// taskText 에는 위험작업 키워드가 들어 있어 룰 기반 태깅의 근거문장으로 쓰인다.
import type { NoticeDetail } from "./safeprocure-types";

export const MOCK_NOTICES: NoticeDetail[] = [
  // ───────────────────────────────────────────────────────────────────────────
  // ⚠ 아래 금액 4종은 전부 [데모값] — 실제 공고/계약/내역서 확보 시 이 블록만 교체.
  //   estimatedPrice     : 추정가격(공사금액)          ← 실제 도급/추정가격으로 교체
  //   targetAmount       : 안전관리비 대상액(직접공사비) ← 실제 대상액으로 교체(현재는 공사금액 근사)
  //   declaredSafetyCost : 공고/내역서 명시 안전관리비   ← 실제 계상액으로 교체
  //   winRate            : 낙찰률(%)                    ← 실제 낙찰률로 교체
  // 현재 임시값은 "과소계상 의심" 시나리오 — declared 1.2억 < 법정 약 2.84억(=120억×2.37%, 건축공사 50억초과 요율).
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "SITE-SMARTHRD-2026",
    title: "광주 스마트인재개발원 신축 공사",
    kind: "공사",
    agency: "광주광역시", // [임시] 실제 발주처로 교체
    region: "광주",
    estimatedPrice: 12_000_000_000, // [임시] 120억 — 실제 공사금액으로 교체
    startDate: "2026-01-02",
    endDate: "2027-06-30",
    licenses: ["건축공사업"],
    taskText:
      "지상 8층 규모 교육연구시설(스마트인재개발원) 신축 공사. 터파기 및 흙막이 가시설 굴착 후 철근콘크리트 골조를 시공하며, 거푸집·동바리 설치를 위한 고소작업과 외부 강관비계 설치·해체가 상시 수반된다. 타워크레인을 이용한 자재 양중작업과 수배전반 전기공사가 포함된다.",
    contractAmount: null,
    winRate: 78.5, // [임시] 낙찰률
    targetAmount: 12_000_000_000, // [임시] 안전관리비 대상액 — 실제 대상액(직접공사비)으로 교체
    declaredSafetyCost: 120_000_000, // [임시] 명시 안전관리비 1.2억(법정 약 2.36억 대비 과소) — 실제값으로 교체
  },
  // ── 데모 현장 5곳 — 현장 선택 드롭다운(LoginSiteSelect)의 noticeId 와 1:1 매칭. 전부 [데모값].
  //    현장 성격별로 규모·요율·계상액을 달리해 정상/과소계상/검토필요 판정을 고루 보여준다.
  {
    id: "SITE-GWANGJU-LOGI",
    title: "광주 첨단3지구 물류센터 신축공사",
    kind: "공사",
    agency: "광주광역시도시공사",
    region: "광주",
    estimatedPrice: 18_000_000_000,
    startDate: "2026-03-02",
    endDate: "2027-02-26",
    licenses: ["건축공사업"],
    taskText:
      "대공간 물류창고 신축. 대형 철골조 기둥·트러스 양중 설치와 지붕 패널 고소작업이 수반되며, 외주부 강관비계 및 고소작업대 작업이 포함된다. 적재 램프 구조물 콘크리트 타설 구간 존재.",
    contractAmount: null,
    winRate: 82.4,
    targetAmount: 14_000_000_000,
    declaredSafetyCost: 250_000_000, // 법정 약 2.76억 대비 소폭 과소
  },
  {
    id: "SITE-PYEONGTAEK-FAB",
    title: "평택 반도체 P4 FAB 증설공사",
    kind: "공사",
    agency: "한국산업단지공단",
    region: "경기",
    estimatedPrice: 85_000_000_000,
    startDate: "2026-01-06",
    endDate: "2027-09-30",
    licenses: ["산업·환경설비공사업", "기계설비공사업"],
    taskText:
      "반도체 생산라인 플랜트 증설. 대형 크레인 중장비 양중작업과 배관·덕트 고소 설치, 밀폐공간 내부 작업 및 정밀 설비 반입이 수반된다. 클린룸 구조물과 유틸리티 배관 연결 작업 포함.",
    contractAmount: null,
    winRate: 88.1,
    targetAmount: 60_000_000_000,
    declaredSafetyCost: 1_200_000_000, // 중건설 기준 약 14.6억 대비 과소
  },
  {
    id: "SITE-BUSAN-RESI",
    title: "부산 해운대 마린시티 주상복합 신축공사",
    kind: "공사",
    agency: "부산도시공사",
    region: "부산",
    estimatedPrice: 45_000_000_000,
    startDate: "2026-04-01",
    endDate: "2028-03-31",
    licenses: ["건축공사업"],
    taskText:
      "해안 인접 초고층 주상복합 신축. 타워크레인 자재 양중과 갱폼·등반거푸집 고소작업이 상시 수반되며, 콘크리트 펌프카 압송 타설과 외부 마감 곤돌라 작업이 포함된다. 강풍 영향 구간 존재.",
    contractAmount: null,
    winRate: 79.6,
    targetAmount: 35_000_000_000,
    declaredSafetyCost: 850_000_000, // 법정 약 8.3억(건축 50억초과 2.37%) 대비 정상
  },
  {
    id: "SITE-INCHEON-OFFICE",
    title: "인천 송도 국제업무지구 오피스타워 신축공사",
    kind: "공사",
    agency: "인천경제자유구역청",
    region: "인천",
    estimatedPrice: 52_000_000_000,
    startDate: "2026-02-16",
    endDate: "2028-01-31",
    licenses: ["건축공사업"],
    taskText:
      "고층 업무시설 신축. 코어 선행 골조와 철골 기둥 양중, 커튼월 외장 고소작업이 수반되며, 지하 구조물 터파기 및 자재 양중 타워크레인 운용 구간이 존재한다.",
    contractAmount: null,
    winRate: 81.0,
    targetAmount: null, // 공고 단계만 확보 → 검토필요
    declaredSafetyCost: null,
  },
  {
    id: "SITE-SEJONG-APT",
    title: "세종 행복도시 6-3생활권 공동주택 신축공사",
    kind: "공사",
    agency: "한국토지주택공사",
    region: "세종",
    estimatedPrice: 38_000_000_000,
    startDate: "2026-05-04",
    endDate: "2028-06-30",
    licenses: ["건축공사업"],
    taskText:
      "공동주택(아파트) 신축. 갱폼·알폼 거푸집 고소작업과 타워크레인 자재 양중이 반복되며, 콘크리트 타설 및 외부 비계 설치·해체가 수반된다. 동별 동시 시공에 따른 양중 동선 관리 필요.",
    contractAmount: null,
    winRate: 77.3,
    targetAmount: 30_000_000_000,
    declaredSafetyCost: 280_000_000, // 법정 약 5.9억 대비 과소(심함)
  },
];
