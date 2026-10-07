# Compose 3단계 — CCTV·경보·현장 상세 검증 (2026-09-27)

기준: 2d `690e87b8`. 구현은 이 Android 앱 폴더에 한정하며 Flutter·서버·신 DB 코드는 변경하지 않는다.

## 구현 계약

- 현장 요약에서 기상·작업자·가스·AED 상세와 CAM-03 CCTV로 이동한다. 상세에서도 기존 수신/오류/오래됨/수동 갱신 상태를 공유한다.
- 경보 5종, 미대응/대응완료·종류 필터, 상세의 명시적 대응 확인. 행 선택·스트립 선택/닫기는 POST를 만들지 않는다.
- 경보 ID는 기존 **양의 정수 JSON number**와 신 DB **UUID JSON string**을 구분해 보낸다. workerId/type 폴백이나 혼합 요청은 하지 않는다.
- 단일 POST, 결과 불명 후 새 GET 대조, 없는 행·부분 실패를 완료/재시도 가능으로 바꾸지 않음, 자동 POST 재전송·오프라인 예약 없음.
- 서버의 siteScoped 값에 따라 현장/전체/미확인 범위를 표시한다. 경보 처리자·처리 시각을 앱에서 만들어내지 않는다.
- 전역 경보 띠는 수신 목록만 관찰한다. 새로운 경보로 현재 표시를 바꾸지 않고, 편집 중 숨기면서 동일 높이 슬롯을 유지한다.
- 기상 풍속은 화면에서만 km/h→m/s, 가스는 서버 단위를 그대로 표시한다. 단위 미제공은 숫자 표시 보류, idle 측정값 숨김.
- 작업자 끊김 상태에서 생체값을 현재값으로 표시하지 않는다. 개인정보 가림이 true/null이면 좌표를 보관·표시하지 않는 모델 계약을 유지한다.
- AED 교환 잔여 일수와 미수신/빈 목록을 구분한다. 날짜·정상 판정을 추정하지 않는다.

## CCTV

- 매 요청 새 1회용 티켓. `/api/app/admin/cctv-ticket {cameraId:CAM-03}` → 게이트 `/cctv/stream3`.
- 게이트에는 발급 티켓만 Authorization 헤더로 전달한다. 앱 access/refresh 토큰·쿼리 토큰을 전달하지 않는다.
- 게이트 URI에서 사용자정보·쿼리·fragment를 거부하고 리다이렉트·캐시를 비활성화한다.
- 기존 네이티브 Manifest의 `usesCleartextTraffic=false`를 유지한다. HTTP 게이트는 명확한 HTTPS 필요 메시지를 표시한다.
- 이미지/MJPEG 첫 파트만 읽고 연결을 닫는다. 본문 16MiB·헤더 64KiB·boundary 200자·전체 요청 15초 제한.
- 2/5/10초 갱신, 실패 시 최대 60초 backoff, 이전 이미지는 마지막 수신·오래됨 표시와 함께 유지한다.
- 화면 이탈·백그라운드에서 게이트 연결과 다음 요청 중지. 발급 중이던 공유 인증 요청의 늦은 결과로 숨은 화면의 게이트를 열지 않는다.
- 계정 변경/로그아웃에서 이미지·경보 데이터와 표시 대기열을 비운다.

## 실행 결과

| 검사 | 결과 |
|---|---|
| Gradle JVM | **291/291**, 기존 264 + 신규 27 |
| 신규 실기기 Stage3ComposeTest | **4/4**: 상세 4종, 명시적 ack 1회, 띠 보류/높이, CCTV 새 티켓/이탈 중지 |
| 프리뷰 | **15/15**, 기존 8개 픽셀 해시 동일 + 신규 7개 시각 검토 |
| 전체 실기기 | **47/47**, 128.41초, 한 번의 전체 실행 결과 |
| 실제 서버·장비 | 기존 세션 자동 복원, 상세 4종·경보 조회, CAM-03 연속 실영상 수신 확인. 실제 경보 대응 상태는 변경하지 않음 |

