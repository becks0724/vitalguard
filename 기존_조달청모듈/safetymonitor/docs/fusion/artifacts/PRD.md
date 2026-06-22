# PRD — 영상·워치 낙상 결합(fusion) 판정 엔진

> 1단계 필수 산출물. cmux-duo-build 파이프라인. 작성: 클로드 ↔ 코덱스(검토).
> 대상 코드베이스: `safetymonitor` 모노레포(Next.js 15 + TS + Zod + SQLite, 워치 Swift).
> 기존 구조·언어·연동을 갈아엎지 않고 **추가**하는 것이 원칙.

## 1. 배경·목표

- **배경**: 영상(YOLOv8-pose, 존 단위, DB 미저장)과 워치(CoreMotion, 작업자 단위, DB 저장)가 분리 운영 중.
- **목표**: 두 신호를 서버에서 결합해 **오탐을 낮추고 미탐을 늘리지 않는** 낙상 판정(의심/경보/확정)을 제공.
- **성공 기준**:
  - (S1) 워치 단독 양성의 현행 danger 동작이 **퇴행 없이 보존**된다(safety monotonicity).
  - (S2) 영상·워치가 시간·대상 정합으로 **둘 다 양성**이면 "확정"으로 격상되고 alerts에 1건 이력화된다.
  - (S3) 한쪽 신호 부재 시 시스템이 무너지지 않고 가용 신호만으로 단독 판정을 유지한다.
  - (S4) 결합 판정 로직이 순수 함수로 단위 테스트되며, 기존 `severity.ts`·`hazard-event.ts` 계약을 깨지 않는다.

## 2. MVP 범위 (In Scope)

1. **결합 판정 순수 함수** — `packages/` 신규 패키지(또는 analyzers 확장)에 `decideFusion(inputs)` 구현.
   - 입력: 워치 측 낙상 상태 + 영상 측 존 낙상 상태 + 양측 **가용성(availability)** + 시간차.
   - 출력: 판정 단계(`suspect|warning|confirmed`) + 근거 + 권장 후속.
2. **가용성 모델** — `available / unavailable / blind / stale` 4상태. 부재는 음성이 아니라 `unknown`.
3. **worker 확정 fusion vs zone 미확정 fusion 분리**
   - worker 확정: 워치 이벤트(workerId 보유)에 영상 코로보레이션을 더해 격상 → 기존 `HazardEvent`(type=`fall`).
   - zone 미확정: 영상 단독 낙상 → **신규 `ZoneHazardEvent`**(workerId 없음, cameraId/zone 보유).
4. **영상 이벤트 수신 경로(서버 측)** — 대시보드에 영상 낙상 이벤트를 받는 API 신설
   (`POST /api/cctv/event`), Zod 스키마 + SQLite 저장(`cctv_fall_events` 테이블) + in-memory 보관.
5. **시간 정합** — 워치 발신 ts와 영상 frame ts를 **넓은 후보창(기본 ±기본값, 설정 가능)**으로 매칭,
   `impactTs` 부재를 반영해 정합 신뢰도를 낮게 가중.
6. **단위 테스트** — 표 5~10개 시나리오(양성/음성/부재/오정합)로 monotonicity·격상·degrade 검증.
7. **설계 문서** — 결합 알고리즘 + 규칙 근거 + 검토 반영 내역(3단계에서 합의된 문서 셋).

## 3. 비범위 (Out of Scope)

- YOLO 모델 재학습·임계 자동최적화(트랙A는 데이터 성숙 후, 본 작업 무관).
- BLE/UWB 실내 측위 하드웨어, 영상 내 개인 식별(얼굴/재식별)으로 worker 자동 귀속.
- 영상 FastAPI(:8000) **내부 추론 코드 대규모 개편** — 이벤트 송신 훅(최소 추가)만, 모델/파이프라인 불변.
- 워치 펌웨어의 `impactTs` 실제 송신 구현(스키마/인터페이스만 정의, 송신부는 "확인 필요").
- 실시간 WebSocket 푸시·APNs/FCM(기존 비범위 유지). 대시보드 폴링 경로 재사용.

## 4. 사용자/이해관계자

