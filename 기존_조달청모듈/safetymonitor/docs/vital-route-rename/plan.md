# 수집 경로에서 "mock" 지우기 — 계획 (2026-08-16 수립 · **착수 안 함**)

> **한 줄 —** 프로덕션 생체 수집 경로 이름이 `/api/mock/vital` 이라 **우리 문서와 테스트
> 인프라가 그것을 목업으로 알고 있다.** 동시에 구 iOS 앱이 그 경로를 하드코딩하고 있다.

**사용자 결정(2026-08-16) = 지금 착수하지 않는다.** 운영은 정상이고 위험은 전부 조건부다.
이 문서는 착수할 때 **다시 파지 않기 위한** 기록이다. 아래 사실은 전부 그날 코드·라이브로 확인했다.

---

## 1. 목표 둘

1. **안정적 송수신 유지** — iOS/워치 → 서버 → DB. ⚠ 일원화가 이걸 *개선*하지는 않는다.
   이미 정상이다(08-16 실측 12건/분 · 유실 0 · 폰 강제종료 중 무공백). 기여하는 것은 **오염 차단**이다.
2. **"mock" 이름 제거** — 아래 §3 의 오해가 실재 피해를 냈다.

## 2. 지금 이대로도 운영은 정상이다 (착수 보류 근거)

| 항목 | 확인 |
|---|---|
| 신규 앱 수집 | 12건/분 · 유실 0 · 폰 강제종료 중 무공백 |
| 관제웹 표시 | `DemoDashboard.tsx:3906` 2초 폴링 정상 |
| 라이브 라우팅 | `POST /api/app/vital` 401 · `GET /api/mock/vital` 401 · `POST /api/app-auth/login` 400 (전부 게이트 작동) |
| 테스트 | dashboard-web **106/106** 실행 · analyzers 4/4 · schemas 1/1 · **누락 0** |
| 가드 | 108/108 앵커 보유(08-15 감사) |
| 구 앱 | **07-31 이후 0건** · 토큰 401(APP_JWT_SECRET 08-11 회전) |

**남는 위험 셋은 전부 조건부·미래형이다.**

```
① 구 앱 데이터 혼입   누가 구 앱을 켜고 재로그인해야 발동   ← 유일하게 실피해
② 문서·테스트 오해    새 사람이 그 문서를 믿어야 발동
③ 테스트 글롭         누가 하위 디렉터리를 만들어야 발동
```
①의 선례 = 2026-07-26 팀원 앱이 관제웹 낙상 오탐을 만든 건. **DB 에 섞이면 조용하고 되돌리기 어렵다.**

## 3. "mock" 오해의 실물 증거 3건

```
docs/app-dashboard-read-contract.md:14
    "GET /api/mock/vital | 인증 없음(공개)"              ← 코드는 401 (08-13 d61c2d0 봉인)
harness/2-verify/e2e/profile_save_dialog_spec.py:55
    "/api/mock/vital 는 공개 합성데이터(접근 차단 아님)"   ← 인증 필수 실데이터
docs/audit-report-*.html
    "미인증 GET /api/mock/vital ... PII 유출"
```
**우리 테스트 인프라가 프로덕션 생체 수집 경로를 목업으로 알고 있다.**

## 4. 관련 코드 지도 (전부 실측)

### 신규 앱의 서버 접점 = 정확히 둘 · `/api/mock/*` 참조 0건
```
ios/Runner/VitalPipeline.swift:228   POST api/app/vital        수집
ios/Runner/VitalBridge.swift:119     POST api/app-auth/login   로그인
```
⟹ **어떤 안을 택해도 신규 앱은 무변경**이다(경로가 `/api/app/vital` 로 이미 분리돼 있다).

### 관제웹 참조 = 3줄
```
app/components/DemoDashboard.tsx:3906     fetch("/api/mock/vital")        2초 폴링
app/components/VitalHistoryPanel.tsx:157  fetch(`/api/mock/history?…`)
app/components/VitalHistoryPanel.tsx:184  fetch(`/api/mock/history?…`)
```

