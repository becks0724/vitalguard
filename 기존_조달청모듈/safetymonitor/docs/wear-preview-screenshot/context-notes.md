# 워치 프리뷰 → PNG — 컨텍스트 노트

## 왜 (2026-08-29)
사용자 요청 *"삼성 One UI 로 갤럭시 워치 UI/UX 디자인을 Claude Code 에 연결해서 편집 가능 여부 확인"* 의
후속. 편집 축은 실측 완료(Kotlin·Wear Compose M3, `compileDebugKotlin` 8초 통과)였고 **빠진 것은
"결과를 눈으로 확인하는 축"** 이었다 — 에뮬레이터 이미지 0 · 연결 기기 0 · 스크린샷 도구 0.
세 길 중 (a) 프리뷰 스크린샷 플러그인을 사용자가 골랐다("2.(a) 착수").

## 사전 사실 (실측)
- 툴체인 = AGP 9.0.1 · Kotlin 2.3.20 · Gradle 9.1.0 · JDK = Android Studio 내장 JBR 25 (시스템 Java 없음 →
  `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"` 필수).
- 플러그인 최신 = `0.0.1-alpha15`. 요구 AGP 9.0 / Kotlin 2.1+ → **충족**.
- ⚠ Wear 장치 프리뷰(`device = WearDevices.LARGE_ROUND`)는 공식 문서에 "지원 예정" 이라
  **렌더 여부를 실험으로만 판정할 수 있다.** 이것이 이 트랙의 유일한 불확실성이다.
- 기존 프리뷰 14개 = `ui/VitalScreenPreview.kt` 9 + `ui/ProbeScreenPreview.kt` 5, **main 소스셋**에 있다.
  함수는 public, 장치 상수(`ROUND`/`SMALL`)는 `private const`.

## 결정
1. **main 의 프리뷰를 옮기지 않는다.** Android Studio 프리뷰 창이 그것을 쓰고 있고, 옮기면 wear-os-port
   트랙(옆 세션)이 보는 파일이 움직인다. `screenshotTest` 소스셋에 **얇은 래퍼**를 두고 main 의
   프리뷰 함수를 호출한다 — 래퍼는 장치·배경 파라미터를 같은 값으로 다시 선언한다(원본이 private const 라
   import 불가).
2. **`:wear` 에만 건다.** `:app`(Flutter) 은 건드리지 않는다. `gradle.properties` 플래그는 프로젝트
   전역이지만 플러그인을 안 건 모듈에는 효과가 없다.
3. **alpha 플러그인** — 실패하면 설정을 통째로 원복한다. 성공해도 CI 에는 안 건다(이번 범위 밖 ·
   참조 PNG 를 레포에 넣을지는 별건 판단).
4. **판정은 그림을 열어서 한다.** 태스크 초록만으로는 "Wear 스펙을 못 읽고 기본 사각형으로 그렸다" 를
   못 가른다(L-118⑥ — 이 초록불이 답하는 질문이 내가 묻고 싶던 질문인가).

## 실행 기록 (2026-08-29 17:1x)

**1차 — 컴파일 실패, 내 실수.** `@PreviewTest` 를 다중 `@Preview` 함수에 두 번 달았다 → `This annotation is not
repeatable`. 한 번만 단다. 플러그인·`screenshot-validation-api` 다운로드는 이때 끝났다.

**2차 — 엔진 초기화 실패, 플러그인 결함(비ASCII 경로).**
```
Preview Screenshot Test Engine > initializationError
  Caused by: java.nio.file.NoSuchFileException: …/ê¸°ì¡´_ì¡°ë¬ì²­ëª¨ë/…/apk-for-local-test.ap_
```
- 그 `.ap_` 는 **디스크에 있다**(851,653 bytes · `packageDebugScreenshotTestForScreenshotTest` 산출물).
- 스택의 경로가 `ê¸°ì¡´_…` 로 찍혔다 = **UTF-8 바이트를 Latin-1 로 읽은 모양**이다.
- 플러그인은 엔진 파라미터를 `build/wear/tmp/updateDebugScreenshotTest/preview_screenshot_config.properties`
  에 **UTF-8 원문**으로 쓴다(xxd 로 확인). 엔진 쪽은 `Properties.load(InputStream)` 계열로 읽는 것으로
  보이는데 그 API 는 **ISO-8859-1 고정**이다 → 한글이 든 경로 10개 키(`resourceApkPath`·`mainAllClassPath`·
  `dependencyJars`·`mainDirectory`·`previewDiffImageOutputDir` 등)가 전부 깨진다.
