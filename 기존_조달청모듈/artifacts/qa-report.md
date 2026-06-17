# QA REPORT — 안전조달 → safetymonitor 통합 검증

> 5단계 검증 결과. 대상 브랜치 `feat/safeprocure` (safetymonitor 로컬 클론). 작성 2026-06-16.

## 1. 검증 결과 — 전 게이트 통과 ✅

| 게이트 | 명령 | 결과 |
|---|---|---|
| 타입 | `pnpm --filter @safetymonitor/dashboard-web typecheck` | ✅ `tsc --noEmit` 에러 0 |
| 테스트 | `pnpm --filter @safetymonitor/dashboard-web test` | ✅ **33 pass / 0 fail** (기존 24 + 모듈 9) |
| 린트 | `pnpm --filter @safetymonitor/dashboard-web lint` | ✅ `eslint .` 경고/에러 0 |
| 빌드 | `pnpm --filter @safetymonitor/dashboard-web build` | ✅ **30/30 페이지**, `/safeprocure`·`/api/g2b/*` 정상 |
| 런타임 | `next dev` + curl | ✅ 아래 §4 |

- 선행: `pnpm install`(사용자, lockfile supply-chain 통과) + 워크스페이스 패키지 빌드 `@safetymonitor/{schemas,analyzers}`(dist import 때문에 필수 — CLAUDE.md 명시).
- 모듈 테스트 9케이스 실제 실행 확인: `구간 판정 / 5억 미만·5억~50억·경계 / 일반건설공사(을) / 판정 3종` 전부 통과(글롭 `app/lib/*.test.ts` 추가 동작).

## 2. 통합 변경 (최종 diff)

- **신규 추가 12파일**: `app/lib/{safeprocure-types,safety-cost,safety-cost.test,g2b,g2b-mock,risk-tagging,procure-risk}.ts`, `app/api/g2b/{notices,notice/[id]}/route.ts`, `app/components/{ProcureRiskBoard,ProcureRiskCard}.tsx`, `app/safeprocure/page.tsx`.
- **기존 파일 수정 2곳**: `app/components/DemoDashboard.tsx`(import 1줄 + 헤더 직하 상단 고정 섹션 1개), `package.json`(테스트 글롭 `+"app/lib/*.test.ts"`).
- 신규 npm 패키지 **0**. `.env.example`은 전역 보안 규칙(`.env.*` 읽기 차단)으로 미수정 → **수동 추가 필요**(§6).

## 3. 발견·수정 (ADR-002 "근거 있는 추가 수정")

1. **`app/lib/procure-risk.ts`(신규 파일) 타입 보정 1줄** — `factorLabels: Record<string, string>`을 `Record<keyof typeof breakdown, string>`로 변경. 레포의 `noUncheckedIndexedAccess: true`가 `Record<string,...>` 인덱스 접근에 `undefined`를 붙여 `topFactors`가 `(string|undefined)[]`가 되던 타입 에러 해결(로직 불변). 코덱스가 1단계에서 예측한 그 지점.
2. **워크스페이스 빌드 선행 필요** — `@safetymonitor/schemas`·`analyzers`는 `dist/`를 import하므로 `pnpm install`만으론 typecheck가 모듈 미발견으로 실패. 두 패키지 build 후 해결(우리 통합 무관, 레포 구조).

## 4. 런타임 검증 (dev `localhost:3000`)

- `GET /api/g2b/notices?kind=공사` → `source:mock`, **샘플 5건**(외벽보수·하수관로·환기구·전기설비·해체철거).
- `GET /api/g2b/notice/20260612-001` → 안전관리비 **과소계상_의심**, 위험도 **score 87**, 위험태그 **[고소작업·해체/철거·도장/화기]**(ANTHROPIC 키 없이 룰 폴백 동작).
- `/safeprocure` **200**(로그인 없이 접근) · `/`(대시보드) **200** · dev 로그 에러 **0**.
- 빌드 라우트: `ƒ /api/g2b/notices`·`ƒ /api/g2b/notice/[id]`(force-dynamic) + `○ /safeprocure` 정상.

## 5. 보안 점검 (직접 수행 — 코덱스 세션 만료로 교차리뷰 대체)

| 점검 | 결과 |
|---|---|
| 키 클라이언트 노출 | ✅ `.next/static` 클라 번들에 `ANTHROPIC_API_KEY`/`G2B_SERVICE_KEY` 매칭 0. (초기 스캔의 "노출"은 `grep\|head && echo` 셸 버그 false positive) |
| 키 격리 | ✅ `process.env` 키 접근은 server-only `risk-tagging.ts`·`g2b.ts` 2곳뿐. 클라 컴포넌트는 fetch만. |
| 키 부재 | ✅ `.env.local` 없음 → 키 값 자체가 존재하지 않음(샘플로 동작, 시크릿 0). |
| SSRF/인젝션(`notice/[id]`) | 현재 키 미설정이라 외부 fetch 자체가 일어나지 않음(샘플). 실키 연결 시 id는 고정 엔드포인트의 쿼리 파라미터로 들어가고 클라에서 `encodeURIComponent` 처리 → 위험 낮음. **제출 전 실키 연결 시 라우트단 id 형식 검증 권장**. |
| LLM PII | risk-tagging.ts가 **공개 조달 공고 텍스트만** 전송, 코드 주석에 "비공개 첨부·민감정보는 상용화 시 마스킹/온프레미스" 명시. 키 없으면 전송 0(룰 폴백). |

## 6. 미완 / 제출 전 (사용자 몫)

- [ ] **코덱스 교차 리뷰** — 세션 만료(`refresh_token_invalidated`)로 5단계 교차리뷰 미수행. `codex login` 재로그인 후 원하면 재실행 가능(객관적 검증은 전부 통과).
- [ ] **`.env.example` 수동 추가** — `G2B_SERVICE_KEY=` / `ANTHROPIC_API_KEY=`(미설정 시 샘플/룰 폴백 주석). 전역 `.env.*` 차단으로 자동화 불가.
- [ ] **안전관리비 요율표** — `safety-cost.ts SAFETY_COST_RATES`를 현행 고시(제2025-11호 별표1 + 조달청 제비율)로 상수 교차검증(엔진 로직 불변). 출처·기준일 기록 권장.
- [ ] **G2B 실키** — 발급 후 `g2b.ts` 엔드포인트·필드 실응답 교정(없으면 심사 재현성 약화).
- [ ] **표현 수위** — "위반 확정" 금지 → "과소계상 의심/검토 필요/정상" 유지.
- [ ] **(선택) 팀 레포 푸시/PR** — 권한 있는 사용자 결정. 현재 로컬 `feat/safeprocure` 브랜치에만 존재.

## 7. 결론

안전조달 모듈이 safetymonitor 대시보드에 **무파괴적으로 통합되어 실제 동작**한다. 기존 코드 수정은 2곳(+신규 파일 1줄 타입 보정)으로 최소 침습, 신규 패키지 0, 기존 테스트 회귀 0. 로그인 직후 첫 화면 상단에 "안전조달" 섹션이 표시되고, `/safeprocure` 독립 라우트도 키 없이 샘플로 시연 가능. 제출 전 정확성 항목(§6)만 사용자가 마무리하면 된다.
