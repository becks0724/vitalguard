# 상용화 갭 분석 + 단계별 로드맵 (제품 전반)

> 작성 2026-06-07. 프로젝트 방향 전환 — *발표용 프로토타입 한정* → **발표 + 최종 상용화·현장 실사용**(메모리 `project-commercialization-goal`).
>
> **이 문서의 범위.** 제품 *전반*의 상용화 갭(인프라·인증·데이터·알림·컴플라이언스·분석·영상·운영)을 도메인별로 진단하고, 발표(2026-07-07) 전/후로 나눈 **단계별 우선순위 로드맵**을 제시한다. 코드 변경 0의 계획 문서다.
>
> **기존 문서와의 관계.** [commercialization-roadmap.md](commercialization-roadmap.md) 는 *잠금·배터리 단일 기술 문제*의 심층 해법(워크아웃 세션·엔타이틀먼트)이고, 본 문서가 그것을 포함한 *제품 전체*의 상위 계획이다. 컴플라이언스 세부는 [compliance.md](compliance.md), 분석 세부는 [fall-ml-plan.md](fall-ml-plan.md)·[stress-algorithm-plan.md](stress-algorithm-plan.md) 참조.

---

## 0. 원칙 (한 줄 결론)

발표는 폐기가 아니라 **상용화로 가는 첫 검증 무대**다. 따라서 — ① 발표(7/7)까지는 *데모를 깨지 않는 선*에서 상용화 친화적 선택을 우선하고, ② AWS 실배포·유료 계정·멀티테넌트 같은 **큰 전환은 발표 직후**에 착수한다. ③ 모든 신규 결정의 기준에 "발표 데모만 되는가"가 아니라 **"현장에서 실제로 24/7 돌아가는가"** 를 포함한다.

---

## 1. 도메인별 갭 분석

난이도 = 구현 부담(S/M/L/XL). 선행 = 시작 전 충족해야 하는 비용/외부 조건.

