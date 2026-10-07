# SafeProcure 모듈 — 안전관리비 기준액 계산·검증

관제 대시보드(`safetymonitor`)에 **기존 파일을 고치지 않고 끼워 넣는 드롭인 모듈**이다. 새 패키지 설치 없이 기존 Next.js/React/zod 와 표준 fetch 만 쓰고, API 키가 없으면 샘플 데이터로 동작한다.

| 경로 | 내용 |
|---|---|
| [`INTEGRATION.md`](INTEGRATION.md) | 통합 가이드 — 복사할 경로, 환경변수, 동작 확인 순서 |
| `apps/dashboard-web/app/lib/` | 나라장터(G2B) 입찰공고·계약 조회 클라이언트, KOSHA 연동, 기준액 룰엔진, 타입·목업 |
| `apps/dashboard-web/app/api/` | 서버 라우트(G2B 프록시 등) |
| `apps/dashboard-web/app/safeprocure/` · `components/` | 검증 화면과 컴포넌트 |

**원칙** — 금액 산정은 AI 가 아닌 **결정적 계산**(요율 고시·공사 종류·규모 기준). 입력이 부족하면 단정하지 않고 「검토 필요」로 강등한다. 산식과 계수 출처는 발표자료 부록 E 와 같다.

관련 스키마: [`../../db/safeprocure/`](../../db/safeprocure/) · 통합 스키마 [`../../db/integrated/`](../../db/integrated/).
