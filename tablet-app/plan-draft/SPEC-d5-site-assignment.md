# SPEC — D-5 담당관 현장 배정 (1차)

> 작성 2026-09-17 · 태곤 님 결정 "방안 A" · 근거 D-5(9/12 확정) "현장 안전관리자 = `org_type=contractor`, 배정된 1~2개 현장, 실제 허용 현장은 **서버 배정 목록**"
> 발견 경위: P8 ⑥ 시험용으로 만든 협력업체 계정 `test.worker`(성광종합건설(주))가 자기 현장을 볼 수 없었다.

## 0. 왜 안 됐나 (실측)

| 사실 | 근거 |
|---|---|
| `/api/sites` 가 협력업체 세션을 **401** 로 거부 | `app/api/sites/route.ts:17` `session?.orgType === "contractor"` |
| 앱은 현장 선택 화면이 없고 서버 `user_current_site` 만 받는다 | `site-info/route.ts:45 getCurrentSite(username)` · 앱 코드에 `api/sites` 호출 0 |
| 새 계정은 `user_current_site` 행이 없어 앱 헤더 "현장 정보 없음" | DB `user_current_site` = `admin` 1행뿐 |
| `users.company` ↔ `site.company_name` 을 잇는 코드 없음 | grep 0건 |
| 현장 마스터에 성광종합건설(주) 현장은 **있다** | `site` R26TE13877355 "삼계2교 외 2개소 교량보수공사" |

## 1. 설계

### 1-1. 테이블 (`ensureSchema` 멱등 · `site` DDL 바로 뒤)
```sql
CREATE TABLE IF NOT EXISTS user_site_assignment (
  username    TEXT NOT NULL,
  site_id     TEXT NOT NULL REFERENCES site(site_id),
  assigned_at TEXT NOT NULL DEFAULT (now_iso),
  assigned_by TEXT,
  PRIMARY KEY (username, site_id)
);
```
- 협력업체(`org_type=contractor`) 계정만 이 표로 현장을 본다. 직원 계정(vitalguard·jodal·kosha·test)은 **지금과 같이 전체**.
- 배정은 **관리자만**(owner 또는 `admin_access`) — 자가취득 불가(`grant_officer` 와 같은 원칙).

### 1-2. DB 함수 (`lib/db.ts`)
- `listAssignedSites(username)` → `SiteRow[]` (active 만 · `sort_order, site_id`)
- `assignSite(username, siteId, assignedBy)` → `boolean` (현장이 없거나 inactive 면 false · 중복은 `ON CONFLICT DO NOTHING` 후 true)
- `unassignSite(username, siteId)` → `boolean`
- `getUserOrgType(username)` → `string | null` (`users.org_type`)

### 1-3. 라우트
| 라우트 | 변경 |
|---|---|
| `POST /api/admin/users` | 액션 `assign_site` · `unassign_site` 추가 — 본문 `{ id, action, siteId }`. 기존 관리 권한 게이트 그대로. 사용자 없음·현장 없음 → 404. 응답 `{ ok, user, assignedSites }` |
| `GET /api/sites` | contractor 401 **제거**. username 확정 후 `getUserOrgType` — contractor 면 `listAssignedSites`(0건이면 빈 배열 200), 아니면 `listSites`. 미인증만 401. 앱 JWT 에는 orgType 이 없으므로 **DB 로 판정**한다(토큰 role 로 권한을 판정하지 않는다는 기존 원칙) |
| `GET /api/admin/site-info` | `getCurrentSite` 가 없고 contractor 면 → 배정 목록 첫 현장을 `setCurrentSite` 로 자동 지정 후 그 현장 반환. 응답에 `assignedSiteCount` 추가. 배정 0건이면 **null**(전체 최신으로 폴백하지 않는다 — 남의 현장이 보인다). 직원 계정은 기존 폴백 유지 |
| `POST /api/admin/site-info` (`selectOnly`) | contractor 가 배정 밖 `siteId` 를 고르면 **403** `{ error: "배정되지 않은 현장입니다" }` |

### 1-4. 손대지 않는 것 (1차)
- 앱(`vitalguard_field`) — `site-info` 가 현장을 주면 헤더·`site_id` 가 자동으로 붙는다
- `site-status` — 경보는 "전체 현장 기준" 이라 현장 범위 검사는 2차
- 관제웹 사용자 관리 화면의 배정 UI — 2차. 1차 배정은 API(`assign_site`)로
- `users.role` — D-5 는 `site_manager` 를 말하지만 가입 기본이 `admin` 이고 앱 `_allowed` 가 둘 다 허용하므로 1차는 그대로

## 2. 테스트 (서버 · `lib/site-assignment.test.ts` · `site-master.test.ts` 하네스 패턴)
1. 배정 추가·중복·해제 · 없는 현장/inactive 현장 false
2. `assign_site` 액션: 관리 권한 없음 401 · 사용자 없음 404 · 현장 없음 404 · 성공 200 + `assignedSites`
3. `GET /api/sites`: contractor 세션 → 배정만 · 배정 0 → `[]` 200 · 직원 세션 → 전체 · 앱 JWT(contractor 계정) → 배정만 · 미인증 401
4. `GET site-info`: contractor + 현재 현장 없음 + 배정 1 → 자동 지정·`user_current_site` 기록 · 배정 0 → null · 직원 계정 폴백 회귀
5. `POST site-info selectOnly`: contractor 배정 밖 403 · 배정 안 200 · 직원 계정 회귀
기준선 2002 통과 유지.

## 3. 검증 순서
1. astra 구현 → claude `pnpm typecheck · lint · test`
2. 재현본/로컬에서 curl E2E → 태곤 님 승인 후 main 배포
3. 라이브: `test.worker` 에 `R26TE13877355` 배정(API) → **관제웹** 현장 선택에 성광종합건설 현장 1개 · **태블릿** `test.worker` 로그인 → 헤더 "삼계2교 외 2개소 교량보수공사" · 사진 `site_id = R26TE13877355`
4. P8 ⑥ 은 별개 — 시험 계정 role 을 `worker` 로 바꿔 차단 확인 후 원복

## 4. 남기는 것
- 다중 현장(배정 2개) 전환 UI — 앱·관제웹 2차
- `site-status` 현장 범위 검사 — 2차
- `role=site_manager` 도입 여부 — 계정 정책과 함께 결정
