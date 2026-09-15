# ③ 재압축이 **착용자 오경보**(head 박스가 안전모 쓴 머리 위에 뜨는가)를 어느 쪽으로 움직이는가.
# ⚠ 앞선 A7-c 는 helmet **재현율**을 쟀다. 격차(0.211 vs 0.286)는 head **오경보율**이라 지표가 다르다.
import csv, io, os
import xml.etree.ElementTree as ET
import numpy as np, cv2
from PIL import Image
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
            g[n].append(tuple(float(b.findtext(k)) for k in ("xmin", "ymin", "xmax", "ymax")))
    items.append((im, g))
n_hel = sum(len(g["helmet"]) for _, g in items)
n_hd  = sum(len(g["head"]) for _, g in items)
print(f"GDUT holdout {len(items)}장 · helmet GT {n_hel} · head GT {n_hd}", flush=True)

m = YOLO(f"{ROOT}/YOLO ML DATA/ppe_yolo26s_640_v5_nc_best.pt")
NM = m.names

def inside(px, py, b): return b[0] <= px <= b[2] and b[1] <= py <= b[3]

def run(q):
    fa = 0                                  # head 예측 중심이 GT helmet 안  = 착용자 오경보
    hd = 0                                  # head 예측 중심이 GT head 안    = 맨머리 적중(중복 허용 아님)
    for im, g in items:
        img = cv2.imread(im)
        if q is not None:
            ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])
            img = cv2.imdecode(enc, cv2.IMREAD_COLOR)
        r = m.predict(img, imgsz=960, conf=0.30, device="mps", verbose=False)[0]
        used = set()
        for b, c in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.cls.cpu().numpy().astype(int)):
            if NM[c] != "head": continue
            px, py = (b[0]+b[2])/2, (b[1]+b[3])/2
            if any(inside(px, py, k) for k in g["helmet"]): fa += 1
            for i, k in enumerate(g["head"]):
                if i not in used and inside(px, py, k): used.add(i); break
        hd += len(used)
    return fa, hd

print(f"{'조건':10s} {'착용자 오경보':>18s} {'맨머리 검출':>16s}")
base = None
for q in (None, 95, 85, 75, 60):
    fa, hd = run(q)
    if base is None: base = fa
    tag = "원본" if q is None else f"q{q}"
    print(f"{tag:10s}  {fa:4d}/{n_hel} = {fa/n_hel:.4f}   {hd:4d}/{n_hd} = {hd/n_hd:.4f}   (원본대비 {fa-base:+d})", flush=True)
