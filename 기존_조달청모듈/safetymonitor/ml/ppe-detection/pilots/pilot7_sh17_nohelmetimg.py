#!/usr/bin/env python3
# 파일럿 7 — pilot6 에서 **helmet 라벨이 있는 SH17 이미지 237장만** 뺀다. 그 밖은 전부 동일.
#   묻는 것 하나: "착용 안전모를 배경으로 가르치는 사진"을 없애면 helmet 이 회복되는가.
#     무너지면 → E63 이 7차-A helmet 0/100 의 범인. 7차-C(E63 제외)가 처방이 된다.
#     안 무너지면 → 범인은 E63 이 아니다. SH17·CSS·HHW 또는 혼합 자체를 봐야 한다.
#   ⚠ 시작 가중치·에포크·배치·imgsz·기기를 pilot4 와 똑같이 둔다. 하나라도 바꾸면 비교가 깨진다.
import os, time
ROOT = "~/Documents/조달청-공모전 관련자료"
W = f"{ROOT}/YOLO ML DATA"; P = f"{W}/recall-plan-20260912"
DATA = f"{P}/runs/pilot7_data"
START = f"{W}/yolo26s.pt"                       # ★ pilot4 와 동일
assert os.path.exists(f"{DATA}/data.yaml"), "pilot7_build.py 를 먼저 돌릴 것"
assert os.path.exists(START), START
from ultralytics import YOLO
t0 = time.time()
m = YOLO(START)
m.train(data=f"{DATA}/data.yaml", epochs=5, imgsz=640, batch=16, device="mps",
        project=f"{P}/runs", name="pilot7_sh17_nohelmetimg", exist_ok=True, val=False, plots=False, verbose=False)
print("  학습 끝 %.0fs" % (time.time()-t0), flush=True)
print("\n→ 가중치 %s/runs/pilot7_sh17_nohelmetimg/weights/best.pt" % P)