- **관제자(대시보드)**: 결합 판정 단계와 근거를 보고 대응. 확정 시 SOS 모달/알림 이력.
- **작업자(워치/폰)**: 경보 단계에서 자가확인 프롬프트(기존 `fallPromptOutcome` 경로 재사용).
- **조달청 심사/현장 운영**: 단일 신호 대비 정확도 향상의 근거(설계 문서).

## 5. 핵심 요구사항 (기능)

| ID | 요구사항 | 근거/제약 |
|---|---|---|
| F1 | 워치 단독 양성은 영상 상태와 무관하게 최소 danger 유지 | severity.ts:93 현행 보존(monotonicity) |
| F2 | 워치 양성 + 영상 `fallen` 정합 → `confirmed` 격상, alerts 1건 | UNIQUE(worker_id,type,ts) dedup 재사용 |
| F3 | 영상 `fallen` 단독(워치 부재/미착용) → zone `warning`(대상 미특정) | ZoneHazardEvent 신설, 관제 확인 |
| F4 | 영상 `lying` 단독 → `suspect`(앉기/눕기 오인 방지) | 약신호는 표시·로깅만 |
| F5 | 가용성 4상태를 입력·저장하고 `unknown`을 음성으로 취급 금지 | degrade gracefully |
| F6 | 영상 이벤트 수신 API + 스키마 + 저장 | 기존 `/api/mock/vital` 패턴 답습 |
| F7 | 결합 판정은 순수 함수(I/O 없음)로 테스트 가능 | analyzers 순수성 규칙 |

## 6. 비기능 요구사항

- **안전성**: false-OK 금지. 미탐 비용 ≫ 오탐 비용으로 가중.
- **호환성**: 기존 `VitalSample`/`HazardEvent`/`severity` 계약 불변(필드 **추가만**, 변경/삭제 금지).
- **격리**: 영상 fusion 실패가 워치 경보 경로를 막지 않음(독립 degrade).
- **한국어**: 로그·UI·문서 한국어(코드 식별자만 영문) — 프로젝트 규약.

## 7. 인터페이스 계약 (실제 코드 기준, 신설 분 명시)

- **기존(불변)**: `VitalSample`(vital-stream.ts), `HazardEvent`(hazard-event.ts, workerId 필수),
  `overallStatus`(severity.ts), `alerts` 테이블(UNIQUE worker_id,type,ts).
- **신설**:
  - `CctvFallEvent` 스키마: `{ cameraId, zone?, ts(frame), status(fallen|lying|...), fallenCount, confidence?, source }`.
  - `ZoneHazardEvent` 스키마: `{ eventId, cameraId, zone?, type:"fall", severity, ts, detail }`(workerId 없음).
  - `POST /api/cctv/event` 라우트 + `cctv_fall_events` SQLite 테이블.
  - `decideFusion()` 순수 함수 + 입력 타입(가용성·시간차 포함).

## 8. 미해결/대안 (코덱스 검토 반영)

- **대상 매칭**: zone↔worker 자동 귀속은 위험(같은 zone 타인 오귀속). MVP는 **배정표 없이는 worker 귀속 금지**,
  zone 이벤트는 대상 미특정으로만 격상. 배정표/BLE/UWB는 발표 후.
- **시간 정합 정밀도**: `impactTs/frameTs` 도입 전에는 **넓은 후보창 + 낮은 가중**만 허용(확인 필요).
- **영상 이벤트 송신부**: 데모 리포(`safetymonitor-cctv-demo`)의 FastAPI에 push 훅을 더할지, 대시보드가
  `/cctv/stats2`를 폴링해 자체 이벤트화할지 — 3단계에서 택1(현재 권장: 폴링 어댑터로 시작해 리포 비침습).

## 9. 산출물

- `docs/fusion/artifacts/`: idea.md, PRD.md, (3단계) 설계 문서 셋, qa-report.md.
- 구현: `packages/fusion/`(또는 analyzers 확장), `apps/dashboard-web/app/api/cctv/event/`,
  `apps/dashboard-web/lib/fusion-*.ts`, 필요 시 `ml/fall-detection/` 폴링 어댑터.
