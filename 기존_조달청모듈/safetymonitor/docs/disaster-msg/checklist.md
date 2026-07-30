# 긴급재난문자 연동 — 체크리스트

> 근거·결정은 [context-notes.md](context-notes.md). 진행하며 체크.
> 목표 = 작업자 GPS 평균 위치(시·도)에 발령된 **재난재해 문자만** 관제웹에 표시하고 텔레그램으로 알린다.
> 원칙 = 실 API 없이 **샘플 CSV 100건을 골든 픽스처로** Phase A~B 를 완성한다(D-02).

---

## Phase 0 — 활용신청·명세 확정 ⬜ (사용자 직접)

- [ ] safetydata.go.kr 회원가입 → `행정안전부_긴급재난문자`(dataSn=228) 활용신청
- [ ] **아이피 항목 = `*.*.*.*`(전체 허용)** 로 기재 — Cloud Run 아웃바운드 IP 는 고정이 아니다(D-13)
- [ ] 사유란이 있으면 "서버리스(Cloud Run) 환경으로 아웃바운드 IP 고정 불가" 명시
- [ ] 승인 후 명세서에서 확인 — **인터페이스 ID**(`DSSP-IF-00247` 추정·미확인)
- [ ] 확인 — 요청 파라미터명(`serviceKey` 대문자 K 여부·`returnType`·`pageNo`·`numOfRows`)
- [ ] 확인 — **지역·기간 필터 파라미터 존재 여부**(없으면 전국 최신 N건 수신 후 클라 필터)
- [ ] 확인 — **일일 호출 제한**(100건 추정) → 폴링 주기 확정 근거(D-12)
- [ ] 확인 — 응답 래핑 구조(`{header, body:[]}`)·필드명이 CSV 와 동일한지
- [ ] 실제 200 응답 1건 확보 → `docs/disaster-msg/sample-response.json` 로 보관
- [ ] `SAFETYDATA_SERVICE_KEY` 를 Secret Manager 에 등록(키가 유일한 방어선 — D-13)

**완료 판정.** 실 API 200 응답 1건 + 명세 6항목 확정.

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
  - [x] 100건 파싱 성공 · invalid 0 · 실종자 31건 **전량 차단**
  - [x] 교통통제 4건 차단 · 호우 61 + 산사태 4 = 65건 통과 · `unknownTypes = ["교통통제","기타"]`
  - [x] **통과분에 "찾습니다" 문자 0건** — 개인정보 차단 직접 검증 (D-10)
  - [x] KST 파싱 — `TZ=UTC` 로 돌려 시각이 안 밀리는지 (**로컬 맥=KST 라 이 테스트가 유일한 방어선**)
  - [x] KST 09시 이전 → UTC 전날 롤오버 · 형식 불일치 → null · 하이픈 구분자 허용
  - [x] 신선도 — 경계 정확히·+1ms 만료·미래 시각 배제

**완료 판정.** `TZ=UTC` + `TZ=Asia/Seoul` 양쪽 통과 + 실종자·교통통제 0건 통과. ✅

---

## Phase B — 지역매칭(시·도) ✅ 완료 (2026-07-30) · ⚠️ D-14 미결

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

**최종 검증(2026-07-30).** `disaster-msg.test.ts` 27건 + `kma-regions.test.ts` 8건 ·
전체 `npm test` **436 pass / 0 fail** (TZ=UTC·TZ=Asia/Seoul 양쪽) · tsc 0 · lint 0.

⚠️ **신규 미결 — D-15.** '기타' 31건이 전부 실종자가 아니다. **하천 수위 대피 안내 2건**
(주암댐 방류·임진강 수위)이 함께 버려진다. 재승격 여부 사용자 결정 대기(현재는 버림 유지).

**결과.** `disaster-msg.test.ts` **25건 통과**(TZ=UTC·TZ=Asia/Seoul 양쪽) · 전체 `npm test` **432 pass / 0 fail** · tsc 0 · lint 0.

⚠️ **미결 — D-14.** `latLonToSido` 가 도(道) 현장을 인접 광역시로 오판한다(주요 34곳 중 17곳 오판·정확도 50%).
경기·경남·경북·전남 현장은 시·도 판정이 틀려 **재난문자 알림이 nearby 로 새어 미발송**된다.
현재 "알려진 결함 가드" 테스트로 고정해 둠. **처리 방침 결정 후 Phase D 진입.**

