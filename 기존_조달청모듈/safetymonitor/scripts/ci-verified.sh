#!/usr/bin/env bash
# 어떤 커밋이 CI 로 실제 검증됐는지 판정한다 — "초록불"이 아니라 "내 커밋을 포함한 초록불" 인지.
#
# ★ 이 스크립트가 존재하는 이유 = **공유 main + cancel-in-progress** (L-109).
#   워크플로에 `concurrency.cancel-in-progress: true` 가 걸려 있어, 병렬 세션이 몇 분 뒤 push 하면
#   내 실행이 **취소**된다. 그런데 `gh run list --limit 1` 은 "최신 실행"이지 "내 커밋의 실행"이
#   아니라서, 남의 성공 실행을 내 근거로 착각한다(2026-08-22 실측 — 하마터면 그렇게 보고할 뻔했다).
#
# 판정은 셋 중 하나다.
#   ① 직접   — 그 SHA 로 돈 실행이 success
#   ② 포함   — 그 SHA 를 **조상으로 갖는** 커밋의 실행이 success (같은 코드가 검증됐다)
#   ③ 미검증 — 위 둘 다 없음 (취소·실패·미실행). 이때는 초록불을 근거로 쓰지 않는다.
#
# 사용.  scripts/ci-verified.sh            HEAD 판정
#        scripts/ci-verified.sh <sha>      특정 커밋 판정
set -uo pipefail

WF="verify-safetymonitor.yml"
SHA_IN="${1:-HEAD}"
SHA="$(git rev-parse "$SHA_IN" 2>/dev/null)" || { echo "✗ 알 수 없는 커밋: $SHA_IN"; exit 2; }
SHORT="${SHA:0:7}"

# ⚠ --template 은 databaseId 를 지수 표기(3.24e+10)로 렌더해 `gh run view` 에 못 쓴다 — jq 로 뽑는다.
RUNS="$(gh run list --workflow="$WF" --limit 20 \
        --json headSha,status,conclusion,databaseId \
        --jq '.[] | "\(.headSha) \(.status) \(.conclusion) \(.databaseId)"' 2>/dev/null)"

# ⚠ 빈 목록을 "미검증" 으로 읽으면 안 된다 — 그건 gh 가 죽은 것이다(L-88 계열).
if [ -z "${RUNS// /}" ]; then
  echo "✗ 실행 목록을 못 받았다 — gh 인증·네트워크를 먼저 본다. 미검증과 구별할 수 없다."
  exit 2
fi
echo "조회된 실행 $(printf '%s\n' "$RUNS" | grep -c .)건 (통제군 — 0이면 조회가 눈먼 것)"

# ① 직접
DIRECT="$(printf '%s\n' "$RUNS" | awk -v s="$SHA" '$1==s && $2=="completed" && $3=="success" {print $4; exit}')"
if [ -n "$DIRECT" ]; then
  echo "✓ 직접 검증 — $SHORT 로 돈 실행 $DIRECT 가 success"
  exit 0
fi

# 내 실행이 어떤 상태였는지는 보여 준다(취소를 성공으로도 실패로도 읽지 않기 위해).
MINE="$(printf '%s\n' "$RUNS" | awk -v s="$SHA" '$1==s {print $2" "$3" ("$4")"; exit}')"
[ -n "$MINE" ] && echo "· $SHORT 자신의 실행 = $MINE"

# ② 포함 — 이 커밋을 조상으로 갖는 성공 실행
while read -r h st cc id; do
  [ "$st" = "completed" ] && [ "$cc" = "success" ] || continue
  git cat-file -e "$h^{commit}" 2>/dev/null || continue          # 로컬에 없는 커밋은 판정 불가
  if git merge-base --is-ancestor "$SHA" "$h" 2>/dev/null; then
    echo "✓ 포함 검증 — ${h:0:7} 의 실행 $id 가 success 이고 그 커밋이 $SHORT 를 포함한다"
    git merge-base --is-ancestor "$h" "$SHA" 2>/dev/null \
      && echo "  ⚠ 통제군 이상 — 역방향도 참이다(같은 커밋?). 판정을 신뢰하지 말 것." \
      || echo "  [통제군] 역방향(${h:0:7} 이 $SHORT 의 조상)은 거짓 — 방향 정상"
    exit 0
  fi
done <<< "$RUNS"

echo "✗ 미검증 — $SHORT 를 포함한 success 실행이 최근 20건 안에 없다. 초록불을 근거로 쓰지 말 것."
exit 1
