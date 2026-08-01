# VitAlGuard 8.9(89) iPhone·Apple Watch 통합 수정 및 개선 보고서

작성일: 2026-08-01
대상: iPhone 앱, Apple Watch 앱, Widget target

## 1. 릴리스 기준

Xcode 프로젝트의 모든 배포 target에 다음 값을 적용했습니다.

| Target | Bundle ID | Version | Build |
|---|---|---:|---:|
| iPhone | `com.yangjeehoo.vitalguard` | `8.9` | `89` |
| Apple Watch | `com.yangjeehoo.vitalguard.watch` | `8.9` | `89` |
| Widget | `com.yangjeehoo.vitalguard.widgets` | `8.9` | `89` |

설정 위치는 `project.yml`과 `VitAlGuard.xcodeproj/project.pbxproj`입니다.

## 2. iPhone 터치·스크롤·키보드 안정화

수정 파일: `Phone/Sources/VitAlGuardPreviewApp.swift`

- `TouchTrackingWindow`가 실제 터치 시작·이동·종료를 추적합니다.
- 사용자가 터치하거나 스크롤하는 동안 전체 화면을 재구성하지 않도록 지연시킵니다.
- 터치가 끝난 뒤 0.22초 후에만 보류된 UI 재구성을 실행해 탭이 다른 화면으로 튀는 회귀를 줄였습니다.
- `UIScrollView.delaysContentTouches = false`, `canCancelContentTouches = true`를 적용해 버튼과 스크롤의 응답성을 높였습니다.
- 화면 재구성 시 기존 `contentOffset`을 복원해 새로고침·탭 전환 뒤 스크롤 위치가 갑자기 바뀌지 않게 했습니다.
- 키보드 프레임 변경·숨김 알림을 처리하고, 입력 화면은 `keyboardLayoutGuide`와 interactive dismiss를 사용합니다.

## 3. 새로고침과 햅틱

- `UIRefreshControl`을 홈·Watch·CCTV 화면의 스크롤 흐름에 연결했습니다.
- 기존 요청대로 강한 중간 진동을 유지하기 위해 `UIImpactFeedbackGenerator(style: .medium)`을 사용합니다.
- 새로고침 시작 시 `impactOccurred(intensity: 0.9)`를 호출하고 다음 동작을 위해 즉시 `prepare()`합니다.
- 최소 0.35초 동안 새로고침 상태를 유지해 표시가 깜빡이지 않도록 했습니다.
- 홈·Watch·CCTV 새로고침은 각각 실제 동기화·Watch snapshot·CCTV 조회를 호출합니다.

## 4. 프레임 끊김과 화면 재구성 완화

- 터치·스크롤 중 반복적인 전체 UIKit 계층 재생성을 억제했습니다.
- 새로고침 후 스크롤 위치를 보존하고, Core Animation/UIScrollView 감속이 끝난 뒤 재구성하도록 했습니다.
- 이 변경은 iPhone 15 Pro Max에서 관찰된 뚝뚝 끊기는 체감을 줄이기 위한 구조적 수정입니다.
- 현재 코드에는 별도의 `120Hz` 강제 고정 API를 추가하지 않았습니다. 실제 ProMotion 프레임 안정성은 실기기에서 스크롤·새로고침을 반복해 최종 확인해야 합니다.

## 5. 관리자 호출·위치 공유·낙상 이벤트 데이터

수정 파일: `Phone/Sources/VitAlGuardPreviewApp.swift`, `Phone/Shared/VitAlGuardShared.swift`

- 이벤트 유형을 `manager_call`, `location_share`, `manual_sos`, `fall_detected`로 정규화합니다.
- 이벤트 요청에는 실제 로그인 ID와 작업자 ID가 모두 있어야 하며, 없으면 성공 처리하지 않습니다.
- 이벤트에는 `eventId`, `eventType`, `loginId`, `employeeId`, `actorName`, `ts`를 포함합니다.
- 작업 시간·작업 구역 조건에서는 `trackingMode = work_hours_zone`을 사용합니다.
- 사고 대응 이벤트에서는 `trackingMode = incident_snapshot`으로 기록합니다.
- 위치는 위도·경도·정확도·측정 시각·취득 주체(`iphone`)를 포함한 snapshot으로만 보냅니다.
- 실제 위치가 없을 때는 좌표를 만들지 않고 `locationUnavailable = true`를 보냅니다.
- 작업 시간 외 또는 작업 구역 밖에서는 지속 위치 추적을 활성화하지 않습니다.
- Watch 실측값은 iPhone 브리지에서 별도 필드로 전달하며, 시뮬레이터 값과 실기기 값을 구분합니다.

이 저장 계약은 클라이언트 payload 기준입니다. 서버의 `safety_events` 테이블 마이그레이션·운영 API가 실제 배포됐는지는 이 iOS 저장소만으로 확정할 수 없으므로, 서버 저장 성공 로그와 DB 조회를 별도 배포 게이트로 확인해야 합니다.

## 6. Apple Watch 낙상 ML v5 적용 및 과다 알림 차단

수정 파일: `Watch/Sources/FallMLPipeline.swift`, `Watch/Sources/MLFusion.swift`, `Watch/Sources/WorkoutManager.swift`

