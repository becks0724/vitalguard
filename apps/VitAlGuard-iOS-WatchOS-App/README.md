# VitAlGuard iOS / watchOS 앱

Apple Watch 가 작업자의 심박·SpO₂·피부온·IMU 를 읽고, **온디바이스 Core ML 3종**으로 낙상을 판정해 폰을 거쳐 관제 서버로 보낸다. 서버 왕복 없이 판정하고, 이벤트가 있을 때만 전송해 배터리를 지킨다(event-gated).

| 경로 | 내용 |
|---|---|
| `Watch/` | watchOS 앱 — 센서 수집, IMU 88특징 추출, Core ML 추론, 요약 화면 |
| `Phone/` | iPhone 앱 — 인증 세션, 워치 연동, 위젯(`Widgets/`), 설정 번들 |
| `project.yml` | XcodeGen 프로젝트 정의 → `VitAlGuard.xcodeproj` |
| `scripts/` | 빌드·배포·GitHub 백업 스크립트 |
| `2026-07-30-V8.4-84-app-sync-release.md` | V8.4(84) 동기화 릴리스 노트 |

- 모델·판정 코어·검증 게이트: [`../../ML 3종 모듈/`](../../ML%203종%20모듈/)
- Android/Wear OS 동반 앱: [`../VitAlGuard-Flutter-Android-App/`](../VitAlGuard-Flutter-Android-App/)
- 실제 워치 화면 캡처: [`../../포트폴리오/서비스 화면/워치/`](../../포트폴리오/서비스%20화면/워치/)
