<!-- iOS/watchOS 앱 → 관제웹 4개 기능(현황요약·실시간레이더·현장정보·캘린더) 조회 계약. 팀원 앱 구현 기준 문서. -->
# 앱 조회 연동 계약 — 현황요약 · 실시간레이더 · 현장정보 · 캘린더

앱이 관제웹의 4개 기능을 화면에 표시하기 위해 호출하는 조회 API. 로그인·업로드는 별도 문서 참조 — [app-auth-contract.md](./app-auth-contract.md)(로그인·JWT) · [app-media-upload-contract.md](./app-media-upload-contract.md)(미디어 업로드).

- **서버 베이스** = `https://vitalguard-dashboard-569797426568.asia-northeast3.run.app`
- **HTTPS 필수.**

## 인증 요약

| 기능 | 엔드포인트 | 인증 |
|---|---|---|
| 실시간 레이더 | `GET /api/radar` | **없음(공개)** |
| 기능 현황요약 | `GET /api/mock/vital` | **없음(공개)** — GPS·보호자 등 PII 는 마스킹되어 나옴(현황요약엔 불필요) |
| 현장정보 | `GET /api/admin/site-info` | **`Authorization: Bearer <앱 JWT>`** |
| 캘린더(조회) | `GET /api/calendar/media?from=&to=` | **`Authorization: Bearer <앱 JWT>`** |
| 캘린더 일정(조회) | `GET /api/calendar/events?from=&to=` | **`Authorization: Bearer <앱 JWT>`** |
| 캘린더 일정 라벨(조회) | `GET /api/calendar/labels` | **`Authorization: Bearer <앱 JWT>`** |

- 앱 JWT = 로그인(`POST /api/app-auth/login`) 성공 시 받는 30일 토큰. 현장정보·캘린더 조회는 **로그인한 사용자(owner/admin/worker 모두)** 면 허용된다.
- 레이더·현황요약은 토큰 없이 바로 호출 가능.

## 역할별 권한 요약 (앱 UI 구성 기준)

작업자(worker)는 **조회 + 본인 사진 업로드**만 가능하고, 기존 항목 수정·삭제·현장정보 저장은 서버가 거부(401)한다. 앱 UI 에서 **수정/삭제/저장 버튼은 `user.role` 이 `admin` 또는 `owner` 일 때만 노출**하면 된다.

| 작업 | worker | admin · owner |
|---|---|---|
| 현황요약·레이더 조회 | ✅ | ✅ |
| 현장정보 조회 (GET) | ✅ | ✅ |
| 캘린더 조회 (GET) | ✅ | ✅ |
| 현장 사진 업로드 (`POST /api/app-media`, 본인 신원 강제) | ✅ | ✅ |
| 현장정보 저장 (`PUT /api/admin/site-info`) | ❌ 401 | ✅ |
| 캘린더 설명 수정 (`PATCH`) · 삭제 (`DELETE`) | ❌ 401 | ✅ |

- 업로드 시 `workerId` 는 로그인 토큰에서 강제되어 **타인 명의 등록·타인 항목 수정 불가**.
- 이 권한 구분은 서버가 강제하므로(앱이 버튼을 노출해도 401), 앱은 UX 차원에서 버튼을 숨기면 된다.

---

## 1. 실시간 레이더 — `GET /api/radar`

강수 레이더 프레임 목록(공개 RainViewer 프록시). 인증·파라미터 없음. 2분 캐시.

**응답 (200)**
```json
{
  "ok": true,
  "cached": false,
  "host": "https://tilecache.rainviewer.com",
  "frames": [
    { "time": 1751690400, "path": "/v2/radar/1751690400" }
  ],
  "fetchedAt": "2026-07-05T04:00:00.000Z"
}
```
- `frames[]` = 과거+예보 프레임. `time`=unix초, `path`=타일 경로 조각.
- 지도 타일 URL 조립(RainViewer 슬리피맵 규격) = `` `${host}${path}/{size}/{z}/{x}/{y}/{color}/{options}.png` `` (예: `256/6/54/25/2/1_1.png`). 관제웹 조립 로직은 `app/components/RadarRealtime.tsx` 참고.
- 업스트림 장애 시 502 `{ ok:false, error:"radar upstream failed" }`.

## 2. 기능 현황요약 — `GET /api/mock/vital`

작업자별 최신 생체 + DB 누적 수신 통계. 인증 없음(PII 마스킹됨).

**응답 (200) — 현황요약이 쓰는 필드**
```json
{
  "totalPersisted": 68782,
  "countsByWorker": { "EMP-6861": 586, "EMP-1024": 36 },
  "latest": [ { "workerId": "EMP-6861", "workerName": "장우진", "ts": "…", "heartRate": 88, "spo2": 95, "skinTempC": 36.2 } ],
  "recent": [ /* 최근 샘플 목록 */ ],
  "workerProfiles": { "EMP-6861": { "jobTitle": "현장소장" } },
  "workerAliases": {},
  "piiRedacted": true
}
```
- `totalPersisted` = 현황요약 "DB 누적" 수치.
- `countsByWorker` = 작업자별 누적 건수.
- `latest` = 작업자별 최신 생체 샘플(카드 표시용).
- `piiRedacted:true` = 위·경도·보호자 정보가 응답에서 제거됨(현황요약엔 불필요).
- **공정률·무사고 게이지는 별도 API 가 아니라 현장정보(착수일·준공일)로 앱이 계산**한다. 아래 3번 필요.

