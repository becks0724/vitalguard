# D-4 서버 명세 (개정) — **`/api/app/admin/*` 로 간다**

작성: Claude / 2026-09-12
⚠ **이전 명세 `SPEC-d4-alerts-app-jwt.md` 는 폐기다.** 아래 「왜 바꿨나」 참조.

---

## 왜 바꿨나 — 내가 방향을 잘못 잡았다

처음에 `/api/alerts` 에 `verifyAppJwt` 를 통과시키는 명세를 쓰고 커밋까지 했다(`bb04a9b3`).
**이 저장소는 그 방식을 쓰지 않는다.** `lib/app-admin-auth.ts` 첫 주석에 축이 명시돼 있다:

> 왜 `/api/monitor/*` 를 열지 않고 `/api/app/admin/*` 을 새로 만드나. 그쪽 응답은
> **16개 필드에 목업·누적집계·온열패턴·구역위험까지 실린 웹 대시보드 전용**이고 인가도 다르다.
> 폰은 작업자 목록 한 화면이면 되므로 필요한 것만 골라 담는다.
> **축을 지킨다 — 앱이 쓰는 것 `/api/app/*` · 관제가 쓰는 것 `/api/monitor/*`**

**원인**: 전수 조사를 `verifyAppJwt` / `verifyBasicAuth` **두 가지로만** 했다.
`requireAppAdmin` 이라는 제3의 헬퍼가 있는 것을 놓쳤고, 그래서 이미 있는 패턴을 두고
관제 라우트를 여는 쪽으로 갔다. 되돌렸다(`a0a3edda`).

---

## 이미 있는 것 — 새로 만들지 마라

### `requireAppAdmin` (`lib/app-admin-auth.ts`)

내가 짜려던 `verifyOfficer` 보다 **세 가지를 더 한다.**

| | 내 초안 | **실제** |
|---|---|---|
| 권한 출처 | 토큰의 `role` | ★ **매 요청 DB 조회**. 모바일 refresh 가 30일이라 회수해도 토큰이 옛 값을 최대 30일 실어 나른다 |
| 토큰 종류 | 앱 JWT 전부 | **`verifyMobileAccessJwt` 만.** 레거시 워치·수집 토큰(2단계 미인증)은 `aud`·`tokenUse`·`v:2`·`sessionId` 가 없어 **구조적으로** 차단 |
| 실패 처리 | 403 | **401 / 403 / 503 을 가름.** DB 조회 실패는 "권한 없음" 이 아니라 **판정 불가** → 503. *"여기서 통과시키면 DB 장애가 곧 인가 우회가 된다"* |

반환: `{ ok: true, principal: { username, role, workerId } }` 또는 `{ ok:false, status, body }`.
**`ok:false` 면 그대로 응답한다** — 사유를 라우트마다 다시 쓰면 갈라진다.

### 선례 — `GET /api/app/admin/workers`

**이미 있고 이미 돈다.** 작업자 목록 + 상태를 준다. 두 가지를 그대로 따라라:

1. **판정을 새로 하지 마라.** `workerStatus`·`effectiveTone`·`gateStaleVitals` 는
   관제웹이 쓰는 그 함수들이다(`lib/worker-signal`).
   > 폰이 임계를 따로 두면 같은 작업자가 웹과 앱에서 다른 색으로 뜬다 — **실제로 구 앱에서 그 사고가 났다.**
2. **PII 선별을 그대로 따라라.** 아래 참조.

---

## ★ PII — 선례가 이미 답이다

`MOCK_VITAL_EXPOSE_PII` 는 **라이브에서 `true`** 다(2026-09-12 태곤 님 확인).

PII 6필드: `guardianName` `guardianPhone` `latitude` `longitude` `lastAccurateLat` `lastAccurateLon`
⚠ 뒤의 둘을 빼먹지 마라 — *"latitude/longitude 만 지우고 이걸 남기면 마스킹이 뚫린다."*

**그런데 `app/admin/workers` 는 스위치가 켜져도 위치 2개만 싣는다**(`:86-89`).
보호자 이름·전화는 **모바일에 안 간다.**

| | 관제웹 | **폰 앱** | **태블릿(결정)** |
|---|---|---|---|
| 위치 | ✅ | ✅ | **✅** |
| 보호자 이름·전화 | ✅ | ❌ | **❌** |
| `piiRedacted` 플래그 | — | ✅ | **✅** |

**태곤 님 결정: 폰 앱과 같게 간다.** 근거 — ① 같은 처지의 모바일 기기 ②
현장 순찰 중 **어디로 갈지**를 알아야 한다 ③ 보호자 연락은 119·관제·본사 순서라
현장에서 담당관이 직접 거는 흐름이 아니다.

★ **`piiRedacted` 를 반드시 함께 보내라.** 화면이 **"위치 기능이 없는 것"** 과
**"가려진 것"** 을 구분해야 한다(`N-1`).

> ⚠ [미검증] 위치정보는 위치정보법 동의 대상이고 근로자 감시 설비는 근참법 제20조
> 노사협의 사항이다. 관제웹이 이미 쓰고 있어 절차는 밟혔을 것으로 보이나,
> **태블릿 추가가 동의 범위를 자동으로 넓히지는 않는다.** 법률 판단은 우리 몫이 아니다 — 기록만 한다.

