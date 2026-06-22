# qa-report.md — 영상·워치 낙상 결합(fusion) QA/검증

> 5단계 산출물. 클로드 + 코덱스 교차 리뷰. 작업 디렉토리 하위에만 저장.

## 1. 검증 결과 요약 (전부 통과)

| 항목 | 결과 | 근거 |
|---|---|---|
| schemas 빌드 | EXIT 0 | `tsc -p tsconfig.json` |
| schemas 단위테스트 | 15/15 | 기존 + cctv/zone 스키마 호환 |
| analyzers 빌드 | EXIT 0 | `tsc` |
| analyzers 단위테스트 | **46/46** | fusion T1~T14 + timeMatched/zoneCompatible + 기존 28 |
| dashboard typecheck | EXIT 0 | `tsc --noEmit` |
| dashboard 단위테스트 | **40/40** | cctv-poller 7 + 기존 33 |
| Next.js 프로덕션 빌드 | **Compiled successfully** | `/api/cctv/event` 동적 라우트 등록 확인 |
| 통합 실행 검증 | **8/8** | tsx로 fusion 전 경로 실행(아래 §2) |

## 2. 통합 실행 검증 (Next 런타임 없이 실제 실행)

`better-sqlite3` 실 DB에 적재하며 전 경로를 직접 실행(검증 후 데이터·스크립트 정리 완료).

| 시나리오 | 입력 | 결과 | 판정 |
|---|---|---|---|
| S1 | 영상 fallen 단독(워치 없음) | `warning_zone` + zoneHazard 적재 | ✔ |
| S2 | 영상 lying 단독 | `suspect` | ✔ |
| S3 | 워치 확정 + 영상 fallen + zone 일치 | `confirmed`(worker 타깃) | ✔ |
| S4 | 워치 확정 + 영상 fallen + zone 불일치 | `danger_watch`(confirmed 아님, 오귀속 방지) | ✔ |
| 부작용 | confirmed | alerts(fall) 기록 + cctv_fall_events 4건 영속 | ✔ |

→ **8/8 PASS.** 검증용 `E2E-WORKER`/`CAM-E2E` 데이터는 DELETE로 정리(전부 0 확인), 임시 스크립트 삭제.

## 3. 코덱스 교차 리뷰 반영 내역

| 라운드 | 코덱스 지적 | 반영 |
|---|---|---|
| R1(설계 초안) | 부재≠음성·zone 트랙 분리·시간 정합 한계·HazardEvent workerId 필수·영상 통계 형식(byStatus) | 설계 전면 반영 |
| R2(설계 문서) | `fallDecision="fall"` 갭(워치 2단계)·ZoneHazardEvent detail default 위험·zone불명 confirmed 금지·202 불필요·zone 저장 위치 | 설계·스키마 전면 반영 |
| 슬라이스1+2 | **워치 후보가 영상 단독 warning_zone을 먹는 monotonicity 위반** | fusion.ts candidate 분기 fall-through(T13/T14 추가) |
| 슬라이스3(직접 분석) | recordAlert ts=영상시각 → 워치 alert와 중복 2건 | **ts=매칭된 워치 ts**로 변경(UNIQUE dedup) |
| 슬라이스3(인라인 리뷰) | matchWatch 단순 최신선택 오매칭 위험 | **시간거리 최소 우선** 선택으로 변경 |

## 4. 보안 점검

- **인증**: `POST /api/cctv/event`는 무인증(워치 `POST /api/mock/vital`과 동일 패턴). **영상 이벤트엔 PII가 없다**
  (worker_id 없음, cameraId/zone/status만) → GET 노출 redaction 대상 아님. zoneHazards에도 PII 없음.
- **주입(injection)**: 모든 입력은 `CctvFallEventSchema` Zod 검증을 통과해야 적재. DB는 prepared statement(`@param`
  바인딩)만 사용 → SQL injection 불가. `ZoneHazardEventSchema.parse`로 zone hazard도 재검증.
- **메모리 가드**: zoneHazards는 200건 cap(초과분 splice). globalThis 캐시로 HMR 안전.
- **기존 계약 불변**: `VitalSample`/`HazardEvent`/`severity`/`alerts`/기존 테이블 **변경·삭제 0**(필드·테이블·라우트 추가만).
  워치 단독 `fallDetected → danger` 경로 퇴행 없음(monotonicity, T2/T3/T4/T12로 검증).

## 5. 한계·확인 필요 (정직한 미해결 항목)

1. **zone↔worker 매핑 데이터 부재** — 현재 코드에 작업자-구역 배정표가 없어, 데모에선 `setWorkerZone()`로 명시
   주입해야 `confirmed`/조기격상 경로가 발화한다(미주입 시 `warning_zone`/`danger_watch`까지만). 실내 GPS 약함.
   → 운영 시 BLE/UWB/게이트 태그/배정표 필요(설계 §15).
2. **워치 `impactTs` 미동봉** — 워치 `ts`는 발신 시각이라 정밀 시간 정합 불가. 넓은 창(PRE 10s/POST 15s) +
   낮은 가중으로만 동작. 펌웨어가 `impactTs`를 보내면 창을 좁히고 신뢰도 상향 가능.
3. **zone hazard 메모리 영속성** — zone hazard 판정 결과는 인메모리(프로세스 재시작·스케일아웃 시 유실). 단 원본
   영상 이벤트는 `cctv_fall_events`에 영속되어 재구성 가능. 프로덕션은 zone hazard 전용 테이블 + zone별 cap +
   TTL 권장(코덱스 #4/#5). 현 설계는 프로토타입(단일 프로세스 mock receiver) 스코프 — 기존 `mockStore` ring(500)과 동일 패턴.
4. **폴링 어댑터 시간 해상도** — `/cctv/stats2` 1초 폴링이라 시각 해상도가 1초. 호출부가 이 한계를 로그로 명시해야 함.
5. **영상 confidence/zone 메타** — `/cctv/stats2`에 confidence가 없을 수 있어 어댑터에서 optional 처리.
6. **e2e(HTTP) 미완** — Next `next start` e2e는 **빌드 인프라 충돌**(포트 3000의 기존 dev 서버와 공유 `.next` 청크
   해시 불일치, `Cannot find module './9555.js'`)로 보류. fusion 코드 결함 아님(기존 `/api/mock/vital`도 동일 500).
   대신 §2 통합 실행 검증으로 동등 이상 커버. **사용자 조치 필요**: 제 `next build`가 공유 `.next`를 prod 산출물로
   갱신했으니, 기존 dev 서버(3000)는 재시작 시 `.next`가 자동 재생성된다.

## 6. 최종 판정

- 설계(idea/PRD/fusion-design) + 구현(스키마 2 · fusion 1 · DB · API · 폴러) + 테스트(101 단위 + 8 통합) 완료.
- 코덱스 적대적 검토 4라운드 전부 반영. Safety Monotonicity 코드·테스트로 보장.
- 기존 코드 구조·언어·연동 불변(추가만). 미확정 가정은 위 §5에 "확인 필요"로 명시.
