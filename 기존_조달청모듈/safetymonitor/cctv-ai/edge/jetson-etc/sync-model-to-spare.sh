#!/bin/bash
# 두 젯슨의 모델 판본을 맞춘다 — 사용자 지시 2026-09-18 「항상 동일하게 유지, 최신을 양쪽에」.
# 기존 젯슨에서 실행한다. ⛔ 서비스는 건드리지 않는다(2호기는 꺼진 채로 둔다).
set -u
TARGET="${1:-}"
[ -n "$TARGET" ] || { printf '⛔ 대상을 적어야 한다.  사용법: %s jetson@<주소>\n' "$0" >&2; exit 1; }
say() { printf '\n=== %s ===\n' "$1"; }
die() { printf '⛔ %s\n' "$1" >&2; exit 1; }

say "0. 대상 확인"
ssh -o BatchMode=yes -o ConnectTimeout=6 "$TARGET" true 2>/dev/null || die "열쇠 접속 불가: $TARGET"
MARK="$HOME/.sync-selfcheck.$$-${RANDOM}"; : > "$MARK"
if ssh "$TARGET" "test -e '$MARK'" 2>/dev/null; then rm -f "$MARK"; die "대상이 이 기계 자신이다"; fi
rm -f "$MARK"
printf '  %s  (%s)\n' "$TARGET" "$(ssh "$TARGET" hostname 2>/dev/null)"

say "1. 기존이 지금 실제로 쓰는 엔진"
LIVE=$(sudo grep -hoE '/home/jetson/[^ ]*\.engine' /etc/systemd/system/cctv-pusher.service.d/*.conf 2>/dev/null | tail -1)
[ -n "$LIVE" ] && SRC="drop-in" || {
  LIVE=$(grep -m1 -oE '"[^"]*ppe_[a-z0-9_]*\.engine"' "$HOME/vg_edge_poc/gopro_ppe_edge.py" 2>/dev/null | tr -d '"')
  LIVE="$HOME/${LIVE##*/}"; SRC="코드 기본값"
}
[ -f "$LIVE" ] || die "라이브 엔진 파일을 못 찾았다: $LIVE"
POSE="$HOME/ultralytics/ultralytics/yolo11s-pose.engine"
printf '  PPE  %s  (%s)\n' "$(basename "$LIVE")" "$SRC"
printf '  자세 %s\n' "$(basename "$POSE")"

say "2. 판본 대조"
NEED=0
for f in "$LIVE" "$POSE"; do
  [ -f "$f" ] || continue
  A=$(md5sum "$f" | cut -c1-12)
  B=$(ssh "$TARGET" "md5sum '$f' 2>/dev/null | cut -c1-12" 2>/dev/null)
  if [ "$A" = "$B" ]; then
    printf '  ✅ %-46s %s 같음\n' "$(basename "$f")" "$A"
  else
    printf '  ⚠ %-46s 기존 %s / 대상 %s\n' "$(basename "$f")" "$A" "${B:-없음}"
    NEED=1
  fi
done
[ "$NEED" = "0" ] && { say "완료"; echo "  이미 같다. 옮길 것 없음."; exit 0; }

say "3. 옮기기"
for f in "$LIVE" "$POSE"; do
  [ -f "$f" ] || continue
  ssh "$TARGET" "mkdir -p '$(dirname "$f")'" 2>/dev/null
  rsync -a "$f" "$TARGET:$f" && printf '  ok %s\n' "$(basename "$f")"
done

say "4. 옮긴 뒤 다시 대조"
OK=1
for f in "$LIVE" "$POSE"; do
  [ -f "$f" ] || continue
  A=$(md5sum "$f" | cut -c1-12)
  B=$(ssh "$TARGET" "md5sum '$f' 2>/dev/null | cut -c1-12" 2>/dev/null)
  [ "$A" = "$B" ] && printf '  ✅ %s %s\n' "$(basename "$f")" "$A" || { printf '  ⛔ %s 여전히 다르다\n' "$(basename "$f")"; OK=0; }
done
[ "$OK" = "1" ] || die "대조 실패 — 손으로 확인할 것"

say "완료"
echo "  ⛔ 2호기 서비스는 건드리지 않았다. 꺼진 상태 그대로다."
echo "  ⚠ 2호기를 실제로 투입할 때 drop-in engine.conf 가 이 엔진을 가리키는지 확인한다."
