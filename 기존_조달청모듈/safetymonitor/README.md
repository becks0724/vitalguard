# SafetyMonitor (가칭 IndusView)

산업 현장 작업자 생체 모니터링 — Apple Watch / Android Wear 작업자 단말 → 백엔드 → 관제 웹 대시보드 + 모바일 보조 앱.

이 파일은 진입 인덱스입니다. 상세는 아래 문서를 참조하세요.

## 어디서 시작하나

- **프로젝트 개요·정책·핵심 결정** — [CLAUDE.md](./CLAUDE.md)
- **현재 상태 (지금 어디까지 왔는지)** — [docs/progress.md](./docs/progress.md#quick-summary-30초-안에-읽기)
- **할 일 (체크리스트)** — [docs/checklist.md](./docs/checklist.md)
- **비전·MVP·마일스톤** — [docs/plan.md](./docs/plan.md)
- **의사결정 기록 (왜 그렇게 했는지)** — [docs/context-notes.md](./docs/context-notes.md)
- **상용화 로드맵 (잠금·배터리·플랫폼 분기)** — [docs/commercialization-roadmap.md](./docs/commercialization-roadmap.md)

## 빌드 / 테스트

빌드·테스트·실행 명령은 [CLAUDE.md](./CLAUDE.md#빌드--테스트--검증) "빌드 / 테스트 / 검증" 절을 참조하세요.

```bash
pnpm install
pnpm build      # packages + dashboard-web
pnpm test       # analyzers + schemas + dashboard
```
