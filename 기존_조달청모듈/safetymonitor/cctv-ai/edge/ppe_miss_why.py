# 가까이 있는 작업자를 놓치는 이유를 화각(스케일)·가림·겉모습으로 갈라 재는 진단기
"""
지적된 자리(ROI)에 대해 세 가지를 따로 잰다. 셋을 한 번에 보아야 원인이 갈린다.

  ① 안정성   같은 자리를 여러 프레임 재서 배포 문턱(0.30)에서 몇 %나 잡히는지.
             점수가 문턱 근처면 '간헐적으로 된다' 의 정체가 그것이다.
  ② 문턱     문턱을 낮추면 되찾는 사람 수와 함께 늘어나는 헛것을 같이 본다.
  ③ 스케일   그 자리만 잘라 배율만 올려 다시 돌린다(비율 유지 — 늘리면 결과가 망가진다).
             거기서 잡히면 원인은 겉모습이 아니라 '너무 가까워 크게 찍혀서'다.

푸셔의 원본 스냅샷(/snapshot?raw=1)을 쓰므로 GoPro 를 따로 열지 않는다.
사용:  python3 ppe_miss_why.py [x1 y1 x2 y2]      # 정규화 ROI · 생략하면 화면 하단 중앙
"""
import statistics
import sys
import time
import urllib.request

import cv2
import numpy as np
from ultralytics import YOLO

NAMES = ["person", "head", "helmet", "safety_vest", "foot", "shoes", "hands", "gloves"]
URL = "http://localhost:8444/snapshot?raw=1"
TRAIN = "학습 머리 높이 참고: 중앙 0.051 · 5~95% 0.033~0.086 · 최대 0.141"
ROI = tuple(float(v) for v in sys.argv[1:5]) if len(sys.argv) >= 5 else (0.33, 0.66, 0.62, 1.00)
m = YOLO("/home/jetson/ppe_yolo26s_960_v5_nc.engine", task="detect")


def grab():
    return cv2.imdecode(np.frombuffer(urllib.request.urlopen(URL, timeout=5).read(), np.uint8),
                        cv2.IMREAD_COLOR)


def rows(img, conf):
    r = m.predict(img, imgsz=960, conf=conf, verbose=False)[0]
    return [(NAMES[int(c)], b, s) for b, c, s in
            zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist(), r.boxes.conf.tolist())]


def in_roi(b, W, H):
    cx, cy = (b[0] + b[2]) / 2 / W, (b[1] + b[3]) / 2 / H
    return ROI[0] <= cx <= ROI[2] and ROI[1] <= cy <= ROI[3]


N = 40
best_hist = {"person": [], "head": [], "helmet": []}
head_h, pers_h = [], []
whole = {c: {k: [] for k in ("person", "head", "helmet")} for c in (0.30, 0.20, 0.15, 0.10)}
last = None
for _ in range(N):
    img = last = grab()
    H, W = img.shape[:2]
    rs = rows(img, 0.05)
    best = {}
    for n, b, s in rs:
        if in_roi(b, W, H) and s > best.get(n, (0, 0))[0]:
            best[n] = (s, (b[3] - b[1]) / H)
    for k in best_hist:
        best_hist[k].append(best.get(k, (0.0, 0))[0])
    if "head" in best:
        head_h.append(best["head"][1])
    if "person" in best:
        pers_h.append(best["person"][1])
    for cf in whole:
        for k in whole[cf]:
            whole[cf][k].append(sum(1 for n, _, s in rs if n == k and s >= cf))
    time.sleep(0.8)

print("지적한 자리 x%.2f~%.2f y%.2f~%.2f · 프레임 %d장\n" % (*ROI, N))
print("① 안정성 — 그 자리에서 배포 문턱(0.30)이 잡아내는 비율")
print("   %-8s %10s %10s %10s" % ("클래스", "0.30", "0.10", "점수 중앙"))
for k, v in best_hist.items():
    nz = [s for s in v if s > 0]
    print("   %-8s %8.0f%% %9.0f%% %10s" % (
        k, 100 * sum(s >= 0.30 for s in v) / N, 100 * sum(s >= 0.10 for s in v) / N,
        ("%.2f" % statistics.median(nz)) if nz else "—"))
for nm, v in (("머리 정규화 높이", head_h), ("작업자 박스 높이", pers_h)):
    if v:
        v = sorted(v)
        print("   %s  %.3f ~ %.3f (중앙 %.3f · n%d)" % (nm, v[0], v[-1], statistics.median(v), len(v)))
print("   " + TRAIN)

print("\n② 문턱 — 낮추면 되찾는 수와 함께 늘어나는 헛것")
print("   %6s %10s %10s %10s" % ("문턱", "작업자", "머리", "안전모"))
for cf in sorted(whole, reverse=True):
    print("   %6.2f %10.1f %10.1f %10.1f" % (cf, *[sum(whole[cf][k]) / N
                                                   for k in ("person", "head", "helmet")]))

print("\n③ 스케일 — 그 자리만 잘라 배율만 올린다(비율 유지)")
H, W = last.shape[:2]
crop = last[int(ROI[1] * H):int(ROI[3] * H), int(ROI[0] * W):int(ROI[2] * W)]
for k in (1, 2, 3, 4):
    c = crop if k == 1 else cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    d = {}
    for n, _, s in rows(c, 0.30):
        d[n] = max(d.get(n, 0), s)
    print("   %dx (%4dx%4d)  %s" % (k, c.shape[1], c.shape[0],
                                    " · ".join("%s %.2f" % kv for kv in sorted(d.items()))
                                    or "아무것도 없음"))
    cv2.imwrite("/home/jetson/miss_zoom_%dx.jpg" % k, c)
print("\n읽는 법 — ①이 낮고 ③에서 잡히면 원인은 거리·화각이다(스케일이 학습 밖).")
print("           ③에서도 안 잡히면 겉모습(부감·가림)이 원인이다.")
