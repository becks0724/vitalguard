<!-- iOS 앱 → 관제웹 캘린더 미디어 업로드 계약(프리사인 PUT → 등록). 팀원 앱 구현 기준 문서. -->
# 앱 미디어 업로드 계약 — OCR 이미지/영상 → 관제웹 캘린더

iOS 앱(OCR/촬영)이 찍은 이미지/영상을 **네이버 클라우드 Object Storage**에 올리고, 관제웹 캘린더의 **촬영 날짜·시간 슬롯**에 자동 표시되게 하는 업로드 흐름이다.

- **서버 베이스** = `https://vitalguard-dashboard-569797426568.asia-northeast3.run.app`
- **인증** = 모든 요청에 `Authorization: Bearer <APP_UPLOAD_TOKEN>` 헤더(앱 빌드에 주입할 공유 토큰, 서버 `.env`/Secret 과 동일값).
- **저장** = 바이트는 서버를 거치지 않고 앱이 프리사인 URL로 **Object Storage에 직접 PUT**. 서버에는 메타데이터만 등록.

> ⚠️ `/api/mock/vital` 은 **생체 전송 전용**이다. 미디어는 아래 엔드포인트를 쓴다.

## ✅ 실제 사용 = 단일 `POST /api/app-media` (서버 relay)

팀원 앱은 **이 단일 엔드포인트**로 업로드한다(아래 2단계 프리사인은 대안). 앱이 이미지+메타를 한 번에 보내면 **서버가 Object Storage 업로드 + 캘린더 DB 등록**까지 처리한다.

```
POST /api/app-media
Authorization: Bearer <APP_UPLOAD_TOKEN>
Content-Type: multipart/form-data

file=<이미지/영상 바이트>               ← 파일 파트(필드명 무관, 어떤 이름이든 인식)
dateKey=2026-06-30                     ← (선택) 촬영 날짜 KST. 없으면 capturedAt/서버 KST 현재
capturedAt=2026-06-30T14:23:00+09:00   ← (선택) 촬영 시각 KST. 없으면 서버 KST 현재 → 캘린더 시각
roadAddress=광주광역시 광산구 …          ← (선택) 도로명 주소(앱이 역지오코딩해 전송)
latitude=35.169862                     ← (선택) GPS 위도(십진수)
longitude=126.863702                   ← (선택) GPS 경도(십진수)
workerName=장우진                       ← (선택) 작업자 이름
workerId=EMP-6861                      ← (선택) 작업자 사번/ID
ocrText=사진대지 … (앱 OCR 텍스트)      ← (선택) 원문 OCR 전체(대시보드에서 접어두기)
title=… / siteId=…                     ← (선택)
```

응답 `{ "ok": true, "media": { "id": "...", ... } }`.

- **파일** — multipart 의 파일 파트면 **필드명 무관**(`file`/`image`/`photo` 등 아무거나). 허용 = jpg/png/webp/heic/mp4/mov(파트 Content-Type 또는 파일명 확장자로 판별).
- **인증** — `Authorization: Bearer <APP_UPLOAD_TOKEN>`(권장). 헤더 `x-app-upload-token` 또는 폼 필드 `token` 도 허용.
- **★ 표시 정리** — 대시보드는 **촬영 시각·도로명 주소·GPS 좌표·작업자(이름·ID)** 4개 항목만 명시하고, `ocrText` 원문은 "원문 보기" 토글로 접어둔다. 이 4개 항목의 소스는 **① 앱 구조화 필드(있으면 우선) → ② `ocrText` 말미의 사진 하단 스탬프 파싱(폴백)** 순이다.
- **구조화 메타(권장·정확)** — 오인식 없는 정확한 표시를 위해 사진 하단 스탬프 정보를 **별도 form 필드로도 전송**하면 좋다. GPS는 십진수 위/경도, 도로명 주소는 앱이 좌표를 역지오코딩해 완성된 문자열로 보낸다.
- **스탬프 파싱(폴백)** — 구조화 필드 미전송 시 대시보드가 `ocrText` 말미의 카메라 스탬프에서 촬영시각(`[YYYY-MM-DD HH:MM:SS]`)·GPS(십진수 위/경도 쌍)·작업자ID(`EMP-####`)·도로명주소(시·도+구/동/로 줄)를 **best-effort 추출**한다([lib/ocr-stamp.ts](../apps/dashboard-web/lib/ocr-stamp.ts)). OCR 오인식이 잦으므로 정확도가 필요하면 구조화 필드 전송을 권장한다.
- **메타 필드명 변형 수용** — `dateKey`/`date`, `capturedAt`/`captured_at`/`time`, `roadAddress`/`address`/`addr`, `latitude`/`lat`, `longitude`/`lng`/`lon`, `workerName`/`uploader`/`name`, `workerId`/`worker_id`/`employeeId`, `ocrText`/`ocr`/`text` 등. 미전송 시 날짜·시각은 **서버 KST 현재로 폴백**(= 업로드 시각으로 캘린더 배치), 나머지 미전송 항목은 표시에서 생략.
- 서버가 받은 요청 형식을 `console.warn("[app-media] …")` 로그에 남김 → 필드명 정밀 매핑·디버깅용(Cloud Run 로그에서 확인).
- 트레이드오프 — 바이트가 **Cloud Run 경유**(프리사인 직PUT 아님). 이미지엔 무방, 대용량 영상이면 아래 2단계가 유리.

