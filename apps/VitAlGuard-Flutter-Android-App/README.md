# VitAlGuard Flutter

VitAlGuard 8.2 (82)의 Android/Wear OS 중심 Flutter 앱입니다. 낙상 후보 규칙(자유낙하·충격·정지), 활력 데이터 계약, 현장 안전 대시보드와 휴대폰-시계 세션 동기화를 포함합니다.

## 플랫폼 구성

| 대상 | 구현 | 빌드 위치 |
| --- | --- | --- |
| iPhone | Flutter + WatchConnectivity 채널 | `flutter run -d ios` |
| Android | Flutter + Google Wear Data Layer 채널 | `flutter run -d android` |
| Apple Watch | 네이티브 SwiftUI 동반 앱 | `watchos_companion/Sources`를 기존 `VitAlGuard Watch` 타깃에 추가 |
| Galaxy Watch / Wear OS | 네이티브 Wear OS 동반 앱 | `cd android && ./gradlew :wearos_companion:assembleDebug` |

Flutter는 watchOS 또는 Wear OS 시계 UI를 직접 빌드하지 않습니다. 그래서 휴대폰 화면·도메인 규칙은 Dart로 공용화하고, 시계의 센서·Health 권한·기기 간 통신은 해당 플랫폼의 네이티브 동반 앱이 담당합니다.

Android 휴대폰과 Wear OS 앱은 동일한 package name과 서명으로 배포해야 Google Data Layer가 동작합니다. 세션 데이터에는 토큰이나 비밀번호를 넣지 말고, 실측·권한 확인 값만 관제 API로 전송하세요.