- 즉 **이 레포 경로에 한글(`기존_조달청모듈`)이 있어서** 터진다. 코드·설정 문제가 아니다. 검색으로는 공개된
  이슈·우회법을 못 찾았다(08-29).

**우회 후보.** ⓐ ASCII 심링크를 통해 `-p` 로 프로젝트를 지정(Gradle 이 경로를 실경로로 정규화하면 무효)
ⓑ 프로젝트를 ASCII 경로에 두는 것(레포 구조 변경 · 범위 밖) ⓒ 플러그인 수정 버전 대기.
ⓐ 를 먼저 실험한다 — 통하면 래퍼 스크립트 한 줄로 루프가 닫힌다.

**우회 실험 결과 (17:2x~).**
- ⓐ ASCII 심링크 + `-p` → **무효.** Gradle 이 프로젝트 경로를 실경로로 정규화한다(설정 파일에 다시 한글 경로가 찍혔다).
- ⓐ' `-Dsun.jnu.encoding=ISO-8859-1` 로 깨진 문자열이 원 바이트로 되돌아가게 하기 → **무효.** macOS JDK 는
  `sun.jnu.encoding` 을 UTF-8 로 고정하고 `-D` 를 무시한다(JBR 25 실측 · 통제군 포함).
- 파라미터 13개 키 중 한글 경로를 담는 것 = 11개는 `vitalguard_app/build/…`, 나머지 둘은 `projectRoot`(android/)
  와 `referenceImageDir`(`wear/src/screenshotTestDebug/reference`). 빌드 디렉터리만 옮겨서는 **둘이 남는다.**
- 두 태스크(`PreviewScreenshotUpdateTask`·`…ValidationTask`)는 Gradle `Test` 를 상속한다 — `jvmArgs`·`doFirst`
  는 걸 수 있으나 설정 파일은 태스크 액션 안에서 쓰이고 엔진은 포크된 워커에서 읽으므로 **중간에 끼어들 자리가 없다.**
- ⓑ **프로젝트를 ASCII 경로로 복사(rsync)해서 거기서 빌드** — 진행 중. 한 스크립트로 감싸면 루프는 닫힌다.
  단점 = Android Studio 안에서는 여전히 안 되고(실경로), 복사 1회/실행이 붙는다(소스만이라 수 초).

**ⓑ 성공 (17:3x).** `scratchpad/ascii/vitalguard_app`(rsync 2.5MB · build/ 제외)에서 `updateDebugScreenshotTest`
→ **BUILD SUCCESSFUL · 참조 PNG 14장**. 454×454 (LARGE_ROUND) 12장 · 384×384 (SMALL_ROUND) 2장 — `device=`
스펙이 실제로 먹혔다("지원 예정" 이라던 Wear 장치 프리뷰가 alpha15 에서는 된다). 총 368KB.

**판정 — 그림을 열어서.** 정상(88bpm 초록)·위험(온열 141bpm 빨강)·작은워치·프로브 백로그 4장을 직접 봤다.
둥근 클리핑 · 한글 글꼴 · 원형 게이지 3개 · 좌우 베젤 지시기(심박/스트레스) · 상태색이 모두 그려졌다.
검은 사각형(통제군)이 아니다. **성공 기준 ①②③ 충족.**

**결정 — 래퍼 스크립트로 고정.** `scripts/wear-shots.sh` = rsync(소스만) → `~/Library/Caches/vitalguard/wear-shots/`
(ASCII) → `updateDebugScreenshotTest` → PNG 를 `apps/vitalguard_app/build/wear-shots/` 로 복사(git 무시).
- 참조 PNG 를 **레포에 넣지 않는다**(별건 판단 · 368KB · 화면 바꿀 때마다 14장 diff). 캐시 경로에만 남는다.
- 스크립트가 캐시 경로의 비ASCII 를 자체 검사한다(처음 문제로 되돌아가지 않게).
- Android Studio 프리뷰 창은 이 결함과 무관하게 종전대로 된다(IDE 는 자기 렌더러를 쓴다).
- ⚠ `validateDebugScreenshotTest` 도 같은 이유로 **한글 경로에서는 못 돈다** → CI 게이트로는 못 쓴다(범위 밖이었다).

