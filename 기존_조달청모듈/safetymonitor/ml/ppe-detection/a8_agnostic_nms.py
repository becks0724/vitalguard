# head↔helmet 배타를 **후처리**로 걸면 착용자 오경보가 줄어드는가.
# 배경 — CAM-03 에서 파일럿이 착용자 helmet 을 0→0.689 로 보는데 오경보는 .3106→.3030 로 거의 안 줄었다.
#        ultralytics NMS 는 기본이 **클래스별**(agnostic=False)이라 같은 머리 위 head 와 helmet 이 서로를 안 누른다.
import csv, os
import xml.etree.ElementTree as ET
from ultralytics import YOLO

ROOT = os.path.expanduser("~/Documents/조달청-공모전 관련자료")
P = f"{ROOT}/YOLO ML DATA/recall-plan-20260912"
G = f"{ROOT}/DATASETS/GDUT-HWD"
MAP = {"yellow": "helmet", "white": "helmet", "red": "helmet", "blue": "helmet", "none": "head"}

items = []
for r in csv.DictReader(open(f"{P}/results/pilot_gdut_hash_split.csv")):
    if r["split"].strip().lower() != "holdout": continue
    s = r["stem"]; x = f"{G}/Annotations/{s}.xml"; im = f"{G}/JPEGImages/{s}.jpg"
    if not (os.path.exists(x) and os.path.exists(im)): continue
    g = {"helmet": [], "head": []}
    for o in ET.parse(x).getroot().findall("object"):
        n = MAP.get((o.findtext("name") or "").strip()); b = o.find("bndbox")
        if n and b is not None:
            g[n].append(tuple(float(b.findtext(k)) for k in ("xmin","ymin","xmax","ymax")))
    items.append((im, g))
NH, ND = sum(len(g["helmet"]) for _,g in items), sum(len(g["head"]) for _,g in items)
print(f"GDUT holdout {len(items)}장 · helmet GT {NH} · head GT {ND}\n", flush=True)

def inside(px,py,b): return b[0]<=px<=b[2] and b[1]<=py<=b[3]

def score(wt, agnostic):
    m = YOLO(wt); NM = m.names
    fa = hel = 0; used_tot = 0
    for im, g in items:
        r = m.predict(im, imgsz=960, conf=0.30, agnostic_nms=agnostic, device="mps", verbose=False)[0]
        used=set()
        for b,c in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.cls.cpu().numpy().astype(int)):
            px,py=(b[0]+b[2])/2,(b[1]+b[3])/2
            if NM[c]=="head":
                if any(inside(px,py,k) for k in g["helmet"]): fa+=1
                for i,k in enumerate(g["head"]):
                    if i not in used and inside(px,py,k): used.add(i); break
            elif NM[c]=="helmet":
                if any(inside(px,py,k) for k in g["helmet"]): hel+=1
        used_tot+=len(used)
    return fa, used_tot, hel

W={"v5":f"{ROOT}/YOLO ML DATA/ppe_yolo26s_640_v5_nc_best.pt",
   "pilot_gdut":f"{P}/runs/pilot_gdut/weights/best.pt"}
print(f"{'모델':12s} {'NMS':10s} {'착용자 오경보':>16s} {'맨머리 검출':>14s} {'착용자 helmet':>15s}")
for tag,wt in W.items():
    base=None
    for ag in (False, True):
        fa,hd,hel = score(wt, ag)
        if base is None: base=fa
        nm = "클래스별" if not ag else "★배타(agnostic)"
        print(f"{tag:12s} {nm:10s}  {fa:4d}/{NH} = {fa/NH:.4f}  {hd:4d}/{ND} = {hd/ND:.4f}  {hel:4d}/{NH} = {hel/NH:.4f}  ({fa-base:+d})", flush=True)
