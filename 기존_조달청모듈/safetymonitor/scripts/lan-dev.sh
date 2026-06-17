#!/usr/bin/env bash
# 관제 웹 dev 서버를 LAN(0.0.0.0)에 기동 — 셸 lifecycle 분리(nohup+disown). 조원 차단은 scripts/lan-firewall.sh 로 별도 적용.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="$ROOT/apps/dashboard-web"
RUNTIME="$ROOT/.runtime"
PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"

mkdir -p "$RUNTIME"

# 중복 바인딩 방지 — 기존 dev 프로세스 종료
if pgrep -f "next dev" >/dev/null 2>&1; then
  echo "기존 next dev 종료 중..."
  pkill -f "next dev" || true
  sleep 1
fi

cd "$WEB"
nohup ./node_modules/.bin/next dev -H "$HOST" -p "$PORT" > "$RUNTIME/dev.log" 2>&1 &
disown || true

LANIP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '?')"
echo "dev 기동: http://$HOST:$PORT"
echo "  - 로컬:  http://127.0.0.1:$PORT"
echo "  - LAN:   http://$LANIP:$PORT   (발표 PC·내 폰 브라우저)"
echo "  - 로그:  $RUNTIME/dev.log"
echo ""
echo "⚠ LAN 전체 개방 상태. 조원 차단하려면:"
echo "    scripts/lan-firewall.sh up"
echo "    scripts/lan-firewall.sh add <내 기기 IP>   # 폰/발표PC 마다"
