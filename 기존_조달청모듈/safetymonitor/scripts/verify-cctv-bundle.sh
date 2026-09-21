#!/bin/sh
# 배포된 관제웹 번들에 젯슨 CCTV 게이트 주소가 실렸는지 확인한다
#
# 왜 필요한가 — 이 값은 빌드할 때 번들에 박힌다(NEXT_PUBLIC_CAM03_GATE_API).
# 치환이 빠지면 런타임 env 에도 안 보이고 서버 응답도 200 이라, 브라우저 화면이
# 검게 나올 때까지 아무도 모른다. 2026-09-18 에 실제로 그렇게 반나절을 썼다.
#
# 쓰는 법   scripts/verify-cctv-bundle.sh [BASE_URL] [찾을문자열]
#           scripts/verify-cctv-bundle.sh --selftest    ← 검사가 살아 있는지 먼저 본다
# 나가는 값 0=실렸음 · 1=안 실림 · 2=계기 고장(대상이 200 이 아니거나 번들을 못 받음)
set -eu

BASE="${1:-https://vitalguard-dashboard-569797426568.asia-northeast3.run.app}"
NEEDLE="${2:-tailnet}"
SELFTEST=0
[ "${1:-}" = "--selftest" ] && { SELFTEST=1; BASE="https://vitalguard-dashboard-569797426568.asia-northeast3.run.app"; NEEDLE="이문자열은절대번들에없다-selftest"; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# ① 대상이 맞는 페이지인가 — 404 페이지도 번들을 내놓는다(2026-09-21 실측).
#    이 검사가 없으면 「없는 페이지에 없다」를 「주소가 빠졌다」로 읽는다.
CODE=$(curl -s -o "$TMP/page.html" -w "%{http_code}" --max-time 30 "$BASE/" 2>/dev/null) || CODE=000
[ -n "$CODE" ] || CODE=000
if [ "$CODE" != "200" ]; then
  echo "⛔ 계기 고장 — 대상 페이지가 HTTP $CODE 다. 200 이 아니면 아래 결과는 의미가 없다."
  exit 2
fi

# ② 번들 목록
grep -oE '/_next/static/[^"]+\.js' "$TMP/page.html" | sort -u > "$TMP/bundles.txt" || true
N=$(wc -l < "$TMP/bundles.txt" | tr -d ' ')
if [ "$N" -eq 0 ]; then
  echo "⛔ 계기 고장 — 페이지는 200 인데 번들을 한 개도 못 찾았다. 추출 규칙을 의심한다."
  exit 2
fi

# ③ 받아서 뒤진다 (파이프 서브셸을 피해 파일로 센다 — 카운터가 조용히 0 이 되는 자리다)
# ⚠ 받기 실패를 건너뛰면 안 된다. 2026-09-21 첫 판이 그렇게 만들어졌다가, 같은 배포를 두 번
#   재는데 1940KB/찾음 → 1292KB/못찾음 이 나왔다. 주소가 든 번들을 못 받고 「없다」를 냈다.
#   못 받은 것이 하나라도 있으면 그 0 은 「없다」가 아니라 「못 쟀다」다.
: > "$TMP/hits.txt"; TOTAL=0; GOT=0; MISS=0
while IFS= read -r b; do
  OK=0
  for try in 1 2 3; do
    if curl -sf --max-time 30 --retry 2 --retry-delay 1 "$BASE$b" -o "$TMP/one.js" 2>/dev/null; then OK=1; break; fi
  done
  if [ "$OK" -eq 0 ]; then MISS=$((MISS + 1)); echo "$b" >> "$TMP/miss.txt"; continue; fi
  GOT=$((GOT + 1))
  SZ=$(wc -c < "$TMP/one.js" | tr -d ' ')
  TOTAL=$((TOTAL + SZ))
  if grep -q "$NEEDLE" "$TMP/one.js" 2>/dev/null; then echo "$b" >> "$TMP/hits.txt"; fi
done < "$TMP/bundles.txt"
HITS=$(wc -l < "$TMP/hits.txt" | tr -d ' ')

# ④ 전부 받았나 — 하나라도 못 받았으면 0 을 「없다」로 읽으면 안 된다
if [ "$MISS" -gt 0 ]; then
  echo "⛔ 계기 고장 — 번들 $N 개 중 $MISS 개를 못 받았다(3회 재시도 후). 이 상태의 결과는 쓰지 않는다."
  sed 's/^/   못 받음: /' "$TMP/miss.txt" 2>/dev/null | head -5
  exit 2
fi
if [ "$GOT" -ne "$N" ]; then
  echo "⛔ 계기 고장 — 목록 $N 개인데 $GOT 개만 셌다. 루프가 중간에 끊겼다."
  exit 2
fi
if [ "$TOTAL" -lt 51200 ]; then
  echo "⛔ 계기 고장 — 번들 $N 개를 받았는데 합계가 ${TOTAL}B 다. 내려받기가 죽었다."
  exit 2
fi

KB=$((TOTAL / 1024))
if [ "$SELFTEST" -eq 1 ]; then
  if [ "$HITS" -eq 0 ]; then
    echo "✅ 자기시험 통과 — 없는 문자열을 없다고 했다 (번들 $N 개 · ${KB}KB 를 실제로 뒤진 뒤의 0 이다)"
    exit 0
  fi
  echo "⛔ 자기시험 실패 — 없어야 할 문자열을 찾았다. 검색 규칙이 잘못됐다."
  exit 2
fi

if [ "$HITS" -gt 0 ]; then
  echo "✅ 게이트 주소가 번들에 실렸다 — $HITS/$N 개 (${KB}KB 검사)"
  sed 's/^/   /' "$TMP/hits.txt"
  exit 0
fi
echo "⛔ 게이트 주소가 번들에 없다 — 번들 $N 개 · ${KB}KB 를 전부 뒤졌다."
echo "   빌드 때 NEXT_PUBLIC_CAM03_GATE_API 치환이 빠졌을 수 있다. 이 상태로는 화면이 검게 나온다."
echo "   되돌리기 = 그 값을 넣어 다시 빌드·배포한다. 서버 응답과 런타임 env 로는 이 고장이 안 보인다."
exit 1
