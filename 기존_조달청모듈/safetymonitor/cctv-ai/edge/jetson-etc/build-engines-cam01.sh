#!/bin/bash
# 2호기(CAM-01) 엔진 재빌드 — 이 기계에서 굽는다. 파이프라인을 내리고 굽고 **반드시 되살린다**.
#
# 왜: 복제할 때 1호기에서 구운 .engine 을 그대로 옮겨 와서 TensorRT 가 경고를 낸다.
#   [TRT] [W] Using an engine plan file across different models of devices ... affect performance
#   실측 추론 CAM-01 31+31ms(11fps) vs CAM-03 14+15ms(31fps) — 딱 2배다.
#
# ⚠ 되살리기는 trap 으로 건다. 빌드가 실패하든 죽든 파이프라인은 돌아온다.
# ⚠ 기존 엔진을 백업하고, 빌드가 실패하면 백업을 되돌린다.
set -u
LOG=~/build-engines-cam01.log
exec > >(tee -a "$LOG") 2>&1
echo "=== $(date +%H:%M:%S) 시작 ==="

PPE_PT=~/ppe_yolo26s_rect544x960_v7e_nc.pt
PPE_EN=~/ppe_yolo26s_rect544x960_v7e_nc.engine
POSE_PT=~/ultralytics/ultralytics/yolo11s-pose.pt
POSE_EN=~/ultralytics/ultralytics/yolo11s-pose.engine
STAMP=$(date +%m%d-%H%M)

restore() {
  echo "=== $(date +%H:%M:%S) 파이프라인 복구 ==="
  sudo systemctl start cctv-pusher-cam1.service
  sleep 14
  echo "  unit: $(systemctl is-active cctv-pusher-cam1)"
  sleep 3
  code=$(curl -s -m 8 -o /tmp/h1.json -w "%{http_code}" http://127.0.0.1:8445/health)
  echo "  health HTTP $code"
  if [ "$code" = "200" ]; then
    python3 -c 'import json;d=json.load(open("/tmp/h1.json"));print("  engine",d.get("engine"));print("  age",d.get("age"),"frames",d.get("frames"),"infer_ms",round(d.get("infer_ms",0)))'
  else
    echo "  ⛔ 복구 실패 — 사람이 봐야 한다"
  fi
}
trap restore EXIT

echo "--- 기존 엔진 백업 ---"
cp -f "$PPE_EN"  "$PPE_EN.bak-$STAMP"  && echo "  ok $(basename "$PPE_EN").bak-$STAMP"
cp -f "$POSE_EN" "$POSE_EN.bak-$STAMP" && echo "  ok $(basename "$POSE_EN").bak-$STAMP"

echo "--- 파이프라인 정지 (systemctl stop · 자동재시작을 막는다) ---"
sudo systemctl stop cctv-pusher-cam1.service
sleep 5
echo "  남은 프로세스: $(pgrep -cf 'python3 -u gopro_ppe_edge.py')개  (0 이어야 한다)"

FAIL=0
echo "--- ① PPE 엔진 (544x960 · FP16) ---"
cd ~ && timeout 1500 python3 -c "
from ultralytics import YOLO
YOLO('$PPE_PT').export(format='engine', half=True, imgsz=(544,960), workspace=2)
" && echo "  빌드 성공" || { echo "  ⛔ PPE 빌드 실패 (코드 $?)"; FAIL=1; }

echo "--- ② 자세 엔진 (640 · FP16) ---"
cd ~/ultralytics/ultralytics && timeout 1500 python3 -c "
from ultralytics import YOLO
YOLO('$POSE_PT').export(format='engine', half=True, imgsz=640, workspace=2)
" && echo "  빌드 성공" || { echo "  ⛔ 자세 빌드 실패 (코드 $?)"; FAIL=1; }

if [ "$FAIL" = "1" ]; then
  echo "--- ⛔ 실패 — 백업 되돌리기 ---"
  cp -f "$PPE_EN.bak-$STAMP"  "$PPE_EN"
  cp -f "$POSE_EN.bak-$STAMP" "$POSE_EN"
  echo "  되돌렸다"
fi

ls -la "$PPE_EN" "$POSE_EN" 2>/dev/null
echo "=== $(date +%H:%M:%S) 빌드 단계 끝 (FAIL=$FAIL) ==="
