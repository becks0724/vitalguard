# 작업 지시 — 서버: 음성 댓글

작성: Claude / 수신: 코덱스(astra) / 2026-09-13
근거: 태곤 님 결정 2026-09-13 — *"녹음본 코멘트 댓글처럼 같이 그 현장사진에 대해서 올라가게끔"* · **댓글 하나로 들어간다**

---

## ⛔ 작업 경로

```
/Users/rlaxorhs77/Desktop/조달청 프로젝트/조달청_rlaxorhs77eng-alerts/기존_조달청모듈/safetymonitor/apps/dashboard-web
```

이 트리에 **미커밋 변경이 많다**(app-media·DemoDashboard·db.ts·cctv-ticket·잉크벡터·잉크권한·웹잉크렌더).
**되돌리거나 지우지 마라.** 그 위에 얹어라.

⛔ 커밋·배포 금지 · 새 패키지 금지 · `verifyBasicAuth` 수정 금지
⛔ `조달청_rlaxorhs77eng/기존_조달청모듈/**`(읽기 전용) · `-newdb/**`(다른 세션) · `tablet-app/app/**`(앱)

---

## 무엇을 만드나

현장 안전 담당관이 **사진에 말로 코멘트를 남긴다.** 카카오톡 음성 메시지처럼
**글자로 바꾸지 않고 소리 그대로** 남겨 증빙이 되게 한다(STT 와 다른 수단이다).

**★ 녹음은 그 사진의 댓글 하나로 들어간다.** 캘린더에 독립 항목으로 뜨는 것이 아니다.
글 댓글과 음성 댓글이 **한 목록에 시간순으로 섞여** 보인다.

### ⛔ 지금 있는 오디오 독립 경로를 **없앤다** (태곤 님 지시 2026-09-13)

`app-media` 가 오디오를 받아 `calendar_media` 행을 만들고 캘린더에 `🎙` **독립 항목**으로 뜨게
돼 있다(`DemoDashboard.tsx:2969`). **그 경로로 가지 마라.**

> 태곤 님: *"ㄴㄴ 그 경로로 가는게 아니라 내가 말한 경로대로가"*

**오디오는 오직 댓글로만 들어간다.** 독립 첨부는 없다.

- `commentOf` **없이** 오디오가 오면 → **400**. `calendar_media` 에 오디오 행을 만들지 마라.
- `mediaType` 의 `"audio"` 갈래는 **쓰이지 않게 된다.** 그 분기를 정리해라.
- `EXT_BY_TYPE`·`TYPE_BY_EXT` 의 `audio/mp4`·`audio/aac` 는 **남겨라** — 댓글 업로드에 쓴다.
- `DemoDashboard.tsx` 의 `🎙` 독립 항목 표시(`CALENDAR_MEDIA_KIND_LABEL` 의 audio 포함)는
  **이 결정으로 죽는 코드다. 같이 지워라.** 단 글·사진·영상 표시는 한 줄도 건드리지 마라.
- 이미 올라간 `mediaType='audio'` 행은 라이브에 **없다**(배포 전이다). 이관을 걱정하지 마라.

---

## 1. `calendar_media_comment` 에 음성 자리를 만든다

`lib/db.ts` `ensureSchema` 의 `calendar_media_comment` `ALTER` 들 옆(≈ `:997`).

```sql
ALTER TABLE calendar_media_comment ADD COLUMN IF NOT EXISTS audio_storage_key TEXT;
ALTER TABLE calendar_media_comment ADD COLUMN IF NOT EXISTS audio_url TEXT;
ALTER TABLE calendar_media_comment ADD COLUMN IF NOT EXISTS audio_ms INTEGER;
```

- **`audio_storage_key` 가 있으면 음성 댓글이다.** 그것이 판정 기준이다.
- `body` 는 **`NOT NULL` 이다**(`:993`). 음성 댓글은 **빈 문자열**로 넣어라.
  ⛔ `NOT NULL` 을 풀지 마라 — 기존 행·기존 쿼리가 전부 그 전제 위에 있다.
- `audio_ms` 는 길이(밀리초). 앱이 보낸다. **화면이 `0:07` 같이 보여주는 데 쓴다.**
  없으면 `null` 로 두고 화면이 길이를 안 보여주면 된다.

## 2. 업로드 — `app-media` 에 댓글 분기를 더한다