**검증 3종 (17:4x).**
- A `validate`(ASCII 복사본) = 14 중 **9 실패 · 5 통과**. 실패 9 = 생체 요약 9장 전부, 통과 5 = 프로브 5장 전부 —
  갈림이 `TimeText()` 유무와 **정확히 일치**한다(`VitalScreen.kt:79`). diff 그림을 열어 보니 자홍색 표시가
  시계 자리(5:22)에만 있다. 렌더러는 결정적이다. 픽셀 게이트가 필요해지면 프리뷰에 고정 시각을 주입한다(main 변경이라 별건).
- B `scripts/wear-shots.sh` e2e = 14장 · **6.6초**(캐시 경로 첫 실행인데도 — Gradle 빌드 캐시가 scratch 빌드의 산출물을 재사용).
- C 주 트리(한글 경로) `compileDebugKotlin` + `testDebugUnitTest` = **246/246 · exit 0**. 설정 추가가 정상 빌드를 안 건드린다.
- 산출물 갤러리를 아티팩트로 발행했다(14장 + 시계 diff 1장 · 477KB) — 터미널에서 그림을 못 보므로.

## 2차 (17:3x) — 사용자 지적: 갤럭시워치9 실제 레이아웃과 다르다
아티팩트가 요약 화면 9장 + 프로브 5장뿐이었다. **실제 앱은 세로 페이저 7장**이다(`MainActivity.kt:337` —
0 요약 · 1 심박 추이 · 2 산소포화도 추이 · 3 체온 추이 · 4 스트레스 추이 · 5 오늘 걸음 · 6 설정, 그리고 로그인).
빠진 이유 = **그 화면들에 `@Preview` 가 없었다.** 도구가 놓친 게 아니라 프리뷰가 없어서 그릴 대상이 없었다.
- `screenshotTest/…/WearPageShots.kt` 신설 — 페이지 1~6 + 로그인 + 체온 워밍업, 9장. main 은 안 건드렸다.
- 표본은 결정적 식(시각·난수 없음)으로 만든다 → 두 번 그려도 같다. 스트레스 값(15)은 화면이 `Stress.compute`
  로 직접 계산한 것(심박 96 · HRV 42 · kcal 12 · 걸음 340).
- 결과 **23장**(9 + 9 + 5). 9장 전부 열어 봤다 — 차트·임계선·결측 끊김·피부온/주변온 겹침·걸음 계단 렌더.
- ⚠ **관찰(수정 안 함)** — 상세 5장 모두 **마지막 보조줄이 둥근 아래 가장자리에 잘린다**(심박 "평균",
  SpO₂ "측정 주기", 체온 "차이", 스트레스 "활동 강도" 절반). 454px 은 워치9 44mm(450px)와 거의 같아 실기에서도
  같을 가능성이 높다. 고칠지는 별건 — 세로 패딩 `w*0.10` 또는 줄 수 상한.

## 3차 (18:1x) — 실기 대조 (무선 ADB · SM-L355N · Android 17 · 480×480)
- 연결 경로 = R-11 그대로. 사무실 공유기(192.168.10.x)와 Mac 핫스팟이 갈려 한 번 막혔고, 워치를 BECKS 핫스팟으로
  옮기고 **Wi-Fi 항상 켜짐 + 폰 블루투스 OFF** 로 절전을 끊은 뒤 링크로컬 `[fe80::fc0f:38ff:fecb:a56e%en0]:36649`
  로 붙었다. 이웃 판별 = 기본 라우터(폰)는 DNS 53/853 이 열려 있고 워치는 아무 포트도 안 연다(드롭).
- 7장을 **기기 안 한 셸 호출**로 떴다(`am start` → `screencap` → `input swipe` ×7) → `adb pull`. R-11 ④.
- ★ **프리뷰의 "마지막 줄 잘림" 은 실기에서 안 난다.** 실기 480px 은 LARGE_ROUND 454px 보다 아래 여백이 있어
  심박 "평균"·SpO₂ "측정 주기"·체온 "차이"·스트레스 "활동 강도" 가 전부 보인다. **장치 스펙 차이였다** —
  워치9 44mm 를 보려면 프리뷰 장치를 `spec:shape=Round,width=480,height=480,unit=px,dpi=<실기 밀도>` 로 준다(별건).
- 실기 상태(18:12) = 위험(피부온 38.7 · 주변 34.2 · 두 선 나란히 → R-25 기기 발열 의심 · 심부 추정 37.2 정상).
- 산출물 = `apps/vitalguard_app/build/wear-shots-device/vg_0~6.png`(git 무시). 아티팩트에 "실기 대조" 절로 실었다.

