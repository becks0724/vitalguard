#!/usr/bin/env bash
# 관제 웹 포트 3000 의 LAN 접근을 허용목록 IP 로 제한하는 macOS pf 방화벽 관리 (조원 차단). up/down/add/del/list/status.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="$ROOT/scripts/lan-firewall.pf.conf"
ALLOW_FILE="$ROOT/.runtime/lan-allow.txt"   # 허용 IP 영속 (gitignore 되는 .runtime/)
TABLE="safetymonitor_lan_allow"

mkdir -p "$ROOT/.runtime"
touch "$ALLOW_FILE"

cmd="${1:-status}"
case "$cmd" in
  up)
    # pf 활성 + 룰셋 로드 → 허용목록 파일을 테이블에 반영
    sudo pfctl -e -f "$CONF"
    if [ -s "$ALLOW_FILE" ]; then
      sudo pfctl -t "$TABLE" -T replace -f "$ALLOW_FILE"
    fi
    echo "방화벽 ON — 포트 3000 은 루프백 + 허용목록 IP 만 접근 가능."
    echo "--- 현재 허용 IP ---"
    sudo pfctl -t "$TABLE" -T show 2>/dev/null || true
    echo "(허용목록이 비어 있으면 이 Mac(127.0.0.1)에서만 보입니다. 'add <IP>' 로 내 기기 추가.)"
    ;;
  down)
    sudo pfctl -d
    echo "방화벽 OFF — pf 비활성(되돌림). 포트 3000 이 LAN 전체에 다시 개방됩니다."
    ;;
  add)
    ip="${2:?사용법: lan-firewall.sh add <IP>}"
    grep -qxF "$ip" "$ALLOW_FILE" 2>/dev/null || echo "$ip" >> "$ALLOW_FILE"
    sudo pfctl -t "$TABLE" -T add "$ip" 2>/dev/null || echo "(pf 미활성 — 'up' 후 자동 반영됩니다)"
    echo "허용 추가: $ip"
    ;;
  del)
    ip="${2:?사용법: lan-firewall.sh del <IP>}"
    if [ -s "$ALLOW_FILE" ]; then
      grep -vxF "$ip" "$ALLOW_FILE" > "$ALLOW_FILE.tmp" || true
      mv "$ALLOW_FILE.tmp" "$ALLOW_FILE"
    fi
    sudo pfctl -t "$TABLE" -T delete "$ip" 2>/dev/null || true
    echo "허용 제거: $ip"
    ;;
  list)
    echo "허용목록 파일($ALLOW_FILE):"
    cat "$ALLOW_FILE" 2>/dev/null || true
    echo "--- pf 테이블(라이브) ---"
    sudo pfctl -t "$TABLE" -T show 2>/dev/null || echo "(pf 미활성)"
    ;;
  status)
    sudo pfctl -s info 2>/dev/null | head -1 || true
    echo "--- 포트 3000 규칙 ---"
    sudo pfctl -s rules 2>/dev/null | grep -i 3000 || echo "(없음 — 방화벽 미적용 / LAN 전체 개방)"
    ;;
  *)
    echo "사용법: lan-firewall.sh {up|down|add <IP>|del <IP>|list|status}"
    exit 1
    ;;
esac
