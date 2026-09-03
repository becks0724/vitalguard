# 관리자 앱 — 3단계 체크리스트 (보기 전용 뼈대)

착수 2026-09-03. 완료 기준은 각 항목 옆 괄호에 적는다.

## 3단계 — 로그인 → 작업자 현황

- [x] 새 Flutter 프로젝트 생성 (`com.vitalguard.vitalguard_admin` · Android 전용)
- [x] `flutter_secure_storage` 추가 (refresh 30일 Keystore 보관)
- [x] `theme.dart` — 작업자 앱 색 토큰 복사 (값이 관제웹 `globals.css` 와 같은가)
- [x] `api_client.dart` — `dart:io HttpClient` 래퍼 (401 을 만나면 refresh 한 번 시도하고 재요청하는가)
- [x] `session.dart` — 토큰 보관·복원·폐기 (로그아웃 뒤 저장소에 아무것도 안 남는가)
- [x] `login_screen.dart` — 2단계 로그인 (`twoFactorRequired` 를 받으면 코드 칸이 나오는가)
- [x] `worker.dart` — `/api/app/admin/workers` 응답 모델 (없는 값이 0 이 아니라 null 인가)
- [x] `workers_screen.dart` — 목록 (색·라벨·집계가 서버 값 그대로인가)
- [x] `main.dart` — 세션 복원 게이트 (재실행 시 로그인을 건너뛰는가)
- [x] `dart analyze` 0 (⚠ `flutter analyze` 는 한글 경로에서 죽는다 — context-notes 참조)
- [x] 시험 11건 — 가드 5종 변이 확인 — 판정을 클라이언트가 새로 하지 않는다는 가드 포함
- [ ] 노트10 실기 확인

## 완료 판정 (셋 다 되어야 3단계 끝)

- [ ] 노트10에서 로그인 → 6자리 코드 → 작업자 목록이 뜬다
- [ ] 목록의 색·라벨·"이상 N명" 이 **같은 시각 관제웹과 일치**한다
- [ ] 로그아웃 후 재실행 시 재로그인을 요구한다

## 범위 밖 (4단계 이후)

- 지도·배치·현장 정보
- 경보 확인(ack)·작업자 호출 등 **쓰기 동작** — 서버 라우트가 더 필요하다
- 작업자별 상세 화면 (여기서부터 `metric_tile`·`status_ring`·`heart_rate_trend` 재사용이 값을 한다)

## 노트10 실기 — 여기까지 확인됨 (2026-09-03)

- [x] 빌드 `assembleDebug` 성공 (23.8s)
- [x] 설치 성공 (`R3CM70ET7TW` · Android 12 · API 31)
- [x] 실행 시 크래시 0 · **`MissingPluginException` 0 · 브리지 오류 0** ← 설계 의도 확인
- [ ] 로그인 화면 눈 확인 — **기기 잠금 해제 필요**
- [ ] 로그인 → 6자리 코드 → 작업자 목록 — **비밀번호 필요(사용자 몫)**
- [ ] 목록이 같은 시각 관제웹과 일치하는지 대조
