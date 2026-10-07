# D-4 서버 변경 명세 — `alerts` 를 앱에 연다 (읽기 + 대응확인)

작성: Claude / 2026-09-12
결정: 태곤 님 — **ⓐ 읽기 + ⓑ 대응확인 둘 다 연다**

> ⚠ **이 문서는 명세다. 아직 아무 파일도 고치지 않았다.**
> `기존_조달청모듈/safetymonitor/` 는 **읽기 전용**(병렬 세션 공유 워킹트리)이라
> 적용 위치를 태곤 님이 정해야 한다. 아래 「적용 위치」 참조.

---

## 배경 — 왜 필요한가

태블릿 앱(현장 담당관)이 **경보를 못 본다.** 소스로 확인했다:

```
alerts/route.ts:9,20        verifyBasicAuth
alerts/ack/route.ts:12      verifyBasicAuth
env-alert/ack/route.ts:16,47 verifyBasicAuth
```

`verifyBasicAuth` 가 받는 것은 **관제웹 세션 토큰** 또는 **base64(id:pw)** 뿐이다
(`lib/admin-auth.ts:114-136`). **앱 JWT 는 둘 다 아니다.**

⛔ **관제 계정 자격을 앱에 심는 우회는 검토 대상이 아니다.**

## 선례 — 이미 같은 패턴이 적용돼 있다

`admin/site-info/route.ts:29-31` 이 정확히 이 문제를 이렇게 풀었다:

```ts
// 조회(GET) = 대시보드 관리자 세션 또는 앱 로그인 JWT(owner/admin/worker) 수용 — 현장 앱이 현장정보 표시.
// 저장(PUT)은 관리자 전용 유지. 앱 JWT 를 먼저 확인해 불필요한 DB 조회(hasAdminMenuAccess)를 피한다.
const appAuthed = verifyAppJwt(bearerToken(request)) !== null;
if (!appAuthed && !(await hasAdminMenuAccess(request))) { ... 401 }
```

**같은 모양으로 간다.**

---

## 변경 1 — `alerts` GET 을 앱 JWT 에 연다

`app/api/alerts/route.ts`

```ts
import { bearerToken, verifyAppJwt } from "../../../lib/app-jwt";

export async function GET(request: Request) {
  // 조회 = 관제 세션 또는 앱 로그인 JWT 수용 — 현장 담당관이 태블릿에서 경보를 본다.
  // 기록(POST)은 관제 전용 유지(구획 이탈 확정 전이는 관제웹이 판정한다).
  if (!verifyAppJwt(bearerToken(request)) && !verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  ...
}
```

**`POST` 는 건드리지 않는다.** 그건 구획 이탈 기록이고 관제웹이 판정 주체다.

### ⚠ 같이 적어야 할 한계 — **현장 필터가 없다**

`listAlerts(100)` 은 이렇다(`lib/db.ts:2610-2616`):

```sql
SELECT * FROM alerts ORDER BY ts DESC, id DESC LIMIT $1
```

**현장 조건이 없다.** `alerts` 테이블에 `site_id` 컬럼 자체가 없다(`lib/db.ts:543-553`).

→ 앱이 받는 것은 **"이 현장의 경보" 가 아니라 "전체 최근 100건"** 이다.
→ ⛔ **앱 화면에 "이 현장 경보" 라고 쓰면 거짓이 된다.**
   `screen-inventory.md:87` 의 `L-01` **"배지는 이 현장 기준"** 은 **지금 구현할 수 없다.**
   화면은 **"최근 경보"** 라고만 쓴다.

> 현재 현장이 하나뿐이라 **실질 문제는 없다.** 다만 **문구가 사실과 달라지면 안 된다.**
> 신규 스키마에는 `alert.site_id` 가 있고 **RLS 격리 기준**이므로 전환 후에 해소된다.

---

## 변경 2 — `alerts/ack` POST 를 앱 JWT 에 연다  **★ 여기가 핵심이다**

`app/api/alerts/ack/route.ts`

### ★★ 인증만 열면 안 된다 — `ackBy` 를 신원으로 강제해야 한다

현재 코드(`:23`):

```ts
const ackBy = String(obj.ackBy ?? "").slice(0, 40) || "관제자";
```

**클라이언트가 보낸 문자열을 그대로 쓴다.** 서버가 인증된 신원에서 뽑지 않는다.

같은 서버의 `app-media/route.ts:127-133` 은 **정반대로** 하고 있고 이유까지 적어 뒀다:

```ts
// 귀속 위조 방지 — 로그인 JWT 로 인증했으면 JWT 신원(name/workerId)을 강제하고 폼 값은 무시한다.
// (폼 workerId 가 JWT 보다 우선하면 인증된 사용자가 미디어를 타인에게 귀속시킬 수 있음.)
const uploader = jwtClaims?.name ?? pick(form, [...]) ?? null;
```

**`ack_by` 는 산업재해 자료에 들어간다.** `AdminExportModal.tsx` 첫 줄:
> `관리자 모달 — 로그인 + 워커/기간 필터 CSV 내보내기 (산업재해 자료 제출용)`

사고 조사에서 **"누가 언제 대응했는가"** 로 읽히는 값이다.
**앱을 열면서 이걸 그대로 두면, 현장 태블릿이 아무 이름이나 써넣을 수 있다.**

### 그래서 이렇게 간다

