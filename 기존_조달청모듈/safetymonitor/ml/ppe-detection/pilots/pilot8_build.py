#!/usr/bin/env python3
# 파일럿 8 자료 — pilot6 에서 **SH17 의 helmet 박스를 버리지 않고 살린다**. 그 밖은 전부 동일.
#   ★ 바꾸는 것 한 줄: sh17_head_filter 의 "if i == HELMET: continue" 를 없앤다.
#     겹친 head 는 그대로 버린다(착용 머리를 맨머리로 가르치면 안 되므로 · 배타 규칙 유지).
#   ⟹ SH17 이 helmet 을 476개 기여한다. pilot7(사진 제외)과 달리 237장의 다른 라벨도 지킨다.
#   묻는 것 하나: 버리는 대신 살리면 helmet 이 pilot7(77)보다 회복되는가.
import os, hashlib, collections
from PIL import Image
P = "~/Documents/조달청-공모전 관련자료/YOLO ML DATA/recall-plan-20260912"
S = "~/Documents/조달청-공모전 관련자료/SH17"
SRC5 = f"{P}/runs/pilot5_data"; DST = f"{P}/runs/pilot8_data"
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
    for i, b in items:                                   # ★ pilot8 — helmet 을 살린다
        if i == HEAD and any(iou(b, hb) > SH17_HEAD_IOU for hb in helmets):
            drop['head'] += 1; continue                  # 착용 머리는 helmet 이 대신한다(배타 유지)
        keep.append((i, b))                              # helmet 은 버리지 않는다
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
print(f"  ★ SH17 helmet 살림 {cnt['helmet']:,}개 · 겹친 head 만 버림 {drop['head']:,}개")
print(f"  최종 라벨: {{{', '.join(f'{U[k]}: {v:,}' for k,v in sorted(tot.items()))}}}")
assert cnt['helmet'] > 300, f"SH17 helmet 이 살아야 한다: {cnt['helmet']}"
assert n_s > 3000, n_s
print("★ 구성 완료")
