# CAM-03(+0.080) 과 GDUT(−0.002) 의 부호 차이를 **안전모 크기**가 설명하는가.
# CAM-03 은 실내 근접(머리 ~97px)이고 GDUT 은 야외 원거리다. 같은 GDUT 안에서 크기로 갈라 본다.
import csv,os,collections
import xml.etree.ElementTree as ET
import numpy as np, cv2
from ultralytics import YOLO
from ultralytics.data.augment import LetterBox
ROOT=os.path.expanduser("~/Documents/조달청-공모전 관련자료")
P=f"{ROOT}/YOLO ML DATA/recall-plan-20260912"; G=f"{ROOT}/DATASETS/GDUT-HWD"
MAP={"yellow":"helmet","white":"helmet","red":"helmet","blue":"helmet","none":"head"}
items=[]
for r in csv.DictReader(open(f"{P}/results/pilot_gdut_hash_split.csv")):
    if r["split"].strip().lower()!="holdout": continue
    s=r["stem"]; x=f"{G}/Annotations/{s}.xml"; im=f"{G}/JPEGImages/{s}.jpg"
    if not(os.path.exists(x) and os.path.exists(im)): continue
    g={"helmet":[],"head":[]}
    for o in ET.parse(x).getroot().findall("object"):
        n=MAP.get((o.findtext("name") or "").strip()); b=o.find("bndbox")
        if n and b is not None: g[n].append(tuple(float(b.findtext(k)) for k in ("xmin","ymin","xmax","ymax")))
    items.append((im,g))
m=YOLO(f"{ROOT}/YOLO ML DATA/ppe_yolo26s_640_v5_nc_best.pt"); NM=m.names
sq=LetterBox(new_shape=(960,960), auto=False, scaleup=True)
BINS=[(0,20),(20,40),(40,70),(70,10**9)]
def binof(w):
    for i,(lo,hi) in enumerate(BINS):
        if lo<=w<hi: return i
    return len(BINS)-1
def inside(px,py,b): return b[0]<=px<=b[2] and b[1]<=py<=b[3]
def score(square):
    fa=collections.Counter()
    for im,g in items:
        img=cv2.imread(im); h0,w0=img.shape[:2]
        base=cv2.resize(img,(960,540)); sx,sy=960/w0,540/h0
        inp=sq(image=base) if square else base; dh=(960-540)/2 if square else 0.0
        res=m.predict(inp, imgsz=960, conf=0.30, device="mps", verbose=False)[0]
        for b,c in zip(res.boxes.xyxy.cpu().numpy(), res.boxes.cls.cpu().numpy().astype(int)):
            if NM[c]!="head": continue
            px,py=(b[0]+b[2])/2,((b[1]+b[3])/2-dh)
            px,py=px/sx,py/sy
            for k in g["helmet"]:
                if inside(px,py,k):
                    fa[binof((k[2]-k[0])*sx)] += 1   # ★ 960x540 로 환산한 폭으로 구간
                    break
    return fa
# 구간별 GT 수 (960x540 환산)
ngt=collections.Counter()
for im,g in items:
    h0,w0=cv2.imread(im).shape[:2]; sx=960/w0
    for k in g["helmet"]: ngt[binof((k[2]-k[0])*sx)] += 1
r=score(False); s=score(True)
print(f"GDUT holdout · 960x540 환산 안전모 폭 구간별 착용자 오경보 (분모 = 그 구간 GT 수)\n")
print(f"{'폭(px)':12s} {'GT':>6s} {'직사각':>12s} {'정사각':>12s} {'정사각−직사각':>14s}")
for i,(lo,hi) in enumerate(BINS):
    n=ngt[i]
    if not n: continue
    a,b=r[i]/n, s[i]/n
    tag=f"{lo}~{hi if hi<10**8 else ''}"
    print(f"{tag:12s} {n:6d}  {r[i]:4d} = {a:.4f}  {s[i]:4d} = {b:.4f}   {b-a:+.4f}")
print(f"\n참고 — CAM-03 머리 ~97px · 정사각−직사각 = **+0.0800**")
