# SafetyMonitor — Plan

> **현재 상태 (2026-05-29)** — 트랙: 프로토타입 (D0~D4) · 현재 위치: **D1 ~99% + D2 ~88% + D3 ~68% + D4 UI 폴리싱 진행**. iPhone 2대 + Galaxy install 이력 유지, 워치 PoC 잠금 검증 PASS. 관제 웹은 VitAlGuard 브랜딩/라이트·다크 CI 로고/관리자 현장정보/WeatherStrip 업데이트 시각/현장정보·수신요약 레이아웃 정렬/히어로 최종 문구(`OPEN SAFETY · NEVER ALONE`)까지 반영. 관리자 현장정보는 서버 DB 에 KST 기준 일 1회 snapshot 저장되고 XLSX/CSV 자료에 포함된다. AWS 는 결제 문제로 local/mock + cloudflared 우회 유지. 남은 것: Galaxy Health 권한, iPhone 최신 release install, 워치 장시간 배터리 측정, D4 리허설. 상세 [progress.md](./progress.md#quick-summary-30초-안에-읽기)

---

> **현 시점 (2026-05-21~) 목표는 *프로젝트 발표용 프로토타입* 제작.** 본 문서는 두 트랙으로 분리.
> - **프로토타입 트랙 (D0~D4)** — 발표 시연 가능성 1순위. 즉시 작업 대상.
> - **발표 후 로드맵 (M0~M9)** — 본문 하단 *"발표 후 로드맵"* 섹션. 프로덕션·베타·KOSHA 컴플라이언스 구현 등은 발표 후로 이연.
>
> 충돌 시 프로토타입 트랙 우선. 자세한 배경은 [context-notes.md "프로젝트 성격 재정의"](./context-notes.md) 참조.

---

## 진행 스냅샷 (2026-05-29)

### 지금까지 작업

- D0 셋업 완료 — TS 4 패키지, Flutter `worker-phone`, Next.js dashboard, CDK synth, analyzers 5종 10/10 통과
- D1 앱 골격 완료 — `health`/`mqtt_client`/`flutter_secure_storage`/`http`, Health query 골격, 5초 polling, SOS UI, MQTT/HTTP publish service
- Android 개발환경 완료 — Android Studio Panda 4, SDK 36.0.0, JDK 17.0.19, AVD `SafetyMonitor_API_35` 생성
- AWS 보류 대체 경로 완료 — `POST /api/mock/vital`, 4 worker dashboard polling, `scripts/mock-publish.mjs`, mock POST/GET 검증
- iPhone 실기기 검증 완료 — HealthKit 권한 허용, HR/SpO₂/손목 온도 수집, local/mock receiver 전송, 관제 표시 확인
- 2026-05-28~29 관제 웹 대폭 확장 — DB 영속화, 관리자 CSV/XLSX, WeatherStrip 정책/이력, 다크·라이트 모드, VitAlGuard 브랜딩, 관리자 현장정보 설정, 현장정보·수신요약 레이아웃 폴리싱
- watchOS PoC — `HKWorkoutSession` 기반 잠금 우회 경로 실기기 검증 PASS

### 현재 상태

- D1 ~99%, D2 ~88%, D3 ~68%, D4 UI 폴리싱 진행. AWS 결제 문제로 IoT/DDB 실검증은 보류하고 local/mock receiver 로 진행 중
- iOS 잠금 중 HealthKit 읽기 불가 한계는 watchOS 워크아웃 세션 경로로 우회 가능함을 실증
- 관제 웹은 dashboard typecheck 통과. 관리자 현장정보는 localStorage 즉시 반영 + 서버 DB `site_info_daily` 일별 snapshot 저장 방식
- 관제 웹 히어로 카피는 `OPEN SAFETY · NEVER ALONE` / `보이지 않는 위험은 없습니다. 혼자가 아니기 때문입니다` 로 최종 반영
- Galaxy phone + Galaxy Watch Health Connect 데이터 타입별 권한 검증 남음

### 다음 할 일

1. Galaxy Health Connect 권한과 실제 워치 데이터 query 검증
2. iPhone 2대 최신 release 재install 및 endpoint 갱신
3. 관제 웹 라이트/다크·히어로 문구·관리자 현장정보·XLSX/CSV 내보내기 회귀 확인
4. 워치 PoC 누적 변경 재설치 및 배터리 장시간 측정
5. D4 발표 시나리오·백업 영상·리허설 진행
6. AWS 결제 보류 해제 후 IoT Thing/cert/Rule/Lambda/DDB 경로 연결

---

## 프로토타입 범위 (현 시점 목표)

### 검증할 핵심 가설 2개

1. **데이터 흐름** — Apple Watch + Galaxy Watch 의 생체 데이터를 페어 iPhone/Galaxy폰 (Flutter 앱) 이 HealthKit/Health Connect 으로 query 후 5초 내 관제 대시보드에 표시 가능. iOS + Android 양 OS 동시 시연.
2. **UX 가치** — 관제 대시보드에서 *4명 작업자* 의 상태를 grid 색 코드 로 동시 인지 가능 + 위험 발생 시 *시각·청각 알림* 으로 즉시 인지 가능

### 시연 흐름 (5분, 라이브 데모)

| 분 | 내용 |
|---|---|
| 0~1분 | 도입 — 산업안전 문제 정의 + KOSHA 의무 (슬라이드) |
| 1~2분 | 데모 1 — 정상 상태. Apple Watch + Galaxy Watch 양쪽 작업자 데이터 → 대시보드 4 카드 grid 갱신 |
| 2~3분 | 데모 2 — 위험 시나리오 5종 중 3종 트리거. 낙상 (mock) · 폰 SOS 버튼 (실기기) · SpO₂ 저하 (mock) → grid 카드 색 변경 + Alert |
| 3~4분 | 데모 3 — 고온 (mock 손목 37.5℃) + 심박 이상 (실기기 운동 직후 또는 mock) → danger 격상 |
| 4~5분 | 마무리 — 차트 시계열 · KOSHA 컴플라이언스 슬라이드 · 발표 후 로드맵 |

### 데모 구성

- **작업자 A (iOS 실기기)** — iPhone + Apple Watch (`workerId: demo_ios_01`). 정상 상태 + SOS 버튼 시연
- **작업자 B (Android 실기기)** — Galaxy phone + Galaxy Watch (`workerId: demo_and_01`). 낙상 · 운동 시 HR 상승 시연
- **작업자 C·D (mock publish 스크립트)** — 노트북에서 가상 HR · SpO₂ · 손목 온도 publish (`workerId: demo_mock_01`, `demo_mock_02`). 주의·위험 색 동시 표시. 라이브 실패 시 fallback.
- **관제자 화면** — 노트북 1대 (Next.js 대시보드, VitAlGuard 브랜딩, 현장정보+수신요약, WeatherStrip, 5 슬롯 grid)
- **백엔드** — AWS IoT Core dev account (다중 Thing — 폰 2개 또는 워커 4개). 단 AWS 결제 보류 중에는 Next.js local/mock receiver (`POST /api/mock/vital`) 로 동일 payload 검증
- **위험 감지 5종** — 낙상·심박이상·SOS·SpO₂·고온 (모두 `packages/analyzers` 단위 테스트 10/10 통과)

### 데모 마일스톤 (D0~D4)

| D | 내용 | 검증 |
|---|---|---|
| D0 | 셋업 — Flutter SDK·Xcode·**Android Studio**·AWS dev 계정·모노레포 골격 (TS 4 패키지 + Flutter 폰 앱). 위험 감지 5종 골격 + 테스트 | `pnpm build` + `flutter build ios --simulator` + `flutter test` + `pnpm --filter @safetymonitor/analyzers test` (10/10) |
| D1 | Flutter 폰 앱 → HealthKit/Health Connect (워치 데이터 query) → publish. AWS 보류 중에는 HTTP fallback → local/mock receiver | iOS 실기기 HR/SpO₂/손목 온도 수신 완료 · Android/Galaxy Health Connect 검증 남음 |
| D2 | 백엔드/대체 receiver → 웹 대시보드 실시간 표시 (VitAlGuard 관제 화면 + 5 슬롯 grid + 시계열 차트) | 단말 또는 mock script → 대시보드 5초 이내 갱신 · AWS 가능 시 IoT/DDB 로 교체 |
| D3 | 위험 감지 5종 + 대시보드 Alert (낙상·심박·SOS·SpO₂·고온) | 5종 모두 5초 내 alert · 색 단계 (caution/danger) 정확 |
| D4 | 데모 폴리싱 — UI·시나리오 스크립트·백업 영상 녹화·발표 슬라이드 | 발표 컴퓨터 1회 무중단 시연 성공 (리허설 3회) |

### 데모 비범위 (발표 후로 이연)

- 별도 워치 앱 (Apple Watch / Wear OS) — 워치는 생체 센서로만
- 멀티 테넌트 — 시연용 worker 다수지만 조직 1개·관제자 1명 단일 유지
- Cognito 인증 / APNs · FCM · SES · Slack 알림 (데모는 웹 alert 만)
- 위험 감지 5종 중 **고립** (5종 시연. 고립만 발표 후)
- KOSHA PDF 리포트·AuditLog 인프라
- 베타 협력사 운용·법률 자문·App Store / Play Store 배포
- 도메인 정식 확보·GitHub Organization

### 비용 윤곽

| 항목 | 프로토타입 비용 |
|---|---|
| Apple Developer | 기존 보유 ($99/년 있으면 활용). 없으면 시뮬레이터만 |
| AWS Free Tier | $0 (단일 디바이스 dev) |
| Vercel | $0 (Hobby) |
| **합계** | **거의 0** |

---

# 발표 후 로드맵 (프로덕션 트랙)

> 이하 모든 섹션은 **발표 종료 후** 본격 활성화. 프로토타입 단계에서는 *참조용 자산* 으로만 유지.

## 비전

산업 현장 (건설·공장·물류·고소작업 등) 작업자의 생체 데이터를 웨어러블로 실시간 수집하여 관제실이 다수 작업자를 동시 모니터링하는 B2B SaaS. 낙상·심박이상·고온·고립 등 위험 신호 감지 시 관제자·동료·관리자에게 즉시 알림. KOSHA 산업안전보건법의 "위험성 평가·실시간 위험 모니터링" 의무 이행을 디지털로 지원.

## 1차 목표 (MVP)

- **작업자 단말 (Apple Watch + Android Wear)** — 심박·SpO₂·낙상·체온·위치·활동 자동 수집, 1~10초 간격 스트리밍
- **관제 웹 대시보드** — 다수 작업자(초기 50명 규모) 실시간 grid 뷰 + 위험 상태 alert
- **모바일 보조 앱 (관제자용)** — 외근/이동 중 푸시 알림 + 위험 발생 작업자 위치·상태 확인
- **백엔드 (AWS IoT Core + Cognito + Lambda)** — 다중 OS 디바이스 → MQTT → Rule → Lambda → DB 파이프라인
- **규칙·통계 기반 위험 감지** — 머신러닝 아직 없음. KOSHA 가이드 + 의료 임계값 기반

## 명시적 비범위 (Out of Scope, 1차)

- 머신러닝 / 이상치 자율 학습 (2차 이후)
- 영상 (CCTV) 통합
- 작업자 간 메시징 / 협업 기능
- 다국어 (한국어 단독, 영문 라벨은 향후 검토)
- iOS/Android 외 OS (Tizen·Wear OS 외 자체 OS 등)
- 의료기기 인증 (MFDS) — 산업 안전 모니터링 범주로 제한. 진단·치료 주장 금지
- 자동 119 연계 (1차는 관제자 수동 호출. 자동화는 2차)

## 아키텍처

상세 데이터 흐름 — 아래 텍스트 다이어그램 참조. 이미지 버전 `architecture.png` 는 추후 추가 예정.

```
작업자 단말 (Apple Watch / Galaxy Watch)
    │  MQTT/TLS
    ▼
AWS IoT Core
    │  Rule (SQL)
    ▼
Lambda (분석·라우팅)
    ├──▶ DynamoDB (시계열)
    └──▶ EventBridge (알림 발송)
              ├──▶ 웹 대시보드 (Next.js)
              ├──▶ APNs/FCM (관제자)
              └──▶ SMS/Slack (관리자)
```

- **단말 → 클라우드** — MQTT over TLS (AWS IoT Core), 디바이스 인증서 기반
- **인증** — AWS Cognito (관제자·관리자 · 조직 단위 멀티 테넌트)
- **시계열 DB** — Amazon Timestream (또는 DynamoDB) — 작업자별 시계열
- **메타 DB** — DynamoDB (조직·작업자·디바이스 매핑·이벤트 이력)
- **알림** — APNs / FCM (모바일), SES (이메일), Slack Webhook
- **웹 대시보드** — Next.js (Vercel) + WebSocket (AWS IoT WebSocket) 으로 실시간 푸시
- **공통 분석 라이브러리** — `packages/analyzers` TypeScript — Lambda·웹·모바일 공유

## 데이터 모델 (1차 윤곽)

| 모델 | 필드 |
|---|---|
| `Organization` | id, name, plan, createdAt |
| `Worker` | id, orgId, name, role, deviceIds[], emergencyContact |
| `Device` | id, type (apple_watch/galaxy_watch), workerId, certificateArn, lastSeenAt |
| `Operator` | id, orgId, role (admin/operator), notificationChannels |
| `VitalStream` | deviceId, ts, hr, spo2, skinTemp, motion, location |
| `HazardEvent` | id, workerId, type (fall/hr_anomaly/hyperthermia/isolation), severity, ts, resolvedAt, resolvedBy |
| `AuditLog` | id, actor, action, target, ts (KOSHA 보존 요건 대응) |

## 위험 감지 알고리즘 윤곽

총 **5종** — 본 시스템은 다음 카테고리를 감지함. "격렬한 움직임 후 무동작 (의식 소실 패턴)" 은 **낙상** 알고리즘 후속 단계로 흡수.

| 카테고리 | 임계·규칙 |
|---|---|
| **낙상** | 가속도 > 3G + 자세 급변 + 후속 30초 무동작 → 즉시 danger (격렬한 움직임 후 무동작 = 의식 소실 패턴 포함) |
| **심박 이상** | resting HR > 130 (휴식 중) 또는 < 40 / 운동 중 zone 5 초과 5분 지속 → caution → danger |
| **저산소 (SpO₂)** | < 92% 30초 지속 → caution / < 88% 즉시 → danger |
| **고온 (체온)** | 피부 온도 + 환경 온도 추정 → 열사병 위험 → caution/danger |
| **고립** | 마지막 통신 > 5분 + GPS 위험 구역 → caution / > 15분 → danger |

세부 임계값은 [context-notes.md](./context-notes.md) 에 누적. KOSHA 가이드 + 의료 reference 출처 명시.

## 화면 구성 (스케치)

### 웹 대시보드 (관제실)
- **Overview** — 작업자 grid (각 카드: 사진·이름·심박·상태 색)
- **Worker Detail** — 시계열 차트 + 최근 위험 이벤트 + 위치 지도
- **Alerts** — 활성 위험 이벤트 큐 + 처리 워크플로우
- **Reports** — 일/주/월 안전 지표 리포트 + KOSHA 제출 양식
- **Admin** — 조직·작업자·디바이스·관제자 관리

### 모바일 보조 앱 (관제자)
- **Alert Inbox** — 푸시 받은 위험 이벤트 목록
- **Worker Quick View** — 호출·위치·연락처

### 작업자 단말 (Watch)
- **현재 상태** — 자신의 심박·SpO₂·상태 색 (모니터링되고 있음 표시)
- **SOS 버튼** — 수동 위험 신고
- **메시지 수신** — 관제자로부터의 호출

## 마일스톤

| M | 내용 | 검증 |
|---|---|---|
| M0 | 인프라 사전 결정 (AWS 계정·Apple Dev·Android Dev·도메인) | 결정 문서화 |
| M1 | 모노레포 스캐폴딩 + 공통 패키지 (analyzers·schemas·thresholds) | `pnpm build` 통과 |
| M2 | AWS IoT Core + Cognito + Lambda 골격 (CDK) | 더미 디바이스 → IoT → Lambda → DynamoDB 1건 |
| M3 | Apple Watch 클라이언트 — 인증서 + MQTT publish | 실기기에서 5초 간격 HR 스트림 확인 |
| M4 | Android Wear 클라이언트 — 동일 기능 | Galaxy Watch 에서 동일 |
| M5 | 웹 대시보드 — 작업자 grid + WebSocket 실시간 | 단말 → 대시보드 1~3초 지연 표시 |
| M6 | 위험 감지 5종 + 알림 라우팅 (APNs·FCM·이메일) | 모의 이벤트 → 관제자 모바일 푸시 수신 |
| M7 | 모바일 보조 앱 (React Native 또는 네이티브) | 푸시 수신 + Worker Quick View |
| M8 | KOSHA 리포트 + 감사 로그 + 데이터 보존 정책 | 일·주·월 리포트 PDF 출력 |
| M9 | 베타 — 1개 협력사 현장 5~10명 시범 운용 | 1주 무장애 + 위험 이벤트 1건 이상 정상 감지·대응 |

## 컴플라이언스·법규 (1차 검토)

- **산업안전보건법 (KOSHA)** — 위험성 평가 의무, 사고 발생 시 보고
- **개인정보보호법** — 생체정보 = 민감정보. 명시적 동의·암호화·보존 기간 관리 필수
- **근로기준법** — 작업자 모니터링 범위·시간 제한 (사생활 침해 방지). 근로계약/사내 합의 필요
- **의료기기법** — 진단·치료 주장 금지. "건강·안전 보조 정보" 로 한정
- **AWS Region** — 한국 데이터 주권 → `ap-northeast-2` (서울) 우선

→ M0~M1 사이에 법률 자문 1회 예산화 권장. 상세는 [compliance.md](./compliance.md) 별도 문서.

## 비용 윤곽 (대략)

| 항목 | 1차 비용 | 베타 단계 월 |
|---|---|---|
| Apple Developer (개인/조직) | $99/년 또는 $299/년 (조직) | — |
| Google Play Developer | $25 (1회) | — |
| AWS Free Tier | $0 (12개월) | 이후 $50~200 (작업자 50명 가정) |
| 도메인 + Vercel | ~$15/년 + $0 (Hobby) | $20/월 (Pro 필요 시) |
| 법률 자문 (개보법·근로계약) | 100~300만원 (1회) | — |
| **초기 합계** | 200~400만원 | 월 10~30만원 (50명 베타) |

→ HealthPattern (M7 부모 모니터링 138,000원) 대비 **약 10~20배 규모**. B2B 수익화 전제.

## 산출물 위치

- 모노레포 — `~/Documents/06.safetymonitor/`
- 본 계획·체크리스트·노트 — `~/Documents/06.safetymonitor/docs/`
- HealthPattern 참고용 사본 — `~/Documents/06.safetymonitor/docs/HealthPattern-reference/`

## 실제 빌드 환경 (M0 진입 시 채움)

- 모노레포 도구 — pnpm + Turborepo (또는 Nx) ★ 결정 필요
- iOS — Xcode 26.4+ / Swift 6.2
- Android — Android Studio Hedgehog+ / Kotlin
- 웹 — Next.js 15 / TypeScript / Tailwind ★ 결정 필요
- 인프라 — AWS CDK (TypeScript) / Region: ap-northeast-2
- CI/CD — GitHub Actions

## M0 진입 전 결정 필요 (체크리스트)

- [ ] 프로젝트 정식명 (영문) — 가칭 `SafetyMonitor`. 상표·도메인 충돌 확인 필요
- [ ] 회사·조직 형태 — 개인사업자 / 법인 (계약·세금·AWS 청구 주체)
- [ ] AWS 계정 — 신규 생성 + 결제 카드 등록 + ap-northeast-2 Region
- [ ] Apple Developer Program — 개인 $99 vs 조직 $299. B2B 배포 형태(App Store / Custom App / Enterprise)
- [ ] Google Play Developer — $25 1회. Wear OS 배포
- [ ] Android 개발 환경 — Android Studio 설치 + Galaxy Watch 실기기 확보
- [ ] 도메인 — `safetymonitor.kr` 등 후보 + 등록
- [ ] GitHub Organization — 개인 vs 조직 repo
- [ ] 베타 협력사 — 시범 운용 가능한 현장 1곳 사전 컨택 (M9 검증용)
- [ ] 법률 자문 — 개보법·근로계약·산업안전보건법 (M0~M1 사이)