## 3. 현장정보 — `GET /api/admin/site-info`

현장 기본 정보(회사·현장·공사종류·주소·착수/준공일).

**요청**
```
GET /api/admin/site-info
Authorization: Bearer <앱 JWT>
```
**응답 (200)**
```json
{
  "ok": true,
  "siteInfo": {
    "companyName": "(주)대성플랜트",
    "siteName": "광주 스마트인재개발원 신축 공사",
    "constructionType": "건축",
    "address": "광주광역시 동구 중앙로 196",
    "startDate": "2026-03-24",
    "completionDate": "2026-10-06"
  }
}
```
- `siteInfo` 가 아직 저장된 적 없으면 `null`.
- 미인증/만료 토큰 → 401 `{ ok:false, error:"인증 필요" }`.
- 저장(관리자 대시보드 전용) = `PUT /api/admin/site-info` — 앱은 조회만.

## 4. 캘린더(조회) — `GET /api/calendar/media?from=YYYY-MM-DD&to=YYYY-MM-DD`

기간 내 현장 미디어(앱이 올린 OCR 사진/영상 포함) 목록.

**요청**
```
GET /api/calendar/media?from=2026-07-01&to=2026-07-31
Authorization: Bearer <앱 JWT>
```
**응답 (200)**
```json
{
  "ok": true,
  "media": [
    {
      "id": "…uuid…",
      "date_key": "2026-07-05",
      "captured_at": "2026-07-05T10:56:00+09:00",
      "media_type": "image",
      "title": "타설 전 점검",
      "media_url": "https://…(만료형 프리사인 GET URL)",
      "thumbnail_url": null,
      "ocr_text": "…",
      "description": "…",
      "worker_id": "EMP-6861",
      "latitude": 35.15,
      "longitude": 126.91,
      "road_address": "광주광역시 …",
      "comments": [ { "id": "…", "media_id": "…", "author": "…", "body": "…", "created_at": "…" } ]
    }
  ]
}
```
- `from`/`to` 는 `YYYY-MM-DD` 필수. 형식 오류 400.
- `media_url` 은 비공개 스토리지 저장분이면 **만료형 프리사인 URL**(표시 시점 발급). 캐시하지 말고 매 조회분을 사용.
- 미인증/만료 토큰 → 401.

### 캘린더 일정(조회) — `GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD` · `GET /api/calendar/labels`

관제 캘린더의 등록 일정(서버 영속) 목록과 라벨(이름·색상) 목록. 인증·오류 규칙은 미디어 조회와 동일(앱 JWT 수용, `from`/`to` 형식 오류 400).

```json
{ "ok": true, "events": [ { "id": "…", "date_key": "2026-07-22", "title": "타설 작업", "label_id": "lbl_important", "start_time": "09:00", "end_time": "12:00", "hazard_type": "crane" } ] }
{ "ok": true, "labels": [ { "id": "lbl_important", "name": "중요일정", "color": "red", "sort_order": 0 } ] }
```
- `hazard_type` = 위험작업 유형(`high_place`·`crane`·`hot_work`·`excavation`·`confined`) 또는 null.
- `labels` 가 빈 배열이면 대시보드 기본 4라벨(중요일정·발주계획·착수계획·기타)을 클라이언트가 폴백 표시한다.
- 일정 등록·수정·삭제는 대시보드 세션 전용(앱은 조회만).

### 캘린더 업로드(앱 → 캘린더)는 이미 지원
- 단일 업로드 = `POST /api/app-media`(앱 JWT 수용, 로그인 신원 자동 연결) — [app-media-upload-contract.md](./app-media-upload-contract.md).
- 2단계 업로드 = `POST /api/calendar/media/upload-url`(프리사인 발급) → 그 URL 로 직접 PUT → `POST /api/calendar/media`(등록). `APP_UPLOAD_TOKEN` 또는 대시보드 세션 수용.
- 다운로드 = `GET /api/calendar/media/download-url?id=<id>`(대시보드 세션).

---

## 운영자/서버 참고
- 현장정보·캘린더 조회 GET 은 앱 JWT 를 수용하도록 수정됨([site-info route](../apps/dashboard-web/app/api/admin/site-info/route.ts) GET · [calendar/media route](../apps/dashboard-web/app/api/calendar/media/route.ts) GET). 저장·수정·삭제는 관리자 인증 유지.
- 현재 정책 = **로그인한 앱 사용자(owner/admin/worker) 모두 조회 허용**. owner/admin 으로 좁히려면 각 GET 에서 `verifyAppJwt(...).role` 을 검사(한 줄)하면 됨.
- 이 문서 변경을 라이브에 반영하려면 재배포 필요(코드 변경이므로 `gcloud builds submit` + `run deploy`).
