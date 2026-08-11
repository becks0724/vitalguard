# 태풍 구역·반경 하이브리드 — 체크리스트

결정·근거는 [context-notes.md](./context-notes.md) T-01~T-08.

## Phase 1 — 판정 모듈 (`app/lib/typhoon-gate.ts`) ✅

- [x] `Zone` 타입 6단계 확장 (`watch`·`alert`·`emergency` 추가) · `ZONE_RANK` 갱신
- [x] 구역 경계 상수 (`ALERT_ZONE` 25°N/135°E · `EMERGENCY_ZONE` 28°N/132°E)
- [x] `classifyKmaZone(lat, lon)` — 비상 → 경계 → 감시 중첩 판정 (T-03)
- [x] 반경 판정을 `radiusZoneAt()` 로 추출 (현재/예보점 공용)
- [x] `tmToMs(tm)` — yyyyMMddHHmm(KST) → epoch ms (T-06)
- [x] ★ 예보 스캔을 무조건 실행하도록 순서 변경 (T-04)
- [x] 예보점에서 `rad25` 까지 판정 (T-05)
- [x] `GateResult` 확장 — `kmaZone` · `radiusZone` · `leadHours` · `EMPTY_GATE` 갱신

## Phase 2 — 테스트 (`app/lib/typhoon-gate.test.ts`) ✅ 12/12

- [x] 기존 기대값 수정 — 원거리 `none`→`watch` · 소멸예보 `none`→`emergency` · 예보 적중 `approach`→`gale`
- [x] `classifyKmaZone` 경계값 (25/28/132/135 정확히 위·아래 · 사각지대 없음)
- [x] 하이브리드 worst-of — 소형 태풍 비상구역(구역 승) / 대형 태풍 강풍역(반경 승)
- [x] ★ 회귀 — 현재 `emergency` 인데 예보가 `approach` 면 선행 점등 (T-04)
- [x] 예보 폭풍역 판정 (`rad25` 적중 → `storm` + `forecast` + `leadHours 72`)
- [x] `leadHours` — 24h/42h/72h · 자정·월 경계 · 파싱 실패 `null`

## Phase 3 — 화면 (`app/components/TyphoonTrack.tsx`) ✅

- [x] `ZONE_LABEL`·`ZONE_TEXT`·`ZONE_BANNER` 6단계 확장 (색 5종 · T-07)
- [x] `KMA_ZONE_LABEL` — 반경 축이 이겼을 때 구역 근거 병기용
- [x] `ZONE_FORECAST_ADVISORY` 신설 · `forecast` 로 분기 (T-05)
- [x] `fmtLead()` 리드타임 표시 (`D-N · 약 N시간 뒤`)
- [x] `watch` 는 배너 미표시 · 지도/푸터로만 (T-07)
- [x] `WorkStoppageBanner` → `ZoneBanner` 로 역할 확장 반영
- [x] 푸터에 리드타임·구역명 병기

## Phase 4 — 검증

- [x] `npx tsc --noEmit` — 0
- [x] `npm run lint` — 0 errors (경고 4건은 기존 `scripts/injection-test.mjs`, 무관)
- [x] `npm test` — 495 pass / 0 fail
- [x] dev(`localhost:3111`) 실화면 확인 — 6단계 전부 + 리드타임 + 배너 색

  | 단계 | 검증 방법 | 화면 결과 |
  |---|---|---|
  | `watch` | **라이브 실데이터**(제13호 돌핀 20.2°N·158.4°E) | 배너 없음 · 지도 표시 · 푸터 `감시구역 · 강풍반경 420km · 현장 3,496km` |
  | `alert` | 합성 27°N·130°E | `경계구역 진입 · 대비 검토 — 기상 정보 주시·가설물 상태 확인` |
  | `emergency` | 합성 30°N·128°E | `비상구역 진입 · 사전 대비 — 자재 결박·타워크레인 하강 준비·배수로 점검` |
  | `approach` | 합성 32°N·126.5°E | `영향권 접근 · 진입 대비` · 푸터에 `기상청 비상구역` 병기 |
  | `gale` | 합성 33.5°N·126.5°E | `강풍역 진입 · 작업중지 — 순간풍속 15m/s급` · 현장 188km |
  | `storm` | 합성 현장 직상공 rad25 120 | `폭풍역 진입 · 전면 작업중지` · 현장 0km |
  | 예보+리드타임 | 현재 emergency + 42h 뒤 approach | `영향권 접근 예보 · D-1 · 약 42시간 뒤 · 자재 결박·가설물 점검` |

  - 합성 검증은 `window.fetch` 래핑으로 `/api/typhoon` 응답만 교체(프로덕션·로컬 DB 무변경).
    ⚠️ 탭·캐러셀이 **CSS 숨김이라 전환해도 언마운트되지 않는다** → 리로드 직후 패치를 심어야 재fetch 를 잡는다.
    `page.addInitScript` 는 이 샌드박스에서 실패한다(`__transport_receive ... expected object`).
  - 신규 `sky` 배너 색 실제 생성 확인 — `rgba(14,165,233,0.1)` / border `0.3` (커스텀 토큰이 아닌 표준 팔레트라
    `semantic-down/<opacity>` 미생성 이슈와 무관).
  - 검증 후 override 해제 → 라이브(돌핀) 복귀 확인.

