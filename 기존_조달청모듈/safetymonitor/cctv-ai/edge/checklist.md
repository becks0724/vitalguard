# CAM-03 전송률 개선 체크리스트 (2026-09-01)

목표 = 관제웹 CAM-03 실전송 5.0fps → 1단계 ~12fps → (측정 후 판단) 2단계 ~20fps.
근거·결정·실측 수치는 `context-notes.md`.

## Phase 0 — 준비
- [x] 정본 확인 — 레포본 == Jetson 실행본 (md5 `2ad83290…` 일치)
- [x] 원인 실측 — 연산·GoPro·망 기각, 직렬 푸시 천장(10.7fps) 확정
- [x] 체크리스트·컨텍스트 노트 생성
- [x] cctv-ai OFF (00071-b8t · ingress internal · 과금 0)

## Phase 1 — 1단계 코드 (gopro_ppe_edge.py 한 파일)
- [x] ③ ~~캡처 스레드 분리~~ → **GIL 로 불가(py-spy 실측, 추론 0.5fps 폭락)** — 단일 스레드 + grab()/retrieve() 로 대체(같은 목적 달성)
- [x] ① 동시 푸시 — `_pusher` → `PUSH_WORKERS`(기본 2) 워커, 보낼 때 최신 프레임 선점(claim)
- [x] `/health` 에 `pushed` 카운터 노출 + `raw` 프레임 pop (JSON 직렬화 보호)
- [x] 기존 env·엔드포인트·health 필드 호환 유지 (INFER_FPS·PUSH_FPS 의미 불변)
- [x] `py_compile` 통과

## Phase 2 — 배포·측정
- [x] Jetson 백업 (`gopro_ppe_edge.py.bak-20260901`) 후 scp
- [x] 재기동 — 최종 운영값 `INFER_FPS=12 PUSH_FPS=12 PUSH_WORKERS=2` (⚠ pkill 은 `[g]opro…` 브래킷)
- [x] 무과금 검증 — stream_fps ≥ 28 복원 · infers ≥ 12/s · 재연결 증가 0
- [x] cctv-ai ON(사용자 승인) → 60초 실측 → OFF
- [x] 판정 게이트(숫자) — **실전송 9.7fps(기존 5.0 의 1.94배)** · 정상 구간 오류 0 · 재연결 0 · INFER 12 평형(지연 무) — ⚠ 11fps 목표는 INFER_FPS=20 전제였고 지연 트레이드오프로 12 채택(노트 발견 2)
- [x] 관제웹 육안 개선 확인(사용자 09-01 "확인 완료") → cctv-ai OFF(00073-56f·404 확인)·엣지 종료·GoPro STOP

## Phase 3 — 마무리
- [x] 운영값 확정 12/12/2 → 재개 런북을 context-notes 운영 메모에 기록
- [x] 커밋 — b215fad(코드+문서) · push 는 담당 세션 규칙대로 보류
- [ ] 2단계(② 추론/렌더 파이프라인 분리 → 생산 13.9→~27fps) 진행 여부 판단 — 1단계 실측을 보고
