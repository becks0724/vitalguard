# 생체 배치 저장 일괄화 — 체크리스트

2026-08-28. 근거와 결정은 [context-notes.md](./context-notes.md).

## 1. 순수 빌더

- [x] `lib/bulk-insert.ts` 신설 — `buildBulkInsert` · `chunkSizeFor` · `PG_MAX_BIND_PARAMS`
- [x] 단위 시험 9건 — 플레이스홀더 번호 연속성 · 값 순서 · 청크 계산 · 빈 입력 (9/9 통과)

## 2. 저장 계층

- [x] `lib/db.ts` — `vitalSampleColumns()` 추출(단건과 공유) · `assertRealDeviceOrigin()` 추출
- [x] `persistSamples(samples)` 신설 — 출처 관문 · 청크 · `VITAL_UPSERT_SUFFIX` 공유
- [x] `persistSample` 은 추출한 컬럼 함수를 쓰도록 수정(동작 불변)

## 3. 수집 경로

- [x] `store.ts` — `addSample(input, { deferPersist })` · 결과에 `pendingPersist`
- [x] `route.ts` 배치 루프 — 모아서 `persistSamples` 한 번 · 실패 시 전량 503

## 4. 가드 (L-113 — 변이 1종 이상 필수)

- [x] 배치 경로가 건별 저장으로 되돌아가지 않는다 (①②③)
- [x] 배치판에도 출처 관문이 있다 — 저장보다 **앞**인 것까지 (⑤)
- [x] 컬럼 목록이 공유된다 · 사본 함수가 둘이면 실패 (⑥)
- [x] 두 경로가 같은 멱등 꼬리말을 쓴다 (⑦)
- [x] 청크가 컬럼 수에서 계산된다 (⑧)
- [x] **변이 시험 실측 — 9종 전부 검출** (route 3 · store 2 · db 4 · 기준선·복원 cmp 왕복 OK)

## 5. 검증·배포

- [ ] `/verify` 3종(typecheck·lint·test) 통과
- [ ] 커밋(변이 종류를 메시지에 적는다)
- [ ] 배포 — CRON_SECRET v4 + 40d0246(좌표 일치·해제 특보 복귀)과 함께
- [ ] 스케줄러 3개 헤더 갱신(env-check·absence-check·geofence-check)
- [ ] 라이브 실증 — 장우진 수신 재개 · 처리 지연 15초 미만
- [ ] 옛 시크릿 버전 3 disable
- [ ] 기록 2곳 — run-log · `safetymonitor/CLAUDE.md` 라이브 줄
