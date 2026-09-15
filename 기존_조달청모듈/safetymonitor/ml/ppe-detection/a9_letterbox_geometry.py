# 전처리 기하(직사각 vs 정사각)만 바꿔 착용자 오경보가 움직이는가 — [CCTV/ML] 반증의 독립 검증.
# .pt 하나로 두 경로를 돌린다. 모델·가중치·그래프가 같으므로 차이가 나오면 원인은 **입력 기하**다.
import csv, os
import xml.etree.ElementTree as ET
import numpy as np, cv2
from ultralytics import YOLO
from ultralytics.data.augment import LetterBox

ROOT = os.path.expanduser("~/Documents/조달청-공모전 관련자료")
P = f"{ROOT}/YOLO ML DATA/recall-plan-20260912"; G = f"{ROOT}/DATASETS/GDUT-HWD"
MAP = {"yellow":"helmet","white":"helmet","red":"helmet","blue":"helmet","none":"head"}
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
NH=sum(len(g["helmet"]) for _,g in items); ND=sum(len(g["head"]) for _,g in items)
print(f"GDUT holdout {len(items)}장 · helmet GT {NH} · head GT {ND}\n", flush=True)
m=YOLO(f"{ROOT}/YOLO ML DATA/ppe_yolo26s_640_v5_nc_best.pt"); NM=m.names
sq=LetterBox(new_shape=(960,960), auto=False, scaleup=True)
def inside(px,py,b): return b[0]<=px<=b[2] and b[1]<=py<=b[3]

def score(square):
    fa=0; used_tot=0; hel=0
    for im,g in items:
        img=cv2.imread(im); h0,w0=img.shape[:2]
        if square:
            r=min(960/h0,960/w0); nw,nh=round(w0*r),round(h0*r)
            dw,dh=(960-nw)/2,(960-nh)/2
            inp=sq(image=img)
        else:
            r,dw,dh=1.0,0.0,0.0; inp=img
        res=m.predict(inp, imgsz=960, conf=0.30, device="mps", verbose=False)[0]
        used=set()
        for b,c in zip(res.boxes.xyxy.cpu().numpy(), res.boxes.cls.cpu().numpy().astype(int)):
            px,py=(b[0]+b[2])/2,(b[1]+b[3])/2
            if square: px,py=(px-dw)/r,(py-dh)/r        # 원본 좌표계로 되돌린다
            if NM[c]=="head":
                if any(inside(px,py,k) for k in g["helmet"]): fa+=1
                for i,k in enumerate(g["head"]):
                    if i not in used and inside(px,py,k): used.add(i); break
            elif NM[c]=="helmet":
                if any(inside(px,py,k) for k in g["helmet"]): hel+=1
        used_tot+=len(used)
    return fa, used_tot, hel

print(f"{'전처리':26s} {'착용자 오경보':>18s} {'맨머리 검출':>16s} {'helmet 검출':>15s}")
for square,tag in ((False,"직사각(.pt 기본 auto=True)"),(True,"★정사각 960x960(엔진과 같음)")):
    fa,hd,hel=score(square)
    print(f"{tag:26s}  {fa:4d}/{NH} = {fa/NH:.4f}  {hd:4d}/{ND} = {hd/ND:.4f}  {hel:4d}/{NH} = {hel/NH:.4f}", flush=True)