## 대안 — 2단계 프리사인 직업로드 (바이트 서버 미경유)

```
[앱] ──①프리사인 발급 요청── [서버]            (POST /api/calendar/media/upload-url)
[앱] ──②파일 직접 PUT──────── [Object Storage]  (①이 준 uploadUrl)
[앱] ──③메타 등록──────────── [서버]            (POST /api/calendar/media)
                                                 → 관제웹 캘린더가 GET 시 표시
```

### ① 프리사인 업로드 URL 발급

```
POST /api/calendar/media/upload-url
Authorization: Bearer <APP_UPLOAD_TOKEN>
Content-Type: application/json

{ "contentType": "image/jpeg", "dateKey": "2026-06-30" }
```

- `contentType` — 아래 허용 타입만. `dateKey` — 촬영 날짜(KST, `YYYY-MM-DD`). 저장 경로 정리에만 쓰임(선택, 없으면 `undated`).
- **허용 contentType** — `image/jpeg` · `image/png` · `image/webp` · `image/heic` · `video/mp4` · `video/quicktime`.

응답.

```json
{ "ok": true, "provider": "naver", "key": "calendar-media/2026-06-30/<uuid>.jpg",
  "uploadUrl": "https://kr.object.ncloudstorage.com/<bucket>/calendar-media/...?X-Amz-..." }
```

- `key` 를 ③에서 `storageKey` 로 그대로 넘긴다. `uploadUrl` 은 **10분** 유효.
- 스토리지 미설정 시 `503`, 토큰 불일치 시 `401`.

### ② 파일 직접 업로드 (Object Storage)

```
PUT <uploadUrl>
Content-Type: image/jpeg          ← ①의 contentType 과 반드시 동일
<원본 바이트>
```

- 인증 헤더 불필요(프리사인에 서명 포함). 성공 시 `200`.

### ③ 메타데이터 등록

```
POST /api/calendar/media
Authorization: Bearer <APP_UPLOAD_TOKEN>
Content-Type: application/json

{
  "dateKey": "2026-06-30",                       // 필수. 촬영 날짜(KST, YYYY-MM-DD) = 캘린더 셀 배치
  "capturedAt": "2026-06-30T14:23:00+09:00",     // 촬영 시각(KST ISO) = 캘린더 시간 표시(HH:MM)
  "mediaType": "image",                          // "image" | "video"
  "storageProvider": "naver",                    // 고정
  "storageKey": "calendar-media/2026-06-30/<uuid>.jpg",  // ①의 key
  "roadAddress": "광주광역시 광산구 ...",          // 선택. 도로명 주소(앱 역지오코딩)
  "latitude": 35.169862,                          // 선택. GPS 위도(숫자)
  "longitude": 126.863702,                        // 선택. GPS 경도(숫자)
  "workerName": "장우진",                          // 선택. 작업자 이름(uploader 로도 인식)
  "workerId": "EMP-6861",                          // 선택. 작업자 사번/ID
  "ocrText": "사진대지 ... (앱 OCR 인식 텍스트)",     // 선택. 원문 전체(대시보드에서 접어두기)
  "title": "현장 점검 사진",                       // 선택
  "siteId": "현장 식별자"                          // 선택
}
```

응답 `{ "ok": true, "media": { ... } }`.

## 날짜/시간 규칙 (중요)

- **캘린더 배치 = `dateKey`(KST 날짜)** → 그 날짜 셀에 미디어 배지.
- **시간 표시 = `capturedAt` 의 `HH:MM`** → 관제웹이 `capturedAt` 문자열의 11~16번째 글자를 그대로 시각으로 표시한다.
  - 따라서 `capturedAt` 은 **KST 로컬 ISO**(`...T14:23:00+09:00`)로 보낼 것. UTC `Z` 로 보내면 화면에 UTC 시각이 뜬다.
  - `dateKey` 도 같은 KST 기준 날짜여야 셀 배치와 시각이 일치한다.
- `mediaUrl` 은 보내지 않는다 — 서버가 표시 시점에 `storageKey` 로 만료형 GET URL(1시간)을 발급한다.

## 참고

- 서버측 구현 = [lib/storage.ts](../apps/dashboard-web/lib/storage.ts)(Object Storage 어댑터) · [upload-url](../apps/dashboard-web/app/api/calendar/media/upload-url/route.ts) · [media](../apps/dashboard-web/app/api/calendar/media/route.ts) · 토큰 검증 [admin-auth.ts](../apps/dashboard-web/lib/admin-auth.ts) `verifyAppUploadToken`.
- 환경변수 = `NCP_ACCESS_KEY`/`NCP_SECRET_KEY`/`NCP_BUCKET` + `APP_UPLOAD_TOKEN`([.env.example](../apps/dashboard-web/.env.example)).
- 라이브 활성화 전제(서버 운영자) = NCP Object Storage 버킷·인증키 + `APP_UPLOAD_TOKEN` 을 Secret Manager 등록 후 Cloud Run 재배포.