- [x] 커밋 `ae2f3ea`

## Phase 5 — 지도 프레이밍 수정 (사용자 육안 확인에서 드러남) ✅

배너·푸터 텍스트는 전부 맞았는데 **지도가 정보를 못 보여주고 있었다**. 근거 T-09·T-10.

- [x] `frameOf()` 분리 — 담을 줌이 없으면 **`null` 반환**(예전엔 조용히 `MIN_Z` 로 떨어져 마커가 화면 밖)
- [x] bbox 에 **현장 좌표 포함** + 폴백 2단(진로+현장 → 진로만 → 최소 줌)
- [x] 최소 스팬 `MIN_FIT_SPAN_DEG = 4` (진로점 1개 → z11 과확대 방지)
- [x] `MIN_Z` 3 → 2 (131px 캔버스에 31.5° 스팬)
- [x] 현장 마커 + 「현장」 라벨 · 모달에도 전달
- [x] 배너 축약 — 등급명 중복 제거 · 태풍명은 쌍태풍일 때만
- [x] 지도 `min-h-[88px]` 하한
- [x] 재검증 — tsc 0 · lint 0 error · test 495 pass

  | 케이스 | 지도 | 마커 | 줌 |
  |---|---|---|---|
  | 라이브 돌핀(watch·배너 없음) | 131×131 | 2/2 안 | z2 |
  | storm 현장 직상공 | 정상 | 2/2 안 | z4 |
  | 진로 5점 예보(배너 2줄) | 88×88(하한) | 6/6 안 · 진로선 1 | z2 |

## Phase 6 — 지도 최대화 · 텍스트 오버레이 · 태풍 심볼 (사용자 요청) ✅

- [x] `SquareFit` 제거 — 정사각 제한이 지도를 작게 묶고 있었다(인라인 **131×131 → 402×194**)
- [x] 인라인 — 관측값 3종 + 출처/판정 푸터를 **지도 위 오버레이**로(그라데이션 + 흰 글씨)
- [x] 모달 — 지도가 팝업 본체를 채움(`h-[72vh]` · **510×778**) · 관측값 `big` 활자(14→18px)
- [x] `ZONE_TEXT_ON_MAP` — 지도 위에서는 밝은 톤(라이트 모드 색은 위성 배경에서 안 읽힌다)
- [x] `TyphoonMarker` — 붉은 점 → **회전하는 태풍 나선**(SMIL `animateTransform` 14s)
      · 어두운 외곽 → 흰 테두리 → 빨강 본체 3겹으로 위성 배경에서 분리
      · 예보/관측 지점은 작은 점 유지, 현재 위치만 심볼 · 인라인 30px / 모달 44px
- [x] `footerContent(onMap)` — 지도가 있으면 오버레이, 없으면(IdleNoThreat·TrackingStopped) 기존 위치
- [x] tsc 0 · lint 0 error · test 495 pass · dev 실화면 인라인·모달 스크린샷 확인

## Phase 7 — 태풍 이동 궤적 (예상경로 조사 → 관측 궤적 채택) ✅

기상청 예상경로 오버레이 가능성 조사 결과와 결정은 T-12·T-13.

