#!/bin/sh
# 앱-서버 챗 계약 파일 무결성 검사 — 릴리스 스냅샷이 main 의 계약 파일을 구버전으로 덮는 반복 사고(8.4·8.7·8.9)의 차단기.
# 사용: check-app-contract.sh <commit-ish>   (예: refs/heads/main)
# 심볼 목록은 apps/dashboard-web/lib/2026-07-29-hyperclova-secret-boundary.test.ts 의 경량 사본이다 —
# 그쪽이 정밀 게이트(4파일·정규식)이고 여기는 push 차단용 1차 검사. 테스트를 고치면 여기도 같이 본다.
set -u

REF="${1:?사용법: check-app-contract.sh <commit-ish>}"
ROOT=$(git rev-parse --show-toplevel) || exit 1
F="apps/VitAlGuard-iOS-WatchOS-App/Phone/Sources/2026-07-24-VitAlGuardAssistant.swift"

SRC=$(git -C "$ROOT" show "$REF:$F" 2>/dev/null)
if [ -z "$SRC" ]; then
  echo "✗ $REF 에서 $F 를 읽지 못함" >&2
  exit 1
fi

fail=0
# 정상(1482줄) = 4·11·4·2 존재 / 사고(1315줄) = 전부 0 — 실측 판별력 100%.
for sym in refreshChatContract TaskSummary followUpWorkerIds makeTaskSummaryTable; do
  if ! printf '%s' "$SRC" | grep -q "$sym"; then
    echo "✗ 필수 심볼 소실: $sym" >&2
    fail=1
  fi
done
# 사고 버전에만 있는 심볼(2·1) — 재등장 = 구버전 스냅샷.
for bad in attachmentContext x-vitalguard-local-debug; do
  if printf '%s' "$SRC" | grep -qi "$bad"; then
    echo "✗ 금지 심볼 재등장: $bad" >&2
    fail=1
  fi
done

[ "$fail" = 0 ] && exit 0
echo "→ $F @ $REF 가 릴리스 구버전 스냅샷으로 덮인 상태다(8.4·8.7·8.9 와 동형)." >&2
echo "   복원 예: git checkout <직전 정상 커밋> -- \"$F\"  (선례 213a03c·d4f400b·9e19661)" >&2
exit 1
