# Compose 메인 2b — 구현·검증 기록 · 2026-09-27

지시서: `../../../plan-draft/TASK-compose-main-stage2b.md`.
이전 실행의 미완성 audio/·VoiceRecorder·MockVoiceRecorder·data/record 파일을 먼저 읽고 같은 파일을 이어서 완성했다.
Gradle·네트워크·ADB·APK 설치·실서버 호출은 실행하지 않았다.

## 실행 결과

| 검사 | 결과 | 증거와 한계 |
| --- | --- | --- |
| 순수 Kotlin 컴파일 + JUnit | **215개 통과** | `python3 tools/check-jvm-offline.py`; `build/offline-jvm/junit.log`의 `OK (215 tests)` |
| Android/Compose 소스 API 컴파일 | **통과** | `python3 tools/check-android-kotlin-offline.py`; main/androidTest/screenshotTest. 캐시 AAR/JAR + Android 37.0 android.jar + R/BuildConfig 이름 스텁 |
| XML 파싱·drawable 참조 | **20개/15개 통과** | `python3 tools/check-stage2b-static.py` |
| Android 독립 데이터/ADTS 경계 | **9개 통과** | data/record 6개, VoiceRecorder, MockVoiceRecorder, AdtsFrames |
| 기존 원본 SHA-256 | **120개 일치** | source-baseline.json의 Flutter lib/test/native Kotlin 및 촬영 파일럿 Kotlin |
| 원문 문구/키·선언 중복·권한·의존성 | **통과** | `stage2b-static-audit.json`; 필수 항목 29개, 새 라이브러리 0, RECORD_AUDIO와 RecognitionService query |
| 신규 Android 계측 테스트 | **12개 작성·소스 컴파일 확인, 실행 미확인** | RecordEditingComposeTest 8, InkRendererAndroidTest 2, MicrophoneAccessTest 2 |
| 편집기/입력 프리뷰 | **각 1개 작성·소스 컴파일 확인, PNG 렌더링 미확인** | Stage2bPreviewTest; 각각 866×1385dp, 340dpi, ko, 고정 데이터 |

직접 JVM 검사는 Kotlin 2.4.0, JUnit 4.13.2, coroutines 1.10.2, org.json 20240303, JVM 17 대상이다.
기존 165개와 2b 50개를 포함한다. Android/Compose 경계인 BackgroundContrastTest는 제외했다.
소스 API 검사에서 사용한 캐시에는 Navigation 2.10.2가 있었다. 전체 선택 목록은 `build/offline-android-kotlin/classpath.txt`에 있다.
이 검사는 Gradle 의존성 해석·리소스 링크·manifest merge·APK 생성·기기 실행을 대체하지 않는다.
기존 JBR 경고·Compose test/Tooltip API deprecation·CameraX safe call 경고는 남아 있으며 컴파일 오류는 없다.

## 확인한 경계

- 잉크: 희소 입력점 사이 선분 접촉, 사진 종횡비와 너비 기준 지우개 반경, 사각형 테두리, 점/중복점/형광펜/끝점,
  옛 지우개 시간순 복원, v:1 JSON, 2 MiB 정확한 경계, 정규화 반올림, 100획×400점 크기.
- 포인터: 손가락 이동/핀치에는 획이 생기지 않음, 1~4배 제한·접촉 구성 변경 뒤 기준 거리 재설정,
  펜 접촉 시 잔여 손바닥 무시, penCancel은 진행 획과 저장 스냅샷에서 제거, 회전/백그라운드는 받은 점까지 확정,
  재시작 전 lifecycle 콜백이 없어도 진행 중 펜 획 복구. 취소된 지우개는 원래 획을 유지하고 완료 삭제는 한 번에 undo.
- 주석 저장: 원문 sourceKey/draftKeys/annotationDraftId/dependsOn과 PNG 경계, 이전 리비전 교체·빈 잉크로 지우기,
  저장 후 깨끗한 빈 초안 비활성, 전송 중·결과 불명·완료 이전 잉크 거부, 2 MiB 초과 시 렌더/enqueue 없이 초안 보존,
  렌더 실패·계정 변경·저장 실패 뒤 복구. 이미지 로딩 중 닫힌 편집기가 세션을 다시 만들지 않음.
- 메모/STT: 최대 5개 후보, partial/선택만 한 후보는 영속화하지 않음, 문장 수정 시 전체 확인 해제,
  직접 쓴 글/확인한 문장만 초안 보관, 빈 초안 삭제, 같은 내용의 새 메모는 다른 리비전으로 새 항목,
  runId가 다른 늦은 이벤트 무시, 준비 중 취소/인식기 없음/권한 실패·status/error/cancelled 처리.
