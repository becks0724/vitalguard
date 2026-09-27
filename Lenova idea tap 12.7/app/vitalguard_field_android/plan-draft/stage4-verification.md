# Compose 4단계 — 설정·서명·Flutter 저장 호환, 2026-09-27

3단계 기준 `99cb6ea2`에서 이어갔다. 제품 서버·네트워크 설정은 변경하지 않는다.

## 구현

- 설정의 왼손/오른손 선택을 계정별 `settings:action-side`에 저장한다. ViewModel 수명에 묶어 회전·탭 이동 중 저장을 유지하고, 실패하면 이전 선택과 재시도 안내를 표시한다.
- 사진 상세·펜 편집의 기존 ActionDock과 워크 캘린더 촬영/스캔 FAB에 같은 선택을 적용한다. RTL에서도 실제 왼쪽/오른쪽을 유지한다.
- 버전은 release `1.1.0 / 2`, debug `1.1.0-dev / 2`. release 앱 ID는 기존과 같은 `com.vitalguard.field`, debug는 `.dev`다.
- 기존 Flutter `android/key.properties`를 UTF-8로 읽는다. 상대 키스토어 경로는 그 속성 파일의 부모 기준이다. 다른 checkout에서는 `-PreleaseSigningProperties=/secure/key.properties`를 지정한다. 비밀값·키스토어를 복사하거나 커밋하지 않는다.
- 서명 설정 누락·`vgMock=true`는 release 준비 단계에서 실패한다. release의 VG_MOCK는 false로 고정한다. 디버그 서명 fallback은 없다.
- 검증해 온 Navigation Compose `2.10.2`를 기본값으로 고정했다. 새 라이브러리는 추가하지 않았다.

## 기존 설치본과의 실제 호환 검사

기기 TB373FU / HA2HG0SD / Android 16의 설치 APK를 읽어 검증했다.

| 항목 | 기존 Flutter | Compose release |
|---|---|---|
| package | com.vitalguard.field | com.vitalguard.field |
| versionName / versionCode | 1.0.0 / 1 | 1.1.0 / 2 |
| 인증서 SHA-256 | `7fa04be4e50b6db653124449b97cfa7155a627e0de8ccfb90079aed1056ad090` | 동일 |
| noBackup 토큰 | field-session.enc | 같은 경로 |
| AES/GCM alias·AAD | vitalguard.field.session.v1 | 동일 |
| 계정 기록 | field-records/accounts/{base64url, 80자 분할}/entries/{키}/value | 동일 |

동일 서명으로 별도 패키지 `com.vitalguard.field.compatibilityprobe`를 설치해 기존 앱을 **읽기만** 검사했다. 실제 Compose의 DeviceLocalStore·QueuedFileStore·LocalStorePaths·모델·OutboxEntry 코드를 그대로 컴파일했다. Activity·FieldCoordinator를 시작하지 않아 세션 refresh·전송·청소를 실행하지 않는다. 원본 파일과 토큰은 기기 밖으로 내보내지 않고 집계·boolean만 출력한다.

- 토큰 복호화·사용자/만료 형식 검사 통과, refresh 만료 전.
- 계정 **2**, 저장 키 **16**, 전송 이력 **7**, 초안 JSON **4**.
- 미완료 전송 **0**, 원본 누락 **0**, 파싱 오류 **0**.
- 검사 전후 noBackup 전체 파일 해시 맵이 같음(`files_unchanged=true`). 해시·계정 ID·자격 증명은 출력하지 않았다.
- 최초 도구에 전체 UI 의존성을 넣었을 때 Flutter AndroidX 리소스와 충돌했다. 저장/모델 코드만 포함한 최소 도구로 수정해 검사 성공. 제품 APK의 문제가 아니며, 이 실패 시 제품 앱을 교체하거나 저장 데이터를 변경하지 않았다.

재현 도구: `tools/prepare-compatibility-probe.py`, `tools/compatibility-probe/`. 도구는 별도 ASCII 경로에만 프로젝트를 만들며, 제품 APK에는 포함되지 않는다. 기존 경로를 덮어쓰지 않는다.

```sh
python3 tools/prepare-compatibility-probe.py /private/tmp/vg-compatibility-check
# 생성한 경로에서, 원래 Flutter 속성 파일을 명시해 assembleRelease 실행
# apksigner verify --print-certs 로 기존 설치본과 공개 인증서 일치 확인
adb -s HA2HG0SD install -r /private/tmp/vg-compatibility-check/app/build/outputs/apk/release/app-release.apk
adb -s HA2HG0SD shell am instrument -w -r \
  com.vitalguard.field.compatibilityprobe/com.vitalguard.field.compatibility.StorageCompatibilityProbe
```