---

## Phase C — 실 API 어댑터·캐시 ⬜ (Phase 0 선행)

- [ ] `serviceKey()` — `SAFETYDATA_SERVICE_KEY` 없으면 `null` → **목업 폴백**(`kma.ts` 정책 답습)
- [ ] `fetchDisasterMsgs()` — 실 API 호출 → `normalize()` 입력과 **동일한 배열** 반환
- [ ] `source: "live" | "mock"` 구분 반환 (알림 발사 게이트에 필수 — D-11)
- [ ] 인메모리 캐시 TTL **15분** (`kma.ts` 의 `globalThis` 맵 패턴 재사용 — D-12)
- [ ] `numOfRows` — 지역 필터 파라미터가 없으면 200~300 (호우 상황 대비)
- [ ] SN 집합 중복 제거 — **증분 커서 금지**, 신선도 윈도우와 같은 기간만 보관 (D-08)
- [ ] 목업/실API 산출 형태가 동일한지 대조 테스트

**완료 판정.** 키 없을 때 목업 200 · 키 있을 때 live 200, 두 응답 형태 동일.

---

## Phase D — 라우트·알림·크론 ⬜

- [ ] `app/api/disaster-msg/route.ts` — `GET ?lat=&lon=` (`kma-warning/route.ts` 구조 답습)
  - [ ] `lat`/`lon` 유한값 검증 → 없으면 400
  - [ ] 알림 발사 조건 = `source === "live" && (verifyBasicAuth || cronAuth)` (D-11)
  - [ ] 무인증 조회는 허용하되 `console.warn` 후 발사 건너뜀
- [ ] `notifyEnvAlerts()` 연결
  - [ ] `itemKey = "disaster:<유형>"` — **SN 금지** (D-09)
  - [ ] `severity` — 긴급재난 → `danger` / 안전안내 → `caution`
  - [ ] `detail` — 발령시각 · 지역 · 본문
  - [ ] **★ 화이트리스트 전 유형을 매번 넘긴다** — 신선한 문자 없는 유형은 `normal` (D-07)
        (빠뜨리면 유형당 알림이 **딱 한 번만** 가고 영영 안 간다)
- [ ] 알림 억제 테스트 — 같은 유형 연속 폴링 시 1회만 발송, 신선도 만료 후 재발령 시 다시 발송
- [ ] `app/api/cron/env-check/route.ts` — `/api/disaster-msg` 자체 호출 추가(좌표 조회는 기존 재사용)
- [ ] 관제웹 표시 — 현장 시·도 발령분 + 인근 시·도는 "참고" 배지

**완료 판정.** dev 에서 목업으로 카드 표시 + 텔레그램 1회 발송·2회차 억제 확인.

---

## Phase E — 검증·배포 ⬜

- [ ] `pnpm typecheck` 0건
- [ ] `pnpm lint` 0건 (**빼지 않는다** — 과거 Cloud Build 에서만 깨진 전례)
- [ ] `pnpm test` 전건 통과
- [ ] `git fetch` — origin 전진 확인(병렬 세션 레이스)
- [ ] `/deploy` 절차로 빌드 → 배포 → 라이브 HTTP 200 + 카드 셀렉터 검증
- [ ] 배포 후 `SAFETYDATA_SERVICE_KEY` 시크릿 주입 확인(누락 시 조용히 목업으로 떨어진다)
- [ ] Cloud Scheduler 크론 1회 수동 실행 → 로그로 호출 확인

**완료 판정.** 라이브에서 실 API `source: "live"` 응답 + 호출 카운트가 일 제한 안.

---

## 보류·후순위

- [ ] 정정 발령(`MDFCN_YMD ≠ REG_YMD`) 처리 — 샘플 0건이라 미구현, 로그만 (D-08)
- [ ] 멀티 현장 — 작업자가 흩어지면 GPS 평균이 무의미해진다. 현장별 좌표로 전환 필요 (D-05 한계)
- [ ] 시·군·구 단위 정밀 매칭 — 지금은 의도적으로 시·도 고정 (D-05)
- [ ] 고정 아웃바운드 IP 확보 — Cloud NAT 상시 과금이라 보류 (D-13)
