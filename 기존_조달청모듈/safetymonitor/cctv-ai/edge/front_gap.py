# 앞모습 화각에서 PPE 탐지가 뒷모습과 얼마나 다른지 재는 비교기 (학습 구멍 정량화)
"""어제 뒷모습 실측 = 작업자 박스 197개 중 26개(13.2%)에 머리 박스가 없었다.
   같은 방법을 앞모습에 적용해 차이를 낸다. 정답은 필요 없다 — 커버리지는 자기참조로 잰다."""
import statistics, time, urllib.request
import cv2, numpy as np
from ultralytics import YOLO

NAMES = ["person","head","helmet","safety_vest","foot","shoes","hands","gloves"]
m = YOLO("/home/jetson/ppe_yolo26s_960_v5_nc.engine", task="detect")
N = 20
tot = miss = 0
heads, cls_cnt = [], {}
for i in range(N):
    img = cv2.imdecode(np.frombuffer(urllib.request.urlopen(
        "http://localhost:8444/snapshot?raw=1", timeout=5).read(), np.uint8), cv2.IMREAD_COLOR)
    H, W = img.shape[:2]
    r = m.predict(img, imgsz=960, conf=0.30, verbose=False)[0]
    ppl, hd = [], []
    for b, c in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist()):
        n = NAMES[int(c)]
        cls_cnt[n] = cls_cnt.get(n, 0) + 1
        if n == "person": ppl.append(b)
        elif n in ("head", "helmet"): hd.append((n, b))
    for pb in ppl:
        tot += 1
        got = [h for h in hd if pb[0] <= (h[1][0]+h[1][2])/2 <= pb[2]
               and pb[1] <= (h[1][1]+h[1][3])/2 <= pb[3]]
        if got:
            heads.append((got[0][1][3]-got[0][1][1]) / H)
        else:
            miss += 1
    time.sleep(1.0)

print("앞모습 화각 · %d프레임 · 작업자 박스 %d개\n" % (N, tot))
print("  머리 없는 작업자  %d / %d = %.1f%%   (어제 뒷모습 13.2%%)" % (miss, tot, 100*miss/max(tot,1)))
if heads:
    h = sorted(heads)
    print("  머리 정규화 높이  5%% %.3f · 중앙 %.3f · 95%% %.3f · 최대 %.3f"
          % (h[max(0,len(h)//20)], statistics.median(h), h[min(len(h)-1,len(h)*19//20)], h[-1]))
    lo, hi, mx = 0.033, 0.086, 0.141
    print("  학습 5~95%% 대역(%.3f~%.3f) 안  %.1f%%" % (lo, hi, 100*sum(1 for x in h if lo<=x<=hi)/len(h)))
    print("  학습 최대(%.3f) 초과            %.1f%%   ← 이 구간이 학습에 없다" % (mx, 100*sum(1 for x in h if x>mx)/len(h)))
print("\n  클래스별 검출(프레임당)  " + " · ".join("%s %.1f" % (k, v/N) for k, v in sorted(cls_cnt.items())))