---

## ★ 개정 (2026-09-13 · 태곤 님 ⓑ 선택) — **신호등 4행을 다 만든다**

물었다: 현장(S) 화면 범위 ⓐ 축소 / ⓑ 4행 전부 / ⓒ 뒤로 미룸 → **ⓑ**.

그러면 관제 라우트를 1:1 로 베꼈을 때 **첫 화면 한 장에 요청 5번**이 된다
(`weather` · `kma-warning` · `gaspod/telemetry` · `aed/devices` · `alerts`).
현장 네트워크에서 왕복 5번은 나쁘다.

**→ 읽기를 하나로 묶는다. 신규 파일은 2개다.**

```
GET  /api/app/admin/site-status    신호등 4행 + 경보 요약   (읽기 전부)
POST /api/app/admin/alerts/ack     대응 확인               (쓰기라 분리)
```

> 태곤 님이 "라우트 1개로 묶는다고 하지 않았나"라고 기억한 것은 정확히는
> **판정 함수 하나**(`requireAppAdmin`)였다. 다만 **읽기를 묶는 쪽이 설계로도 낫다** —
> 첫 화면이 한 번에 그려지고, "마지막 수신 시각"이 **한 덩어리로** 일관된다(S-08).

---

## ① `GET /api/app/admin/site-status`

```ts
const gate = await requireAppAdmin(request);
if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
```

### ★★ 행별 상태를 따로 담아라 — **뭉개면 S-09 위반이다**

가스만 실패했는데 화면 전체를 "불러오기 실패"로 만들면 안 된다.
**`Promise.allSettled` 로 4행을 각각 받고, 실패한 행만 `{ ok:false }` 로 표시한다.**

```ts
{
  ok: true,
  fetchedAt: "2026-09-13T11:45:00+09:00",
  weather:  { ok: true, level: "normal", summary: "특보 없음 · 광주", ... } | { ok:false, error },
  workers:  { ok: true, level: "normal", normal: 1, waiting: 3, ... }      | { ok:false, error },
  gas:      { ok: true, level: "danger", summary: "CO 52ppm · 탱크 야드", ... } | { ok:false, error },
  aed:      { ok: true, level: "warn",   summary: "배터리 교환 임박 · 지하 주차장 B1", ... } | { ok:false, error },
  alerts:   { ok: true, unacked: 2, siteScoped: false, items: [...] }      | { ok:false, error }
}
```

### 각 행이 쓸 것 — **관제 라우트를 열지 말고 같은 DB 함수를 호출해라**

| 행 | 쓸 것 | ⛔ 주의 |
|---|---|---|
| 기상 | `weather/route.ts` · `kma-warning` 의 조회 로직 | 캐시 경로를 그대로 타라(`cached:true` 분기) |
| 작업자 | **`app/admin/workers` 가 이미 있다** | 새로 만들지 마라. **PII 처리는 그 선례를 그대로** |
| 가스 | `listGaspodTelemetry` + **`readPower()`** | ★ 이력 720행을 통째로 싣지 마라. **최신 1건의 raw 는 실어도 된다** — 아래 정정 |
| AED | `listRegisteredAedDevices` | |
| 경보 | `listAlerts(100)` | ⚠ 아래 |

> ⚠ **2026-09-14 정정 — 원시값 금지의 범위를 좁힌다 (태곤 님 결정).**
> 내가 "720행 원시값을 앱에 보내지 마라"고 쓴 것을 astra 가 **모든 raw 금지**로 읽어
> `readGasStatus` 가 판정(level)만 싣고 수치를 전부 뺐다. 그 결과 `screen-inventory`
> **S-04 의 "raw/ppm 단위 혼재 표기"를 만들 수 없게 됐다.**
>
> **금지의 실제 취지는 워치 생체 데이터다.** 개인정보·민감정보에 걸릴 수 있어 막은 것이다.
> **가스포드 측정값은 개인정보도 민감정보도 아니므로 raw/ppm 을 보내도 된다.**
>
> 따라서 — **이력 720행을 통째로 싣는 것만 금지**하고, **최신 1건의 측정값은 싣는다.**
> 단위는 실제로 섞여 있다: `O₂ = %` · `MQ-7(CO)·MQ-136(H₂S) = raw ADC`
> (`ppm 환산은 하지 않는다` — 관제 표시와 같은 기준. 환산은 가스 임계 v2 과제다).
> 화면은 **단위를 값 옆에 명시**해 % 와 raw 를 섞어 읽지 않게 해야 한다.
>
> ⛔ 이 완화는 **가스포드에만** 적용된다. 워치 생체 원시값은 그대로 금지다.

★ **전원 판정은 서버가 한다** (2026-09-08 · 태곤 님 결정 ㉯). `readPower()` 결과를 그대로 실어라.
브라우저가 판정했을 때 어댑터에 물린 기기를 방전으로 읽은 사고가 있었다(`gaspod/telemetry:88-92`).

### ⚠ 경보에 현장 필터가 없다