- [x] `getTyphoonInfo` 원본 전수 확인 — 통보문 10건 전부 1행(예보점 없음)·전체 필드 확인
- [x] 공식 진로도 `img` 확인 — 700×550 PNG·5일 예상경로+70% 확률반경 포함, **오버레이는 부적합**
- [x] 진로 구성 변경 — 관측점 전부 + 최신 통보문 예보점(낡은 예보 제외·관측 우선 dedup)
- [x] `pickCurrentIndex` — 최근접 → `tmFc` 이하의 마지막(현재는 언제나 관측점)
- [x] 화면 — 지나온 경로 **실선** / 예보 진로 **점선** 분리 · 모달 안내 문구 갱신
- [x] 테스트 3건 추가(낡은 예보 제외 · 최신 예보 유지 · 관측 우선) — test 497 pass
- [x] dev 확인 — 인라인 402×194 · 실선 1개(관측 10점) · 마커 11/11 화면 안 · 점선 0(예보 없음)
- [x] 확대 팝업 마감 — 컨트롤 버튼 28→**40px**(`⤾`→`↺`) · 줌 뱃지를 하단→**좌상단**
      (하단 오버레이에 반쯤 가렸다) · 팝업 폭 `max-w-lg`→**`max-w-2xl`**

  ⚠️ 폭 확대는 취향이 아니라 **퇴행 수선**이다 — 궤적이 쌓이며 경도 스팬이 40°로 넓어지자
  512px 에서 `z4` 가 안 들어가 **`z3` 으로 떨어져 호주까지 나왔다**. 672px 에서 `z4` 복귀(670×778).
  **진로점이 늘면 프레이밍 줌이 내려간다** — 궤적 길이와 지도 폭은 묶여 있다.

## Phase 8 — 기상청 예보 진로·확률반경 연동 ✅

추천안 ①(예보 데이터 수급) 실행. 근거 T-14~T-16.

- [x] 오퍼레이션 탐색 — `getTyphoonFcst` 발견(`tmFc`+`typSeq` **둘 다** 필수)
- [x] `parseForecastItems` — 통보문과 필드명이 다르다(`typLat`→`lat`·`typTm`→`tm`)
- [x] `mergeForecast` — 관측 궤적 + 예보 진로, 같은 시각은 관측 우선
- [x] `attachForecasts` — 태풍별 독립 호출(하나 실패해도 나머지 유지·예보 부재는 정상 상태)
- [x] `radPr`(70% 확률반경) 판정 반영 — **가산이지 대체가 아니다**(T-15)
- [x] 캐시 키 `active-v2` → `active-v3`(T-16)
- [x] 테스트 1건 추가 — 확률반경 가산/소멸예보 미가산 — test 504 pass
- [x] dev 확인 — **진로점 17개(관측 10 + 예보 7)** · `radPr` 40→440km
      · 배너 **「경계구역 진입 예보 · D-5 · 약 120시간 뒤」** · 지도 실선 10점 + 점선 8점

  ★ 첫 요청의 대응 타임라인(5일 전 진로 인지 → 비상구역 D-1~2 → 특보 작업중지)이
  실제로 작동한다. 지금 D-5 단계가 그 첫 칸이다.

- [x] 확률반경 원 시각화 — `kmToPx()`(위도별 메르카토르 축척 보정) · 예보점에만 · **확대 팝업 전용**
      (인라인 402×154 에서는 원 7개가 겹쳐 지저분하다) · 맨 아래 레이어로 깔아 진로선·마커를 안 가림
      · 범례에 **"중심이 있을 범위, 강풍 범위 아님"** 명시(T-15 혼동 방지)
      · dev 실측 반경 **4·9·12·15·21·33·50px**(40→440km) — 예보가 멀어질수록 원이 커진다

## Phase 10 — 배포 ✅ (`00204-4b8` → `00205-bc6`)

- [x] 선검증 typecheck 0 · lint 0 error · test 505 pass
- [x] push(`859ca0e`) · pre-push 훅 typecheck 통과
- [x] 빌드 `ad4d30c4`(3M58S · digest `4ab52ac9`) · `_AI_URL` 치환 포함
- [x] **L-09 3자 일치** — `BUILT` = `HEAD` = `origin/main` = `859ca0e`
- [x] 배포 후 별도 확인(L-20) — `revisions list` + `describe` 로 트래픽 `00205-bc6` 100% ·
      서빙 digest = 빌드 digest · env 25 보존 · HTTP 200(0.08s)
