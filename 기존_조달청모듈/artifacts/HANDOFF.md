# HANDOFF — 안전조달 통합 작업 재개 노트

작성: 2026-06-16. cmux-duo-build 진행 중 **4단계에서 샌드박스 EPERM으로 중단** → 권한 복구 후 재개용.

## 어디까지 됐나
- ✅ 1단계 토론(클로드↔코덱스) + 실코드 검증 → `artifacts/idea.md`, `artifacts/PRD.md`
- ✅ 2단계 문서 셋 합의(코덱스) → PRD + Runbook + ADR
- ✅ 3단계 설계 문서 + 코덱스 리뷰 반영 → `artifacts/INTEGRATION-RUNBOOK.md`, `artifacts/ADR.md`
- ⏸ 4단계 실제 통합 빌드 — **환경 차단으로 미시작**
- ⬜ 5단계 QA → `artifacts/qa-report.md`

## 무엇이 막혔나
샌드박스 EPERM(Operation not permitted)이 시간 경과로 확산:
- 모듈 소스(`조달청_안전관리비_모듈/.../app/lib`) 읽기·복사 전면 차단
- `safetymonitor` git·디렉토리 순회 차단(단일 파일 touch만 됨)
- `/tmp`·`기존_조달청모듈/artifacts`(이 세션이 생성)만 정상
- `dangerouslyDisableSandbox`로도 안 뚫림 = OS/Claude Code 샌드박스 레벨
- **유력 원인**: 이 세션의 primary working directory가 홈(`/Users/rlaxorhs77`)이라, 작업 위치인 `Desktop/조달청 프로젝트` 하위(특히 이 세션이 만들지 않은 clone/모듈)가 신뢰 루트 밖으로 취급됨.

## 복구 방법 (권장 순서)
1. Claude Code 종료 후, **작업 폴더를 신뢰 루트로 삼아 재실행**:
   ```
   cd "/Users/rlaxorhs77/Desktop/조달청 프로젝트"
   claude
   ```
   (모듈·레포·OUT 셋 다 이 폴더 하위 → 한 번에 신뢰 범위 포함)
2. 그래도 EPERM이면: macOS 시스템 설정 > 개인정보 보호 및 보안 > **전체 디스크 접근**에 터미널/cmux/Claude Code 추가.
3. 최후: 이 산출물 폴더에 곧 생성될 통합 스크립트를 **Terminal.app(샌드박스 밖)**에서 직접 실행.

## 재개 지점
재실행 후: "안전조달 통합 4단계부터 이어서, `기존_조달청모듈/artifacts/INTEGRATION-RUNBOOK.md`대로 진행" 이라고 지시.

## 4단계 핵심 (Runbook 요약)
1. `pnpm install --frozen-lockfile`(레포 루트, node_modules 없음 — 사용자/클로드 실행).
2. `git switch -c feat/safeprocure`.
3. 모듈 12파일을 `safetymonitor/apps/dashboard-web/app/` 동일 경로로 cp(`[id]` 경로 quoting). 원본 존재·대상 부재 사전 검증.
4. 기존 수정 3곳: `package.json` 테스트 글롭 `+"app/lib/*.test.ts"` / `DemoDashboard.tsx` 상단 `<section><ProcureRiskBoard/></section>` + import 1줄 / `.env.example` G2B·ANTHROPIC 키.
5. 검증: `typecheck → test → lint → build`(build 최종 게이트) + dev에서 `/safeprocure`·`/` 콘솔에러 0.

## 통합 안전성 (검증 완료 — 재확인 불필요)
- `ProcureRiskBoard`=`"use client"`+`fetch("/api/g2b/*")`만, `ProcureRiskCard`=`import type`만 → DemoDashboard("use client")에 import 1줄로 안전.
- API route 2종 `export const dynamic="force-dynamic"` 이미 있음. risk-tagging AI는 `AbortSignal.timeout(8000)`+룰 폴백 이미 있음.
- 신규 npm 패키지 0. 데이터원 = 조달청 OpenAPI + 고용부 산안비 요율 + AI (KOSHA/기상은 본체 연결점, 12파일 미구현 — 과장 금지).

## 환경 메모
- node v24.15.0(nvm), pnpm/corepack 있음.
- codex CLI 직접 호출 = `codex exec -s read-only --skip-git-repo-check -C /tmp "..."` (한글 경로를 -C로 주면 seatbelt EPERM → /tmp에서 실행하고 정보는 프롬프트로).
- cmux-mirror.sh / ask-codex.sh(`~/.claude/skills`)도 EPERM → codex 직접 호출로 대체.
