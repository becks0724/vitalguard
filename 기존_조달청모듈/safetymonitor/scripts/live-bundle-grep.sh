#!/usr/bin/env bash
# 라이브 번들에 문자열이 실렸는지 검사 — 양성 통제군을 강제해 "조회가 눈먼 것" 과 "정말 없는 것" 을 가른다
#
# ★ 존재 이유. [[L-108]] 의 함정을 **두 번** 밟았다(08-22 · 08-28). 둘 다 같은 모양이다 —
#   청크 목록을 놓쳐 `chunks/app/page-*.js`(번들의 대부분)에 안 닿았는데, 검색어가 0개로 나와
#   "코드가 안 실렸다" 로 읽힐 뻔했다. 두 번 다 **양성 통제군이 그 실패를 잡았다.**
#   절차로 두 번 못 막았으므로 도구로 만든다.
#
# 이 스크립트가 답하는 질문 = **"이 문자열이 라이브 번들에 실렸는가."**
# 답하지 않는 질문 = "화면에서 그 코드가 실제로 동작하는가."([[L-118]]⑥ — 초록불이 답한 질문을 적는다)
#
# 사용.  scripts/live-bundle-grep.sh <찾을문자열> <양성통제군> [URL]
# 예.    scripts/live-bundle-grep.sh '심박끊김' '연결끊김'
#          찾을것 = 새로 배포한 라벨 · 통제군 = 이미 있던 라벨(반드시 히트해야 정상)
# 종료코드. 0 = 통제군 히트 + 검색어 히트 · 1 = 검색어 0(통제군은 히트 = 진짜 없음)
#           2 = 통제군 0(조회가 눈멀었다 — 결과를 믿지 말 것) · 3 = 사용법·네트워크 오류
set -uo pipefail

NEEDLE="${1:-}"; CONTROL="${2:-}"
BASE="${3:-https://vitalguard-dashboard-569797426568.asia-northeast3.run.app}"
[ -n "$NEEDLE" ] && [ -n "$CONTROL" ] || { sed -n '13,17p' "$0"; exit 3; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
curl -s -m 25 "$BASE/" -o "$TMP/page.html" || { echo "✗ 페이지를 못 받았다: $BASE"; exit 3; }
[ -s "$TMP/page.html" ] || { echo "✗ 빈 응답"; exit 3; }

# ★ 접두(`/_next/`)를 패턴에 넣지 않는다 — 그 자리가 08-22·08-28 두 번의 실패 지점이다.
#   HTML 안에서 경로가 상대/절대/이스케이프 형태로 섞여 나오므로 `static/chunks/` 만 잡고 붙인다.
grep -oE 'static/chunks/[^"\\]+\.js' "$TMP/page.html" | sed 's|^|/_next/|' | sort -u > "$TMP/chunks.txt"
N=$(wc -l < "$TMP/chunks.txt" | tr -d ' ')
[ "$N" -gt 0 ] || { echo "✗ 청크를 하나도 못 찾았다 — 페이지 구조가 바뀌었다(조용한 0 금지)"; exit 2; }

HIT_N=""; HIT_C=""; GOT=0
while read -r c; do
  body=$(curl -s -m 25 "$BASE$c") || continue
  [ -z "$body" ] && continue
  GOT=$((GOT+1))
  printf '%s' "$body" | grep -qF "$NEEDLE"  && HIT_N="$HIT_N $c"
  printf '%s' "$body" | grep -qF "$CONTROL" && HIT_C="$HIT_C $c"
done < "$TMP/chunks.txt"

# ⚠ `$N개` 로 쓰면 한글이 변수명에 붙어 `N개` 를 찾는다(set -u 에서 unbound). 중괄호 필수.
echo "청크 ${N}개 중 ${GOT}개 수신"
echo "통제군 '$CONTROL' :${HIT_C:- 0개}"
echo "검색어 '$NEEDLE' :${HIT_N:- 0개}"

# 판정 순서가 중요하다 — 통제군을 **먼저** 본다. 그것이 0이면 검색어 결과는 아무 뜻이 없다.
if [ -z "$HIT_C" ]; then
  echo "✗ 통제군이 0개다 — 조회가 번들에 안 닿았다. 검색어 결과를 근거로 쓰지 말 것([[L-108]])"
  exit 2
fi
if [ -z "$HIT_N" ]; then
  echo "✗ 통제군은 히트했는데 검색어가 0개 — 이 문자열은 **정말로** 안 실렸다"
  exit 1
fi
echo "✓ 실렸다 (통제군이 조회 생존을 보증)"
