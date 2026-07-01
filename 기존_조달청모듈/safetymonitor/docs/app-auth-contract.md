<!-- iOS/watchOS 앱 → 관제웹 로그인 연동 계약(계정 검증 API + JWT). 팀원 앱 구현 기준 문서. -->
# 앱 로그인 연동 계약 — iPhone/Apple Watch ↔ 관제웹 계정

앱이 **관제웹 대시보드와 동일한 ID/비밀번호**로 로그인한다. 앱은 DB에 직접 접속하지 않고, **관제웹 서버의 로그인 검증 API만 호출**한다.

- **서버 베이스** = `https://vitalguard-dashboard-569797426568.asia-northeast3.run.app`
- **HTTPS 필수.** 로그인 성공 시 서버가 **앱용 토큰(JWT)** 을 발급하고, 앱은 이후 요청에 이 토큰을 쓴다.

## ✅ 로그인 API

```
POST /api/app-auth/login
Content-Type: application/json

{ "id": "worker01", "password": "사용자비밀번호" }
```

**성공 응답 (200)**
```json
{
  "ok": true,
  "token": "<JWT — 이후 요청 Authorization 헤더에 사용>",
  "user": {
    "id": "worker01",
    "name": "장우진",
    "role": "worker",
    "workerId": "EMP-6861"
  }
}
```

**실패 응답**
| 상황 | HTTP | body |
|---|---|---|
| ID/비번 불일치 | 401 | `{ "ok": false, "error": "invalid_credentials" }` |
| 승인 대기/거절 계정 | 403 | `{ "ok": false, "error": "not_approved" }` |
| 로그인 시도 초과(잠금) | 429 | `{ "ok": false, "error": "too_many_attempts", "retryAfterSec": 300 }` |
| 요청 형식 오류 | 400 | `{ "ok": false, "error": "invalid_request" }` |
| 서버 미설정(시크릿 없음) | 503 | `{ "ok": false, "error": "app_auth_not_configured" }` |

- `user.role` = `owner` | `admin` | `worker` → 앱의 **관리자/근로자 모드 구분**에 사용.
- `user.workerId` = 사번(관리자가 부여). 생체 데이터·미디어 업로드가 이 값으로 매칭된다. **미설정 계정은 `null`**.

## 토큰(JWT) 사용법

- 형식 = **HMAC-SHA256 서명 JWT**, 유효기간 **30일**. 만료 시 재로그인.
- 이후 모든 앱 요청에 헤더로 동봉.
  ```
  Authorization: Bearer <token>
  ```
- **미디어 업로드(`POST /api/app-media`) 가 이 토큰을 그대로 수용**한다(기존 `APP_UPLOAD_TOKEN` 과 병행). JWT로 업로드하면 **로그인한 작업자 신원(이름·workerId)이 자동으로** 미디어에 연결된다 → 폼에 `workerName`/`workerId` 를 안 보내도 채워짐(보내면 폼 값 우선).
- 토큰은 **Keychain 저장** 권장. 비밀번호는 앱에 저장하지 않는다.

## 계정은 어떻게 만드나 (중요)

- 현장 근로자 계정은 **관리자(owner)가 관제웹 대시보드에서 생성**한다 — `사용자 관리 → + 근로자 계정 추가`(아이디·이름·사번·초기 비밀번호). 생성 즉시 승인되어 앱 로그인 가능.
- 즉 **앱은 "로그인 화면"만 구현**하면 된다(가입/승인 화면 불필요). 관리자 계정(owner/admin)도 같은 API로 로그인된다.

## 서버 동작(내부)

1. 앱이 `id`/`password` 전송 → 서버가 **env owner** 또는 **`users` 테이블**에서 계정 조회.
2. 비밀번호는 **scrypt 해시 비교**(평문 미저장, 서버만 보유).
3. 성공 + 승인 상태면 **JWT 발급**(무상태 서명 → Cloud Run 다중 인스턴스 어디서든 검증, 세션 저장 불필요).
4. 실패는 위 표대로. `(IP, ID)` 별 연속 실패 시 일정 시간 잠금(429).

## 보안 요건 (충족 상태)
- 앱은 DB에 직접 접속하지 않음 — 서버 API만 호출. DB 접속정보는 서버에만.
- 비밀번호 평문 저장 금지 — scrypt 해시 검증(기존 관제웹과 동일).
- 토큰은 서명(JWT)이라 위조 불가. 개인키/시크릿은 서버에만.

## 서버 운영자 활성화 전제
- **`APP_JWT_SECRET`**(JWT 서명 키, 강한 임의값)을 Secret Manager 등록 후 Cloud Run 재배포. **미설정 시 로그인 API 는 503**([.env.example](../apps/dashboard-web/.env.example)).
- 서버 구현 = [/api/app-auth/login](../apps/dashboard-web/app/api/app-auth/login/route.ts) · JWT [lib/app-jwt.ts](../apps/dashboard-web/lib/app-jwt.ts) · 계정 검증 [lib/password.ts](../apps/dashboard-web/lib/password.ts)·[lib/db.ts](../apps/dashboard-web/lib/db.ts) · 미디어 토큰 수용 [/api/app-media](../apps/dashboard-web/app/api/app-media/route.ts).
- 미디어 업로드 상세는 [app-media-upload-contract.md](./app-media-upload-contract.md).
