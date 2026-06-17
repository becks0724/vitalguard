# KOSHA OpenAPI 관제 웹 연동 — 플랜·체크리스트·핸드오프

> 2026-05-31 착수. 발표용 프로토타입 트랙. **①+② 먼저** 적용(③ 국내재해사례는 이후).
> 인증키(`KOSHA_SERVICE_KEY`) 발급 전까지 **목업 fallback** 으로 데모 동작, 키 연결 시 실 API 자동 전환.

## 적용 대상 (사용자 결정: ①+②)

| # | API | data.go.kr | callApiId | 관제 웹 배치 | 상태 |
|---|---|---|---|---|---|
| ① | 건설현장 안전 신호등 | 15139182 | 1020 | WeatherStrip↔캐러셀 사이 `KoshaSafetyLightPanel` (빨강/노랑/초록 집계) | 목업 동작 ✅ |
| ② | 사고사망 게시판 | 15119137 | 1040 | 동 위치 `KoshaAccidentTicker` (마퀴 속보) | 목업 동작 ✅ |
| ③ | 국내재해사례(업종별) | 15121001 | (고정) | 보류 | 미착수 |

## 구현된 것 (이번 세션)

- `app/lib/kosha.ts` — 공통 클라이언트. env 키 게이트 + 30분 캐시 + 목업 fallback + tolerant 필드 추출(`pick`/`extractRows`).
- `app/api/kosha/safety-light/route.ts`, `app/api/kosha/fatal-accidents/route.ts` — 프록시 GET.
- `app/components/KoshaSafetyLightPanel.tsx` — 전국 신호등 3색 집계 패널(다크/라이트, "샘플/KOSHA 실시간" 배지).
- `app/components/KoshaAccidentTicker.tsx` — 산업재해 속보 마퀴(`wx-marquee` 재사용, 빨강 톤, 샘플 [샘플] 접두).
- `DemoDashboard.tsx` — 위 둘 배치(히어로 레드박스 미사용).
- `.env.example` — `KOSHA_SERVICE_KEY` 항목 + 발급 안내.
- 검증: `tsc --noEmit` EXIT=0 · 두 라우트 목업 200 · dev 렌더 포함 · dev 로그 에러 0.

## ⚠ 키 발급 후 확정 필요 (실 API 전환 시 반드시 검증)

코드에 `⚠` 주석으로 표시. **추측값이므로 실응답으로 교정 필수**:

1. **엔드포인트 host/path** — `KOSHA_BASE`(`apis.data.go.kr/B552468`)·`/safetyLight`·`/accidentDeath` 는 추정. data.go.kr 활용가이드(.docx)·Swagger 의 정확한 경로로 교체.
2. **응답 필드명** — `normalize`/`pick` 후보 키(`signalColor`/`title`/`regDate` 등)를 실 응답 JSON 키로 확정.
3. **신호등 색 매핑** — `getSafetyLight` 의 정규식(`red|빨|적|위험|3` 등)을 실제 등급 코드 체계에 맞춤.
4. **JSON 여부** — 둘 다 문서상 JSON. `type=json` 파라미터로 강제했으나 일부 data.go.kr API 는 XML 기본 → 실패 시 XML 파서 추가.
5. **인증키 인코딩** — Decoding 키 사용 가정. Encoding 키면 `serviceKey` 이중 인코딩 이슈 주의(이미 인코딩된 키는 `searchParams.set` 이 재인코딩 → 깨짐 → 그 경우 raw 문자열 직접 부착).

## 키 발급·연결 절차

1. data.go.kr 로그인 → 15139182·15119137 각각 **활용신청**(자동승인, 분 단위).
2. 마이페이지 → 인증키(Decoding) 복사.
3. `apps/dashboard-web/.env.local` 에 `KOSHA_SERVICE_KEY=<키>` (커밋 금지, .gitignore 적용됨).
4. dev 재시작 → `/api/kosha/safety-light` 응답 `source` 가 `live` 인지 확인.
5. `live` 인데 counts 0 / items 빈 배열이면 → 위 ⚠ 1~5 항목 교정.

## 데모 프레이밍 주의

- 두 패널 모두 **전국 데이터**(우리 현장 아님) → 제목에 "전국" 명시(오해 방지, 이미 반영).
- 사망 속보는 톤이 무거움 → 도입부 경각심 용도, 상단 얇은 띠 권장(현재 캐러셀 위 배치).

## 2026-05-31 실연결 확정 결과 (인증키 발급 후 실응답 검증)

