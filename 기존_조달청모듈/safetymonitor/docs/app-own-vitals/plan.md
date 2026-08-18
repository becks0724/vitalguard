# 폰 앱 본인 생체 조회 — 계획 (2026-08-18 수립)

목적 = **관제웹이 계산하는 파생 지표를 작업자 본인 폰에서도 보게 한다.**
단 본인 것만. 관제 조회(`GET /api/monitor/vital`)는 전 작업자 + PII 라 폰에 열 수 없다.

## 1. 왜 새 엔드포인트인가

`GET /api/monitor/vital` 의 인가는 `verifyBasicAuth` 다 — **관제 세션 토큰 또는 오너 자격**만
통과하고 폰이 가진 앱 JWT(`verifyAppJwt` · `aud: vitalguard-mobile`)는 거부된다.
거기에 앱 JWT 를 받아들이게 만들면 **작업자 폰이 전 작업자의 생체·PII 를 보게 된다** —
권한 범위가 뒤집힌다. 그래서 본인 스코프 엔드포인트를 새로 만든다.

## 2. 스코프는 토큰이 정한다 (클라가 못 정한다)

```
로그인  app-login.ts:60  workerId = storedEmployeeId || `EMP-${username}` || null
        signAppJwt({sub, role, name, workerId})      ← 서명된 클레임
조회    verifyAppJwt(bearerToken(req))?.workerId     ← 이 값 하나로만 스코프
```

**URL·쿼리·본문으로 사번을 받지 않는다.** 받는 순간 남의 사번을 넣어 조회할 수 있다.
수집 라우트(`POST /api/app/vital`)가 이미 같은 패턴이다(`claims.workerId` + `bodyIsBoundToWorker`).

계정 전환은 토큰 교체로 자동 반영된다 — 실측 대조.

```
admin6861 → EMP-6861(사번 정식화)   admin7276 → EMP-admin7276(사번 미설정 폴백)
```

## 3. 무엇을 서버가 주고 무엇을 폰이 내는가

**서버만 낼 수 있는 것 → 엔드포인트**

| 값 | 왜 폰이 못 내나 |
|---|---|
| 심부체온 추정 | `estimateCoreTemp(HR 시계열)` · 창 180분 · **워밍업 30분**. 폰은 HR 이력을 안 들고 있다 |
| PSI | 추정 체온 파생. 두 곳이 계산하면 갈린다 |
| 스트레스 지수 | `computeStressIndex` + 모집단 베이스라인 상수. 이식하면 갈린다 |
| 누적 건수 | DB COUNT |

**폰이 내는 것 → 로컬 유지**

심박·SpO₂·이산 6종·걸음(이미 표시 중) · 신호 막대(샘플 나이) · 심박/SpO₂ 밴드 판정
(`vital_range.dart` 로 이미 이식 · 08-18).

## 4. ★ 별칭을 같은 방식으로 접는다

`worker_alias` 가 `EMP-admin6861 → EMP-6861` 로 접는다. 관제웹은 `workerAliases()` 로
접은 뒤 집계하므로 **엔드포인트도 같은 접기를 해야** 폰 누적과 관제웹 누적이 갈리지 않는다.
2026-08-12 에 이 접기를 빠뜨려 누적이 어긋난 전례가 있다.

## 5. ★ 선결 결함 — 계정을 바꿔도 화면 스냅숏이 안 지워진다

`PhoneReceiver.swift` 의 `snapshot` 에 `workerId`·`AuthStore` 참조가 **0건**이다.
`steps += `·`discreteCounts += ` 로 앱 프로세스 수명 내내 누적되고 배치마다 전량 emit 한다.
워치는 로그인 상태와 무관하게 계속 보내므로 로그아웃 중에도 자란다.

→ 지금 계정을 바꾸면 **직전 작업자의 걸음·이산 건수·마지막 심박이 새 계정의 값으로 보인다.**
업로드 큐는 이미 `purgeQueue` 로 폐기되므로(`VitalBridge.swift:158`) **서버 귀속은 안전**하고
**화면만 거짓을 말한다.** 이 트랙에서 함께 고친다.

## 6. 비범위

- 낙상 — 신규 앱에 수집 코드가 0줄이다(표시 문제가 아니라 수집 문제 · 별도 트랙 B2)
- 활동 에너지 — 약 4배 과대라 기존 가드가 표시를 금지(`heat-activity-axis` 미해결)
- 동료 작업자 조회 — 본인만(사용자 결정)
