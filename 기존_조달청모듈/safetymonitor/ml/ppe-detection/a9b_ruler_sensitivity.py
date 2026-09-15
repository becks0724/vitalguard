# 내 GDUT 기하 결과가 **자에 민감한가** — 같은 예측에 자 셋을 대 본다.
#   A 객체 단위   head 중심이 GT helmet 박스 안            (내 원래 자)
#   B 프레임 단위 helmet 이 있는 사진에서 그런 head 가 하나라도 있나  ([CCTV/ML] 자에 가깝다)
#   C 느슨한 겹침 head 박스가 GT helmet 과 IoU ≥ 0.3
import csv,os
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
NH=sum(len(g["helmet"]) for _,g in items)
NF=sum(1 for _,g in items if g["helmet"])          # helmet 이 있는 사진 수 = B 의 분모
m=YOLO(f"{ROOT}/YOLO ML DATA/ppe_yolo26s_640_v5_nc_best.pt"); NM=m.names
sq=LetterBox(new_shape=(960,960), auto=False, scaleup=True)
def inside(px,py,b): return b[0]<=px<=b[2] and b[1]<=py<=b[3]
def iou(a,b):
    ix=max(0,min(a[2],b[2])-max(a[0],b[0])); iy=max(0,min(a[3],b[3])-max(a[1],b[1])); i=ix*iy
    u=(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-i; return i/u if u>0 else 0
def score(square):
    A=B=C=0
    for im,g in items:
        img=cv2.imread(im); h0,w0=img.shape[:2]
        base=cv2.resize(img,(960,540)); sx,sy=960/w0,540/h0
        inp=sq(image=base) if square else base; dh=(960-540)/2 if square else 0.0
        res=m.predict(inp, imgsz=960, conf=0.30, device="mps", verbose=False)[0]
        hit=False
        for b,c in zip(res.boxes.xyxy.cpu().numpy(), res.boxes.cls.cpu().numpy().astype(int)):
            if NM[c]!="head": continue
            x1,y1,x2,y2=b[0],b[1]-dh,b[2],b[3]-dh
            x1,y1,x2,y2=x1/sx,y1/sy,x2/sx,y2/sy
            px,py=(x1+x2)/2,(y1+y2)/2
            if any(inside(px,py,k) for k in g["helmet"]): A+=1; hit=True
            if any(iou((x1,y1,x2,y2),k)>=0.3 for k in g["helmet"]): C+=1
        if g["helmet"] and hit: B+=1
    return A,B,C
print(f"GDUT holdout {len(items)}장 · helmet GT {NH} · helmet 있는 사진 {NF}\n")
print(f"{'전처리':16s} {'A 객체단위':>14s} {'B 프레임단위':>16s} {'C IoU≥0.3':>14s}")
out={}
for square,tag in ((False,"직사각 960x544"),(True,"정사각 960x960")):
    A,B,C=score(square); out[tag]=(A,B,C)
    print(f"{tag:16s}  {A:4d}/{NH} = {A/NH:.4f}  {B:4d}/{NF} = {B/NF:.4f}  {C:4d}/{NH} = {C/NH:.4f}", flush=True)
a,b=out["직사각 960x544"],out["정사각 960x960"]
print(f"\n정사각−직사각   A {(b[0]-a[0])/NH:+.4f} · B {(b[1]-a[1])/NF:+.4f} · C {(b[2]-a[2])/NH:+.4f}")
print("⟹ 자 셋이 같은 부호면 내 GDUT 결과는 자에 안 민감하다(= 도메인 차이)")