| # | 도메인 | 현재 (데모 우선) | 상용화·현장 실사용 목표 | 핵심 갭 | 난이도 | 선행 |
|---|---|---|---|---|---|---|
| 1 | **백엔드·인프라** | cloudflared 임시터널 + Mac `localhost:3000`. CDK 는 39줄 스캐폴드(DDB 테이블+IoT Thing뿐, 미배포) | AWS IoT Core→Rule→Lambda(ingest/detect/notify)→Timestream/DDB 실배포. dev/staging/prod 분리 | 실 파이프라인 전무, 임시터널은 세션마다 만료 | XL | AWS 계정·결제 |
| 2 | **네트워크·연결** | 폰/워치 HTTP POST → 임시터널. 워치는 https 전용(ATS) | 고정 도메인·TLS, MQTT/TLS(IoT) 또는 API GW. store-and-forward 버퍼([roadmap §5](commercialization-roadmap.md)) 서버 반영 | URL 회전 피로, 유실 시 서버측 멱등 적재 부재 | L | #1 |
| 3 | **단말 배포 (iOS)** | 무료 Personal Team `F2P5ZFP65Q`(100대 한도→설치 차단), `flutter build ios --release`+devicectl 수동 | 유료 Apple Developer Program($99), 엔터프라이즈/MDM 또는 TestFlight·App Store, 자동 서명 | 디바이스 한도·수동 설치는 다수 현장 불가 | M | Apple $99 |
| 4 | **워치 배터리·백그라운드** | 워크아웃 세션 연속 광학 HR(~9%/hr·~11h), 잠금 우회의 유일 근거 | 유료 엔타이틀먼트(`healthkit.background-delivery`·`CMFallDetectionManager`·`CMBatchedSensorManager`)로 지배원 절감([roadmap §9.4](commercialization-roadmap.md)) | 무료팀은 엔타이틀먼트 서명 불가 → 풀시프트(8h+) 미충족 | L | Apple $99 |
| 5 | **인증·권한** | `admin/safety2026` 기본값, 세션 in-memory(재기동 시 만료), PII env 게이트 | Cognito/NextAuth, RBAC(작업자/관제자/관리자), 토큰 영속, 감사 로그 | 단일 관리자 비번·휘발 세션은 다중 사용자 운용 불가 | L | #1 |
| 6 | **멀티테넌트** | 단일 조직·단일 관제자(시연용) | 조직·현장·관제자 계층 분리 + 데이터 격리(테넌트 경계) | 데이터 모델·인가가 단일 테넌트 가정 | L | #5 |
| 7 | **데이터 저장·보존** | SQLite `.runtime/safetymonitor.db`(단일 파일), in-memory ring(500) | 관리형 DB(시계열 Timestream/DDB), 백업·보존정책·운영 마이그레이션, WebSocket 구독 | 단일 파일·로컬은 다수 디바이스·내구성 부족 | L | #1 |
| 8 | **알림·통지** | 웹 alert + 화면 SOS 모달·사이렌만 | APNs/FCM 푸시, SES/문자, 5분 dedup(danger 제외), 관제자 모바일 보조앱 | 관제 PC 안 볼 때 골든타임 통지 경로 없음 | M | #1, #5 |
| 9 | **위험 분석·ML** | 규칙기반 5종(낙상·심박이상·고온·SpO₂·SOS) + 스트레스 P1-lite. 낙상 ML은 데이터 수집만 | 개인 baseline 축적, 낙상 트랙A(임계 최적화)→shadow→배포, 스트레스 LSTM, **고립 감지(미구현)** 추가 | 규칙 임계 고정·개인화 없음, 고립 미구현 | M | 데이터 축적 |
| 10 | **영상 (CV)** | 없음(기존 "2차/영구 비범위") | supervision+YOLO 현장 영상분석(PPE 미착용·위험구역 침입·낙상 영상 교차검증) → 통합 안전 신호등 합류 | 신규 Python CV 서비스·탐지모델·GPU·영상 PII | XL | GPU, 동의 |
| 11 | **컴플라이언스·개인정보** | 동의·KOSHA 보존 비범위([compliance.md](compliance.md) 계획만) | 개보법 동의서(서명·철회권)·익명화 cron·최소수집, KOSHA 3년 보존·PDF 리포트·AuditLog, 의료기기 경계(진단 주장 금지) | 법적 운용 요건 미구현 | L | 법률 검토 |
| 12 | **품질·운영** | CI 없음(.github/workflows 부재), 테스트 경량(TS 5·Flutter 1), 단일 PC | CI(lint·build·test), 관측성(로그·메트릭·알람), 가용성·장애복구·OTA, 디바이스 인증서 회수 절차 | 회귀 안전망·운영 가시성 부족 | M | — |

---

## 2. 단계별 로드맵 (발표 전 → 후)

각 Phase 는 **선행 게이트가 충족돼야 시작**한다. Phase 1+ 는 발표 직후.

### Phase 0 — 발표 전 (~2026-07-07) · "데모 견고화 + 상용화 씨앗"
- **목표.** 발표 데모 성공 + 상용화로 자연 연결되는 선택만. 큰 인프라 전환은 **금지**(데모 리스크).
- **항목.**
  - 기존 블로커 해소 — 전 팀원 iPhone release 재install · Galaxy Health 권한 · 워치 배터리 풀시프트 측정 · D4 리허설.
  - 누적 커밋 push 정리(현재 main `ahead 88`).
  - 낙상 ML 데이터 축적·라벨링 시작(파이프라인 이미 라이브).
  - **비용 게이트 사전 결정** — AWS 계정·결제 알람, Apple Developer Program($99). Phase 1·3 의 선행이라 지금 의사결정만이라도.
- **산출물.** 안정적 발표 데모 + Phase 1 착수 준비 완료.

### Phase 1 — 인프라 기반 (발표 직후) · "임시터널 없이 24/7"
- **선행.** AWS 계정 + 결제 알람($50/$100/$200 단계).
- **항목.**
  - cloudflared 임시터널 → **고정 백엔드**. CDK `iot-stack.ts`(39줄) 확장 — IoT Core/API GW → Lambda(vital-ingest→hazard-detect→notify-fan-out) → Timestream/DDB.
  - 전송 경로 — HTTP POST → MQTT/TLS(IoT) 또는 HTTPS API GW. **store-and-forward** 서버측 멱등 적재.
  - 대시보드 데이터 소스 — SQLite/in-memory → 관리형 DB + WebSocket 구독.
  - 고정 도메인·TLS·환경 분리(dev/staging/prod).