- [x] 라이브 기능 검증 — `/api/typhoon` 진로점 17(관측 10 + 예보 7) · `radPr` 40→440km ·
      화면 실선 10점 + 점선 8점 · 현장 마커 y=88 · 배너/푸터 중복 없음
- [x] `harness/5-observability/run-log.md` 기록(로컬 전용)

★ L-20 은 이번엔 **맞았다**(새 리비전을 정확히 지목·트래픽 실제 전환). 가끔 맞는 쪽이 항상
틀리는 것보다 위험하므로 대조 절차는 결과와 무관하게 유지한다.

## Phase 9 — 경보 배너도 지도 위로 · 중복 제거 ✅

- [x] `ZoneBanner` 를 지도 컨테이너 안 상단 오버레이로 이동 · `ZONE_BANNER_ON_MAP`(반투명 검정 + 등급색)
- [x] **푸터에서 등급·리드타임 제거** — 배너와 글자 그대로 중복이었다
      (`경계구역 진입 예보 · D-5 · 약 120시간 뒤` 가 한 화면에 두 번).
      단 배너가 없는 감시(watch) 단계에서는 푸터가 유일한 표시이므로 그때만 남긴다.
- [x] ★ `padTop` — 배너가 **현장 마커를 덮고 있었다**(실측 마커 y=34 · 배너 하단 40px).
      가용 높이를 줄여 줌을 정하고 중심을 북쪽으로 밀어 콘텐츠를 배너 아래 중앙에 둔다.
      **줌만 낮추면 여전히 상단이 가린다** — 중심 이동이 함께 있어야 한다.
      수정 후 마커 y=34 → **88**(`siteHidden: false`).
- [x] 지도 154 → **194px**(배너가 별도 행을 먹지 않으므로) · tsc 0 · lint 0 · test 505 pass
- [x] **확대 팝업에도 같은 배너** — 팝업에는 등급·리드타임이 아예 없어서 확대하면 정보가 사라졌다.
      좌우 여백(`pl-12 pr-14`)으로 줌 뱃지(좌상단)·확대축소 컨트롤(우상단)을 피한다 —
      전체 폭으로 깔면 배너가 버튼을 덮어 **누를 수 없게 된다**(실측 `ctrlCovered: false` 확인).
      `padTop 62` 로 현장 마커도 가리지 않는다(배너 하단 42px · 마커 y=293).

## Phase 11 — 태풍특보 연동 + 매직넘버 실측화 ✅

**③ 태풍특보 연동** — 같은 화면에 공식 특보 데이터가 있는데 이 패널만 안 보고 있었다.

- [x] `/api/kma-warning?lat&lon` 에서 **`태풍` 포함 특보만** 필터(통보문과 같은 30분 주기)
- [x] 배너 제목 앞에 `태풍주의보 발효 · ` · 푸터에도 병기(배너를 못 볼 수 있다)
- [x] ★ **특보가 발효 중이면 감시(watch) 단계여도 배너를 띄운다** — 공식 특보는 작업중지의
      법적 근거라 자체 판정이 낮다고 화면에서 사라지면 안 된다. 감시/밖은 배너 색이 비어 있어
      경계(alert) 톤을 빌린다.
- [x] 자체 fetch 방식 유지 — `WeatherStrip` 도 같은 라우트를 자체 호출하는 기존 패턴이고,
      `notifyEnvAlerts` 가 전이 판정을 하므로 호출이 늘어도 알림이 중복 발사되지 않는다.
      ⚠️ 다만 `DemoDashboard` 가 이미 같은 라우트를 호출해 `activeWarningTypes` 를 갖고 있다
      (`DemoDashboard.tsx:1867·4263`) — **prop 으로 내리면 호출을 줄일 수 있다**(후속 여지).

**⑤ 매직넘버 실측화** — ③이 곧 ⑤의 문제를 만들었다(특보 라벨이 붙어 배너가 길어진다).

- [x] `padTop` 고정값(인라인 46 · 팝업 62) → **`useOverlayHeight()` 실측**(배너 높이 + 여백)
      · 고정값이면 배너가 2줄이 되는 순간 마커가 다시 가려진다
