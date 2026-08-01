# 긴급재난문자 연동 — 체크리스트

> 근거·결정은 [context-notes.md](context-notes.md). 진행하며 체크.
> 목표 = 작업자 GPS 평균 위치(시·도)에 발령된 **재난재해 문자만** 관제웹에 표시하고 텔레그램으로 알린다.
> 원칙 = 실 API 없이 **샘플 CSV 100건을 골든 픽스처로** Phase A~B 를 완성한다(D-02).

---

## Phase 0 — 활용신청·명세 확정 ✅ 완료 (2026-07-31)

- [x] safetydata.go.kr 회원가입 → `행정안전부_긴급재난문자`(dataSn=228) 활용신청
- [x] **아이피 항목 = `*.*.*.*`(전체 허용)** 로 기재 — Cloud Run 아웃바운드 IP 는 고정이 아니다(D-13)
- [x] 사유란이 있으면 "서버리스(Cloud Run) 환경으로 아웃바운드 IP 고정 불가" 명시
- [x] **인터페이스 ID = `DSSP-IF-00247`** — 발급 내역의 URL 로 확정(추정이 맞았다)
- [x] 파라미터 = `serviceKey`(대문자 K 맞음)·`returnType=json`·`pageNo`·`numOfRows` · 키 16자 특수문자 없음
- [x] ★ **`crtDt=YYYYMMDD` 날짜 필터 작동**(57,119 → 16건) · `rgnNm` 지역 필터도 있으나 미사용 (D-17)
- [x] 확인 — **일일 호출 1000건**(추정 100건은 오류) → 폴링 5분 주기 확정 (D-12)
- [x] 확인 — **만료일자 2027-07-31** · 유저아이피 `*.*.*.*` 등록됨 (D-16)
- [x] 응답 = `{header, numOfRows, pageNo, totalCount, body:[]}` · 필드명 CSV 동일, **`SN` 만 number** (D-17)
- [x] 실 호출 200 `NORMAL SERVICE` 확인 · 응답 구조는 D-17 에 기록
      (JSON 파일로 커밋하지 않는다 — 실데이터에 실종자 개인정보가 섞인다, D-10)
- [ ] `SAFETYDATA_SERVICE_KEY` — 로컬 `.env.local` + 프로덕션 Secret Manager 등록
      (시크릿 생성 → `secretAccessor` 개별 바인딩 → `--update-secrets` 1회 연결 — D-13)

- [x] ★ **실데이터 end-to-end 검증** — 오늘 17건을 Phase A~B 에 통과(폭염 15건 매칭·개인정보 0)

**완료 판정.** 실 API 200 + 명세 6항목 확정 + 실데이터 파이프라인 통과. ✅

---

## Phase A — 픽스처·정규화·유형필터 ✅ 완료 (2026-07-30)

- [x] `app/lib/disaster-msg-sample.ts` — CSV 100건을 레코드 배열로 고정
      (경로 변경 — 테스트 글롭이 `app/lib/*.test.ts` 라 같은 디렉터리 평면 배치가 관례)
- [x] 픽스처에 D-02 표의 6개 케이스가 전부 포함됐는지 확인(임진강·다지역·동단위·전체·긴급재난·실종자)
- [x] `app/lib/disaster-msg.ts` — `DisasterMsg` 타입 + `normalize()`
  - [x] `CRT_DT` 를 **KST(+09:00) 명시 파싱** → epoch ms (D-06)
  - [x] `RCPTN_RGN_NM` 은 `splitRegions()` 가 토큰별 `trim()` 까지 수행
  - [x] `MDFCN_YMD ≠ REG_YMD` → `revised: boolean` 플래그로 반환
        (순수 함수를 유지하려 `console.warn` 대신 플래그. 로그는 Phase C 호출부에서)
  - [x] 파싱 실패분을 `invalid[]` 로 반환 — 조용한 0건은 "재난 없음"과 구별되지 않는다
