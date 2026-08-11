# vitalguard_app — 조건 A 웨어러블 신규 앱 (워치 → 아이폰 → 서버)

기존 iOS/워치 앱 코드를 활용하지 않는 **완전 신규 애플리케이션**(2026-08-11 사용자 결정).
Apple Watch 가 심박을 수집하고, 아이폰 네이티브가 큐·업로드를 전담하며, 관제웹이 실시간 모니터링한다.

## 상태 — ✅ PoC 완결 (2026-08-11)

Phase 0(워치→폰 수신) · 1(강제종료 생존 + 관제웹 프로덕션 연동) · 2(폰 화면 실시간 표시) **세 게이트 실기기 전부 통과.**
게이트 기록·트러블슈팅·운영 이월 항목 = **[SETUP.md](./SETUP.md)** (이 모듈의 단일 진실 소스).

## 구조 (계층 원칙 — 생체 데이터는 Dart 미경유)

| 레이어 | 파일 | 책임 |
|---|---|---|
| Watch (SwiftUI) | `ios/VitalWatch/WatchStreamer.swift` | HKWorkoutSession HR 수집·5초 배치·WCSession 송신(sendMessage→transferUserInfo 폴백) |
| iOS 네이티브 | `ios/Runner/PhoneReceiver.swift` | WCSession 수신·콘솔 로그 |
| iOS 네이티브 | `ios/Runner/VitalPipeline.swift` | 파일 영속 큐(유실 0)·`POST /api/app/vital` JWT 업로드·BGTask 재시도 |
| iOS 네이티브 | `ios/Runner/VitalBridge.swift` | Flutter MethodChannel(로그인·상태) + EventChannel `vitalguard/stream` |
| Flutter | `lib/main.dart` · `lib/vital_stream.dart` | 로그인(관제웹 계정 공용)·실시간 심박/큐 표시 **만** |

## 실행 방법

1. `ios/Runner.xcworkspace` 를 Xcode 로 열기(`.xcodeproj` 아님) → 스킴 `Runner` + 실기기 iPhone → Run.
   - **강제종료 생존 시험·홈 화면 단독 실행은 Release 구성 필수**(debug 는 디버거 없는 재기동이 즉사 — SETUP.md 참조).
2. 워치에 VitalWatch 설치(Watch 앱 → 사용 가능한 앱. 안 되면 워치 개발자 모드 확인) → 실행 → **시작**.
3. 폰 앱에서 **관제웹 계정 id/비번** 그대로 로그인(앱 전용 계정 없음) → 홈 화면에 실시간 심박.
4. 서버는 기본 프로덕션. dev 시험은 `ios/Runner/PoCConfig.plist` 의 `DevBaseURLOverride`(gitignore, 예시 = `PoCConfig.example.plist`).

## 신원·귀속 구조 (운영 모델의 핵심)

- **워치는 신원 없는 원시 샘플(bpm·시각)만** 보낸다. **아이폰이 전송 시점에 로그인 계정의 사번(workerId)·이름(workerName)을 부착**하고, 서버는 토큰 사번=본문 사번을 강제한다.
- 따라서 **어떤 워치를 페어링하든**(오늘 1번, 내일 2번) 본인 폰에 본인 계정으로 로그인돼 있으면 대시보드 귀속·이름 표기가 정확하다.
- 관제웹 작업자 행 이름 = `workerName` 표시(관제웹 관리자 프로필 입력이 있으면 그쪽이 오버라이드).
- ⚠ 같은 폰에서 **다른 계정으로 교체 로그인**하면 미전송 잔여 큐가 새 계정으로 귀속될 수 있다 — 보강 예정(SETUP.md 이월 ⑥).

## 서버 계약 요점

- `POST /api/app/vital` — 앱 JWT(Bearer) 필수·토큰 사번=본문 workerId 강제·배열 ≤500건.
- `source` 는 서버 화이트리스트 — 워치 생체 = `VitAlGuard-WatchVitals`. **미등록 source 는 201 이어도 dropped(조용한 유실).**
- 상세·함정 전체 = [SETUP.md](./SETUP.md).
