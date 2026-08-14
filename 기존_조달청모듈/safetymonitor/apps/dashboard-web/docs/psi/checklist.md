# PSI 도입 — 체크리스트

목표 = 작업자별 생리적 부담을 **문헌 지수**로 표시한다(우리가 정한 숫자 0개).
성공 기준 = ① 문헌 임계 6/7.5 가 화면에 반영 ② 입력 결측이 0 이 아니라 null 로 표시 ③ 기존 711 테스트 무회귀.

결정·근거 = [context-notes.md](./context-notes.md)

## 1. 산출 함수

- [x] `packages/analyzers/src/core-temp-estimator.ts` — `CT0` export 추가(외과적·한 줄)
- [x] `lib/psi.ts` 신설
  - [x] `computePsi({ coreTempC, heartRate, restingHeartRate })` → `{ value, personalized } | null`
  - [x] Tc0 = analyzers 의 `CT0` 를 import (숫자 중복 금지)
  - [x] HR0 = `restingHeartRate ?? 60`(논문 기본값) · `personalized` 로 구분 · **범위 밖(30 미만·180 이상)은 개인화하지 않음**
  - [x] 0~10 클램프
  - [x] 입력 결측 → null (0 아님)
  - [x] `psiBand(value)` → `"normal" | "high" | "critical"`(6·7.5 문헌 임계)
- [x] 파일 첫 줄 한국어 헤더 주석 + 출처(Moran 1998)

## 2. 단위 테스트 — 8건 통과

- [x] `lib/psi.test.ts` — 체온 단조 · 심박 단조 · **개인화**(안정심박↓ → PSI↑) · Tc0=CT0 에서 PSI 0 · 클램프 · **결측 null(0 과 구분)** · personalized 플래그 · 밴드 경계 6/7.5

## 3. 화면 연결

- [x] `DemoDashboard.tsx` 체온 셀 보조 라벨에 `PSI N.N · 추정` 병기(열 추가 없음 — 폭 압박 회피)
- [x] 밴드별 색(정상 muted / 높음 앰버 / 고위험 빨강) — 신호등·판정 경로 무변경
- [x] 툴팁 — 문헌 출처·임계·**개인화 여부**·"추정 체온 입력이라 판정·경보 미사용" 명시
- [x] null 은 기존 `심박 추정` 라벨 유지(빈 자리 = 판정 불가)
- [x] ⚠ 저활동·고심박 주석이 있으면 그쪽 우선(더 급한 경고)

## 4. 회귀 가드 — 5건 통과

- [x] `lib/2026-08-14-psi-display-only.guard.test.ts` — severity 모듈 무유입 · store/vital 알림 경로 무유입 · 문헌 상수 4개(6·7.5·39.5·180) 불변 · **CT0 import 강제**(하드코딩 금지) · 대시보드가 판정 토큰 미생성
- [x] **음성 대조** — `PSI_HIGH` 6→5 변조 시 가드 ③만 실패(1건), 복원 시 5/5. 자기 결함에만 반응함 확인

## 5. 검증

- [x] `pnpm typecheck && pnpm lint && pnpm test` — **EXIT=0 · 724 pass / 0 fail**(신규 13건 · lint 0 errors)
- [x] ⚠ **모노레포 함정 실측** — analyzers 소스에 export 를 추가해도 **dist 를 빌드하기 전엔 `CT0` 가 undefined** 라 PSI 가 조용히 전부 null 이 됐다(테스트 1건 실패로 발견). `pnpm --filter @safetymonitor/analyzers build` 후 해소. **배포는 무관** — Dockerfile 이 소스에서 패키지를 빌드하고 dist 는 gitignore 다.
- [ ] 배포 후 라이브 손계산 대조 — 현재 데이터(체온 37.5℃·심박 93bpm·안정심박 미수신)면 **PSI ≈ 2.2** 예상

## 6. 배포·기록

- [ ] 커밋
- [ ] 사용자 `/deploy` 승인 후 배포
- [ ] 배포 전 `git log <직전 라이브>..HEAD` 로 범위 확인(08-14 레이스 교훈)
- [ ] 라이브 확인 — **관측 가능한 항목만** 요청한다(경계값 대기 항목과 구분)
- [ ] run-log · Status 기록

## 범위 밖 (별도 결정)

- PSI 를 판정·알림에 승격 — 추정 체온 오차 전파를 검증할 정답 데이터가 없다
- 스트레스 지수와의 통합·대체 — 사용자 결정 사항
- WBGT + ACGIH 작업–휴식 비율(B안) — MET·일광 시간 수집 후
