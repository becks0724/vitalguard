#!/usr/bin/env python3
# 파일럿 6 자료 — pilot5(GDUT+E63) + SH17. SH17 변환은 노트북 규칙을 그대로 옮긴다.
#   ★ SH17_HEAD_FILTER = True 경로: helmet 박스는 **전부 버리고**, helmet 과 겹치는 head 도 버린다.
#     (노트북 sh17_head_filter 원문 — "박스 정의가 달라 못 쓴다")
#     ⟹ SH17 은 helmet 을 0개 기여한다. 착용 안전모가 보이는 사진은 배경이 되거나 head 로 남는다.
#   묻는 것 하나: SH17 을 더하면 현장 안전모가 무너지는가.
import os, hashlib, collections
from PIL import Image
P = "~/Documents/조달청-공모전 관련자료/YOLO ML DATA/recall-plan-20260912"
S = "~/Documents/조달청-공모전 관련자료/SH17"
SRC5 = f"{P}/runs/pilot5_data"; DST = f"{P}/runs/pilot6_data"
IMGDIR = f"{P}/sh17_img"
SH17_HEAD_IOU = 0.3
NAMES = ['person','ear','ear-mufs','face','face-guard','face-mask','foot','tool','glasses','gloves',
         'helmet','hands','head','medical-suit','shoes','safety-suit','safety-vest']
MAP = {'person':'person','head':'head','helmet':'helmet','safety-vest':'safety_vest',
       'foot':'foot','shoes':'shoes','hands':'hands','gloves':'gloves'}
U = ['person','head','helmet','safety_vest','foot','shoes','hands','gloves']
UI = {n: i for i, n in enumerate(U)}
IDX = {i: UI[MAP[n]] for i, n in enumerate(NAMES) if n in MAP}
HEAD, HELMET = UI['head'], UI['helmet']

def iou(a, b):
    ax1, ay1, ax2, ay2 = a[0]-a[2]/2, a[1]-a[3]/2, a[0]+a[2]/2, a[1]+a[3]/2
    bx1, by1, bx2, by2 = b[0]-b[2]/2, b[1]-b[3]/2, b[0]+b[2]/2, b[1]+b[3]/2
    ix = max(0, min(ax2, bx2)-max(ax1, bx1)); iy = max(0, min(ay2, by2)-max(ay1, by1))
    i = ix*iy; u = a[2]*a[3] + b[2]*b[3] - i
    return i/u if u > 0 else 0

for sp in ("images/train", "labels/train"):
    os.makedirs(f"{DST}/{sp}", exist_ok=True)
    for f in os.listdir(f"{DST}/{sp}"): os.remove(f"{DST}/{sp}/{f}")

n5 = 0
for f in sorted(os.listdir(f"{SRC5}/images/train")):
    stem = os.path.splitext(f)[0]
    os.symlink(os.path.realpath(f"{SRC5}/images/train/{f}"), f"{DST}/images/train/{f}")
    os.symlink(os.path.realpath(f"{SRC5}/labels/train/{stem}.txt"), f"{DST}/labels/train/{stem}.txt")
    n5 += 1

n_s, cnt, drop = 0, collections.Counter(), collections.Counter()
for f in sorted(os.listdir(IMGDIR)):
    if not f.lower().endswith(('.jpg', '.jpeg', '.png')): continue
    stem = os.path.splitext(f)[0]
    lp = f"{S}/labels/{stem}.txt"
    if not os.path.exists(lp): continue
    items = []
    for l in open(lp, errors="ignore"):
        p = l.split()
        if len(p) < 5: continue
        new = IDX.get(int(float(p[0])))
        if new is None: continue
        items.append((new, tuple(float(x) for x in p[1:5])))
    helmets = [b for i, b in items if i == HELMET]
    keep = []
    for i, b in items:                                   # ★ 노트북 sh17_head_filter 그대로
        if i == HELMET: drop['helmet'] += 1; continue
        if i == HEAD and any(iou(b, hb) > SH17_HEAD_IOU for hb in helmets):
            drop['head'] += 1; continue
        keep.append((i, b))
    if not keep: continue
    out = f"sh17_{stem}"
    os.symlink(f"{IMGDIR}/{f}", f"{DST}/images/train/{out}{os.path.splitext(f)[1]}")
    open(f"{DST}/labels/train/{out}.txt", "w").write(
        "\n".join(f"{i} " + " ".join(f"{v:.6f}" for v in b) for i, b in keep) + "\n")
    for i, _ in keep: cnt[U[i]] += 1
    n_s += 1

open(f"{DST}/data.yaml", "w").write(
    f"path: {DST}\ntrain: images/train\nval: images/train\nnames:\n" +
    "".join(f"  {i}: {n}\n" for i, n in enumerate(U)))
tot = collections.Counter()
for f in os.listdir(f"{DST}/labels/train"):
    for l in open(f"{DST}/labels/train/{f}", errors="ignore"):
        p = l.split()
        if p and p[0].isdigit(): tot[int(p[0])] += 1
print(f"pilot5 {n5:,}장 + SH17 {n_s:,}장 = {n5+n_s:,}장")
print(f"  SH17 이 더한 라벨: {dict(cnt)}")
print(f"  ★ SH17 에서 버린 것: helmet {drop['helmet']:,}개(전부) · 겹친 head {drop['head']:,}개")
print(f"  최종 라벨: {{{', '.join(f'{U[k]}: {v:,}' for k,v in sorted(tot.items()))}}}")
assert cnt['helmet'] == 0, "SH17 이 helmet 을 기여하면 노트북 규칙과 다르다"
assert n_s > 3000, n_s
print("★ 구성 완료")
