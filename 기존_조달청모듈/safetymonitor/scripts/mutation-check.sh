#!/usr/bin/env bash
# 가드 변이 시험 — 가드가 "실제로 그 결함을 잡는지" 를 검증한다. 통과만 보고 넘기지 않기 위한 도구.
#
# ★ 왜 스크립트인가 (L-103). 손으로 짤 때마다 같은 자리가 빈다. 2026-08-21 에 두 번 밟았다 —
#   zsh 가 따옴표 없는 변수를 단어분할하지 않아 백업·복원이 **한 번도 성공하지 않았는데**
#   화면에는 `FAIL ✓잡힘` 이 줄줄이 찍혀 완벽해 보였다. 변이 10개가 소스에 누적된 채였고,
#   두 번째 변이부터는 이미 빨간 상태에서 재는 것이라 판별력이 0 이었다.
#
# 이 스크립트가 강제하는 것 넷.
#   ① 백업을 **내용까지** 검증하고(cmp), 실패하면 변이를 시작조차 안 한다
#   ② 무변이 기준선이 PASS 인지 먼저 재고 출력한다 — 아니면 나머지 결과가 무의미하다
#   ③ 변이마다 복원 후 원본 복귀를 cmp 로 확인하고, 어긋나면 즉시 중단한다
#   ④ 변이 대상과 백업 목록이 **같은 spec 에서 나온다** — 두 목록이 갈려서 또 밟았다
#
# 사용법 — spec(JSON)을 stdin 으로.
#   scripts/mutation-check.sh <<'JSON'
#   { "cwd": "apps/dashboard-web",
#     "test": "node_modules/.bin/tsx --test lib/foo.guard.test.ts",
#     "mutations": [
#       { "label": "SELECT 에서 컬럼 제거", "file": "lib/db.ts",
#         "from": ", location_timestamp FROM", "to": " FROM" } ] }
#   JSON
#
#   cwd     레포 루트(safetymonitor) 기준. 생략 시 루트.
#   file    cwd 기준.
#   from/to **전량 치환**한다 — 첫 하나만 바꾸면 여러 번 나오는 이름이 안 흔들린다(L-104).
#
# 종료코드 0 = 모든 변이가 잡혔다. 1 = 살아남았거나 하네스 자체가 어긋났다.
#
# ★ 음성 통제군을 함께 넣어라. 무관한 곳을 바꾼 변이는 **살아남는 것이 정상**이고, 그래야
#   "이 가드가 아무것에나 빨개지는 것은 아니다" 가 증명된다. 그 경우 종료코드는 1 이 되는데
#   그것이 맞다 — 라벨을 보고 사람이 읽으면 된다.
#   ⚠ `"expect": "survive"` 같은 기대값 필드를 **일부러 두지 않았다.** 결함을 "기대됨" 으로
#     표시해 초록으로 만드는 길을 열면 그것이 곧 [[L-101]](결함을 가드로 고정)이 된다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPEC_FILE="$(mktemp)"; BK="$(mktemp -d)"
trap 'rm -rf "$SPEC_FILE" "$BK"' EXIT
cat > "$SPEC_FILE"

field() { python3 -c "import json,sys; print(json.load(open(sys.argv[1]))$1)" "$SPEC_FILE"; }

WORK="$ROOT/$(field '.get("cwd",".")')"
TEST="$(field '["test"]')"
N="$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))['mutations']))" "$SPEC_FILE")"

run_test() { ( cd "$WORK" && eval "$TEST" ) >/dev/null 2>&1 && echo PASS || echo FAIL; }

# ── ① 백업 — 내용까지 검증한다 ────────────────────────────────────────────
# ⚠ macOS 기본 bash 는 3.2 라 `mapfile` 이 없다 — 이식 가능한 while 루프로 읽는다.
FILES=()
while IFS= read -r f; do
  [ -n "$f" ] && FILES+=("$f")
done < <(python3 -c "
import json,sys
seen=[]
for m in json.load(open(sys.argv[1]))['mutations']:
    if m['file'] not in seen: seen.append(m['file'])
print('\n'.join(seen))
" "$SPEC_FILE")

for f in "${FILES[@]}"; do
  mkdir -p "$BK/$(dirname "$f")"
  cp "$WORK/$f" "$BK/$f"
  cmp -s "$WORK/$f" "$BK/$f" || { echo "백업 내용 불일치: $f — 변이를 시작하지 않는다" >&2; exit 1; }
done
echo "백업 ${#FILES[@]}/${#FILES[@]} · 내용 일치 확인"

restore() { for f in "${FILES[@]}"; do cp "$BK/$f" "$WORK/$f"; done; }
verify_restored() {
  for f in "${FILES[@]}"; do
    cmp -s "$WORK/$f" "$BK/$f" \
      || { echo "★ 복원 실패: $f — 중단한다(이후 결과는 무의미)" >&2; exit 1; }
  done
}

# ── ② 기준선 — 무변이가 PASS 여야 한다 ────────────────────────────────────
BASE="$(run_test)"
echo "기준선(무변이) → $BASE"
[ "$BASE" = "PASS" ] \
  || { echo "★ 무변이 상태가 이미 실패다 — 변이 결과가 아무것도 증명하지 못한다" >&2; exit 1; }
echo

# ── ③ 변이 — 매번 복원하고 복귀를 확인한다 ────────────────────────────────
SURVIVED=0
for ((i = 0; i < N; i++)); do
  LABEL="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['mutations'][int(sys.argv[2])]['label'])" "$SPEC_FILE" "$i")"
  python3 - "$SPEC_FILE" "$i" "$WORK" <<'PY'
import json, sys, io, os
spec, idx, work = sys.argv[1], int(sys.argv[2]), sys.argv[3]
m = json.load(open(spec))["mutations"][idx]
path = os.path.join(work, m["file"])
src = io.open(path, encoding="utf-8").read()
if m["from"] not in src:
    sys.stderr.write("변이 대상 없음: %r\n" % m["from"][:60]); sys.exit(2)
io.open(path, "w", encoding="utf-8").write(src.replace(m["from"], m["to"]))  # 전량 치환
PY
  if [ "$(run_test)" = "PASS" ]; then
    printf '  %-46s PASS ⚠ 살아남음\n' "$LABEL"; SURVIVED=$((SURVIVED + 1))
  else
    printf '  %-46s FAIL ✓ 잡힘\n' "$LABEL"
  fi
  restore
  verify_restored
done

echo
echo "복원 후 → $(run_test)"
[ "$SURVIVED" -eq 0 ] \
  || { echo "★ 살아남은 변이 ${SURVIVED}건 — 가드가 그 결함을 못 잡는다" >&2; exit 1; }
echo "변이 ${N}/${N} 전부 잡힘"
