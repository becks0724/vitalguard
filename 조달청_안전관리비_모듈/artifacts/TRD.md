# TRD — 안전조달(SafeProcure) 모듈

> 기술 요구사항·설계. PRD를 구현 가능한 형태로 구체화. 미정 값은 `(미정 — 확인 필요)`.
> 단일 원천은 PRD.md. 본 문서가 PRD와 충돌하면 PRD 우선.

## 1. 개요 / 범위
`safetymonitor`(Next.js15/React19/TS, pnpm 모노레포)의 `apps/dashboard-web`에 **drop-in 플러그인**으로 추가되는 조달 안전 모듈. PRD의 F1~F5(조달 수집·안전관리비 예비검증·위험작업 태그·리스크 카드·데모 안전성)를 구현한다. 기존 파일은 **수정하지 않고**(라우트/컴포넌트 신규 추가만), 기존 KOSHA/KMA 모듈과 동일한 패턴을 따른다.

## 2. 아키텍처
- 구성요소
  - **클라이언트**: `ProcureRiskBoard`(목록), `ProcureRiskCard`(상세). 기존 테마/캐러셀/모달 패턴 재사용.
  - **서버 라우트(BFF/프록시)**: `app/api/g2b/*` — 조달청 OpenAPI를 서버에서 호출(키 은닉), 정규화 후 반환.
  - **도메인 로직(lib)**: `g2b.ts`(수집·정규화·캐시·목업), `safety-cost.ts`(요율 룰엔진), `risk-tagging.ts`(LLM+룰+목업), `procure-risk.ts`(스코어 종합).
  - **외부서비스**: 조달청 나라장터 OpenAPI(필수), Anthropic Claude API(위험태그 AI), KOSHA(기존). 기상청(선택).
- 데이터 흐름 (시퀀스, API-Spec에도 동일 게재)
  ```
  [브라우저] → GET /api/g2b/notices?kind=공사
        → g2b.ts: env키 있으면 조달청 OpenAPI 호출, 없으면 목업
        → 정규화(추정가격/공사기간/공종/지역/수요기관)
        ← 표준 NoticeSummary[] (캐시 30분)
  [카드 열기] → GET /api/g2b/notice/:id
        → g2b.ts 상세 정규화
        → safety-cost.ts: 공사종류·대상액·기간 → 기준액·분류·산정식
        → risk-tagging.ts: 공고문 → 위험작업 태그(+근거문장)  [LLM 또는 룰/목업]
        → procure-risk.ts: 위 결과 + KOSHA 공종 통계 → 위험도(기여도 분해)
        ← RiskProfile (카드 렌더)
  ```

## 3. 기술 스택 / 선택 근거
| 영역 | 선택 | 근거 | 대안(기각) |
|---|---|---|---|
| 언어/런타임 | TS / Next.js 15 App Router | 기존 프로젝트 동일, 변형 최소화 | 신규 스택(불필요) |
| 검증 | zod ^3 (기존 의존) | 이미 설치됨, 외부응답 tolerant 파싱 | 수기 검증(취약) |
| 캐시 | 모듈 메모리 Map + TTL | KOSHA 모듈과 동일, 의존 추가 0 | Redis(과함) |
| LLM 호출 | `fetch` 로 Anthropic Messages API 직접 | **새 패키지 불요**(전역 규칙 준수), env키+폴백 | SDK 설치(승인 필요·불요) |
| 저장소 | 신규 없음(stateless 프록시+캐시) | 새 DB 불필요 | DB 추가(비범위) |
> **새 npm 패키지 설치 없음** — 전부 기존 의존(next/react/zod)과 표준 `fetch`로 구현. (전역 패키지 정책 준수)

## 4. 데이터 모델 (Zod, `packages/schemas/src/procurement.ts` 또는 dashboard 내)
| 엔티티 | 핵심 필드 | 비고 |
|---|---|---|
| `NoticeSummary` | `id, title, kind(공사/용역/물품), agency(수요기관), region, estimatedPrice, startDate, endDate, licenses[]` | 목록용 |
| `NoticeDetail` | NoticeSummary + `taskText(과업/공고전문), contractAmount?, winRate?(낙찰률)` | 상세 |
| `SafetyCostCheck` | `constructionType, baseAmount, durationDays, requiredCost(기준액), formula(산정식 문자열), inputSufficiency('full'/'partial'), verdict('정상'/'과소계상_의심'/'검토필요')` | 결정적 룰엔진 산출 |
| `RiskTag` | `tag, severity(1~3), evidence(원문 근거문장), source('ai'/'rule'/'mock')` | |
| `RiskProfile` | `noticeId, score(0~100), breakdown(기여도 분해), topFactors[], recommendations[3], safetyCost, tags[]` | 카드 종합 |
- 저장 위치: 영속 저장 없음(요청 시 계산, 캐시만). PII 미수집(공개 공고/계약).

