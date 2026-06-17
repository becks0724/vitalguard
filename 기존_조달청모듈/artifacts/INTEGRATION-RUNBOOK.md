# INTEGRATION RUNBOOK — 안전조달 → safetymonitor 통합 실행 절차

> 4단계 빌드의 작업 지시서 겸 재현 가이드. 레포 **실측** 기반(가정 아님). 코덱스 리뷰 반영판.
> 모듈 원본: `…/조달청_안전관리비_모듈/safeprocure-module/apps/dashboard-web/app/`
> 대상 레포: `…/기존_조달청모듈/safetymonitor`(클론됨, `@safetymonitor/dashboard-web`, Next 15·App Router·pnpm)
> `<DW>` = `safetymonitor/apps/dashboard-web` 로 표기.

## 0. 사전조건 + 존재 검증

- 통합으로 추가되는 npm 패키지 **0**(모듈은 next/react/zod/node:test만 사용 — 전부 레포에 존재).
- **원본 12파일 존재 + 대상 부재**를 먼저 확인(조용한 덮어쓰기 방지). `[id]`는 zsh glob이라 **quoting 필수**:
  ```bash
  SRC="…/safeprocure-module/apps/dashboard-web/app"
  for f in lib/safeprocure-types.ts lib/safety-cost.ts lib/safety-cost.test.ts \
           lib/g2b.ts lib/g2b-mock.ts lib/risk-tagging.ts lib/procure-risk.ts \
           api/g2b/notices/route.ts 'api/g2b/notice/[id]/route.ts' \
           components/ProcureRiskBoard.tsx components/ProcureRiskCard.tsx \
           safeprocure/page.tsx; do
    test -e "$SRC/$f" && echo "원본 OK  $f" || echo "원본 없음!! $f"
    test -e "<DW>/app/$f" && echo "대상 충돌!! $f" || true   # 충돌이면 STOP
  done
  ```
- **의존성 설치(사용자 실행)** — `node_modules` 없음. 검증 전에 레포 루트에서:
  ```bash
  pnpm install --frozen-lockfile   # 기존 pnpm-lock.yaml 복원(새 패키지 추가 아님), better-sqlite3 네이티브 빌드 포함
  ```

## 1. 브랜치 격리

```bash
cd <safetymonitor> && git switch -c feat/safeprocure
```

## 2. 드롭인 파일 복사 (신규 12파일 — 검증된 무충돌만)

```bash
DST="<DW>/app"
mkdir -p "$DST/lib" "$DST/api/g2b/notices" "$DST/api/g2b/notice/[id]" "$DST/components" "$DST/safeprocure"
# §0 for 루프와 동일 목록을 cp (각 파일 quoting, [id] 포함)
for f in lib/safeprocure-types.ts lib/safety-cost.ts lib/safety-cost.test.ts \
         lib/g2b.ts lib/g2b-mock.ts lib/risk-tagging.ts lib/procure-risk.ts \
         api/g2b/notices/route.ts 'api/g2b/notice/[id]/route.ts' \
         components/ProcureRiskBoard.tsx components/ProcureRiskCard.tsx \
         safeprocure/page.tsx; do cp "$SRC/$f" "$DST/$f"; done
```
- **기대 상태**: `git -C <safetymonitor> status --porcelain` → 신규 12파일 **`??`(untracked) 12개, modified 0**.

## 3. 기존 파일 수정 — 기본 3곳 (검증이 더 요구하면 ADR-002에 따라 근거 남기고 추가)

### 3.1 `<DW>/package.json` — 테스트 글롭 (먼저 현재값 확인)
```bash
jq -r '.scripts.test' <DW>/package.json   # 기대: tsx --test lib/*.test.ts "app/api/mock/*.test.ts"
```
- 확인 후 수정(1-depth만 추가 — 하위 폴더 테스트 없음을 확인했으면 충분):
  ```
  - "test": "tsx --test lib/*.test.ts \"app/api/mock/*.test.ts\""
  + "test": "tsx --test lib/*.test.ts \"app/api/mock/*.test.ts\" \"app/lib/*.test.ts\""
  ```
- jq 출력이 기대와 다르면 **STOP**(레포가 바뀐 것). 패치 강행 금지.

### 3.2 `<DW>/app/components/DemoDashboard.tsx` — 상단 고정 섹션
- 4단계에서 **실제 파일을 열어** ① `import ProcureRiskBoard from "./ProcureRiskBoard";` 추가, ② `DemoDashboard()` return의 **최상위 컨테이너(main/grid) 내부 첫 자식**으로:
  ```tsx
  <section className="mb-6">
    <ProcureRiskBoard />
  </section>
  ```
- **삽입 전/후 diff를 실제 코드 조각으로 확정**(이 문서의 예시는 형태일 뿐). 기존 레이아웃 폭·padding·dark mode·grid와 어긋나지 않는 위치인지 확인.
- 안전성: `ProcureRiskBoard`=`"use client"` + `fetch("/api/g2b/*")`만 → DemoDashboard("use client")에 직접 import 가능. **이 한 곳 외 DemoDashboard 수정 금지.**
- 부하 검토: 첫 화면 진입 시 기존 대시보드 API + G2B API가 **병렬 발생** → dev에서 네트워크 폭주/장애 전파 없는지 확인.