- [x] ⚠️ **callback ref 로 구현** — 배너는 조건부 렌더라 요소가 나타났다 사라진다.
      `RefObject + useEffect(deps)` 는 그 시점을 놓친다.
- [x] 검증 — 특보 주입 시 배너 34px · 하단 40px · 현장 마커 y=91 · **`siteHidden: false`**

**★ 사고 1건 — Rules of Hooks 위반으로 앱이 죽었다.** `useOverlayHeight` 를 `bannerShown` 계산
직후, 즉 **early return(`if (error)`·`if (!data)`) 뒤에** 두었다. 렌더마다 훅 호출 순서가 달라져
`Application error: a client-side exception` 으로 화면 전체가 죽었다. **tsc·lint·test 는 전부 통과했고**
브라우저를 열어서야 발견했다 — 훅 순서는 정적 검사로 안 잡힌다. → 훅은 조건·early return 과
무관하게 **최상단에서 무조건 호출**하고, 요소 존재 여부는 callback ref 로 다룬다.

**남은 매직넘버(의도적 유지)** — `min-h-[120px]`(지도 하한)·`MIN_FIT_SPAN_DEG 4`·`MIN_Z 2` 는
콘텐츠가 아니라 정책·지리 상수라 문구가 바뀌어도 흔들리지 않는다.
`min-h-[277px]`(신호등 문구에 묶임)은 다른 트랙 소유라 손대지 않았다.

⚠️ 이 트랙 밖 발견 — **로컬 dev 서버가 `cctv-fall-poller` 때문에 오염된다**

08-01 작업 중 3111 dev 서버가 **CPU 175~190% 로 4분 이상 무응답**이 되어 재시작했다.
재시작 로그에서 원인 후보가 드러났다.

```
[cctv-fall-poller] 기동 — /ai-cctv/cctv/stats2, 1500ms 주기
[cctv-fall-poller] 폴 실패(다음 주기 재시도)
  TypeError: Failed to parse URL from /ai-cctv/cctv/stats2   ← 1.5초마다 반복
```

`AI_URL` 이 상대 경로(`/ai-cctv`)라 **서버에서는 fetch 가 불가능**하다(절대 URL 필요).
그런데 폴러는 1.5초마다 재시도하며 매번 예외 + 스택 트레이스를 만든다 — 2시간 가동이면
약 4,800회다. 무응답의 확정 원인이라고 단정할 수는 없지만 유력하고, 최소한 **로그를 덮어
다른 문제의 진단을 방해한다**(이번에도 그랬다).

로컬에서 `NEXT_PUBLIC_AI_CCTV_API` 가 없을 때는 폴러를 아예 기동하지 않는 편이 맞다.
`cctv-ai` 는 현재 OFF 라 로컬 폴링은 어차피 무의미하다. **이 트랙 범위 밖이라 손대지 않았다.**

⚠️ 남은 것
- 배너가 길 때 지도가 `min-h` 하한(120px)에 걸리면 패널이 늘어나 `min-h-[277px]` 기준
  좌우 하단선 정렬이 어긋날 수 있다. 실사용 배너 길이에서 재확인 필요.
- **실시간 레이더 작동 불가는 이 트랙과 무관하고 코드 문제도 아니다** — 이 맥에서
  `api.rainviewer.com`(157.90.66.200) 으로 나가는 TCP 연결이 `ETIMEDOUT`(IPv6 는 `EHOSTUNREACH`).
  `curl` 은 200 인데 Node fetch 만 실패한다. **라이브 서버 `/api/radar` 는 정상 프레임을 반환**한다.
  화면 문구가 `프레임 없음` 이라 원인(업스트림 연결 실패)을 감추는 점은 개선 여지.

---

## 태풍 마커 회전 — SMIL → CSS ✅ (2026-08-04 · 배포 `00228-69g`)

사용자 제보 "지도에 태풍 심볼은 있는데 안 돈다".

**조사 — 마크업이 아니라 앱 환경 문제였다.**

```
SMIL 단독 재현      정상 (2.51초에 78.7도 — 14초/360도 비율과 일치)
SVG 구조·CSS 충돌   없음 (animateTransform 이 붙은 g 에 다른 transform 없음)
pauseAnimations     호출 없음
전역 애니 차단      없음 (prefers-reduced-motion 규칙은 .logo3d-badge 전용)
데이터 연결         정상 (13호 돌핀 · source live · currentIndex 10/18)
```

