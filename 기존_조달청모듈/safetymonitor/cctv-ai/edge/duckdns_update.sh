#!/bin/sh
# DuckDNS 갱신 — vitalguard-cam 이 젯슨의 "유선 LAN 주소"를 가리키게 유지한다.
#
# 왜 공인 IP 가 아니라 사설 IP 인가
#   젯슨은 학원 공용망에 있어 바깥에서 들어오는 연결을 받을 수 없다(공유기 접근 불가).
#   그래서 시청은 같은 망 안에서만 한다. 이름을 LAN 주소로 두면 Let's Encrypt 인증서가
#   그대로 맞아 브라우저가 경고 없이 붙는다. 동시에 인터넷 노출은 0 이 된다.
#   ⚠ 바깥 공개로 전환하려면 이 줄을 공인 IP(ip= 를 비움)로 되돌리면 된다.
IFACE=${DUCKDNS_IFACE:-enP8p1s0}
IP=$(ip -4 -o addr show "$IFACE" 2>/dev/null | awk '{print $4}' | cut -d/ -f1)
[ -n "$IP" ] || { logger -t duckdns "no ip on $IFACE"; exit 1; }
TOKEN=$(cat "$HOME/.duckdns_token" 2>/dev/null) || exit 1
RESP=$(curl -s --max-time 20 "https://www.duckdns.org/update?domains=vitalguard-cam&token=$TOKEN&ip=$IP")
logger -t duckdns "update $IFACE $IP -> ${RESP:-no-response}"
[ "$RESP" = "OK" ] || exit 1
