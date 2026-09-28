# 근접 캡모자 사진을 프로덕션 엔진으로 판정해 head/helmet 어느 쪽으로 잡히는지 보는 일회성 측정기
import glob
import os
import sys

import cv2
import numpy as np
from ultralytics import YOLO

PAT = sys.argv[1] if len(sys.argv) > 1 else "/home/jetson/capphoto/*_rot.jpg"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/home/jetson/capphoto_sheet.jpg"
NAMES = ["person", "head", "helmet", "safety_vest", "foot", "shoes", "hands", "gloves"]
m = YOLO("/home/jetson/ppe_yolo26s_960_v5_nc.engine", task="detect")

crops, tot = [], {"head": 0, "helmet": 0}
for f in sorted(glob.glob(PAT)):
    img = cv2.imread(f)
    H, W = img.shape[:2]
    r = m.predict(img, imgsz=960, conf=0.30, verbose=False)[0]
    per = {"head": 0, "helmet": 0}
    for b, c, cf in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist(), r.boxes.conf.tolist()):
        n = NAMES[int(c)]
        if n not in ("head", "helmet"):
            continue
        per[n] += 1
        tot[n] += 1
        x1, y1, x2, y2 = [int(v) for v in b]
        pad = int((y2 - y1) * 0.45)
        cr = img[max(0, y1 - pad):min(H, y2 + pad), max(0, x1 - pad):min(W, x2 + pad)]
        if cr.size == 0:
            continue
        cr = cv2.resize(cr, (200, 200))
        cv2.rectangle(cr, (0, 0), (199, 199), (0, 0, 255) if n == "head" else (0, 200, 0), 4)
        cv2.putText(cr, "{} {:.2f}".format(n, cf), (6, 190), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)
        cv2.putText(cr, "h{:.3f}".format((y2 - y1) / H), (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
        crops.append(cr)
    print("{:24s} head {:2d} · helmet {:2d}".format(os.path.basename(f), per["head"], per["helmet"]))

print("합계", tot)
if crops:
    cols = 5
    rows = (len(crops) + cols - 1) // cols
    sh = np.zeros((rows * 200, cols * 200, 3), np.uint8)
    for i, c in enumerate(crops):
        sh[i // cols * 200:(i // cols + 1) * 200, i % cols * 200:(i % cols + 1) * 200] = c
    cv2.imwrite(OUT, sh, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print("시트", sh.shape, "→", OUT)
