# ③ JPEG 재압축이 착용자 오경보를 움직이는가 — 젯슨 없이 맥에서 재는 시험.
import io, pathlib, sys
import numpy as np, cv2
from PIL import Image, ImageOps
from ultralytics import YOLO

RAW = pathlib.Path.home()/"Documents/조달청-공모전 관련자료/PHOTO-FIELD-20260910/raw"
LAB = pathlib.Path.home()/"Documents/조달청-공모전 관련자료/PHOTO-FIELD-20260910/labels"
PT  = pathlib.Path.home()/"Documents/조달청-공모전 관련자료/YOLO ML DATA/ppe_yolo26s_640_v5_nc_best.pt"
HEAD, HELMET = 1, 2                      # ls_export 정본 순서
m = YOLO(str(PT))

def gt(stem, w, h):
    out = {HEAD: [], HELMET: []}
    f = LAB/f"{stem}.txt"
    for ln in f.read_text().split("\n"):
        p = ln.split()
        if len(p) != 5: continue
        c = int(p[0])
        if c not in out: continue
        cx, cy, bw, bh = (float(x) for x in p[1:])
        out[c].append((cx*w, cy*h, bw*w, bh*h))
    return out

def inside(px, py, box):
    cx, cy, bw, bh = box
    return abs(px-cx) <= bw/2 and abs(py-cy) <= bh/2

def run(q):
    """q=None 이면 원본, 아니면 그 품질로 JPEG 재압축 후 추론."""
    fa = hit = n_helmet = n_head = 0
    for p in sorted(RAW.glob("*.JPG")):
        im = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
        if q is not None:
            buf = io.BytesIO(); im.save(buf, "JPEG", quality=q); buf.seek(0)
            im = Image.open(buf).convert("RGB")
        arr = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
        W, H = im.size
        g = gt(p.stem, W, H)
        n_helmet += len(g[HELMET]); n_head += len(g[HEAD])
        r = m.predict(arr, imgsz=960, conf=0.30, verbose=False, device="mps")[0]
        for b, c in zip(r.boxes.xywh.cpu().numpy(), r.boxes.cls.cpu().numpy().astype(int)):
            if c != HEAD: continue
            px, py = b[0], b[1]
            if any(inside(px, py, k) for k in g[HELMET]): fa += 1
            if any(inside(px, py, k) for k in g[HEAD]):   hit += 1
    return fa, hit, n_helmet, n_head

print(f"{'조건':14s} {'착용자 오경보':>14s} {'맨머리 검출':>12s}")
base = None
for q in (None, 95, 85, 75, 60):
    fa, hit, nhel, nhd = run(q)
    tag = "원본" if q is None else f"JPEG q{q}"
    if base is None: base = fa
    print(f"{tag:14s}  {fa:3d}/{nhel:3d} = {fa/nhel:.3f}   {hit:2d}/{nhd:2d} = {hit/nhd:.3f}   (원본대비 {fa-base:+d})")
