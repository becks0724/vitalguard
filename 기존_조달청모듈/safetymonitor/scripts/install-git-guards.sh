#!/bin/sh
# 릴리스 덮어쓰기 방지 가드 설치 — 클론마다 1회 실행(멱등). 팀원 클론에도 이걸 한 번 돌려야 그쪽 push 가 막힌다.
#   ① merge.ours 드라이버 — .gitattributes 의 계약 파일 4종이 머지 충돌 시 main(ours)을 지킨다
#   ② pre-push 체인 가드 — push 마다 로컬 main 의 계약 파일 심볼을 검사(check-app-contract.sh),
#      훼손이면 push 차단. 기존 pre-push 훅은 pre-push.chain 으로 보존하고 뒤에 이어 실행한다.
#      (기존 L-17 훅 뒤에 붙이면 ts 변경 없는 push 가 조기 exit 0 으로 빠져 swift 사고를 통과시킨다 — 그래서 앞단 체인)
set -eu

ROOT=$(git rev-parse --show-toplevel)
HOOKS="$ROOT/.git/hooks"
MARK="VG-CONTRACT-GUARD"

# ① 머지 드라이버 — 'true' 는 현재(ours) 내용을 그대로 두는 no-op 드라이버.
git -C "$ROOT" config merge.ours.driver true
echo "① merge.ours.driver 설정 완료"

# ② pre-push 체인 설치(멱등).
if [ -f "$HOOKS/pre-push" ] && grep -q "$MARK" "$HOOKS/pre-push"; then
  echo "② pre-push 가드 이미 설치됨 — 건너뜀"
else
  if [ -f "$HOOKS/pre-push" ]; then
    mv "$HOOKS/pre-push" "$HOOKS/pre-push.chain"
    echo "   기존 pre-push → pre-push.chain 으로 보존"
  fi
  cat > "$HOOKS/pre-push" <<'HOOK'
#!/bin/sh
# VG-CONTRACT-GUARD — install-git-guards.sh 가 관리(수동 편집 금지). 우회 = git push --no-verify
# 로컬 main 의 앱 계약 파일이 릴리스 구버전으로 덮였으면 어떤 push 든 막는다(조기 경보).
set -u
ROOT=$(git rev-parse --show-toplevel)
CHECK="$ROOT/기존_조달청모듈/safetymonitor/scripts/check-app-contract.sh"
if [ -x "$CHECK" ] && git show-ref --verify --quiet refs/heads/main; then
  if ! "$CHECK" refs/heads/main; then
    echo "✗ pre-push: 로컬 main 의 앱 계약 파일 훼손(릴리스 덮어쓰기 의심) — push 중단." >&2
    exit 1
  fi
fi
# 기존 훅(L-17 typecheck 등)에 stdin 그대로 위임.
if [ -x "$ROOT/.git/hooks/pre-push.chain" ]; then
  exec "$ROOT/.git/hooks/pre-push.chain" "$@"
fi
exit 0
HOOK
  chmod +x "$HOOKS/pre-push"
  echo "② pre-push 가드 설치 완료(기존 훅 체인 유지)"
fi
echo "설치 끝 — 검사 대상: apps/VitAlGuard-iOS-WatchOS-App/…/2026-07-24-VitAlGuardAssistant.swift @ refs/heads/main"
