// 데모용 샘플 공사 공고 5건 — 인증키 없이도 심사 시연이 끊기지 않도록 내장(KOSHA 목업 패턴).
// 과소계상_의심 / 과다계상_의심 / 정상 / 검토필요 케이스를 고루 포함해 룰엔진 분기를 모두 보여준다.
// taskText 에는 위험작업 키워드가 들어 있어 룰 기반 태깅의 근거문장으로 쓰인다.
import type { NoticeDetail } from "./safeprocure-types";

export const MOCK_NOTICES: NoticeDetail[] = [
  // ───────────────────────────────────────────────────────────────────────────
  // 관제 메인 현장 — 광주 스마트인재개발원 신축 공사 (safetymonitor 등록 현장)
  // ⚠ 아래 금액 5종은 전부 [임시값] — 실제 공고/계약/내역서 확보 시 이 블록만 교체.
  //   estimatedPrice     : 추정가격(공사금액)          ← 실제 도급/추정가격으로 교체
  //   targetAmount       : 안전관리비 대상액(직접공사비) ← 실제 대상액으로 교체(현재는 공사금액 근사)
  //   declaredSafetyCost : 공고/내역서 명시 안전관리비   ← 실제 계상액으로 교체
  //   winRate            : 낙찰률(%)                    ← 실제 낙찰률로 교체
  // 현재 임시값은 "과다계상 의심" 시나리오용 — declared(3,500만) > 법정 2,484.5만 × 1.3.
  //   법정 = 9억 × 2.28% + 기초액 432.5만 (건축공사 '5억 이상 50억 미만' 구간).
  //   법정 요율은 '최소' 기준이라 초과 계상 자체는 적법하다 — 그래서 판정은 '_의심'(선별)이고,
  //   확정은 실집행(③ 워치 출역) 대조와 발주처 몫이다.
  // 규모를 10억 미만으로 잡은 이유 = 목표 고객이 10억 미만을 시공하는 전문건설사이고,
  //   나라장터 실계약 3현장(8.0/4.0/1.8억)과 같은 구간이라 덱 전체가 한 규모로 정합한다.
  // 교체만 하면 안전관리비 예비검증·위험도·실집행(워치 worker-day) 전부 자동 재계산.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "SITE-SMARTHRD-2026",
    title: "광주 스마트인재개발원 신축 공사",
    kind: "공사",
    agency: "광주광역시", // [임시] 실제 발주처로 교체
    region: "광주",
    estimatedPrice: 900_000_000, // [임시] 9억 — 실제 공사금액으로 교체
    startDate: "2026-01-02",
    endDate: "2026-11-30",
    licenses: ["건축공사업"],
    taskText:
      "지상 2층 규모 교육연구시설(스마트인재개발원 부속동) 신축 공사. 터파기 및 흙막이 가시설 굴착 후 철근콘크리트 골조를 시공하며, 거푸집·동바리 설치를 위한 고소작업과 외부 강관비계 설치·해체가 상시 수반된다. 이동식 크레인을 이용한 자재 양중작업과 수배전반 전기공사가 포함된다.",
    contractAmount: null,
    winRate: 78.5, // [임시] 낙찰률
    targetAmount: 900_000_000, // [임시] 안전관리비 대상액 — 실제 대상액(직접공사비)으로 교체
    declaredSafetyCost: 35_000_000, // [임시] 명시 안전관리비 3,500만(법정 2,484.5만의 1.41배 = 과다계상 의심) — 실제값으로 교체
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
  // ── 나라장터 실계약 스냅샷 3곳 — getCntrctInfoListCnstwk 실응답(2026-07-09 조회) 기반. ──
  //    id(통합계약번호)·공사명·계약기관·계약금액·착공/준공일·시공사 = 전부 실값.
  //    declaredSafetyCost 는 계약 API 미제공 → null(룰엔진이 '검토필요'로 판정).
  //    winRate = 낙찰정보서비스(as/ScsbidInfoService, inqryDiv=4+ntceNo) 실측 스냅샷(2026-07-10) — live 시 재조회로 갱신.
  //    getContracts 가 실 API 수신 시 이 3건을 live 값으로 갱신해 목록에 태운다(ID 매칭).
  {
    id: "R26TE13895124",
    title: "시민문화복지센터 내진성능 보강공사",
    kind: "공사",
    agency: "충청남도 아산시",
    region: "충남",
    estimatedPrice: 799_719_230,
    startDate: "2026-04-20",
    endDate: "2026-09-16",
    licenses: ["건축공사업"],
    taskText:
      "시민문화복지센터 내진성능 보강공사. 나라장터 계약분류 시설공사>종합건설>건축공사, 제한경쟁 계약. 시공: 주식회사 백산건설.",
    contractAmount: 799_719_230,
    ntceNo: "R26BK01412328",
    winRate: 90.255, // 낙찰정보서비스 실측,
    targetAmount: 799_719_230, // 계약금액을 대상액 근사로 사용(계약 API 기준)
    declaredSafetyCost: null, // 계약 API 미제공 → 검토필요
  },
  {
    id: "R26TE13894834",
    title: "사직동 코워킹스페이스(녹성상회) 리모델링공사(건축, 기계)",
    kind: "공사",
    agency: "광주광역시 남구",
    region: "광주",
    estimatedPrice: 404_334_000,
    startDate: "2025-11-27",
    endDate: "2026-09-16",
    licenses: ["건축공사업"],
    taskText:
      "사직동 코워킹스페이스(녹성상회) 리모델링공사(건축, 기계). 나라장터 계약분류 시설공사>종합건설>건축공사, 제한경쟁 계약. 시공: 현대도건 주식회사.",
    contractAmount: 404_334_000,
    ntceNo: "R25BK01120895",
    winRate: 90.212, // 낙찰정보서비스 실측,
    targetAmount: 404_334_000,
    declaredSafetyCost: null,
  },
  {
    id: "R26TE13877355",
    title: "삼계2교 외 2개소 교량보수공사",
    kind: "공사",
    agency: "경상북도 봉화군",
    region: "경북",
    estimatedPrice: 176_059_600,
    startDate: "2026-04-15",
    endDate: "2026-08-12",
    licenses: ["토목공사업"],
    taskText:
      "삼계2교 외 2개소 교량보수공사. 나라장터 계약분류 시설공사>종합건설>토목공사, 수의계약. 시공: 성광종합건설(주).",
    contractAmount: 176_059_600,
    ntceNo: "R26BK01438751",
    winRate: 90.54, // 낙찰정보서비스 실측,
    targetAmount: 176_059_600,
    declaredSafetyCost: null,
  },
];
