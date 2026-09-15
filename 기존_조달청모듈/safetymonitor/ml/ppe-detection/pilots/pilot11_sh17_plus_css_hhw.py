#!/usr/bin/env python3
# 파일럿 11 — 안전모와 안전화를 한 모델에서 둘 다 얻을 수 있는지 본다.
#   pilot10 (SH17 없음)            helmet 97/FP3 · person 99/FP16 · vest 59 · shoes  0
#   pilot7  (SH17 있음·CSS/HHW 없음) helmet 77/FP3 · person 91/FP8  · vest 43 · shoes 71
#   pilot11 = 그 둘의 합. 여기서 helmet 이 90 근처면 Ⓐ(안전화 포기)를 고를 이유가 없어진다.
#   ⚠ 시작 가중치·에포크·배치·imgsz·기기를 pilot4·pilot10 과 똑같이 둔다. 하나라도 바꾸면 비교가 깨진다.
#     (자료만 바꾼다 — 사다리의 규칙이다)
import os, time
ROOT = "~/Documents/조달청-공모전 관련자료"
W = f"{ROOT}/YOLO ML DATA"; P = f"{W}/recall-plan-20260912"
DATA = f"{P}/runs/pilot11_data"
START = f"{W}/yolo26s.pt"                       # ★ pilot4·pilot10 과 동일
assert os.path.exists(f"{DATA}/data.yaml"), "pilot11_build.py 를 먼저 돌릴 것"
assert os.path.exists(START), START
n = len(os.listdir(f"{DATA}/images/train"))
assert n == 18906, f"장수가 다르다: {n:,}"      # 구성이 바뀌면 비교가 깨지므로 여기서 멈춘다
from ultralytics import YOLO
t0 = time.time()
m = YOLO(START)
m.train(data=f"{DATA}/data.yaml", epochs=5, imgsz=640, batch=16, device="mps",
        project=f"{P}/runs", name="pilot11_sh17_css_hhw", exist_ok=True, val=False, plots=False, verbose=False)
print("  학습 끝 %.0fs" % (time.time()-t0), flush=True)
print("\n→ 가중치 %s/runs/pilot11_sh17_css_hhw/weights/best.pt" % P)
