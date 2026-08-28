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

- [x] `/verify` 3종 통과 — tsc OK · lint 에러 0 · **1330/1330 @ 워킹트리**
- [x] 커밋 `653d45d`(변이 11종을 메시지에 명시)
- [x] 배포 — `00330-xzd`(`feb08bd`) · digest `sha256:e6dc8fb2…` 대조 일치 · env 28 · 사후 90초 5xx 0건
  - 40d0246(좌표 일치·해제 특보 복귀)은 **이미 라이브였다** — 팀원 `00328` 에 동승해 나갔다
- [x] 스케줄러 3개 헤더 갱신 — **크론이 5시간째 401 이었다**(401 01:10:03 → 200 01:10:55 실증)
- [x] 라이브 실증 — 지연 16.5초 → **0.04초** · 6분 내 **664건 회수** · 3.5시간 후 공백 0건
- [x] 옛 시크릿 버전 3 disable
- [x] 기록 2곳 — run-log · `safetymonitor/CLAUDE.md` 라이브 줄

## 6. 남긴 것

- [ ] **폰 타임아웃 15초** — 서버가 빨라져 당장은 안 걸리지만 계약상 여전히 서버 최악 처리시간보다 짧다. 앱 재빌드·재설치가 필요해 재서명 창(~09-03)에 묶는 것이 자연스럽다.
- [ ] **`APPROVED_AT` 이 배포 스크립트에서 무시된다** — [[L-116]]⑥ 의 처방이 미구현이다. `git archive "$APPROVED_AT:$SUBTREE"` 로 고쳐야 승인 범위 고정이 구조로 보장된다(사용자 판단 대기).
- [ ] **라이브가 origin 보다 앞서 있다** — 배포된 `feb08bd` 가 미푸시다. 소유 세션이 push 예정.
