# vitalguard_app — 조건 A 웨어러블 신규 앱 (워치 → 아이폰 → 서버)

기존 iOS/워치 앱 코드를 활용하지 않는 **완전 신규 애플리케이션**(2026-08-11 사용자 결정).
Apple Watch 가 심박을 수집하고, 아이폰 네이티브가 큐·업로드를 전담하며, 관제웹이 실시간 모니터링한다.

## 상태 — ✅ PoC 완결 (08-11) · 확장 완결 (08-12) · 수집 정직성 수리 (08-13~15)

Phase 0~2 실기기 전부 통과(08-11).
**08-12 확장** = 신원 정식화(EMP-6861·별칭 병합) · SpO₂ 갱신 구조(측정 1건=1행·30분 게이트) ·
심부체온 추정(심박 칼만·표시 전용) · 추세 차트 실데이터 3종 · 배터리 6.4%/h(풀시프트 가능).
**08-13~14 수집 확장** = 활동에너지·MET·일광(온열) · 스트레스 입력 6종(⚠ HRV 는 상시 워크아웃과
**구조적 배타**) · 배치 `ts` 중복으로 조용히 버려지던 이산 측정 수리.

**08-15 — 값이 사실을 말하게 하는 수리 세 건.**
- **하트비트 복사 중단**(`541bfa9`) — 미착용·측정 공백 구간에 마지막 심박이 영원히 흐르던 것
  (실사례 **12시간 34분·8,531건 전부 102bpm**). 30초 유효기간 · 프로덕션 실동작 확인
- **POST 5xx 큐 유지 실기기 검증** — 503 구간에 폰이 큐를 **1→41 건**으로 쌓고 복귀 시 일괄 배출
  (유실 0 · 중복 0). 서버측은 진짜 죽은 DB 로 8/8
- **`VitalWatch` 스킴 공유**(`10f194c`) — 워치 직접 Run 이 문서에만 있고 스킴은 없었다

⚠ **워치 화면 `잔량7` 은 고아 전송이다**(데이터 무해). 08-18 시험 B 에서 `잔량 − 7` 로 읽는다.

게이트 기록·트러블슈팅·운영 이월 항목 = **[SETUP.md](./SETUP.md)** (이 모듈의 단일 진실 소스).

## 구조 (계층 원칙 — 생체 데이터는 Dart 미경유)

| 레이어 | 파일 | 책임 |
|---|---|---|
| Watch (SwiftUI) | `ios/VitalWatch/WatchStreamer.swift` | HKWorkoutSession HR 수집 + SpO₂ anchored query(측정 이벤트만·앵커 영속)·5초 배치·WCSession 송신(sendMessage→transferUserInfo 폴백) |
| iOS 네이티브 | `ios/Runner/PhoneReceiver.swift` | WCSession 수신·콘솔 로그 |
| iOS 네이티브 | `ios/Runner/VitalPipeline.swift` | 파일 영속 큐(유실 0)·`POST /api/app/vital` JWT 업로드(heartRate·spo2+측정시각·workerName 부착)·BGTask 재시도·계정 교체 시 큐 폐기 |
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
- 같은 폰에서 **다른 계정으로 교체 로그인**하면 미전송 잔여 큐를 자동 폐기한다(오귀속 방지 — 직전 로그인 사번과 다를 때만, 08-12 보강). 첫 로그인·같은 계정 재로그인은 큐를 유지한다.

## 서버 계약 요점

- `POST /api/app/vital` — 앱 JWT(Bearer) 필수·토큰 사번=본문 workerId 강제·배열 ≤500건.
- `source` 는 서버 화이트리스트 — 워치 생체 = `VitAlGuard-WatchVitals`. **미등록 source 는 201 이어도 dropped(조용한 유실).**
- 상세·함정 전체 = [SETUP.md](./SETUP.md).
