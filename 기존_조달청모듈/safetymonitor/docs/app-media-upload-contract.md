<!-- iOS 앱 → 관제웹 캘린더 미디어 업로드 계약(프리사인 PUT → 등록). 팀원 앱 구현 기준 문서. -->
# 앱 미디어 업로드 계약 — OCR 이미지/영상 → 관제웹 캘린더

iOS 앱(OCR/촬영)이 찍은 이미지/영상을 **네이버 클라우드 Object Storage**에 올리고, 관제웹 캘린더의 **촬영 날짜·시간 슬롯**에 자동 표시되게 하는 업로드 흐름이다.

- **서버 베이스** = `https://vitalguard-dashboard-569797426568.asia-northeast3.run.app`
- **인증** = 모든 요청에 `Authorization: Bearer <APP_UPLOAD_TOKEN>` 헤더(앱 빌드에 주입할 공유 토큰, 서버 `.env`/Secret 과 동일값).
- **저장** = 바이트는 서버를 거치지 않고 앱이 프리사인 URL로 **Object Storage에 직접 PUT**. 서버에는 메타데이터만 등록.

> ⚠️ 현재 앱이 가리키는 `/api/mock/vital` 은 **생체 전송 전용**이다. 미디어는 아래 별도 엔드포인트를 쓴다.

## 흐름 (3단계)

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
  "ocrText": "사진대지 ... (앱 OCR 인식 텍스트)",
  "title": "현장 점검 사진",                       // 선택
  "siteId": "현장 식별자",                         // 선택
  "uploader": "작업자 이름/사번"                    // 선택
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