### `app/api/mock/` 내용 = 라우트 둘 + 본체 + 테스트 4
```
/api/mock/vital      수집 POST + 관제 GET   (route.ts — GET 73행 · POST 168행)
/api/mock/history    생체 이력 GET
store.ts             addSample·persistSample·recordAlert = 파이프라인 본체
*.test.ts ×4
```

### 구 앱 = `/api/mock/vital` 하드코딩 14곳
```
apps/VitAlGuard-iOS-WatchOS-App/project.yml:94                RECEIVER_URL_DEFAULT
apps/VitAlGuard-iOS-WatchOS-App/Phone/Shared/VitAlGuardShared.swift:110,120,122
그 밖 /api/mock/gas ×1 · /api/mock/cctv ×1
```
⚠ **구 앱은 `/api/app-auth/login` 도 갖고 있다**(`VitAlGuardPreviewApp.swift:4685`) —
토큰 회전만으로는 영구 차단이 아니다. 재로그인하면 다시 POST 한다.

### ⚠⚠ source 로는 구/신 앱을 구분할 수 없다
```
구 앱 워치  VitAlGuardShared.swift:223   "VitAlGuard-WatchVitals"
신규 앱     VitalPipeline.swift:221      "VitAlGuard-WatchVitals"   ← 같은 값
```
**source 차단은 신규 앱을 함께 죽인다.** 구 폰 자체(`VitAlGuard-iPhone`)만 막을 수 있고 워치 경로는 못 막는다.
⟹ **확실한 차단 수단은 경로뿐이다.**

## 5. 채택안 = B (개명) — A(이동)는 기각

| | A안 `app/vital` 로 이동 | **B안 `mock` 개명 (채택)** |
|---|---|---|
| 구 앱 차단 | 405 | **404** (경로 소멸) |
| **"mock" 제거** | ❌ **GET 경로에 남음** | ✅ **완전 소멸** |
| 신규 앱 | 무변경 | 무변경 |
| 관제웹 | 무변경 | 3줄 |

**A 기각 사유** — 목표 2 를 달성하지 못한다. `/api/mock/vital` GET 이 남으면 §3 의 오해도 남고
나중에 또 손대게 된다. B 의 추가 비용은 관제웹 3줄뿐이다.

### 목표 구조
```
app/api/app/vital/route.ts        본체 (GET+POST)     /api/app/vital     ← 앱 무변경
app/api/vital/route.ts            export { GET }      /api/vital         ← 관제 읽기
app/api/vital/history/route.ts                        /api/vital/history
app/api/vital/store.ts            파이프라인 본체
app/api/mock/                     삭제
```
부수 이득 = **수집 POST 가 `/api/app/vital` 하나로 좁혀진다**(지금은 두 경로가 받는다).

## 6. ★ 최대 리스크는 가드가 아니라 테스트 글롭이다

착수 전에 이 순서를 지킬 것. **처음 평가와 뒤바뀌었다.**

### 가드 4개 — 전부 큰 소리로 실패한다 (안전)
```
lib/2026-07-29-worker-id-binding.guard.test.ts:28      readFileSync ×1  게이트 형태 /!claims\?\.workerId/
lib/2026-07-29-hyperclova-secret-boundary.test.ts:26   readFileSync ×1  인증 4건(105·109·113·114·115행)
lib/client-ip.guard.test.ts:66                         ★ 앵커
lib/app-auth-diagnosis.test.ts:75                      readFileSync ×1  401 블록 action/reason
```
①②④는 **존재 확인형**(`assert.match`)이라 파일이 없으면 throw, 스텁이어도 match 실패.
③만 금지형인데 **08-15 감사가 바로 그 이유로 앵커를 박아뒀다.**

⚠ **유일한 조용한 약화** = ③ 앵커가 `app/api/mock/vital/route.ts` 를 가리킨다.
그 파일이 사라지면 앵커가 실패해 드러나지만, **스텁으로 남기면 통과하면서 의미가 빈다.**
**앵커를 새 위치로 옮길 것.**

