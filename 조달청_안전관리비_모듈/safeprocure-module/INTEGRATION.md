# INTEGRATION — 안전조달(SafeProcure) 모듈 통합 가이드

> `safetymonitor` 기존 코드를 **수정하지 않고** 끼워 넣는 드롭인 모듈. 신규 파일만 추가한다.
> 새 npm 패키지 설치 없음(기존 next/react/zod + 표준 fetch). 키 없으면 샘플 데이터로 동작.

## 1. 파일 복사 (기존 파일 덮어쓰기 없음)

이 폴더(`safeprocure-module/`)의 트리는 레포 루트 구조와 동일하다. 레포 루트에서:

```
safeprocure-module/apps/dashboard-web/app/lib/        → apps/dashboard-web/app/lib/
safeprocure-module/apps/dashboard-web/app/api/g2b/    → apps/dashboard-web/app/api/g2b/
safeprocure-module/apps/dashboard-web/app/components/ → apps/dashboard-web/app/components/
safeprocure-module/apps/dashboard-web/app/safeprocure/→ apps/dashboard-web/app/safeprocure/
```

추가되는 신규 파일:
```
app/lib/safeprocure-types.ts      app/lib/safety-cost.ts        app/lib/safety-cost.test.ts
app/lib/g2b.ts                    app/lib/g2b-mock.ts           app/lib/risk-tagging.ts
app/lib/procure-risk.ts
app/api/g2b/notices/route.ts      app/api/g2b/notice/[id]/route.ts
app/components/ProcureRiskBoard.tsx   app/components/ProcureRiskCard.tsx
app/safeprocure/page.tsx
```
> 모두 신규 경로라 기존 파일과 충돌하지 않는다. (동명 파일 없음)

## 2. 환경 변수 (`apps/dashboard-web/.env.local`, gitignore)

```bash
# 조달청 나라장터 입찰공고정보서비스 (data.go.kr 15129394) — 활용신청 후 Decoding 키
G2B_SERVICE_KEY=

# (선택) 위험작업 AI 태깅용. 없으면 규칙 기반으로 자동 폴백
ANTHROPIC_API_KEY=
```
- **둘 다 없어도 동작**한다(샘플 5건 + 규칙 태깅). 데모/심사 시연에 키 불필요.
- `G2B_SERVICE_KEY` 발급: data.go.kr 로그인 → 15129394 "활용신청"(자동승인) → 마이페이지 인증키(Decoding).

## 3. 실행

```bash
pnpm install            # 기존 의존만 (새 패키지 없음)
pnpm --filter @safetymonitor/dashboard-web dev
# 브라우저: http://localhost:3000/safeprocure
```

검증:
```bash
pnpm --filter @safetymonitor/dashboard-web typecheck   # tsc --noEmit
pnpm --filter @safetymonitor/dashboard-web test        # safety-cost.test.ts 포함
```

## 4. 기존 대시보드에 패널로 붙이기 (선택)

독립 페이지(`/safeprocure`) 대신 기존 `DemoDashboard.tsx` 안에 패널로 넣으려면:

```tsx
import ProcureRiskBoard from "./ProcureRiskBoard";
// ... 렌더 트리 원하는 위치에:
<ProcureRiskBoard />
```
KOSHA 패널들과 동일한 배치 방식이다(기존 컴포넌트 import 추가 한 줄).

## 5. ⚠ 실데이터/제출 전 반드시 확정할 것

1. **안전관리비 요율표** (`app/lib/safety-cost.ts` `SAFETY_COST_RATES`) — 현행 고시(제2025-11호) 별표1 + 조달청 '공사원가계산 제비율 적용기준'으로 수치 교차검증. (엔진 로직은 수치와 독립 — 상수만 교체)
2. **조달청 OpenAPI 엔드포인트/필드** (`app/lib/g2b.ts` `G2B_BASE`/`G2B_PATH`/`normalizeSummary`) — data.go.kr Swagger·활용가이드로 버전 접미사·오퍼레이션·필드명 확정. `pick()` 다중후보로 대부분 흡수되나 키 발급 후 실응답으로 교정 권장. (KOSHA 모듈에서 했던 절차와 동일)
3. **대상액** — 조달 OpenAPI에 안전관리비 대상액이 직접 없으면 추정가격 근사 → 자동으로 `검토필요`로 분류(과장 방지). 계약정보서비스로 대상액·명시 안전관리비 보강 시 정밀 검증(정상/과소계상_의심).

## 6. 동작 개요

```
/safeprocure → ProcureRiskBoard
  → GET /api/g2b/notices   (g2b.ts: 키 있으면 조달청 OpenAPI, 없으면 샘플)
  → 각 공고 GET /api/g2b/notice/:id
       → safety-cost.ts  안전관리비 예비검증(법정요율, 결정적)
       → risk-tagging.ts 위험작업 태그(AI 또는 규칙, evidence 원문검증)
       → procure-risk.ts 위험도 종합(설명가능 기여도 분해)
  → 위험도 순 정렬 + 선택 시 ProcureRiskCard
```