초기 검사에서 옛 LoginGatewayTest의 “CCTV는 다음 단계” 기대가 실패했다. 이를 실제 전용 티켓 경로·본문·응답 검사로 갱신했다.
기존 FieldAppComposeTest의 경보/현장 자리 화면 기대도 실제 화면 이동 검사로 바꿨다. 기존 검증 범위는 삭제하지 않았다.

실기기 확인:

- 기상: 현장 좌표·기상 출처·캐시 여부·기상/전체 수신 시각이 표시됨.
- 작업자: 실제 서버의 집계·개인정보 가림 여부가 표시됨. 가림/미수신 위치의 비표시는 JVM/계측 합성 표본으로 검증.
- 가스: 실제 O₂ 20.7%와 감지기 수신 시각(9/23)을 표시하고 **이전 수신 값** 경고가 나타남.
- AED: 서버 등록 0대·빈 목록을 명시적으로 표시.
- 경보: 라이브의 전체 현장 범위·미대응 0 표시. 운영 경보를 생성하거나 대응 확인하지 않음.
- CCTV: **15:52:47 KST 수신 → 15:53:20 KST 새 수신**, 실제 CAM-03 GoPro/Jetson 오버레이 영상 확인.
- 계측 전후 개발 앱 로그인 파일 해시 일치. 테스트 후 기존 계정으로 로그인 재입력 없이 복원.

실영상 확인 뒤 CCTV 표시만 추가 보완했다: 기존 프레임이 있을 때 갱신 문구 때문에 영상이 위아래로 움직이지 않게 하고,
남은 화면 영역 안에 종횡비를 유지한 **전체 프레임**을 표시한다. 큰 글자는 제어 영역 안에서 스크롤한다.
해당 변경 뒤 빌드·프리뷰 **15/15**, 이미지 경계가 본문 영역 안에 있는지 추가 검사한 CCTV 실기기 **1/1(8.07초)** 통과.
이후 계정 전환 직후에도 현재 계정을 동기 대조하도록 경보 가드를 보강했고, 최종 APK에서 전체 47개 실기기 검사를 다시 통과했다. 실제 화면 PNG와 로그는 로컬 증적이며 코드 커밋에 포함하지 않는다.

최종 개발 APK: 62,429,337B, SHA-256 `6bfc7134318f57d494a504a84bdd20f951e200d84c86cdccc494370ca5fc08c1`.
원본 프로젝트 `app/build/outputs/apk/debug/app-debug.apk`와 로컬 증적 폴더 `app-stage3-debug.apk`에 같은 파일을 보관했다.
versionName은 기존 `0.3-stage2b` 문자열을 유지한다. 릴리스 버전·서명은 4단계에서 정리한다.

## 재현

별도 ASCII 검증 폴더 `/private/tmp/vg-compose-20260927-stage3`에서 JBR과 기존 Gradle 캐시를 사용했다.
의존성 추가 없음. Navigation Compose는 `-PnavigationComposeVersion=2.10.2`로 고정한다.

```sh
./gradlew --offline -PnavigationComposeVersion=2.10.2 :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest
./gradlew --offline -PnavigationComposeVersion=2.10.2 :app:validateDebugScreenshotTest
adb -s HA2HG0SD install -r app/build/outputs/apk/debug/app-debug.apk
adb -s HA2HG0SD install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s HA2HG0SD shell am instrument -w -r com.vitalguard.field.dev.test/androidx.test.runner.AndroidJUnitRunner
```

대상 앱을 삭제하는 Gradle connected-task 대신 직접 runner를 실행해 로그인·기기 기록을 보존한다.
실제 기기 조작 시 모의 테스트용 데이터와 실서버 데이터를 구분한다.
증적 위치: 상위 프로젝트 `artifacts/compose-stage3-20260927/`.

## 후속 경계

- 신 DB의 실제 UUID 경보·역할·현장 격리 통합 검증은 별도 신 DB 담당 트랙과 맞춘다.
- Tailscale 제거·핫스팟 문제·젯슨 서버 로그 수집은 이번 범위에서 변경하지 않는다.
- 설정·릴리스 서명·Flutter 파일/토큰 호환 및 release 교체는 4단계다.
- 기록의 자동 전송 시작 시점은 기존 상세 종료 동작을 유지했으며, 이번 3단계에서 변경하지 않았다.