## 4차 (18:1x) — 루프 실전 · 사용자 편집 요청 2건
① **베젤 띠 연장** — "좌우 띠를 위아래로 더 길게". `Bezel.SWEEP` 70°→100°(좌 130°~230° · 우 50°~−50°), 15° 씩 양끝.
   이름은 `bandLabelDeg` 가 띠 한가운데를 계산하므로 손 안 대고 따라왔다. `BezelTest` 4건(12시·6시 침범 금지 ·
   좌우 같은 방향) 그대로 통과 — 단언이 상수를 읽지 숫자를 박아 두지 않아서다([[L-106]]). 작은 워치(384)에서 띠 위끝이
   `● 수집` 줄에 바짝 붙는다 — 겹치진 않는다. 15° 는 첫 제안값이고 사용자가 보고 더 늘리거나 줄인다.
② **로그인 한 화면** — 제목이 위 가장자리에, 로그인 버튼이 아래 가장자리에 잘렸다. 세로 contentPadding 22dp +
   칸(9/14sp · 안 5dp)·버튼(40dp) 축소. 결과 = 제목·칸 2·로그인이 454px 한 화면에 들어온다. **취소 버튼은 스크롤 아래**
   (226dp 에 다섯 항목은 안 들어간다). 취소를 로그인 옆 반폭 버튼으로 두면 한 화면에 다 들어오나 조작 방식이 바뀌어 별건.
   편집 → 렌더 5.5초 → 확인. 단위테스트 246/246.

## 5차 (18:2x) — 베젤 120° 확정 + 그라데이션
- 후보 100/120/140° 를 **캐시 사본만 고쳐** 렌더해 갤러리에 나란히 놓았다(주 트리 무변경 · 캐시는 원복). 사용자가 120° 선택.
  140° 는 위끝이 `● 수집` 상태줄에 닿는다 — 상한 근거로 주석에 남겼다.
- **그라데이션** — `drawBand` 의 구간 트랙을 칸 단색+틈에서 `Brush.sweepGradient` 로. 정지점 = 구간 중앙에 제 색, 양끝 연장.
  현재 구간만 원색(같은 브러시 alpha 1)으로 덧칠 → "어느 등이 켜졌나" 의미 보존. ⚠ 우측 띠(-60°~60°)는 sweep 의 0° 를
  가로지르므로 0 과 1 에 0° 의 색을 같이 박아 이음매를 없앴다. 구간 헬퍼 `arc()` 는 안 쓰게 돼 제거(23줄).
- 렌더 확인 3장(정상·위험(온열)·작은워치) · 단위테스트 246/246(BezelTest 는 각도만 본다 · 색 단언 없음).

## 6차 (18:3x) — 원형 게이지 3개 트랙 그라데이션
- `VitalBubble(zones=)` 신설 — 트랙을 `BezelBand.gradientStops()` 재사용으로 그린다(브러시 계산 한 곳). alpha 0.30(띠보다 진하게 · 버블이 작다).
- 구간은 임계 상수에서(`spo2Zones`·`skinZones`·`psiZones` · L-106). SpO₂ 축 85/100 리터럴은 `SPO2_GAUGE_MIN/MAX` 로 올렸다.
- **채움은 단색 유지** — 스펙트럼으로 칠하면 정상 SpO₂ 도 빨·주를 지나 올라와 위험처럼 읽힌다. 트랙이 "어디부터 위험" 을, 채움이 "지금 판정" 을 말한다.
- 렌더 3장(정상·위험 SpO₂·대기) 확인 · 단위테스트 246/246.

## 7차 (18:3x) — 상세 페이지 보조줄 잘림 수정 (`DetailPage.kt`)
- 사용자 지적 — 프리뷰(454)에서 마지막 보조줄이 둥근 아래 가장자리에 잘린다. 실기(480)는 3줄까진 괜찮았으나
  심박 페이지는 HRV 가 있으면 **4줄**이라 실기에서도 넘친다. 그래서 고쳤다.
- 두 축을 함께 다뤘다. **세로** = 위아래 여백 10%→7% · 값 34→30sp · 보조줄 11→10sp/간격 3→1dp → 4줄까지 226dp 안.
  **가로** = 보조줄만 5% 씩 더 들여 아래쪽 좁은 현(chord) 안에 — 맨 아래 줄은 중심에서 ~70dp 아래라 현 폭 176dp,
  차트 폭 163dp 는 거기서 모서리가 잘린다. 세로만 줄였으면 "평균" 의 첫 글자가 계속 잘렸다.
- 렌더 4장(심박 4줄·체온·걸음·SpO₂) 전부 보조줄 온전. 단위테스트 246/246.
