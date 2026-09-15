#!/bin/zsh
# 지연 누적 곡선을 남긴다. input_lag_s 가 자라면 젯슨/ffmpeg 쪽, 안 자라면 GoPro 내부다.
OUT="$1"
echo "ts,iso,input_lag_s,age,stream_fps,reconnects,system_hot" > "$OUT"
while true; do
  H=$(curl -s -m 6 http://yahboom-1:8444/health 2>/dev/null)
  G=$(ssh -o ConnectTimeout=8 -o BatchMode=yes jetson@yahboom-1 'curl -s -m 4 http://172.23.102.51/gopro/camera/state' 2>/dev/null)
  python3 -c "
import json,sys,time
h=json.loads('''$H''') if '''$H''' else {}
try: hot=json.loads('''$G''')['status'].get('6')
except Exception: hot=''
print('%.0f,%s,%s,%s,%s,%s,%s' % (time.time(), time.strftime('%H:%M:%S'),
  h.get('input_lag_s',''), h.get('age',''), round(h.get('stream_fps',0),1), h.get('reconnects',''), hot))
" >> "$OUT" 2>/dev/null
  sleep 120
done
