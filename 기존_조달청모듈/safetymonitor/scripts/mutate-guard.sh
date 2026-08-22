#!/usr/bin/env bash
# 가드 변이 시험 러너 — 신설·수정 가드의 통과 의례(L-113)를 L-103 규율로 강제한다.
#
# ★ 존재 이유. 같은 의식(백업→cmp→변이→실행→복원→cmp)을 이틀간 손으로 4번 짰고,
#   그 손절차가 과거에 실사고를 냈다(L-103 — 복원 무음 실패로 변이 누적, 화면엔 "전부 잡힘").
#   의무화된 절차(L-113)는 스크립트가 맞다.
#
# 판정 3층.
#   ① 기준선   무변이 상태에서 가드가 전부 PASS 인가 — 아니면 나머지가 무의미(L-103③)
#   ② 변이 적용 sed 가 실제로 파일을 바꿨는가 — 안 물면 "잡힘"이 가짜다(이 검사가 손절차에 없던 것)
#   ③ 검출     변이 상태에서 fail > 0 인가 — 0 이면 약한 단언(L-104)
#   복원은 매 변이마다 cmp -s 로 대조하고, 어긋나면 그 자리서 중단한다(L-103②).
#
# 사용.  scripts/mutate-guard.sh <가드테스트> <대상파일> <sed식> [<sed식>...]
#        경로는 apps/dashboard-web 기준. sed 식은 BSD sed(-i '') 문법.
# 예.    scripts/mutate-guard.sh lib/2026-08-22-pool-warm-floor.guard.test.ts lib/db.ts \
#          's|} catch {|} finally0 {|' 's|await pool.connect()|await Promise.all([pool.connect()])[0]|'
# 종료코드. 0 = 기준선 PASS + 전 변이 적용·검출. 그 외 = 실패(사유 출력).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB="$HERE/../apps/dashboard-web"
export PNPM_HOME="${PNPM_HOME:-$HOME/Library/pnpm}"; export PATH="$PNPM_HOME:$PNPM_HOME/bin:$PATH"

[ "$#" -ge 3 ] || { sed -n '15,18p' "$0"; exit 2; }
GUARD="$1"; TARGET="$2"; shift 2

cd "$WEB" || { echo "✗ dashboard-web 없음: $WEB"; exit 2; }
[ -f "$GUARD" ]  || { echo "✗ 가드 없음: $GUARD"; exit 2; }
[ -f "$TARGET" ] || { echo "✗ 대상 없음: $TARGET"; exit 2; }

# 가드 fail 건수를 센다. 실행 자체가 죽으면(파스 오류 등) -1.
fails() {
  local out; out=$(npx tsx --test "$GUARD" 2>&1) || true
  local n; n=$(printf '%s\n' "$out" | sed -n 's/^# fail \([0-9][0-9]*\)$/\1/p' | tail -1)
  [ -n "$n" ] && echo "$n" || echo "-1"
}

BK=$(mktemp -d)/target.bak
cp "$TARGET" "$BK"
cmp -s "$TARGET" "$BK" || { echo "✗ 백업 무결성 실패 — 시작하지 않는다(L-103①)"; exit 1; }

echo "가드   $GUARD"
echo "대상   $TARGET"

BASE=$(fails)
if [ "$BASE" != "0" ]; then
  echo "✗ 기준선 실패 — 무변이 fail=$BASE. 가드부터 초록으로 만들 것(L-103③)."
  rm -f "$BK"; exit 1
fi
echo "기준선 무변이 PASS (fail 0)"

BAD=0; i=0
for EXPR in "$@"; do
  i=$((i+1))
  sed -i '' "$EXPR" "$TARGET" 2>/dev/null
  if cmp -s "$TARGET" "$BK"; then
    echo "✗ 변이$i 미적용 — sed 식이 아무것도 안 바꿈(가짜 초록 위험): $EXPR"
    BAD=1
  else
    N=$(fails)
    if [ "$N" = "0" ]; then
      echo "★ 변이$i 검출 실패 — 가드가 초록(fail 0). 약한 단언이다(L-104): $EXPR"
      BAD=1
    elif [ "$N" = "-1" ]; then
      # 대상 파스가 깨져 테스트 자체가 못 돈 경우 — 가드가 아니라 tsx 가 잡은 것.
      echo "△ 변이$i 실행 불능(파스 붕괴 추정) — 검출로 안 쳐줌. 더 조용한 변이로 다시: $EXPR"
      BAD=1
    else
      echo "✓ 변이$i 검출 — fail $N: $EXPR"
    fi
  fi
  cp "$BK" "$TARGET"
  cmp -s "$TARGET" "$BK" || { echo "✗ 복원 실패 — 여기서 중단. 수동 확인 필요: $TARGET (백업 $BK 보존)"; exit 1; }
done

FINAL=$(fails)
[ "$FINAL" = "0" ] || { echo "✗ 종료 검증 실패 — 복원 후 fail=$FINAL (백업 $BK 보존)"; exit 1; }
rm -f "$BK"
echo "복원·종료 검증 OK (fail 0)"
[ "$BAD" = "0" ] && { echo "== 전 변이 검출 — 가드 검증 완료"; exit 0; } || { echo "== 미검출/미적용 변이 있음 — 가드 보강 필요"; exit 1; }