### 3.3 `<DW>/.env.example` — 키 템플릿
```bash
# 조달청 나라장터 입찰공고정보서비스(data.go.kr 15129394) — 미설정 시 샘플 5건
G2B_SERVICE_KEY=
# (선택) 공고문 위험작업 AI 태깅 — 미설정 시 규칙 기반 폴백
ANTHROPIC_API_KEY=
```
- 키는 **서버 전용**(API Route·server-only lib에서만 사용) 확인 — 클라이언트 번들에 절대 노출 금지.

## 4. 검증 (typecheck → test → lint → build, build가 최종 게이트)

```bash
pnpm --filter @safetymonitor/dashboard-web typecheck    # strict + noUncheckedIndexedAccess
pnpm --filter @safetymonitor/dashboard-web test 2>&1 | tee /tmp/sp_test.log   # safety-cost 9 케이스 포함
grep -c "safety-cost\|구간 판정\|대상액\|기초액" /tmp/sp_test.log             # 모듈 테스트 실제 실행 확인(0이면 글롭 미적용)
pnpm --filter @safetymonitor/dashboard-web lint         # eslint . — 신규 파일發 신규 경고 0
pnpm --filter @safetymonitor/dashboard-web build        # next build — Route Handler/dynamic/env 실검증 (최종 게이트)
```
육안(dev `0.0.0.0:3000`):
- `/safeprocure` — 로그인 없이(인증 미들웨어/layout guard로 막히지 않는지 확인) 샘플 5건 위험도 순 + 상세 카드 + "샘플 데이터" 배지.
- `/` — 로그인(admin/safety2026) 후 첫 화면 **상단** "안전조달 · 발주 단계 안전 리스크" 섹션, 기존 기능 정상.
- **브라우저 콘솔/네트워크 에러 0**(API 500, hydration warning, CORS/timeout 확인).
- 상태 분기: **loading / error / empty / 긴 공고명 overflow / 모바일 폭** 깨짐 없음.

## 5. 롤백 (정확 열거 — 광범위 clean 금지)

```bash
# 수정 3곳 되돌리기 (.env.example은 원래 있던 파일이면 checkout, 신규 생성이면 rm)
git checkout -- <DW>/package.json <DW>/app/components/DemoDashboard.tsx
git ls-files --error-unmatch <DW>/.env.example 2>/dev/null && git checkout -- <DW>/.env.example || rm -f <DW>/.env.example
# 복사한 신규 12파일만 정확히 제거 (git clean -fd <dir> 금지 — 다른 untracked 삭제 위험)
rm -f <DW>/app/lib/safeprocure-types.ts <DW>/app/lib/safety-cost.ts <DW>/app/lib/safety-cost.test.ts \
      <DW>/app/lib/g2b.ts <DW>/app/lib/g2b-mock.ts <DW>/app/lib/risk-tagging.ts <DW>/app/lib/procure-risk.ts \
      "<DW>/app/api/g2b/notice/[id]/route.ts" <DW>/app/api/g2b/notices/route.ts \
      <DW>/app/components/ProcureRiskBoard.tsx <DW>/app/components/ProcureRiskCard.tsx \
      <DW>/app/safeprocure/page.tsx
rmdir "<DW>/app/api/g2b/notice/[id]" <DW>/app/api/g2b/notice <DW>/app/api/g2b <DW>/app/safeprocure 2>/dev/null || true
# 전체 폐기: 미커밋 변경 확인 후
git status && git switch main && git branch -D feat/safeprocure
```

## 6. 최종 diff 확인 + DoD

```bash
git add -A && git diff --cached --name-status   # 기대: A 12개 + M 2~3개(package.json, DemoDashboard.tsx, [.env.example])
```
- [ ] typecheck/build/test/lint 4종 통과, 기존 테스트 회귀 0, 모듈 테스트 9 케이스 실제 실행 확인(§4 grep)
- [ ] dev에서 `/safeprocure`·`/` + 콘솔/네트워크 에러 0 + 상태 분기 정상
- [ ] 키 미설정 상태에서 "샘플 데이터"로 무에러 동작
- [ ] diff = A 12 + M 2~3(±ADR-002 근거 있는 추가)
- [ ] (정확성) `safety-cost.ts` 요율 **상수의 출처·기준일**을 qa-report에 기록(현행 고시 교차검증은 제출 전 사용자 몫이라도 출처는 명시)

## 7. 제출 전 정확성 (사용자 몫)

1. `safety-cost.ts` `SAFETY_COST_RATES`를 현행 고시(제2025-11호 별표1 + 조달청 제비율)로 **상수만** 교차검증·교체(엔진 로직 불변).
2. `G2B_SERVICE_KEY` 발급 후 `g2b.ts` 엔드포인트·필드 실응답 교정. (실키 없이 제출하면 심사 재현성 약화 — `.env.example`로 경로 명시)
3. 표현 수위: "위반 확정" 금지 → "과소계상 의심 / 검토 필요 / 정상".
4. (선택) 팀 레포 푸시/PR — 권한 있는 사용자 결정.

## 8. 동작 흐름 (참고)

```
/safeprocure 또는 대시보드 상단 섹션 → ProcureRiskBoard
  → GET /api/g2b/notices (g2b.ts: 키 있으면 G2B OpenAPI, 없으면 g2b-mock 5건)
  → 각 공고 GET /api/g2b/notice/:id
       → safety-cost.ts  안전관리비 예비검증(법정요율, 결정적)
       → risk-tagging.ts 위험작업 태그(AI 8s timeout → 룰 폴백, evidence 원문검증)
       → procure-risk.ts 위험도 종합(설명가능 기여도 분해)
  → 위험도 순 정렬 + 선택 시 ProcureRiskCard
```