- [x] `WATCHED_TYPES` 화이트리스트 — 호우·산사태·폭염·강풍·대설·지진·태풍·산불 (D-03)
- [x] `filterWatched()` — 화이트리스트 외 값은 버리고 `unknownTypes[]` 로 반환
      (`console.info` 대신 반환값. 로그는 Phase C 호출부에서)
- [x] `isFresh()` 신선도 게이트 — `FRESH_WINDOW_MS = 3시간` 상수로 노출
- [x] 단위 테스트 (`app/lib/disaster-msg.test.ts`)
  - [x] 100건 파싱 성공 · invalid 0 · **실종자 27건 전량 차단**
  - [x] 교통통제 4건·도로통제 2건 차단 · 통과 67건 · `unknownTypes = ["교통통제","기타"]`
        (초안엔 "'기타' 31건 = 전부 실종자"라 적었으나 실측 결과 27건이다 — D-15)
  - [x] **통과분에 "찾습니다" 문자 0건** — 개인정보 차단 직접 검증 (D-10)
  - [x] KST 파싱 — `TZ=UTC` 로 돌려 시각이 안 밀리는지 (**로컬 맥=KST 라 이 테스트가 유일한 방어선**)
  - [x] KST 09시 이전 → UTC 전날 롤오버 · 형식 불일치 → null · 하이픈 구분자 허용
  - [x] 신선도 — 경계 정확히·+1ms 만료·미래 시각 배제

**완료 판정.** `TZ=UTC` + `TZ=Asia/Seoul` 양쪽 통과 + 실종자·교통통제 0건 통과. ✅

---

## Phase B — 지역매칭(시·도) ✅ 완료 (2026-07-30)

- [x] `matchSite(msgs, lat, lon)` — 기존 자산 재사용, 신규 지역 로직 **작성 금지** (D-04)
  - [x] `latLonToSido(lat, lon)` → 현장 시·도
  - [x] `splitRegions()` 로 `RCPTN_RGN_NM` 분리 (**괄호 보존 — 임진강 케이스**)
  - [x] `regionMatchesSido()` 로 시·도 일치 판정
  - [x] `nearbySidos()` 인근 시·도는 `nearby: true` 로 표시만, **알림 제외** (D-05)
- [x] **★ 신규 — `msgRegionMatchesSido()`** (계획에 없던 항목)
      기상특보와 재난문자는 **괄호 의미가 정반대**다. 기상특보 `경기도(안산, 시흥)` 은 head=시·도지만
      재난문자 `임진강 수계지역(경기도 연천군,파주시)` 은 head=하천명이고 괄호가 실제 행정구역이다.
      → head 가 **어떤 시·도도 아닐 때만** 괄호 안을 본다(경기 광주시 ↔ 광주광역시 오매칭은 그대로 차단).
      `kma-regions.ts` 는 수정하지 않았다 — 재난문자 전용 규칙이라 이쪽에 둔다.
- [x] 단위 테스트
  - [x] 임진강 행이 **2개 지역으로 정확히 분리**(괄호 안 콤마가 안 깨짐)
  - [x] 고양시 3개 구 다지역 행이 3토큰으로 분리
  - [x] `msgRegionMatchesSido` — head 매칭 · 괄호 폴백 · `경기도(광주, 하남)` 오매칭 차단
  - [x] 전주 현장 → 전북 발령 8건이 `site`, 매칭 지역이 전부 전북인지 불변식 검증
  - [x] 전주 현장 → 인근 시·도 발령은 `nearby` 로만(현장 시·도가 섞이지 않는지)
  - [x] 제주 현장 → 인근 시·도 0건, 전국 발령만 매칭
  - [x] 부산 전용 발령은 전주 현장에서 통째로 제외

