# 체감온도 산출식 교체 — 체크리스트

목표 = 법정 폭염 판정(31/33/35℃)의 입력을 Open-Meteo `apparent_temperature` 에서 **기상청 체감온도**로 교체한다.
성공 기준 = ① 풍속이 여름철 체감온도에 영향을 주지 않는다 ② 같은 기상 조건에서 값이 기존보다 낮아지지 않는다 ③ 기존 690 테스트 무회귀.

결정·근거 = [context-notes.md](./context-notes.md)

## 1. 산출식 구현

- [x] `lib/apparent-temp.ts` 신설 — 순수 함수 4종
  - [x] `wetBulbStull(tempC, humidityPct)` — Stull 습구온도 추정
  - [x] `apparentTempSummer(tempC, humidityPct)` — 기상청 여름철
  - [x] `apparentTempWinter(tempC, windKmh)` — JAG/TI 겨울철
  - [x] `apparentTempKma(tempC, humidityPct, windKmh)` — 구간 분기 진입점
- [x] 파일 첫 줄 한국어 헤더 주석
- [x] 각 공식에 출처·개정일 주석

## 2. 단위 테스트 — 8건 통과

- [x] `lib/apparent-temp.test.ts`
  - [x] **풍속 불변** — 여름 구간에서 풍속만 바꿔도 결과 동일
  - [x] 습도 단조 · 기온 단조
  - [x] 구간 분기 — 25℃/10℃ 경계·풍속 1.3m/s 경계
  - [x] 중간 구간(10℃ < Ta < 25℃) = 기온 그대로
  - [x] 겨울철 풍속 반영 — 풍속↑ → 체감온도↓
  - [x] 습구온도가 기온을 넘지 않는다(물리 제약)·포화 시 기온 수렴
  - [x] 습도 결측·비정상 시 여름식 미적용
  - [x] 법정 임계 근처 실계산(33℃/60% → 33.4℃)

## 3. 파이프라인 연결

- [x] `app/api/weather/route.ts` — 업스트림 매핑 지점에서 `apparentTempKma()` 로 산출
- [x] Open-Meteo `apparent_temperature` 요청 파라미터 제거(내 변경이 만든 미사용)
- [x] 결측 폴백 확인 — 습도 `?? 0` → 유효 범위 밖이라 여름식 미적용(기온 그대로)

## 4. 회귀 가드 — 4건 통과

- [x] `lib/2026-08-14-apparent-temp-source.guard.test.ts`
  - [x] 업스트림 값 직결이 되살아나지 않는다(`doesNotMatch` 로 차단)
  - [x] 여름철 함수 본문에 풍속 식별자가 없다
  - [x] 기상청·Stull 계수 14개 불변
  - [x] 임계 3단계(31/33/35) 숫자 불변

## 5. 검증

- [x] `pnpm typecheck && pnpm lint && pnpm test` — **EXIT=0 · 711 pass / 0 fail**(종료코드 확인, grep 파이프 금지)
- [x] 조건 매트릭스 실계산 — 기온 29~35 × 습도 40~85 × 풍속 0~29km/h 전수 비교
- [x] 라이브 기상 실측 대조(광주 27.3℃/77%) — 현행 32.3℃ vs 기상청 29.1℃
- [ ] ~~dev 브라우저 육안~~ → **생략**. dev 서버가 프로덕션 DB 를 물고 `persistWeather` 가 쓰기까지 한다(L-04). 배포 후 라이브 `/api/weather` 응답값 대조로 대체.
- [ ] 배포 후 라이브 응답의 `apparentTempC` 가 기상청 식 계산값과 일치하는지 확인

## 6. 배포·기록

- [ ] 커밋 (산출식 + 테스트 + 가드 + 문서)
- [ ] 사용자 `/deploy` 승인 후 배포
- [ ] 옆 세션 칩 폭 8rem 수정 편승 여부 확인(합의됨)
- [ ] 라이브 육안 확인
- [ ] `harness/5-observability/run-log.md` 기록
- [ ] `CLAUDE.md` Status 갱신

## 범위 밖 (별도 처리)

- 31℃ `binding` 표기 검토(legal vs recommendation) — 법령 원문 대조 필요
- 38℃ 단계 신설 여부 — 고용노동부 공식 지침 대조 필요
- PSI 도입 (A안) — 이 트랙 완료 후