**원인** — SMIL 은 React 가 요소를 다시 만들 때마다 0도로 리셋된다. 이 지도는 `ResizeObserver` ·
`view` 갱신으로 리렌더가 잦아 **14초 주기가 늘 0도 근처**에 머문다 = 멈춘 것처럼 보인다.

**수정** — CSS 애니메이션(`@keyframes typhoon-spin`)으로 교체. 요소가 새로 생겨도 즉시 진행한다.

⚠️ **회전 중심은 구조로 해결했다.** SVG 에서 CSS `transform-origin` 은 `transform-box` 에 따라
기준이 달라 다루기 까다롭다 → 부모 `<g transform="translate(x,y) scale(s)">` 가 **태풍 중심을
원점에 맞추고**, 그리기 좌표(24×24)는 안쪽 `translate(-12,-12)` 로 되돌린다. 그러면
`transform-origin` 기본값(0 0)이 곧 회전축이라 아무것도 건드리지 않아도 중심에서 돈다.

**검증**
```
단독 재현   3초간 77.5도(기대 77.1) · 회전 중심 이동 0px
라이브 실측  4초간 102.9도(기대 102.9) · animationPlayState running · duration 14s
            중심 이동 0px · animateTransform 잔존 0건
```

💡 **세션 만료 모달 우회법** — 이날 브라우저 검증을 3회 이상 막았다.
`sessionStorage.clear()` → `reload()` 하면 모달이 사라지고 로그인 화면으로 돌아간다.
그다음 로그인 → 현장 입장 → 패널 클릭을 **단계마다 별도 스크립트로** 나누면 dev-browser
30초 상한에 걸리지 않는다(한 스크립트에 몰면 대시보드 로딩만으로 초과).

---

## Phase 11 — 일본 기상청(JMA) 참고 진로 (2026-08-06 · 결정 T-17)

- [x] 소스 조사 — JMA / Windy / ECMWF / JTWC 중 **JMA 만 채택**(Windy 는 태풍 트랙 API 자체가 없다)
- [x] 실 응답 실측 — `targetTc.json` → `TC{번호}/specifications.json` · 인증키 불필요
- [x] 태풍 매칭 규칙 확정 — 기상청 `typSeq` 13/14/15 ↔ JMA `typhoonNumber` 2613/2614/2615
- [x] 순수 파서 `app/lib/jma-typhoon-parse.ts` — 실황(`advancedHours===0`) + 예보 → `TrackPoint[]`
- [x] 회귀 10건 — 번호 정규화·시각 변환·시간순·실황 판정(문구 변경 내성)·확률반경·깨진 좌표 폐기·빈 진로 null
- [x] 클라이언트 `app/lib/jma-typhoon.ts` — 30분 캐시 · **throw 하지 않음**(실패 = 빈 배열)
- [x] `/api/typhoon` 에 `jma` 동봉 — 기존 필드 불변(구 클라이언트 무영향)
- [x] `SlippyMap` 에 `refTrack` prop — 청록 점선 + 어두운 외곽선, 기상청 선보다 **먼저** 그려 아래로
- [x] 범례 — `일본 기상청 참고 진로 · 판정 미반영 · 출처 気象庁 · MM/DD HH:mm 발표`
- [x] **판정 불변 확인** — `computeGate` 인자 변경 0 · JMA 는 렌더에만 흐른다

### 검증 (로컬 dev · 실 태풍 3개 발효 중)

```
API        기상청 13호 돌핀(17점) / 14호 구지라(6) / 15호 찬홈(11)
           JMA   13호 ドルフィン(14점) / 15호 チャンホン(7) / 14호 クジラ(1)
매칭       대표(13호) ✅ 14점 · 발표 2026-08-06 15:45 JST
진로 차이  같은 시각 2건 — 평균 32.3km · 최대 34.8km
팝업 SVG   #0f172a(외곽 w4 dash) + #38bdf8(참고 w2 dash) 각 14점
           #f87171 실선 10점(지나온) + #f87171 dash 8점(예보)  ← 기상청, 위에 그려짐
범례       "일본 기상청 참고 진로 · 판정 미반영 · 출처 気象庁 · 08/06 15:45 발표" · rgb(125,211,252)
인라인     폴리라인 #f87171 2개만 · 참고 문구 0건  ← 의도대로 팝업 전용
검사       tsc 0 · lint 0 · npm test 566 pass / 0 fail
```