### 실제 실행 리소스

Watch 앱 번들에 다음 4개가 포함됩니다.

- `Watch/ML/work_veto.mlmodel`
- `Watch/ML/impact.mlmodel`
- `Watch/ML/recovery.mlmodel`
- `Watch/ML/thresholds.json`

첨부된 `impact.joblib`, `work_veto.joblib`, `recovery.joblib`은 학습·검증 산출물이며 watchOS 런타임에서 직접 로드하지 않습니다. 프로젝트 파일과 제공 파일의 SHA-256 대조 결과, 실행에 사용되는 4개 리소스는 일치했습니다.

### 알림 게이트

- 세 Core ML 모델이 모두 로드될 때만 낙상 ML 파이프라인을 활성화합니다.
- 출력이 없거나 잘못된 확률이면 후보를 알림으로 방출하지 않습니다.
- `work_veto >= 0.675`인 작업 동작 후보를 억제합니다.
- `peakG < 8.0`인 후보는 `impact >= 0.3876582891869371`일 때만 남깁니다.
- `impact < 0.05`인 후보는 억제합니다.
- ML self-check가 완료되지 않았거나 IMU window가 후보와 매칭되지 않으면 규칙 단독 알림을 만들지 않습니다.
- 이동이 감지되면 낙상 확인 프롬프트를 취소해 작업 중 오탐을 줄입니다.
- 실제 낙상 후보만 iPhone으로 전달하고, 작업 동작으로 veto된 후보는 알림으로 전송하지 않습니다.

## 7. 세션·Watch 브리지·실측 데이터 개선

- iPhone 앱 잠금·백그라운드 복귀 정책을 정비했습니다.
- Keychain에는 관리자 비밀번호를 보관하지 않고, access token과 refresh token을 분리 관리합니다.
- `401` 응답은 `reauth`인 경우에만 재인증 흐름으로 보내며, 모든 네트워크 오류를 자동 로그아웃으로 처리하지 않습니다.
- Watch vital 단일 전송과 batch 전송을 모두 지원합니다.
- Watch relay health check와 `vitalsRelayed` 응답을 추가했습니다.
- 실측 Watch snapshot과 시뮬레이터 relay payload에 출처·모델·식별자를 구분해 표시합니다.

## 8. 검증 결과

- 실패 우선 ML 게이트 테스트 후 수정된 회귀 테스트 통과
- Watch generic Debug build 성공
- iOS generic Debug build 및 임베디드 Watch 포함 산출물 성공
- Watch 앱 번들에서 `work_veto.mlmodelc`, `impact.mlmodelc`, `recovery.mlmodelc`, `thresholds.json` 확인
- `YJH’s iPhone 15 Pro Max`에 iPhone 앱 설치 성공, 버전 `8.9 (89)` 확인
- `YJH’s Apple Watch 6`에 Watch 앱 설치·실행 성공, 버전 `8.9 (89)` 확인
- iPhone 자동 실행은 기기 잠금 상태에서 `devicectl`이 거부되어 완료하지 못했습니다.
- TestFlight 업로드, Archive 배포, GitHub push는 실기기 동작 확인 전에는 진행하지 않았습니다.

## 9. 아직 완료되지 않은 검증

다음은 실제 착용 상태에서 사용자가 최종 확인해야 합니다.

1. 걷기·손목 흔들기·가벼운 작업 충격에서 낙상 알림이 반복되지 않는지
2. 강한 낙상 동작에서 알림이 유지되는지
3. iPhone에서 탭·스크롤·키보드·Pull-to-refresh가 자연스럽게 동작하는지
4. 새로고침 중 화면 재구성과 프레임 끊김이 재현되지 않는지
5. 관리자 호출·위치 공유가 실제 서버 이벤트와 DB에 저장되는지

특히 현재 Watch 게이트는 과다 알림을 줄이기 위해 낮은 G 후보를 보수적으로 억제합니다. 실제 낙상이 8G 미만으로 측정되는 환경에서는 민감도가 낮아질 수 있으므로, 위 실기기 결과를 바탕으로 임계값을 조정해야 합니다.

## 10. 변경 파일 요약

- `VitAlGuard for Phone&Watch)/project.yml`
- `VitAlGuard for Phone&Watch)/VitAlGuard.xcodeproj/project.pbxproj`
- `VitAlGuard for Phone&Watch)/Phone/Sources/VitAlGuardPreviewApp.swift`
- `VitAlGuard for Phone&Watch)/Phone/Shared/VitAlGuardShared.swift`
- `VitAlGuard for Phone&Watch)/Watch/Sources/FallMLPipeline.swift`
- `VitAlGuard for Phone&Watch)/Watch/Sources/MLFusion.swift`
- `VitAlGuard for Phone&Watch)/Watch/Sources/WorkoutManager.swift`
- `VitAlGuard for Phone&Watch)/Watch/Sources/VitalTransmitter.swift`
- `VitAlGuard for Phone&Watch)/Watch/ML/impact.mlmodel`
- `VitAlGuard for Phone&Watch)/Watch/ML/thresholds.json`