## 5. 주요 컴포넌트 / 모듈
- `app/lib/g2b.ts` — 조달청 OpenAPI 클라이언트. `G2B_SERVICE_KEY` env 게이트 + 30분 캐시 + **목업 fallback**(샘플 공고 5건). tolerant 필드 추출(`pick`/`extractRows`), `type=json` 강제(실패 시 XML 파서 폴백 자리만 표시). KOSHA 모듈 `app/lib/kosha.ts` 구조 답습.
- `app/lib/safety-cost.ts` — **결정적 룰엔진**. 입력(공사종류·대상액·기간) → 요율표(`SAFETY_COST_RATES`) 적용. 구간 분기: 5억 미만=대상액×요율 / 5억~50억=대상액×요율+기초액 / 50억 이상=대상액×요율. 입력 부족 시 `verdict='검토필요'`(단정 금지). 산정식 문자열 동봉.
- `app/lib/risk-tagging.ts` — 위험작업 태그. ① `ANTHROPIC_API_KEY` 있으면 Claude(모델 `claude-haiku-4-5` 권장: 저비용·빠름)로 구조화 추출(strict JSON), ② 없으면 **룰 키워드 매칭**(아래 사전), ③ 데모용 **precomputed 목업**. 모든 태그에 `source` 표기.
  - **LLM 호출 규약**: 헤더 `anthropic-version: 2023-06-01` + `x-api-key`. AbortController 타임아웃(예 8s). 응답 JSON 파싱 실패/스키마 불일치 시 **룰 폴백**(throw 금지). 프롬프트는 시스템/사용자 분리, 공고문은 구분자로 감싸 지시 주입 차단.
  - **환각 방지(코덱스 지적)**: AI가 준 `evidence`는 **반드시 원문(taskText)의 부분문자열인지 검증** — 아니면 해당 태그 폐기 또는 `source='rule'`로 강등. 원문에 없는 근거문장은 신뢰하지 않는다.
- `app/lib/procure-risk.ts` — 위험도 종합(설명가능). `score = clamp(w1·태그심각도합 + w2·안전관리비의심 + w3·저가낙찰/공기단축 + w4·공종재해통계)`. 기여도(`breakdown`) 반환. 학습모델 아님.
- `app/api/g2b/notices/route.ts`, `app/api/g2b/notice/[id]/route.ts` — 프록시.
- `app/components/ProcureRiskBoard.tsx`, `ProcureRiskCard.tsx` — UI. 기존 다크/라이트·캐러셀·SOS모달 패턴 재사용.

### 5.1 안전관리비 요율표 `SAFETY_COST_RATES` (현행 고시 제2025-11호 반영)
> **출처/검증**: 고용노동부 고시 **제2025-11호(2025.2.12 시행) 별표1**, 신 4공종(건축/토목/중건설/특수). 직전 개정(제2024-53호)에서 평균 약 19% 인상되며 구 5공종에서 재분류됨. 공식 HWPX 별표1 + 산업안전지원센터 계산기 + koit 인포그래픽 **3중 교차검증(2026-06)**. 별표1의 '보건관리자 선임대상 적용비율' 열은 제외(타겟=소액 관급공사, 선임대상 비해당). 제출 전 공식 별표1 HWP 최종 대조 권장.

| 공사종류 | 5억 미만 | 5억~50억 미만 | 50억 이상 |
|---|---|---|---|
| 건축공사 | 3.11% | 2.28% + 4,325천원 | 2.37% |
| 토목공사 | 3.15% | 2.53% + 3,300천원 | 2.60% |
| 중건설공사 | 3.64% | 3.05% + 2,975천원 | 3.11% |
| 특수건설공사 | 2.07% | 1.59% + 2,450천원 | 1.64% |
- 대상액 = 직접재료비+간접재료비+직접노무비. 조달 OpenAPI에 대상액이 없으면 **추정가격을 근사**로 쓰되 `inputSufficiency='partial'` → `verdict='검토필요'` 로 강등(과장 방지).
- 공사종류 판정: 공고 면허/공종 코드 → 매핑표(미정 부분은 `건축공사` 기본 + 근거 표기). 신 4공종 정의는 별표1 비고/소관부처 기준으로 정밀 매핑 권장.
- **구간 경계(정확히 구현)**: 대상액 `x`(원). `x < 500,000,000` → 5억 미만식 / `500,000,000 ≤ x < 5,000,000,000` → 5억~50억식(요율+기초액) / `x ≥ 5,000,000,000` → 50억 이상식. 경계값(정확히 5억/50억)은 **이상(≥) 구간에 포함**. 기초액 단위는 **천원(×1000)** — 표의 `4,325천원 = 4,325,000원`. 단위 환산 누락 금지(만원으로 오인 시 10배 오류).
- 단위 정합: 요율은 백분율(×0.01), 기초액은 천원(×1000). `requiredCost = round(x × rate + base)`.