### 이월

- **14호 구지라는 JMA 트랙이 1점** — TD(열대저압부)라 예보가 없다. `track.length > 1` 조건에
  걸려 참고선·범례가 안 뜬다(의도대로). 태풍으로 발달하면 자동으로 붙는다.
- **ECMWF 앙상블 스파게티** — 51개 멤버 진로로 불확실성을 보여줄 수 있으나 BUFR 디코딩에
  Python 사이드카가 필요하다. 실제로 필요해질 때 착수한다(운영 대상이 하나 늘어난다).
- **예보 시각이 서로 어긋난다** — 기상청 24/48/72h vs JMA 4/7/10/13…115h 라 같은 시각 대조가
  2건뿐이었다. 정량 비교를 계속하려면 시간 보간이 필요하다.

---

## Phase 12 — NASA GIBS Himawari 구름 오버레이 (2026-08-06 · 결정 T-18)

- [x] 미국·NASA 소스 조사 — JTWC(경로 O) / NHC(담당 아님) / NASA(예보 없음) / GIBS(위성영상 O)
- [x] GOES 서태평양 미커버 확인(404) → **Himawari 가 유일**
- [x] 레이어별 제공 줌 실측 — 적외 `Level6`(z6) · 가시 `Level7`(z7) · GeoColor·IMERG 없음
- [x] 순수 유틸 `app/lib/gibs-himawari.ts` — 시각 계산(70분 지연·10분 내림) · 타일 URL · 업스케일
- [x] 회귀 9건 — 시각 경계·지연 상수·z/y/x 순서·상한 초과 null·MatrixSet 분리·업스케일 배율
- [x] `/api/typhoon` 에 `himawariTime` 동봉(**서버 시각** — 클라 시계 어긋남 방지)
- [x] `SlippyMap` 에 구름 타일 레이어 — 위성 위·라벨 아래 · screen 합성 · opacity 0.8
- [x] ☁ 토글(꺼짐→적외→가시) · 켜짐 시 버튼 하늘색 + 시각·출처 표기
- [x] 업스케일 — 상한 초과 줌에서 상한 타일 확대(z7 512px · z8 1024px)
- [x] 팝업 전용 유지(인라인 구름 0건 확인)

### 검증 (로컬 dev)

```
토글 순환   꺼짐(0타일) → 적외 12/12 → 가시 12/12 → 꺼짐(0타일)
타일 줌     z4→4 · z5→5 · z6→6 · z7→6(512px) · z8→6(1024px)   ← 확대해도 구름 유지
시각        서버 06:30Z (요청 시각 07:41Z · 71분 전 → 10분 내림)
합성        mix-blend-mode screen · opacity 0.8 · 레이어 순서 위성→구름→라벨
인라인      구름 0 · 위성 8 · ☁ 버튼 없음
검사        tsc 0 · lint 0 · npm test 575 pass / 0 fail
```

### 이월

- **JTWC 참고 진로** — 가능하지만 이득이 작아 보류(T-18 근거). 필요해지면 영문명 매칭 +
  풍속 평균 시간 차이(1분 vs 10분) 처리가 전제다.
- **ECMWF 앙상블** — BUFR 디코딩에 Python 사이드카가 필요(T-17 이월과 동일).
- **투명도·인라인 포함 여부** — 실사용 중 붐빈다고 느껴지면 opacity 조정 또는 인라인 추가 재검토.

---

## Phase 13 — 소멸 태풍 구역 축 강등 (2026-08-11 · 결정 T-19)

- [x] 증상 확인 — 라이브 실응답으로 돌핀(소멸)이 찬홈(접근)을 밀어내는 것 재현
- [x] 원인 특정 — `classifyKmaZone` 반평면 정의(서쪽 한계 없음)에 T-08 로 기록된 한계
- [x] `GateTrackPoint` 에 `maxWindMs` 추가(`TrackPoint` 에 이미 있어 파서·서버 변경 0)
- [x] `TYPHOON_MIN_WIND_MS = 17` · `isBelowTyphoonStrength()` — 기상청 태풍 정의 기준
- [x] `computeGate` 현재 지점만 구역 축 제외(예보점·반경 축은 무변경)
- [x] `classifyKmaZone` 무변경 — 규정 구현은 그대로 두고 정책을 위에 얹는다
- [x] 회귀 5건 — 17m/s 경계 · 미제공 미강등 · 돌핀 재현 · 예보 미강등 · 다중 태풍 대표 전환
- [x] 실데이터 대조 — 라이브 `/api/typhoon` 응답을 수정 모듈에 통과(L-07)

