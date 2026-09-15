#!/usr/bin/env python3
# 파일럿 4 — 파일럿 3 과 **자료·에포크·배치·imgsz 전부 동일**, 시작 가중치만 v5 → yolo26s.pt(COCO).
#   묻는 것 하나: 파일럿3 의 현장 helmet 94/100 은 「GDUT 자료」 덕인가 「v5 에서 출발한」 덕인가.
#   codex 2차 적대검증(09-14) 권고. 7차-C(E63 절제)를 돌리기 전에 가장 큰 교란(시작점)을 먼저 가른다.
#     yolo26s 출발도 ~94 → 시작점 무관 → E63 가설이 산다 → 7차-C 로 간다
#     yolo26s 출발이 실패 → 시작점이 원인 → 7차-C 는 돌려도 해석 불가 → 처방이 「v5 출발」로 바뀐다
#   ⚠ pilot3_data 를 그대로 쓴다(의사라벨 마커 있음 · 재생성 금지). 자료를 건드리면 비교가 깨진다.
import os, time
ROOT = "~/Documents/조달청-공모전 관련자료"
W = f"{ROOT}/YOLO ML DATA"; P = f"{W}/recall-plan-20260912"
DATA = f"{P}/runs/pilot3_data"                  # ★ pilot3 와 같은 자료
START = f"{W}/yolo26s.pt"                       # ★ 유일한 변경 — pilot3 는 ppe_yolo26s_640_v5_nc_best.pt
assert os.path.exists(f"{DATA}/.pseudo_done"), "pilot3 의사라벨 마커가 없다 — 자료가 다르면 비교가 무효다"
assert os.path.exists(START), START
from ultralytics import YOLO
t0 = time.time()
m = YOLO(START)
m.train(data=f"{DATA}/data.yaml", epochs=5, imgsz=640, batch=16, device="mps",
        project=f"{P}/runs", name="pilot4_yolo26_start", exist_ok=True, val=False, plots=False, verbose=False)
print("  학습 끝 %.0fs" % (time.time()-t0), flush=True)
print("\n→ 가중치 %s/runs/pilot4_yolo26_start/weights/best.pt" % P)
print("→ 채점: python3 gate_score_xcheck.py 로 현장35 helmet 중심포함 conf0.30 imgsz960")