- [x] ✅ **D-14 해소 — A안(시·도 대표점 다중 시드) 적용** (2026-07-30)
  - [x] `kma-regions.ts` `SIDO_SEEDS` — 도(道)에 주요 시·군 좌표 57개, 광역시는 중심점 유지
  - [x] `nearbySidos` 거리 계산은 SIDO 중심점 유지 → 인근 시·도 목록 불변(기상특보 회귀 0)
  - [x] `kma-regions.test.ts` 기존 5건 그대로 통과
  - [x] 회귀 고정 — 안산·고양·창원·구미·순천·천안 6곳이 도(道)로 판정되는지
  - [x] **홀드아웃 21곳(시드 미포함) 정확도 ≥85% 게이트** — 실측 58% → 88%
  - [x] 안산 좌표 → 긴급재난 1건이 `site` (이전엔 `nearby` 로 새어 알림 미발송)
  - [x] `경상남도 전체` → 창원 좌표 `site`
  - [x] 임진강 수계 발령 → 고양 좌표 `site` (괄호 폴백 + 시드 판정 통합)

**완료 판정.** 위 케이스 통과. 좌표는 테스트 상수로 고정. ✅

✅ **D-15 해소 — ②안 재승격 채택** (2026-07-30)
- [x] `senderOrg()` — 본문 `[기관명]` 추출, 표기 없으면 `null`
- [x] `isEvacuationNotice()` — **비경찰청 + 대피 키워드** 두 조건 AND
- [x] 재승격분은 `type` 을 `PROMOTED_TYPE("대피안내")` 로 치환(itemKey 유형 단위 대응)
- [x] 통과분 65 → **67건**(호우 61 + 산사태 4 + 대피안내 2) · 차단 35 → 33건
- [x] ★ 불변식 테스트 — 통과분에 "찾습니다" 0건 · 경찰청 발신 0건
- [x] 음성 케이스 — 경찰청+대피 / 기관표기 없음 / 대피 키워드 없음(사천 도로통제) 전부 차단

**최종 검증(2026-07-30).** `disaster-msg.test.ts` **33건** + `kma-regions.test.ts` 8건 ·
전체 `npm test` **442 pass / 0 fail** (TZ=UTC·Asia/Seoul) · tsc 0 · lint 0.

---

## Phase C — 실 API 어댑터·캐시 ✅ 완료 (2026-07-31)

`app/lib/disaster-msg-api.ts` (server-only) 신설. 순수 로직은 `disaster-msg.ts` 에 그대로 둔다.

- [x] `serviceKey()` — `SAFETYDATA_SERVICE_KEY` 없으면 `null` → 목업 폴백(`kma.ts` 정책 답습)
- [x] `fetchDisasterMsgs(now?)` — `crtDt` + `numOfRows=1000` 호출 → 정규화 → 유형필터까지 수행
  - [x] `queryDates()` — 평시 오늘 1건, **KST 00:00~03:00 에는 전날도**(신선도 3시간이 자정을 걸침)
  - [x] `dedupeBySn()` — 두 날짜 결과 병합 시 중복 제거. 증분 커서 금지(SN 비연속 — D-08)
  - [x] ⚠️ 응답 정렬 미신뢰 — 하루치 전건을 받아 우리가 필터 (D-17)
- [x] `source: "live" | "mock"` 반환 (알림 발사 게이트용 — D-11)
- [x] ★ **빈 body 를 목업으로 떨어뜨리지 않는다** — 재난 없는 날 가짜 경보 방지 (D-19)
- [x] 인메모리 캐시 TTL **5분** · 캐시 키에 조회 날짜 포함(자정 경계 안전)
- [x] `rgnNm` 서버측 지역 필터 **미사용** — 시·도 매칭은 우리가 한다 (D-17)
- [x] ⚠️ 실 API 실패 시 `console.error` — 폴백이 아니라 장애다 (D-16)
- [x] 로그는 `warn`/`error` 만(ESLint `no-console`) · 상시 차단 유형은 로그 제외 (D-19)
- [x] 🐛 **실 API 의 `SN` 은 number** — `String(r.SN).trim()` (D-18)
- [x] 🐛 **`REG_YMD`/`MDFCN_YMD` 는 나노초 타임스탬프** — 날짜 부분만 비교 (D-18)

**실동작 검증(2026-07-31).**
```
목업 경로   source=mock · 2건 · 신선도 통과 2 · 부산 현장 매칭 2 · 긴급재난 1
실 API      source=live · 34건(폭염) · 224ms · 개인정보 통과 0건
캐시        2회차 0ms 적중
당진/포항   site 6·7 · nearby 6·3
키 오류     resultCode 30 SERVICE KEY IS NOT REGISTERED → console.error + mock 폴백
```