- **엔드포인트 규칙** — `https://apis.data.go.kr/B552468/<서비스>/get<서비스>`. base 단독(`/news_api02`)은 500, 오퍼레이션(`/getNews_api02`) 필요. 잘못된 오퍼레이션은 404 "API not found".
- **인증키** — Decoding 키. KOSHA 는 HTTP 200 으로 내리고 `header.resultCode` 로 성공/실패 전달(00=정상, 99=UNKNOWN_ERROR, 90=APICODE_ERROR, 80=INPUT-ERROR). → `assertNormal()` 로 비-00 강등.
- **사고사망 ✅ LIVE** — `news_api02/getNews_api02` + `callApiId=1040`. 실 필드 = `keyword`(제목, 날짜·지역 포함) · `contents`(HTML 본문) · `arno`(id) · `body.totalCount`. 응답 형태 `{body:{items:{item:[...]}}}`.
- **`getconstplan01` 은 다중 보드 게이트웨이** — callApiId: 1030 미디어 / **1040 사고사망** / 1050 기술지침 / **1060 국내재해사례(필드 business·keyword·contents·boardno)** / 1070·1080 certNo·BOARDNO 필요. 1010·1020 → UNKNOWN_ERROR.
- **건설현장 안전 신호등 ❌** — `callApiId=1020` 은 모든 파라미터/오퍼레이션 변형에서 `UNKNOWN_ERROR(99)`. APICODE 등록됐으나 KOSHA 백엔드 오류(우리 측 수정 불가). **결정(사용자) = 샘플 유지 + 30분 폴링마다 자동 재시도**(실패는 캐시 안 함 → 복구 시 자동 live 전환).
- **미래 옵션** — 신호등 미복구 지속 시 callApiId=1060(국내재해사례·건설업)로 패널 교체 가능(실데이터, 단 신호등 색상 아님).
- `KOSHA_SERVICE_KEY` 는 `apps/dashboard-web/.env.local`(gitignore, 커밋 제외)에 보관.

## 2026-06-01 세션12 — 국내재해사례 1060 적용 + PDF 미리보기 한계 확정

- **국내재해사례 ✅ LIVE** — `news_api02/getNews_api02` + `callApiId=1060`(totalCount 6,334). 필드 = `keyword`(제목)·`business`(업종 제조/건설/서비스/조선)·`contents`(경위 평문)·`boardno`(=포털 `pstNo`)·`atcflcnt`(첨부 개수). 응답은 `{body:{items:{item:[...]}}}`(헤더 없는 성공 → `assertNormal` 통과). `getAccidentCases()` + `/api/kosha/accident-cases` 프록시 + `detail`(경위 전문 2000자) 매핑.
- **전용 End Point `disaster_api02` = Forbidden** — 사용자가 준 `https://apis.data.go.kr/B552468/disaster_api02`(오퍼레이션 `getdisaster_api02`)는 **현재 키로 모든 callApiId에서 Forbidden** = 해당 활용신청 미승인. 승인 시 `KOSHA_PATH.accidentCase`만 교체. 미승인 동안은 동일 데이터 주는 1060(news_api02) 사용.
- **업종 분포(1060, 100건)** — 건설업 55 · 제조업 37 · 서비스업 5 · 조선업 3.
- **★ 인앱 PDF 미리보기 = 불가 확정** — 단계별 실측 결론.
  - 파일 엔드포인트 `https://portal.kosha.or.kr/api/compn24/auth/stdtboard/getImage.do?bbsId=&pstNo=&bbsAtcflNo=` 는 **토큰 없이 공개 GET**(1040 본문 박힌 이미지로 137KB 수신 확인). "auth" 경로는 로그인 게이트 아님.
  - 그러나 **1060 API는 첨부 `bbsId`/`bbsAtcflNo`를 안 줌**(본문도 평문, URL 미포함). 1040은 본문 HTML에 인라인 이미지 URL이 박혀 있어 가능하지만 그건 PDF 첨부가 아닌 이미지.
  - 첨부 ID는 포털 내부 RPC `process.do/boardDetail`로만 획득. 요청 형식 해독 = **`_JSON=`(URL 인코딩 JSON) 폼 파라미터**, 봉투 `{common:{data:{tboard:{systemCd:"20",channel,bbsId,bbsGrpId,serviceId:"boardDetail"}}}, service:{data:{bbsId,pstNo,bbsAtcflNo}}}`. 토큰 게이트는 없으나 **권한 검사에서 `msg_913 "권한이 없습니다"`** → KOSHA 인증 세션 필요(서버 재현 = 비공식·취약·ToS 리스크).
  - **결정 = 인앱 PDF 직접 임베드 비범위.** 외부 링크/팝업 버튼도 사용자 요청으로 제거, 재해사례는 경위 전문 팝업만 유지. (1040 사고사망 첨부 이미지는 공개 접근 가능하나 별건.)
- **UI** — 현장정보 박스 = `WidgetCarousel`(좌우 화살표, ‹ 제목 N/M ›, 9초 자동순환) [현장정보 ↔ 국내재해사례]. 항목 클릭 → 경위 전문 팝업(SOS 모달 패턴, `createPortal` body 렌더로 캐러셀 transform 회피). 커밋 `b3352b3`(캐러셀+1060)·`4922064`(경위 팝업).
