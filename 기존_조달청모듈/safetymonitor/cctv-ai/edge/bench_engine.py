# TensorRT 엔진 추론 지연 기준선 측정기 — 모듈 8GB 교체 전후 비교용 (ultralytics 경로)
import sys, os, time, numpy as np
os.chdir("/home/jetson")
from ultralytics import YOLO

ENG = sys.argv[1] if len(sys.argv) > 1 else "ppe_yolo26s_640_v5_nc.engine"
IMGSZ = int(sys.argv[2]) if len(sys.argv) > 2 else 640        # 엔진을 구운 imgsz 와 맞출 것
OW, OH = (map(int, sys.argv[3].split("x")) if len(sys.argv) > 3 else (640, 360))  # 입력 프레임 WxH
WARM, ITER = 15, 150

m = YOLO(ENG, task="detect")
frame = (np.random.rand(OH, OW, 3) * 255).astype(np.uint8)

for _ in range(WARM):
    m.predict(frame, imgsz=IMGSZ, conf=0.30, verbose=False, device=0)

pre, inf, post = [], [], []
t_all = time.perf_counter()
for _ in range(ITER):
    r = m.predict(frame, imgsz=IMGSZ, conf=0.30, verbose=False, device=0)[0]
    pre.append(r.speed["preprocess"]); inf.append(r.speed["inference"]); post.append(r.speed["postprocess"])
wall = (time.perf_counter() - t_all) / ITER * 1000

f = lambda a: f"{np.mean(a):6.2f} ms  (p95 {np.percentile(a,95):5.2f})"
print(f"엔진        {ENG}")
print(f"입력        {OW}x{OH} → imgsz {IMGSZ} · {ITER}회")
print(f"전처리      {f(pre)}")
print(f"★ 추론      {f(inf)}   → {1000/np.mean(inf):.1f} fps")
print(f"후처리      {f(post)}")
print(f"전체(벽시계) {wall:6.2f} ms  → {1000/wall:.1f} fps")
