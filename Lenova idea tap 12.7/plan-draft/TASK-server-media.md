# 작업 지시 — 서버: 사진 위변조 방지 연결 + 녹음 수용

작성: Claude / 수신: 코덱스(astra) / 2026-09-13
근거: `artifacts/screen-inventory.md` §4 · `plan-draft/SPEC-d4-app-admin-routes.md` ③

---

## ⛔ 먼저 — 작업 경로를 틀리면 사고다

**작업할 곳** (절대 경로 그대로 쓸 것):
```
/Users/rlaxorhs77/Desktop/조달청 프로젝트/조달청_rlaxorhs77eng-alerts/기존_조달청모듈/safetymonitor/apps/dashboard-web
```
브랜치 `feat/app-admin-alerts` · HEAD `a0a3edda` · 워킹트리 깨끗함(확인 완료).

**건드리면 안 되는 곳**
| 경로 | 이유 |
|---|---|
| `조달청_rlaxorhs77eng/기존_조달청모듈/safetymonitor/` | **읽기 전용.** 병렬 세션과 공유하는 main 워킹트리 |
| `조달청_rlaxorhs77eng-newdb/…/dashboard-web` | **다른 세션의 코덱스가 지금 이 폴더에서 돌고 있다** |

**하지 마라**
- ⛔ **배포 금지.** 태곤 님 지시로 배포는 전부 끝난 뒤 맨 마지막이다.
- ⛔ **라이브 DB 에 직접 `ALTER` 를 치지 마라.** 스키마는 `ensureSchema` 가 정본이고 앱 기동 시 반영된다.
- ⛔ `verifyBasicAuth` 경로를 한 줄도 바꾸지 마라 — 관제웹 회귀가 가장 큰 위험이다.

---

## 왜 하는가 — 태곤 님 시나리오

> *"원본에 펜 잉크를 바로 해버리고 사진 전송이 되면 그것은 편집이 되어 사진의 위변조가
> 가능해진다는 것. 이는 막아야함"*

촬영본(원본)과 담당관이 펜으로 표시한 것(잉크본)을 **둘 다** 남긴다.
관제웹에서 사진을 한 번 더 클릭하면 **카드가 뒤집혀** 잉크본이 나온다(그 화면 작업은 이 지시 밖).

**지금 서버는 이 둘을 묶을 수 없다.** 그래서 이 작업이 선행이다.

---

## ① `calendar_media` 에 `annotation_of` 추가

`lib/db.ts` `ensureSchema` 안, `calendar_media` 의 다른 `ALTER … IF NOT EXISTS` 들 바로 뒤(≈ `:976-981`).

```sql
ALTER TABLE calendar_media ADD COLUMN IF NOT EXISTS annotation_of TEXT;
CREATE INDEX IF NOT EXISTS idx_calmedia_annotation_of ON calendar_media(annotation_of);
```

의미: **"이 행은 `annotation_of` 가 가리키는 사진의 잉크본이다."** 원본이면 `NULL`.

- FK 제약은 **걸지 마라.** 이 테이블의 다른 컬럼도 안 걸려 있고, 기존 행 전부가 `NULL` 이라 잡을 게 없다.
- 인덱스는 원본 하나로 잉크본을 찾는 조회가 생기므로 넣는다.

## ② `insertCalendarMedia` 가 받게 한다

`lib/db.ts:4642`. 입력 타입에 **선택 필드** `annotationOf?: string` 를 더하고 INSERT 에 실어라.
**기본은 `null`** — 지금 올라오는 모든 사진은 원본이다.

## ③ `listCalendarMedia` — 잉크본을 목록에 따로 띄우지 않는다

`lib/db.ts:4597`(쿼리는 `:4609` `FROM calendar_media m`).

**날짜별 목록에서 잉크본이 원본과 나란히 두 장으로 보이면 안 된다.** 그게 이 작업의 핵심이다.

- 목록 조회는 **`WHERE m.annotation_of IS NULL`** 로 원본만 준다.
- 각 원본 행에 **`annotationId`**(그 원본을 가리키는 잉크본의 id · 없으면 `null`)를 같이 실어라.
  한 장뿐이므로 서브쿼리 하나면 된다. **N+1 로 만들지 마라.**
- `getCalendarMediaById`(`:4634`)는 **그대로 둔다** — id 로 직접 집으면 잉크본도 열려야 한다.

## ④ 녹음 — 오디오를 받게 한다

`app/api/app-media/route.ts`.

- `EXT_BY_TYPE`(`:11-19`)·`TYPE_BY_EXT`(`:20-28`) 에 **`audio/mp4` → `m4a`**, **`audio/aac` → `aac`** 를 더한다.
  안드로이드 `MediaRecorder` 기본 출력이 AAC/MPEG-4 다.
- `:136` 의 한 줄을 고친다.
  ```ts
  const mediaType = contentType.startsWith("video/") ? "video" : "image";
  ```
  → 오디오를 `image` 로 적으면 관제웹이 `<img>` 로 그리려다 깨진다. **세 갈래로** 만들어라.
- `:64` 의 오류 문구 `"multipart/form-data 로 이미지 파일을 첨부하세요"` 도 실제와 맞게 고쳐라.

### ⚠ 관제웹이 `audio` 를 모른다

`mediaType: "audio"` 인 행이 생기면 기존 캘린더 화면이 어떻게 되는지 **먼저 읽고 보고해라.**
깨지면 그 화면도 같이 고쳐야 한다 — **깨지는 걸 알면서 넣지 마라.**
(이 지시에서 화면을 고칠지는 네 조사 결과를 보고 내가 정한다.)

---

## 하지 않는 것 (이번 범위 밖)

- 원본을 지울 때 잉크본을 같이 지울지 — **아직 정하지 않았다.** `deleteCalendarMedia`(`:4774`)를 건드리지 마라.
- 관제웹 뒤집기 애니메이션 — 별도 작업.
- 앱 쪽 업로드 코드 — 별도 작업.

---

## 끝났으면

1. `pnpm tsc --noEmit`(또는 이 레포의 타입 검사 명령)이 **깨끗한지** 확인하고 결과를 보고해라.
2. **커밋하지 마라.** 내가 검토하고 커밋한다.
3. ④의 관제웹 조사 결과를 **같이** 보고해라.
