# 워치 프리뷰 → PNG (Compose Preview Screenshot Testing) — 체크리스트

**목표.** 워치 화면의 `@Preview` 14개가 **빌드만으로 PNG 로 떨어지는가** 를 판정한다.
되면 "Claude 가 워치 UI 를 고치고 → 그림을 읽고 → 다시 고친다" 루프가 기기·에뮬레이터 없이 닫힌다.

**성공 기준.** `./gradlew :wear:updateDebugScreenshotTest` 가 ① 통과하고 ② 참조 PNG 가 프리뷰 수만큼
생기며 ③ 그 PNG 를 열었을 때 **둥근 워치 화면에 실제 내용**(이름·수치·호)이 보인다.
반대 통제 = 검은 정사각형·빈 그림이면 "렌더는 됐지만 Wear 장치 스펙을 못 읽은 것" 으로 판정하고 실패로 센다.

**실패 시.** 빌드 설정을 원복한다(플러그인·플래그·소스셋 제거). 실기기 ADB 경로(②-b)로 넘어간다.

상태 범례. `[ ]` 미착수 · `[~]` 진행중 · `[x]` 완료 · `[-]` 실패/원복.

---

## 1. 산출물 (코딩 전)
- [x] `checklist.md` — 본 문서
- [x] `context-notes.md` — 결정과 근거

## 2. 빌드 설정 — `wear/build.gradle.kts` · `gradle.properties`
- [x] 플러그인 `com.android.compose.screenshot` **0.0.1-alpha15** — `:wear` 에만 적용(`:app` 무변경)
- [x] `android.experimental.enableScreenshotTest=true`
- [x] `screenshotTestImplementation` — `screenshot-validation-api` · `ui-tooling` (+ compose-bom 재선언)
- [x] 소스셋 `src/screenshotTest/kotlin/…` — 기존 프리뷰(main)를 **옮기지 않고** 얇은 래퍼로 호출 (`WearPreviewShots.kt` 13함수)

## 3. 실행·판정
- [x] `updateDebugScreenshotTest` 통과 — **단, 한글 경로에서는 실패**(플러그인 결함) → ASCII 복사본에서 통과. 상세는 context-notes
- [x] 참조 PNG 개수 = **14** = 프리뷰 수 (454×454 ×12 · 384×384 ×2 — 장치 스펙이 먹혔다)
- [x] **2차 — 페이저 1~6·로그인 9장 추가 → 23장**(사용자 지적 · 실제 앱 레이아웃과 달랐다 — 그 화면엔 프리뷰가 없었다)
- [x] PNG 를 열어 **둥근 화면 + 내용** 확인 — 정상·위험(온열)·작은워치·프로브 백로그 4장 실제로 봤다. 한글·게이지·베젤 지시기·상태색 전부 렌더
- [-] `validateDebugScreenshotTest` — **14 중 9 실패, 전부 시계.** 생체 요약 9장은 `TimeText()` 가 현재 시각을
      그려 분이 바뀌면 픽셀이 바뀐다(diff 그림에 자홍색이 시계 자리에만 있다). 시계 없는 프로브 5장은 5/5 동일 →
      **렌더러는 결정적.** 눈으로 보는 루프에는 무관 · 픽셀 게이트로 쓰려면 고정 시각 주입이 필요(범위 밖)
- [x] `:wear` 기존 검증 비회귀 — 한글 경로 주 트리에서 `compileDebugKotlin` + `testDebugUnitTest` **246/246** (exit 0)

## 4. 마감
- [x] 래퍼 `scripts/wear-shots.sh` — rsync→ASCII 캐시→update→PNG 를 `build/wear-shots/` 로 (git 무시 경로)
- [x] 결과를 `context-notes.md` 에 · 사용법 = `scripts/wear-shots.sh` 머리 주석
- [~] 커밋(`git commit -- <경로>`) → push 는 담당 세션에 요청 (L-125 · 담당은 사용자 확인 중)
