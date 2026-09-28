#!/bin/sh
# Tailscale 인증서를 자동 갱신하고, 실제로 바뀐 날만 게이트를 재시작한다
# DRY=1          재시작 대신 로그만 (시험용)
# FORCE_CHANGED=1 갱신 호출을 건너뛰고 「바뀜」으로 친다 (양성 통제 — 분기가 사는지 본다)
set -eu
H=jetson-1.tailnet.invalid
OWNER=jetson
C="/home/$OWNER/$H.crt"
K="/home/$OWNER/$H.key"
DRY="${DRY:-0}"

[ -s "$C" ] || { logger -t tscert "인증서 파일이 없다 — 중단"; exit 1; }
BEFORE=$(md5sum "$C" | cut -d' ' -f1)

if [ "${FORCE_CHANGED:-0}" = "1" ]; then
  AFTER="positive-control-fake-hash"
else
  if ! /usr/bin/tailscale cert --cert-file "$C" --key-file "$K" "$H" >/dev/null 2>&1; then
    logger -t tscert "갱신 호출 실패 — 다음 차례에 다시 시도"
    exit 0
  fi
  chown "$OWNER:$OWNER" "$C" "$K" 2>/dev/null || true
  chmod 644 "$C" 2>/dev/null || true
  chmod 600 "$K" 2>/dev/null || true
  AFTER=$(md5sum "$C" | cut -d' ' -f1)
fi

END=$(openssl x509 -in "$C" -noout -enddate 2>/dev/null | cut -d= -f2)
if [ "$BEFORE" = "$AFTER" ]; then
  logger -t tscert "변동 없음 · 만료 $END"
  exit 0
fi

if [ "$DRY" = "1" ]; then
  logger -t tscert "[DRY] 갱신 감지 · 만료 $END — 여기서 cctv-gate 를 재시작했을 것"
else
  logger -t tscert "갱신됨 · 만료 $END — cctv-gate 재시작"
  systemctl restart cctv-gate
fi
