# Compose 메인 2a — 검증 기록 · 2026-09-26

지시서: `../../../plan-draft/TASK-compose-main-stage2a.md`.
Gradle·네트워크·ADB·APK 설치·실서버 호출은 실행하지 않았다.

## 실행한 검사

| 검사 | 결과 | 한계/증거 |
| --- | --- | --- |
| 순수 Kotlin 컴파일 + JUnit | **165개 통과** | `python3 tools/check-jvm-offline.py`; `build/offline-jvm/junit.log`의 `OK (165 tests)` |
| Android/Compose Kotlin 소스 API 컴파일 | **통과** | `python3 tools/check-android-kotlin-offline.py`; main/androidTest/screenshotTest 전체. 캐시 클래스패스, SDK android.jar, R/BuildConfig 이름 스텁 사용 |
| XML 파싱 | **20개 통과** | manifest·drawable·adaptive icon·values 포함 |
| drawable Kotlin 참조 | **15개 확인** | main의 R.drawable 참조가 실제 리소스 이름에 존재 |
| Android 독립 경계 | **8개 확인** | 원장·ActionPlacement·RecordOrigin·순수 촬영 모델/파이프라인/저장 경계·화면 상태 계산에 Android/AndroidX import 없음 |
| 파일럿 복사 대조 | **3개 일치** | CaptureNative·TaskAwait·CapturePipeline은 패키지만 바꾼 원본과 동일 |
| 원본 해시 대조 | **114개 일치** | 프로젝트에 이미 있던 source-baseline.json의 Flutter lib/test·파일럿 Kotlin 표본과 일치 |
| 필수 문구·키·개행·공백 | **확인** | stage2a-static-audit.json; git diff --check 및 신규 텍스트 파일 점검 |

검사에 사용한 컴파일러는 캐시된 Kotlin 2.4.0, JVM 대상 17이다.
JVM 테스트는 JUnit 4.13.2, coroutines 1.10.2, org.json 20240303을 사용했다.
기존 BackgroundContrastTest는 Android/Compose 그래픽 경계이므로 순수 JVM 실행에서 제외했다.
직접 Android 소스 검사에서 사용한 AAR/JAR 목록은 `build/offline-android-kotlin/classpath.txt`에 있다.
이는 Gradle의 의존성 선택 결과를 대신하지 않는다. 사용 캐시에는 Navigation 2.10.2가 있었다.
컴파일 경고(기존 Compose test API deprecated, CameraX 관찰자의 불필요한 safe call, JBR 경고)는 오류가 아니었다.

## 확인한 주요 회귀

- Flutter v1 JSON의 키·선택 필드·로컬 시각, sending → uncertain 복구, 원장 계정/작업 ID 검증.
- bytes 우선 저장, 스냅숏 복사·동일 sourceKey 재사용, sending 저장 실패 시 POST 0회, 이중 탭·묶음 단일 실행.
- 사진 → 잉크 → 메모 → 음성, 부모 현장 복사, 서버 참조의 요청 시 합성, 401 갱신에서도 같은 ID.
- 부모 결과 불명/실패/재로그인 시 딸린 항목 대기, 조회 등록+receipt id 뒤 명시적 재개.
- 조회 50/50/1 배치, 자동 30초 제한, 수동 즉시 조회, 계정 전환의 늦은 응답, 비활성/백그라운드 중단.
- absent는 불명을 유지하며 자동 POST 없음. 새 조회 오류/재시작은 재시도 자격을 지움. 503·통신 실패는 absent 아님.
- 완료 영수증 저장 전에 파일 삭제 금지, 완료 파일·미리보기·초안 정리, 7일 초과와 정확히 7일 경계, legacy 1회 정리.
- 묶음/딸린 항목 삭제, 오프라인 보관·UI 전송 경계, 로컬 photoBytes와 목록·버튼 활성 조건.
- multipart 파일 형식·경계·메타/영수증·60초 요청 제한, JSON 댓글 작업 ID, 10 MiB 음성, 주소 display.
- 원본 OCR 선행, 위치/주소 실패 폴백, 다중 페이지와 원본 finally 삭제, 촬영 시작 시각·현장/JWT 각인,
  1장 상세·다중/부분 실패 목록 분기, 시간대와 무관한 KST 표시.

## 작성했으나 실행은 미확인

- 신규 Android 계측 15개: HoldBundleComposeTest 7, OutboxComposeTest 6, CaptureScreensTest 2.
  촬영 대신 enqueue와 주입 mock을 사용한다. 메인 Activity의 기록 스택·스크롤·회전, 목록/상세/전송/삭제,
  오프라인/필터/서버 조회/미등록 확인/재로그인, 카메라 권한 오류·스캐너 미준비 UI를 다룬다.
- 프리뷰 2개: 보낼 기록 866×1385dp, 로컬 사진 상세 1385×866dp, 340dpi. PNG·시각 검수는 미확인.
- Gradle assemble/test, 리소스 링크, manifest merge, APK 생성·설치, 실기기 카메라/스캐너/ML Kit/위치,
  기존 Flutter 앱 데이터 경로·서명·Keystore·덮어 설치, 실제 회전·제스처 인셋·큰 글꼴·메모리/저장 실패.
- 실서버 업로드·주소·조회·세션 갱신과 관제웹 확인. 원장 호환은 fixture/JVM 검사 범위다.

## 범위 경계

주석 편집기·메모/음성 입력·녹음기·세션 복구는 2b다. 두 진입 버튼은 원문의 활성 조건을 적용하고
“다음 단계(2b)에서 옮깁니다”를 표시한다. 설정 실행 위치 토글은 4단계, CCTV/경보 HTTP는 3단계다.
기존 원본/다른 프로젝트와 작업 중 외부에서 변경된 런처 이미지는 이 작업에서 수정하지 않았다.
코드·테스트·README·검증 파일은 새 Android 앱 안에 두고, 지시서 §3의 외부 완료 로그만 append한다.