## 빌드와 회귀

- Android Studio JBR 25.0.2 사용, 소스/바이트코드 JVM 17, Gradle offline, ASCII 복사본 `/private/tmp/vg-compose-20260927-stage4`.
- JVM **295/295**. 계정별 설정·실패 복구·연속 선택·취소 검사를 추가했다.
- 프리뷰 **17/17**, 기존 **15개 PNG 해시 동일**. 일반 설정 및 2배 글꼴의 좁은 화면 2개를 추가하고 육안 확인했다.
- 서명 누락·모의 옵션 릴리스 요청이 각각 의도한 오류로 중단됨.
- 실기기 **49/49**, 전체 1회 최종 실행 **135.029초**. 첫 실행의 49개 중 2개는 옛 설정 자리 화면 기대값이어서 실제 설정 화면으로 갱신했다. 촬영/스캔 FAB의 실제 좌·우 위치도 단언했다.
- 테스트는 직접 설치·instrument 방식이다. connectedDebugAndroidTest의 대상 앱 삭제를 사용하지 않았다.

| APK | 크기(B) | SHA-256 |
|---|---:|---|
| debug | 62,711,356 | `4dba53237a1dc7d7a58fe23f935b5c2f7a964e59d9902beba13148d0c5015082` |
| release | 57,025,152 | `0f536eb193143061675b341d4a1f537632e41615fdd1de784ff213dccd3579f9` |

원본 프로젝트의 `app/build/outputs/apk/{debug,release}/`와 `../../artifacts/compose-stage4-20260927/`에 APK를 보관한다. 개인정보가 있는 화면 캡처와 기기 자료는 로컬 artifacts에만 둔다.

## 설치 확인

- 2026-09-27 **22:00 KST**, `adb install -r`로 위 release APK를 기존 `com.vitalguard.field`에 설치했다.
- UID **10303**, 최초 설치 시각 **2026-09-16 12:50:57**, 카메라·위치 허용 상태 유지. debuggable 플래그 없음.
- Activity가 Flutter의 `com.vitalguard.vitalguard_field.MainActivity`에서 Compose의 `com.vitalguard.field.MainActivity`로 바뀌었고, 콜드 실행 **305ms**로 성공했다.
- 앱 첫 실행 전 읽기 검사를 다시 실행: 토큰 복호화 성공, **2계정·16키·전송7·초안4·대기0**로 교체 전과 동일. 각 읽기 검사 전후 파일 불변 확인.
- 실제 저장 계정·현장으로 **오프라인 복원**, 설정에 `앱 버전 1.1.0` 표시, 전송 이력에 기존 완료 묶음 표시 확인. 임시 검사 패키지는 검증 후 제거했다.
- 기기는 **Active default network: none**, VPN UnderlyingNetworks가 빈 상태였다. 신규 서버 조회/온라인 갱신은 이번 release에서 미확인. 네트워크 설정을 바꾸지 않았고, 이는 3단계 당시 온라인 CAM-03 검증과 구분한다.
- 개발 `.dev` 앱도 최종 APK로 갱신해 공존한다. 최종 계측 진행 중부터 종료까지 로그인 암호문 파일 해시가 같았다. 첫 설치 전과 전체 작업 종료까지의 해시 불변은 주장하지 않는다.

## 연결 검증과 유지 조건

- 신 DB 담당 Peers 보고: 고정 앱 `99cb6ea2` + 서버 `6fe1c227`, 실제 LiveGateway/HttpUrlConnectionTransport/HttpCctvFrames → 격리 HTTPS 서버 → 실제 신 DB 스키마를 복제한 PostgreSQL 통합 **6/6**. UUID ack·중복·다른 현장·역할 차단·CCTV 티켓 사용을 확인했다. 제품 코드는 변경하지 않았다.
- 이 보고의 정본은 별도 작업 트리 `DB재구축/22_Compose_신DB_통합검증_20260927.md`. 실제 Jetson GATE_SITE와 신 DB sid 일치 여부는 별도 담당의 확인 대상이다. 격리 게이트 검사를 실제 Jetson 직결 검사로 기록하지 않는다.
- 사진 상세를 닫을 때 자동 전송하는 2c 동작을 유지한다. 정확한 시작 시점을 사용자가 새로 확정했다고 기록하지 않는다.
- 배터리 추가 1시간 측정은 사용자 제외 결정 유지, 젯슨 로그는 사용자가 가져오는 범위, Tailscale/핫스팟 설정은 변경하지 않는다.

서명·버전 확인 근거: [Android 앱 서명](https://developer.android.com/studio/publish/app-signing), [Android 앱 버전](https://developer.android.com/studio/publish/versioning).