### 테스트 글롭 — 조용히 안 돈다 (위험)
```json
"test": "tsx --test lib/*.test.ts \"app/api/mock/*.test.ts\" \"app/lib/*.test.ts\""
```
`app/api/mock/` 하드코딩 + **1단계 깊이만**. 옮기면 **실패가 아니라 미실행**이다.
걸린 파일에 `vital-batch-limit.test.ts`(옮기려는 POST 의 배치 상한 검사)가 있다.

**실증 (scratch)** — 판별력 있는 관측은 이것뿐이다.
```
                                      기존 위치만  옮긴 위치 포함
app/api/mock/*.test.ts                   1건          (놓침)
app/api/**/*.test.ts                     2건          (잡음)
```
⚠ *"`**` 로 바꿔도 866 동일"* 은 **정보가 없는 관측**이다 — 파일이 안 움직였으니 당연하다(L-68).

**해결안 — 실측 확인됨**
```json
"test": "tsx --test \"lib/**/*.test.ts\" \"app/**/*.test.ts\""
```
`866 pass / 0 fail` · 1.25초 · 글롭 3→2 · `.next`·`node_modules` 혼입 없음(둘 다 `app/`·`lib/` 밖).

**현재 노출 = 0** — dashboard-web 106/106 · analyzers 4/4 · schemas 1/1.
지금 새는 것은 없고 **경로를 건드리는 순간 발동하는 잠재 결함**이다.
같은 1단계 글롭이 `analyzers`·`schemas` 에도 있다(`src/*.test.ts`) — 함께 할지는 선택.

## 7. 실행 순서 (착수 시)

- [ ] **1. 테스트 글롭을 재귀로 — 단독 커밋.** 866 유지 확인.
      ★ 먼저 분리해야 나중에 수가 변했을 때 **글롭 탓인지 개명 탓인지** 갈린다
- [ ] **2. 개명** — 파일 이동 · import 조정 · 관제웹 3줄 · 가드 4개 경로 · **③ 앵커 새 위치로**
- [ ] **3. 음성 대조** — 새 위치 파일을 비워 가드 4개가 **각자** 실패하는지(사본에서 · 공유 트리 금지)
- [ ] **4. 검증** — tsc · lint · test 866 · `next build`
- [ ] **5. 배포 후 실측** — `POST /api/mock/vital` → **404** · `POST /api/app/vital` → 401(무토큰) ·
      `GET /api/vital` → 401 · 관제 화면 생체 표시 정상 · 신규 앱 수집 무중단
- [ ] **6. 문서 정정 3곳** — §3 목록

### import 조정 (실측)
`route.ts` 를 `app/api/mock/vital/` 밖으로 옮길 때 **깊이가 같으면 1줄만 바뀐다.**
```
../../../../lib/*      깊이 동일 → 무변경
../../cctv/ingest      깊이 동일 → 무변경
../store               ← 이것만 조정
```

## 8. 검증에 쓸 실증 (이미 확보)

**Next.js 405 거동 — 라이브 실증 완료.** 추측 아님.
```
POST /api/radar   405     ← GET 만 export (route.ts:13)
GET  /api/radar   200     ← 대조군
```
⟹ 경로에서 POST export 를 빼면 405, 경로 자체가 사라지면 404.

## 9. 하지 않기로 한 것

- **source 기반 차단** — 구/신 앱이 같은 값이라 신규 앱을 함께 죽인다(§4).
- **구 앱 소스 삭제** — 팀 소유 자산이고 이번 목표와 무관하다. 서버 경로만 닫는다.
- **신규 앱 경로 변경** — `/api/app/vital` 은 이미 표준이고 잘 돈다. 바꾸면 앱 재빌드·재설치가 붙는데
  얻는 것이 이름뿐이다.
- **`lib/` 로 파이프라인 이동** — `store.ts` 를 `lib/vital-store.ts` 로 빼는 안. 참조 4곳 + 가드가
  걸려 범위가 커진다. 개명만으로 목표가 달성되므로 별도 트랙.