- 음성: 계정+사진 recorderKey, 시작/정지/미리듣기/자동 정지 문구, 타이핑 보존, 최대 3분 모의 타이머,
  파일 사본으로 native 캐시 유실 뒤 복구, native 종료 콜백 전 사라진 화면의 저널 복구,
  enqueue 성공 뒤 operationId 쓰기 실패도 sourceKey로 중복 방지, 저장 실패·읽기 실패는 원본 경로/사본 보존,
  10 MiB 초과 음성의 enqueue 거부, 다시 녹음/취소, ADTS의 완성 프레임만 복구,
  백그라운드 pause 뒤 늦게 끝난 미리듣기 읽기가 재생을 다시 시작하지 않음.
- 세션/lock: 사진 상세 → editor 또는 input 복구 대상, 최신 로컬 사진 메타 사용·서버 URL 제거,
  없는/완료된 묶음은 세션만 닫기, 계정 격리, 로그인당 복구 1회·원문 실패 스낵바,
  FieldCoordinator의 실제 재로그인 경로가 beforeLock을 호출하여 활성 획·메모·음성을 보관,
  한 초안 저장 실패가 다른 오디오 보관을 막지 않음, 로컬 저장이 끝난 뒤 화면 보존/탭 전환 완료.
- Android 계측 소스: 실제 MotionEvent stylus normal/cancel/FLAG_CANCELED 경로, Compose performTouchInput 무획,
  56dp 타깃/선택·180×64 저장·레일 잠금, 모의 메모/STT/음성 저장, Back/회전/재로그인 스택,
  선택 범위만 Bundle에 보관하는 커서 복원, 4160×3120 원본 렌더/알파/원본 픽셀, 늦은 권한 결과 차단을 작성했다.

## 구현 위치

- `audio/`: 이전 네이티브 Kotlin 복사본을 Flow/계약으로 연결, Activity에만 권한 요청 host 연결.
- `data/contracts/VoiceRecorder.kt`, `data/mock/MockVoiceRecorder.kt`: 녹음·STT 계약과 모의.
- `data/record/`: 이전 잉크/메모/음성/세션 컨트롤러를 이어서 완성하고 RecordWorkspace로 ViewModel 수명에 연결.
- `ui/record/RecordEditorScreen.kt`, `RecordInputScreen.kt`, `AndroidInkRenderer.kt`: 실제 R-04/R-06, raw 포인터, 공통 렌더러.
- FieldApplication/FieldViewModel/MainActivity/FieldApp: live/mock 조립·마이크 권한·수명·beforeLock·셸 첫 프레임 복구.
  NavController는 계정 셸에서 유지하여 가려진 탭에서도 완료된 저장의 pop이 같은 스택에 반영된다.
- FieldShell/ShellController: 편집기 동안 레일을 접고 펼치기를 막음. 기존 고정 경보 슬롯은 편집 중 지연 상태를 보유한다.
  실제 전역 경보 스트립 내용은 3단계 범위를 유지했다.

## 미확인

- Gradle assemble/test/connectedAndroidTest/updateScreenshotTest/validateScreenshotTest, 전체 의존성 조합,
  리소스 링크·manifest merge·APK 생성/설치·실서버/관제웹 결과·Flutter 서명/기기 저장 경로 호환.
- 신규 Android 계측의 실제 실행, 두 프리뷰의 PNG 생성/시각 검수, 접근성 읽기·큰 글꼴·IME/제스처 인셋.
- TB373FU의 펜 압력·팜 리젝션·지연/핀치/회전/분할창, 4160px 실제 메모리/OOM, 저장 공간 부족과 원자 파일 교체 실패.
- 실제 마이크 권한창/녹음/재생, 한국어 온디바이스 인식기와 모델 설치 상태, 실기기 STT timeout/오류,
  프로세스 강제 종료 중 ADTS 저널/복구·M4A 컨테이너 마감/용량 상한·백그라운드 중단.

## 수정 범위

코드·테스트·README·검증 파일은 `vitalguard_field_android/`에만 있다.
지시서 §3의 `../../../plan-draft/astra-done.txt`에만 기존 내용 뒤로 완료 기록을 추가했다.
다른 앱·Flutter·촬영 파일럿·기존 사용자 변경은 수정하거나 되돌리지 않았다.