### 5.2 위험작업 태그 사전 (룰 폴백 키워드)
| 태그 | severity | 키워드(예) |
|---|---|---|
| 고소작업 | 3 | 비계, 고소, 외벽, 지붕, 철골, крон→크레인 양중 |
| 굴착/흙막이 | 3 | 굴착, 터파기, 흙막이, 토공, 사면 |
| 밀폐공간 | 3 | 맨홀, 정화조, 탱크, 관거, 밀폐 |
| 전기/감전 | 2 | 수배전, 전기, 활선, 변전 |
| 중장비/양중 | 2 | 크레인, 굴삭기, 항타, 양중, 장비 |
| 해체/철거 | 3 | 해체, 철거, 발파 |
| 도장/화기 | 2 | 도장, 용접, 화기, 방수 |
> AI(Claude) 사용 시 위 사전을 few-shot 컨텍스트로 제공하고, 원문 근거문장 추출을 강제(JSON schema). 룰 폴백은 키워드 매칭만(근거=매칭 문장).

### 5.3 위험도 가중치 (초기값, 데모 후 튜닝)
`w1=0.40(위험작업) · w2=0.25(안전관리비 의심) · w3=0.15(저가낙찰/공기단축) · w4=0.20(공종 재해통계)`. 카드에 각 기여도(%) 분해 표시.

## 6. 비기능 요구
- 보안: 키는 서버 라우트에서만. `.env.local`(gitignore). zod 입력검증. 외부 응답 tolerant 파싱(필드 누락 허용하되, **핵심 필드(추정가격/기간) 누락 시 정상 데이터로 오인 금지** → `검토필요` 강등 — 코덱스 지적). 내부 라우트 남용 방어는 데모 범위상 경량(메모리 기반 간단 throttle 또는 캐시로 상류 호출 제한); 상용화 시 인증·rate limit 추가(비범위).
- 성능: 30분 캐시. 목록 목업 1초 내. LLM 호출은 상세 1건당 1회(목록에선 미호출).
- 접근성: 기존 테마 토큰 준수. 색만으로 위험 구분 금지(아이콘/텍스트 병기).
- 관측성: 라우트 `source: 'live'|'mock'` 응답 필드로 데이터 출처 노출(KOSHA 패턴).

## 7. 폴더 구조 (생성 대상 — 모두 신규)
```
apps/dashboard-web/app/lib/{g2b,safety-cost,risk-tagging,procure-risk}.ts
apps/dashboard-web/app/lib/g2b-mock.ts            # 샘플 공고 5건
apps/dashboard-web/app/lib/safety-cost.test.ts    # 요율 케이스 단위테스트
apps/dashboard-web/app/api/g2b/notices/route.ts
apps/dashboard-web/app/api/g2b/notice/[id]/route.ts
apps/dashboard-web/app/components/{ProcureRiskBoard,ProcureRiskCard}.tsx
packages/schemas/src/procurement.ts               # (선택) 공용 스키마
```
- **납품**: 위 트리를 `<OUT>/safeprocure-module/`에 동일 경로로 제공 + `INTEGRATION.md`. 사용자가 자기 레포에 복사(기존 코드 무변형). 검증은 /tmp 클론에 적용해 수행.

## 8. 의존성
| 패키지 | 용도 | 비고 |
|---|---|---|
| (없음) | — | 기존 next/react/zod + 표준 fetch로 충분. **신규 설치 없음**(전역 패키지 정책 준수). |

## 9. 미해결 / 리스크
- R1. **요율표 정확성** — 고시 원문 수치 교차검증 필요(§5.1). 데모는 정리본 + 검증 플래그로 진행.
- R2. **조달 OpenAPI 실응답 필드명** — Swagger/활용가이드로 `pick` 후보키 확정 필요(키 발급 후). 미발급 동안 목업.
- R3. **대상액 부재** — 조달 데이터에 안전관리비 대상액이 직접 없을 수 있음 → 추정가격 근사 + `검토필요` 강등으로 무결성 유지.
- R4. **LLM 비용/지연** — 상세 1건당 1회, haiku 모델, 캐시. 키 없으면 룰 폴백.
- R5. **Next15 App Router 함정(코덱스 지적)** — route handler의 `params`는 비동기(`await params`). 상세 라우트 캐시 기본값 주의(`export const dynamic = 'force-dynamic'` 또는 `revalidate` 명시)로 stale 방지. 빌드 시 검증 항목.
