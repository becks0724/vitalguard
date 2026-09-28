# 사람 박스 안에 머리류 박스가 있는지 프레임마다 확인해 '머리를 놓친 작업자' 를 골라내는 진단기
import glob
import sys

import cv2
import numpy as np
from ultralytics import YOLO

NAMES = ["person", "head", "helmet", "safety_vest", "foot", "shoes", "hands", "gloves"]
m = YOLO("/home/jetson/ppe_yolo26s_960_v5_nc.engine", task="detect")
files = sorted(glob.glob(sys.argv[1] if len(sys.argv) > 1 else "/home/jetson/cam03_data/*amb3*.jpg"))

def inside(hb, pb):
    hx = (hb[0] + hb[2]) / 2
    hy = (hb[1] + hb[3]) / 2
    return pb[0] <= hx <= pb[2] and pb[1] <= hy <= pb[3]

miss, tot, crops = 0, 0, []
for f in files:
    img = cv2.imread(f)
    H, W = img.shape[:2]
    r = m.predict(img, imgsz=960, conf=0.30, verbose=False)[0]
    ppl, heads = [], []
    for b, c in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist()):
        n = NAMES[int(c)]
        (ppl if n == "person" else heads if n in ("head", "helmet") else []).append(b)
    for pb in ppl:
        tot += 1
        if any(inside(hb, pb) for hb in heads):
            continue
        miss += 1
        x1, y1, x2, y2 = [int(v) for v in pb]
        cr = img[max(0, y1):y2, max(0, x1):x2]
        if cr.size and len(crops) < 20:
            cr = cv2.resize(cr, (170, 230))
            cv2.rectangle(cr, (0, 0), (169, 229), (0, 90, 235), 3)
            cv2.putText(cr, "h{:.3f}".format((y2 - y1) / H), (5, 222),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 2)
            crops.append(cr)
print("프레임 {} · 작업자 박스 {} · 머리 없는 박스 {} ({:.1f}%)".format(
    len(files), tot, miss, 100 * miss / max(tot, 1)))
if crops:
    cols = 5
    rows = (len(crops) + cols - 1) // cols
    sh = np.zeros((rows * 230, cols * 170, 3), np.uint8)
    for i, cr in enumerate(crops):
        sh[i // cols * 230:(i // cols + 1) * 230, i % cols * 170:(i % cols + 1) * 170] = cr
    cv2.imwrite("/home/jetson/head_miss.jpg", sh, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print("크롭 시트", sh.shape)