### 검증

```
단위테스트   typhoon-gate 18 pass / 0 fail (기존 13 + 신규 5)
전체         tsc 0 · lint 0 errors
             dashboard-web 580 pass (575 + 5) · schemas 38 · analyzers 50 = 668 pass / 0 fail

라이브 실데이터 대조 (08-11 · 광주 현장 기준)
  제13호 돌핀    zone=none   tracking=false  kmaZone=none   현장 1,208km   ← 강등됨
  제15호 찬홈    zone=alert  tracking=true   forecast 36h   현장 1,510km   ← 대표 전환
  제16호 페이러우 zone=watch  tracking=true                  현장 3,007km
  화면 대표 = 제15호 찬홈 · 경계구역 진입 예보(36시간 후) · 배너 표시
```

### 이월

- **태풍 선택 UI** — 돌핀·찬홈·페이러우를 골라 보기. `liveList`·`gates` 가 이미 다중이라
  `active` 선택만 바꾸면 지도·상세·JMA 참고선이 따라온다. **경보 주체는 worst 유지**(보기와 분리).
- **확대 팝업 다중 진로** — 인라인(296px)은 경도 폭 49도라 1px당 16km 로 뭉개져 팝업 전용이어야 한다.
- **`발효 태풍 N개 감시` 카운트** — 강등 태풍 포함 여부, 선택 UI 와 함께 정리.

---

## Phase 14 — 태풍 선택 칩 (2026-08-11 · 결정 T-20)

- [x] 상태 분리 — 경보 주체(`active`·`gate`=worst) vs 보기 대상(`viewed`·`viewGate`=선택)
- [x] `disp = viewed ?? active ?? …` — 지도·관측값·JMA 참고 진로·확대 팝업이 함께 따라온다
- [x] 배너(인라인·팝업)는 `gate`·`alert*` 고정 — 보기 선택을 따르지 않는다
- [x] 푸터는 `viewGate`·`view*` 로 통일 — 발표시각과 등급·거리가 다른 태풍이 되지 않게
- [x] 등급 생략 예외(`viewDiffers`) — 배너가 남의 태풍 경보일 때는 푸터 등급을 남긴다
- [x] 지도/추적중지 분기는 `gate.tracking` 유지 — 소멸 태풍을 골라도 진로는 볼 수 있어야 한다
- [x] `TyphoonChips` — 등급 점(`ZONE_DOT`, ZONE_TEXT 와 같은 계열) + 선택 토글(다시 누르면 자동)
- [x] 소멸로 목록에서 빠진 선택은 자동 해제(`findIndex` 미발견 → 경보 대상)
- [x] `발효 태풍 N개 감시` 삭제(T-19 이월 해소) · 헤더 `외 N` 은 칩 없을 때만
- [x] 가드 테스트 5건 — 렌더 인프라가 없어 소스 불변식으로 고정
- [x] **가드 음성 대조** — 배너를 `viewGate` 로 / `disp` 에서 `viewed` 제거 → 각각 실패 확인 후 원복

### 검증

```
가드      typhoon-alert-view-split 5 pass / 0 fail (음성 대조 2건 통과)
전체      tsc 0 · lint 0 errors
          dashboard-web 585 pass (580 + 5) · schemas 38 · analyzers 50 = 673 pass / 0 fail
레이아웃  사이드 패널(296px·scale 0.87) · 캐러셀(min-h 277px) 둘 다 지도 min-h 120px 여유
```

### 이월

- **확대 팝업 다중 진로**(3단계) — 인라인은 경도 폭 49도라 뭉개져 팝업 전용.
- **브라우저 렌더 실측** — 로컬 dev 가 프로덕션 DB 의 `env_alert_state` 를 건드려(L-04) 돌릴 수 없다.
  프로덕션 로그인은 `ADMIN_PASSWORD` 회전으로 막혀 사용자 확인 필요.