- **산출물.** 실 디바이스가 임시터널 없이 상시 적재. (갭 #1·#2·#7)

### Phase 2 — 보안·다중 사용자 운영
- **선행.** Phase 1.
- **항목.**
  - 인증 — Cognito/NextAuth, RBAC, 토큰 영속(갭 #5).
  - 멀티테넌트 — 조직·현장·관제자 분리·데이터 격리(갭 #6).
  - 알림 — APNs/FCM/SES/문자, 5분 dedup, 관제자 모바일 보조앱(갭 #8).
  - 운영 — CI 추가·테스트 보강·관측성(CloudWatch)·디바이스 인증서 회수 절차(갭 #12).
- **산출물.** 여러 현장·여러 관제자가 안전하게 동시 사용.

### Phase 3 — 컴플라이언스·현장 정식 운용
- **선행.** Apple Program($99), 법률 검토.
- **항목.**
  - 개보법 — 동의서(서명·철회권)·익명화 cron·최소수집(갭 #11, [compliance.md](compliance.md)).
  - KOSHA — 3년 보존·사고 데이터 익명화 예외 명시·PDF 리포트·AuditLog.
  - 단말 — 유료 배포 + 엔타이틀먼트로 **워치 배터리 지배원 절감**(풀시프트 충족, 갭 #3·#4, [roadmap §9.4](commercialization-roadmap.md)).
  - 신뢰성 — 가용성·장애복구·OTA.
- **산출물.** 법적·전력 요건을 만족하는 현장 정식 운용.

### Phase 4 — 분석 고도화·영상 확장
- **선행.** 데이터 축적(Phase 1~2 운영), GPU(엣지/서버).
- **항목.**
  - ML — 낙상 트랙A→shadow→배포([fall-ml-plan.md](fall-ml-plan.md)), 스트레스 개인 baseline→LSTM.
  - 고립 감지(5종 중 미구현) 추가.
  - 영상(CV) — supervision+YOLO PoC→현장(PPE·구역침입·낙상 영상 교차검증), GPU 엣지(Jetson), 녹화·마스킹·동의(갭 #9·#10).
- **산출물.** 멀티모달(생체+영상) 위험 감지로 차별화.

---

## 3. 즉시 의사결정이 필요한 비용 게이트

상용화의 **가장 앞 관문은 코드가 아니라 비용 결정**이다(현재 결제 보류 중).

| 게이트 | 비용 | 막는 것 | 필요 시점 |
|---|---|---|---|
| AWS 계정 + 결제 | 사용량 과금(Free Tier 후 IoT/Timestream) | Phase 1 전체(실 백엔드) | 발표 직후 |
| Apple Developer Program | $99/년 | 디바이스 한도 해소(#3) + 워치 엔타이틀먼트(#4) | Phase 3, 가능하면 조기 |
| GPU(엣지/서버) | 하드웨어/클라우드 | Phase 4 영상(CV) 실시간 | Phase 4 |

---

## 4. 의존성·우선순위 근거

- **#1 백엔드가 병목.** #2·#5·#7·#8 이 전부 #1 에 의존 → Phase 1 이 최우선.
- **비용 게이트 선행.** AWS·Apple 결제 결정이 없으면 Phase 1·3 착수 불가 → Phase 0 에서 의사결정만이라도 끝낸다.
- **컴플라이언스는 운용 직전 필수.** 실 작업자 데이터를 현장에서 수집하는 순간(Phase 3) 법적 요건이 강제된다 → 그 전에 동의·보존 설계 완료.
- **영상(CV)·ML 은 데이터·GPU 의존이라 마지막.** 임팩트는 크나 선행조건이 무거워 Phase 4.

---

## 변경 로그
- 2026-06-07 — 신규 작성. 프로젝트 방향 전환(발표→상용화) 반영, 12개 도메인 갭 분석 + Phase 0~4 로드맵 + 비용 게이트.
