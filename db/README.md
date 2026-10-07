# db/ — 데이터베이스 설계·감사·스키마

| 폴더 | 내용 |
|---|---|
| [`erd-vitalguard2/`](erd-vitalguard2/) | **신규 스키마(VITALGUARD2) ERD** — 74표·외래키 119·RLS 정책 149·트리거 146·마이그레이션 101. Mermaid 도식 16개 + 데이터 사전 + 「DB 전체 그림」(법 요건·3겹 방어) |
| [`integrated/`](integrated/) | VITALGUARD + SafeProcure 통합 스키마 덤프와 정합성 점검 증빙 |
| [`audit/`](audit/) | DB 종합 감사 보고서(HTML/PDF/MD), 수정 SQL, 백업 전략, 모니터링 설정 |
| `fall_ml/` | 낙상 ML 수집·판정 결과 스키마(1차·2차) |
| `imu_collect/` | 워치 IMU 윈도 적재 표(`imu_window`) — 낙상 ML 3종의 유일한 입력 |
| `calendar_media/` · `doc_media/` | 일정·증빙 미디어 스키마와 FK 고아 정리·3해시 전송 MVP |
| `safeprocure/` | 안전관리비 검증 모듈 스키마 — **README 의 실행 금지 경고 참조** |

설계 원칙은 [`erd-vitalguard2/README.md`](erd-vitalguard2/README.md) 「데이터를 지키는 세 겹(CHECK · RLS · 트리거)」 참고. 라이브 전환 상태와 남은 결정은 같은 문서의 「현재 전환 상태」에 있다.