```ts
import { bearerToken, verifyAppJwt } from "../../../../lib/app-jwt";

export async function POST(request: Request) {
  const appClaims = verifyAppJwt(bearerToken(request));
  if (!appClaims && !verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  ...
  // 귀속 위조 방지 — app-media 와 같은 규칙.
  // 앱 JWT 로 인증했으면 JWT 신원을 강제하고 body 의 ackBy 는 무시한다.
  // ack_by 는 산업재해 자료 CSV 에 "대응자" 로 실린다.
  const ackBy = appClaims
    ? (appClaims.name ?? appClaims.sub)
    : String(obj.ackBy ?? "").slice(0, 40) || "관제자";
```

`AppJwtClaims` 는 `{ sub, role, name, workerId, exp }` 다(`lib/app-jwt.ts:8-12`).
`name` 이 `null` 일 수 있으므로 **`sub`(로그인 ID)로 폴백**한다. **빈 문자열이나 "관제자"로 떨어뜨리지 마라** —
현장에서 누른 것이 관제자로 기록되면 그게 바로 우리가 막으려는 왜곡이다.

### 기존 관제웹 동작은 바뀌지 않는다

관제 세션으로 들어오면 `appClaims` 가 `null` 이라 **지금과 똑같이** `obj.ackBy` 를 쓴다.
**회귀 없음.**

### ack 는 멱등하다 — 이건 좋은 소식이다

```sql
-- ackAlert(id, ackBy)               lib/db.ts:2619-2625
UPDATE alerts SET ack_at=…, ack_by=$1 WHERE id=$2 AND ack_at IS NULL
-- ackAlertByKey(workerId, type, …)  lib/db.ts:2629-2643
… WHERE id = (SELECT id FROM alerts WHERE worker_id=$2 AND type=$3 AND ack_at IS NULL
              ORDER BY ts DESC, id DESC LIMIT 1)
```

- `ack_at IS NULL` 조건이라 **두 번 눌러도 덮어쓰지 않는다.**
- 자연키 방식도 **가장 최근 미대응 1건**만 닫는다(`LIMIT 1`). 한 번에 여러 건이 닫히지 않는다.
- `UNIQUE(worker_id, type, ts)` 가 테이블에 있다.

→ **사진 업로드와 정반대다.** 업로드는 멱등키가 없어 재시도가 중복을 만들지만,
  **ack 는 재시도해도 안전하다.** 전송함(`O`) 설계에서 이 둘을 같은 규칙으로 묶지 마라.

---

## 변경하지 않는 것

| | 이유 |
|---|---|
| `alerts` POST | 구획 이탈 **기록**. 관제웹이 판정 주체다 |
| `env-alert/ack` | 환경 경보. 이번 범위 밖 — 필요해지면 같은 패턴으로 따로 연다 |
| `app/vital` GET | 생체 원본 스트림. 주석이 명시적으로 "URL 을 아는 누구에게도 공개하지 않는다" 고 한다 |
| `admin/site-info` PUT | 현장 정보 **저장**. 관제 전용 유지 |

---

## 적용 위치 — ★ 태곤 님 결정 필요

`기존_조달청모듈/safetymonitor/` 는 **`main` 브랜치 · 병렬 세션과 공유하는 워킹트리**다.
여기서 직접 고치면 **남의 작업과 섞인다.**

현재 워크트리:
```
…/조달청_rlaxorhs77eng                  main
…/조달청_rlaxorhs77eng-newdb            feat/newdb-cutover   ← 병렬 세션 작업 중
```

선택지:
1. **새 워크트리 + 새 브랜치**(예: `feat/app-jwt-alerts`) — 가장 깨끗하다. 다른 작업과 안 섞인다
2. `feat/newdb-cutover` 에 얹기 — ⛔ **권하지 않는다.** 신 DB 전환과 성격이 다르고 병렬 세션 것이다
3. ~~신 DB 전환을 기다린다~~ — ⛔ **기각.** 아래 참조

### ★ 신 DB 대기는 선택지가 아니다 (2026-09-12 태곤 님 확인)

신규 스키마에는 `alert.site_id`(RLS 격리 기준)와 `alert_ack.ack_by uuid → app_user` FK 가 있어
**이 명세가 푸는 문제 두 가지가 구조적으로 없다.** 그래서 "기다리면 되지 않나" 를 물었고, 답은:

| 물은 것 | 답 |
|---|---|
| 아직 설계 문서인가 | **그렇다.** 이사 **계획** 단계 |
| 재현본 DB 에 올라가 있나 | **아니다** |
| API 가 붙어 있나 | **아니다** |

→ **신규 스키마는 아직 스키마뿐이다.** 붙일 API 가 없다.
→ **태블릿 앱은 구 DB 라이브 서버로 간다.** 이 명세를 **지금 적용한다.**

> ⚠ 다만 **신 DB 전환 때 이 변경은 버려진다.** 신규에서는 같은 문제가 없기 때문이다.
> **그러니 최소로 고친다** — 인증 한 줄과 `ackBy` 강제뿐이다. 리팩터링을 끼워 넣지 마라.
> 나중에 `alerts` 를 손대는 사람이 **이 변경을 신규 스키마로 이식하려 하면 안 된다**는 것을
> 코드 주석에 남겨라.

## 배포 전 확인

- **라이브 서버 코드다.** 배포하면 현재 관제웹에 즉시 반영된다.
- `verifyBasicAuth` 경로를 건드리지 않았는지 확인 — **관제웹 회귀가 가장 큰 위험**이다.
- ⛔ **라이브에 ack 쓰기를 시험 삼아 실행하지 마라.** 산업재해 자료에 행이 남는다.