- [ ] ⚠️ **재승격분 육안 확인** — 오늘 재승격 0건(대피 문자 미발생)이라 **미확인**.
      실제 `대피안내` 가 나온 날 개인정보가 섞이지 않았는지 1회 점검 (D-15 한계)

**완료 판정.** 목업·실API·캐시·실패 4경로 실동작 확인. ✅
검증 = `npm test` **453 pass / 0 fail** (TZ=UTC·Asia/Seoul) · tsc 0 · lint 0.

---

## Phase D — 라우트·알림·크론 🔶 백엔드 완료 (2026-07-31) · UI 미착수

- [x] `app/lib/disaster-msg-api.ts` — `disasterMsgsForLocation(lat, lon, now?)`
      (`kma.ts` 의 `warningsForLocation` 과 같은 자리. 라우트를 얇게 유지)
- [x] `app/api/disaster-msg/route.ts` — `GET ?lat=&lon=` (`kma-warning/route.ts` 구조 답습)
  - [x] 🐛 **`Number(null)`·`Number("")` 이 0 이라** 파라미터 누락이 "적도 앞바다 현장"으로
        통과했다 → `coord()` 로 빈 값을 NaN 처리. 누락·빈값·문자·일부누락 4케이스 400 확인
  - [x] 알림 발사 조건 = `source === "live" && (verifyBasicAuth || cronAuth)` (D-11)
  - [x] 무인증 조회는 허용하되 `console.warn` 후 발사 건너뜀
  - [x] `alertItems` 는 응답 JSON 에서 제외(내부 전용)
- [x] `notifyEnvAlerts()` 연결 — `buildAlertItems()` 결과를 그대로 전달
  - [x] `itemKey = "disaster:<유형>"` — SN 금지 (D-09)
  - [x] `severity` — 긴급재난 → `danger` / 안전안내 → `caution`
  - [x] `detail` — `HH:MM 발령 · 지역` + 본문 · 여러 건이면 `currentValue` 에 "외 N건"
  - [x] **★ `ALERT_TYPES` = 화이트리스트 전 유형 + `PROMOTED_TYPE`** — 발령 없는 유형도
        매번 `normal` 로 넘긴다(D-07 해제 역할 · D-15)
- [x] **★★ 알림 억제 시퀀스 테스트** — 실제 `shouldSendEnv` 로 6단계 재생
      (발령없음 → 첫발령 발송 → 지속 억제 → 긴급재난 승격 발송 → 신선도 만료 해제 → **재발령 재발송**)
- [x] `app/api/cron/env-check/route.ts` — `/api/disaster-msg` 자체 호출 추가
- [ ] **관제웹 표시** — 현장 시·도 발령분 + 인근 시·도 "참고" 배지 (미착수)

**실동작 검증(2026-07-31 · `next dev`).**
```
파라미터 누락/빈값/문자/일부누락  → 400 (4케이스)
당진(충남)  200 · source=live · severity=caution · summary=폭염 · site 7 · nearby 7
서울        200 · severity=normal · summary=재난문자 없음 · site 0 · nearby 15
alertItems 응답 노출 없음 · 무인증 알림 스킵 로그 확인
cron/env-check  키 없음 → 503
```
⚠️ **인증 경로는 로컬에서 돌리지 않았다** — `notifyEnvAlerts` 가 프로덕션 DB 에 쓰고(L-04)
실제 텔레그램을 발송한다. 라이브 검증은 Phase E 에서 크론 1회 실행으로 한다.

**완료 판정(백엔드).** 라우트·알림·크론 실동작 확인. 검증 = **473 pass / 0 fail** · tsc 0 · lint 0.

---

## Phase E — 검증·배포 ✅ 완료 (2026-07-31)

