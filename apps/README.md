# apps/ — 작업자용 앱

| 폴더 | 플랫폼 | 역할 | 상태 |
|---|---|---|---|
| [`VitAlGuard-iOS-WatchOS-App/`](VitAlGuard-iOS-WatchOS-App/) | iPhone + Apple Watch (+ 위젯) | 작업자 생체·낙상 감지(온디바이스 Core ML 3종), 폰-워치 세션 동기화 | 현행 · V8.x |
| [`VitAlGuard-Flutter-Android-App/`](VitAlGuard-Flutter-Android-App/) | Android + Wear OS (Flutter) | iOS 앱의 Android 동반 앱 — 낙상 후보 규칙, 활력 데이터 계약, 현장 대시보드 | 현행 · 8.2+ |

담당관(안전관리자)용 **태블릿 앱**은 별도 폴더 [`../Lenova idea tap 12.7/app/vitalguard_field_android/`](../Lenova%20idea%20tap%2012.7/app/vitalguard_field_android/) 에 있다(Kotlin/Jetpack Compose).
낙상 ML 모델·검증 게이트는 [`../ML 3종 모듈/`](../ML%203종%20모듈/) 에서 모듈 단위로 관리한다.