**새 라우트를 만들지 마라.** `app/api/app-media/route.ts` 는 이미 인증·multipart·스토리지·MIME 을 다 한다.

- 폼 필드 **`commentOf`**(사진 id)를 받아라. 기존 `pick(form, [...])` 관례대로 변형 몇 개.
- **`commentOf` 가 있으면** — 오디오(`audio/*`)만 허용하고, `calendar_media` 가 **아니라**
  `calendar_media_comment` 에 INSERT 한다. `insertCalendarMediaComment`(`lib/db.ts:4724`)를 써라.
- 검사 순서:

| 검사 | 실패 시 |
|---|---|
| Content-Type 이 오디오인가 | **400** (댓글에는 오디오만) |
| (`commentOf` 없는 오디오) | **400** — 오디오는 댓글로만 올라간다 |
| 크기 **10MB** 이하인가 | **413** |
| `commentOf` 사진이 **존재**하는가 (`getCalendarMediaById`) | **404** |
| 그 사진이 **잉크본이 아닌가** (`annotation_of IS NULL`) | **400** |

- ⚠ **권한은 잉크와 다르다.** 잉크는 "작성한 담당관만"이지만 **댓글은 소통 수단이라
  로그인한 담당관이면 남의 사진에도 달 수 있다.** 이 라우트가 이미 하는 인증
  (`verifyAppJwt`)을 통과하면 된다. **작성자 일치를 요구하지 마라.**
- 작성자(`author_*`)는 **JWT 에서 채워라.** 폼에 실려온 이름을 믿지 마라 — 위조된다.
  기존 댓글 라우트(`app/api/calendar/media/comment/route.ts`)가 작성자를 어떻게 채우는지
  **먼저 읽고 같은 방식**으로 해라.

## 3. 조회 — 댓글 목록에 음성을 실어라

댓글을 읽는 함수·라우트가 **새 세 컬럼을 그대로 내려보내게** 해라.
글 댓글은 지금과 **완전히 같은 모양**이어야 한다(오디오 필드는 `null`).

## 4. 삭제 — 파일도 지운다

댓글을 지울 때 `audio_storage_key` 가 있으면 **스토리지 객체도 지워라.**
잉크·사진 삭제가 이미 그렇게 한다(`deleteCalendarMedia` 가 키를 돌려주고 호출부가 정리).
**같은 방식**으로 맞춰라 — 권한을 통과해 실제로 지워진 경우에만 키가 나와야 한다.

⚠ 댓글 삭제 권한은 기존 규칙(`commentScopeClause` — 작성자 본인 또는 owner) 그대로다. **바꾸지 마라.**
⚠ 사진(원본)을 지울 때 그 댓글들이 어떻게 되는지 **지금 코드가 어떻게 하는지 읽고 보고해라.**
   음성 댓글의 파일이 남으면 고아가 된다. **고칠지는 네 보고를 보고 내가 정한다.**

---

## 하지 않는 것

- 앱 녹음 기능 · 관제웹 재생 UI — 별도 작업이다
- STT·글자 변환 — **녹음은 소리 그대로 남긴다.** 변환하지 마라
- 영상(`video`)·사진(`image`) 경로 — **한 줄도 건드리지 마라**

---

## 검증

1. 타입 검사·테스트를 돌리고 **숫자로** 보고. ⛔ `npx`·`npm install` 금지
2. **테스트를 더해라** — ⓐ 오디오+commentOf → 댓글 행 생성 ⓑ 없는 사진 → 404
   ⓒ 잉크본 지정 → 400 ⓓ 이미지+commentOf → 400 ⓔ **남의 사진에도 댓글이 달린다**
   ⓕ **글 댓글 등록·조회가 그대로 동작** ⓖ 음성 댓글 삭제 시 스토리지 키가 나온다
3. 회귀가 가장 큰 위험이다 — **기존 댓글·사진 업로드가 한 치도 달라지면 안 된다.**

---

## 끝나면

답변에 적어라 (astra-done.txt 는 쓰기 범위 밖이라 못 쓴다 — 내가 대신 적는다).

- 바꾼 파일과 줄 수
- 작성자를 **어디서** 채웠나 (기존 댓글 라우트 인용)
- **사진 삭제 시 댓글이 어떻게 되나** (지금 코드 기준)
- 테스트 결과(숫자)
- 네가 임의로 정한 것 전부