- [x] `pnpm typecheck` 0건
- [x] `pnpm lint` 0건
- [x] `pnpm test` 490 pass / 0 fail
- [x] `git fetch` — origin 동기(ahead 0 · behind 0) · 워킹트리 0건
- [x] 빌드 `4fabc718` (3M37S · digest `sha256:c2722d93`) · 커밋 `2764303`
- [x] **BUILT == HEAD 대조 통과**(L-09 병렬 세션 레이스 방지)
- [x] `SAFETYDATA_SERVICE_KEY` — Secret Manager 생성 + `secretAccessor` 바인딩 +
      `--update-secrets` 로 배포에 연결(env 24 → 25개). 키는 stdin 으로만 전달(argv·파일 미경유)
- [x] **트래픽 전환** `00223-vot` → **`00198-qk7` 100%**
- [x] 라이브 검증 — `/` HTTP 200 · **`/api/disaster-msg` `source=live`**
      (광주 · caution · 폭염 · site 7 / nearby 3) · 파라미터 누락 400 ·
      화면 탭 4개 · 패널 4개 · 신호등 칩 10개
- [x] `harness/5-observability/run-log.md` 기록

### ★★ 배포 함정 — `deploy` 성공 메시지가 트래픽 전환을 보장하지 않는다

`gcloud run deploy` 가 **"deployed and is serving 100 percent"** 를 출력했는데
실제로는 새 리비전이 **0%** 였다. 기존 트래픽이 구 리비전(`00223-vot`)에
`verify` 태그와 함께 **명시 고정**돼 있었기 때문이다.

```
deploy 직후   00198-qk7 (새 이미지)   0%
              00223-vot (구 이미지) 100%   ← verify 태그 고정
```

메시지만 믿었으면 **구 이미지가 서비스되는 채로 "배포 완료"를 보고**할 뻔했다.
→ **`update-traffic --to-revisions <새 리비전>=100` 을 별도로 실행**하고
`revisions describe` 로 **digest 를 대조**해야 한다.

**완료 판정.** 라이브 `source: "live"` 확인 · 트래픽 새 리비전 100%. ✅

---

## Phase F — 지역 매칭 정정 ✅ (2026-08-01 · 미배포)

사용자 제보 두 건(`경기도 광주시` 오탐 / 광주 발령 미탐) — 근거·수치는 D-20.

- [x] 시·도 매칭을 토큰의 **첫 공백 앞**으로 한정 (재난문자는 `시·도 시·군·구` 한 토큰)
- [x] 괄호 폴백 내부도 콤마 단위로 같은 규칙 적용 (임진강 수계 회귀 테스트 유지)
- [x] `전남광주통합특별시` 를 두 번째 토큰으로 광주/전남 분리 · 전역 발령은 양쪽 다
- [x] 회귀 테스트 4건 추가 (오탐 · 통합시 분리 · 전역 발령 · matchSite 통합)
- [x] 실 API 337건 재현 — 광주 site 50 → 1건 · 전남 44 → 43 · 경기 42 불변
- [x] dev 라이브 검증 — `폭염 광주` site 1건(광산구) · 인근 전남·전북 26건 참고
- [x] main 반영 — ⚠️ 병렬 세션 커밋 `a368fa1`(제목은 태풍 작업)에 흡수돼 함께 올라갔다
- [ ] 배포 — 라이브(`00204-4b8`)는 아직 옛 매칭이라 **광주 현장 알림에 전남 발령이 계속 간다**

## 보류·후순위

- [ ] 정정 발령(`MDFCN_YMD ≠ REG_YMD`) 처리 — 샘플 0건이라 미구현, 로그만 (D-08)
- [ ] 멀티 현장 — 작업자가 흩어지면 GPS 평균이 무의미해진다. 현장별 좌표로 전환 필요 (D-05 한계)
- [ ] 시·군·구 단위 정밀 매칭 — 지금은 의도적으로 시·도 고정 (D-05)
- [ ] 고정 아웃바운드 IP 확보 — Cloud NAT 상시 과금이라 보류 (D-13)
- [ ] **2027-07-31 인증키 만료** — 캘린더 등록 필요. 만료돼도 화면은 멀쩡하고 내용만 가짜가 된다 (D-16)