`alerts` 테이블에 `site_id` 가 없고 `listAlerts` 도 전체를 읽는다.
→ **`siteScoped: false`** 를 실어 **앱이 "이 현장 경보" 라고 쓰지 못하게** 해라.
~~`type` 은 **4종뿐**이다(`sos·fall·vital·geofence`). `screen-inventory.md` 가 5종을 적고 있는데 **서버가 옳다.**~~

> ⚠ **2026-09-14 정정 — 위 문장이 틀렸다.** `type` 은 **5종**이다.
> 서버 정의(`lib/alert-type.ts:12`)가 `sos | fall | vital | geofence | **absence**` 이고,
> 라이브 DB 실측도 `absence` **131건 · 최신 2026-09-13** 으로 살아 있다.
> **`screen-inventory.md` 가 맞았다.**
> `absence` 는 성격이 다르다 — 다른 경보는 샘플이 들어와서 발화하는데 이것은 **안 들어와서**
> 발화하며 크론(`/api/cron/absence-check`)이 넣는다. 관제 라벨은 **`장기 미수신`** 이다.
> 라벨 정본은 `lib/site-chat-context.ts:309` 의 `ALERT_TYPE_LABEL` 이다:
> `sos=SOS · fall=낙상 · vital=생체 이상 · geofence=구획 이탈 · absence=장기 미수신`.
> (DB 에 `danger_zone` 1건이 있으나 2026-08-19 이후 없고 타입 정의에도 없는 레거시라 제외한다.)

실제 컬럼(`lib/db.ts:543-553`): `id · worker_id · worker_name · type · ts · created_at · ack_at · ack_by`.
**없는 필드를 만들지 마라.**

---

## ② `POST /api/app/admin/alerts/ack`

- 같은 게이트. body 는 `{ id }` 또는 `{ workerId, type }`.
- ★ **`ackBy` 를 body 에서 받지 마라.** `gate.principal.username` 을 쓴다.
- `ackAlert` / `ackAlertByKey` 를 그대로 쓴다. **멱등하다** —
  `WHERE ack_at IS NULL` 이고 자연키도 `ORDER BY ts DESC LIMIT 1` 이다(`lib/db.ts:2619-2643`).
- `acked:false` 는 **실패가 아니라 "이미 처리됨"** 이다.

---

## ③ 캘린더 — **사진 위변조 방지·녹음 (2026-09-13 신규)**

태곤 님 시나리오(screen-inventory §4)를 받으려면 **둘 다 서버가 먼저 바뀌어야 한다.**

### ③-1 원본 ↔ 잉크본 연결 — 컬럼 하나

`calendar_media` 전체 컬럼을 확인했다. **"이 사진은 저 사진의 잉크본이다"를 적을 곳이 없다.**
지금 구조로 2장을 올리면 캘린더에 **사진 2장이 따로** 뜬다.

```sql
ALTER TABLE calendar_media ADD COLUMN IF NOT EXISTS annotation_of TEXT;
```
`lib/db.ts` 의 **`ensureSchema` 가 정본**이다. 거기에 넣어라(`IF NOT EXISTS` 라 안전).
조회에서는 **`annotation_of IS NOT NULL` 인 행을 목록에 따로 띄우지 않고** 원본에 딸린 것으로 준다.

### ③-2 녹음 — 오디오 MIME 허용

`app-media/route.ts:13-27` 의 허용 목록에 오디오가 없고 `mediaType` 도 `image|video` 둘뿐이다.

- 허용 MIME 에 **`audio/mp4`(m4a) · `audio/aac`** 를 더한다 — 안드로이드 기본 녹음 형식이다.
- `mediaType` 에 **`audio`** 를 더한다.
- ⛔ **관제웹 표시도 같이 봐야 한다** — `audio` 를 모르는 화면이 깨지지 않는지 확인 후 배포.

---

## ⛔ 이번에 하지 않는 것

가스(`gaspod/*`) · AED(`aed/*`) · CCTV(`cctv/*`) · 날씨(`weather`·`kma-warning`·`disaster-msg`) ·
환경경보(`env-alert/ack`) · 원본 다운로드(`calendar/media/download-url`).

**화면이 생길 때 같은 방식으로 추가한다.** 그때는 `requireAppAdmin` 이 이미 있으니 한 줄이다.

## 적용 위치

```
…/조달청_rlaxorhs77eng-alerts    브랜치 feat/app-admin-alerts   (a0a3edda)
```
⛔ `기존_조달청모듈/safetymonitor/`(main 워킹트리)는 **읽기 전용**이다. 병렬 세션과 공유한다.

## 배포 전

- **라이브 서버 코드다.** 배포하면 관제웹에 즉시 반영된다.
- `verifyBasicAuth` 경로를 **한 줄도 건드리지 마라** — 관제웹 회귀가 가장 큰 위험이다.
  새 라우트만 만드는 방식이라 **회귀 면적이 0 이다.** 이게 이 축의 이점이다.
- ⛔ **라이브에 ack 쓰기를 시험 삼아 실행하지 마라.** 산업재해 자료에 행이 남고 되돌리는 API 가 없다.
