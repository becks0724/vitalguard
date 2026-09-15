#!/usr/bin/env python3
# 파일럿 7 자료 — pilot6 에서 **helmet 라벨이 있는 SH17 이미지만** 뺀다. 그 밖은 전부 동일.
#   pilot6 대비 바뀌는 것 하나: "착용 안전모를 배경으로 가르치는 사진"을 학습에서 없앤다.
#   ⟹ helmet 이 회복되면 원인은 (i) 우리 필터가 버린 안전모.
#      회복 안 되면 원인은 (ii) SH17 이 더한 맨머리 라벨(head +5,630 · helmet:head 2.02→1.17).
#   ★ SH17 감사 결과(09-14): 'head 있고 helmet 라벨 없는' 사진 80장 표본에서 착용 안전모 0건
#     (양성 2건은 야구모자·터번 — 사진 확인). ⟹ helmet 라벨 있는 사진만 빼면 잔여 오염이 없다.
import os, collections
P = "~/Documents/조달청-공모전 관련자료/YOLO ML DATA/recall-plan-20260912"
S = "~/Documents/조달청-공모전 관련자료/SH17"
SRC6 = f"{P}/runs/pilot6_data"; DST = f"{P}/runs/pilot7_data"
HEL_S = 10                                     # SH17 디스크 id

for sp in ("images/train", "labels/train"):
    os.makedirs(f"{DST}/{sp}", exist_ok=True)
    for f in os.listdir(f"{DST}/{sp}"): os.remove(f"{DST}/{sp}/{f}")

n_keep = n_drop = 0
for f in sorted(os.listdir(f"{SRC6}/images/train")):
    stem = os.path.splitext(f)[0]
    if stem.startswith("sh17_"):
        lp = f"{S}/labels/{stem[5:]}.txt"       # SH17 **원본** 라벨을 본다(우리 필터 이전)
        if os.path.exists(lp):
            cls = {int(l.split()[0]) for l in open(lp, errors="ignore")
                   if l.split() and l.split()[0].isdigit()}
            if HEL_S in cls:                    # ★ 착용 안전모가 있는 사진 → 제외
                n_drop += 1
                continue
    os.symlink(os.path.realpath(f"{SRC6}/images/train/{f}"), f"{DST}/images/train/{f}")
    os.symlink(os.path.realpath(f"{SRC6}/labels/train/{stem}.txt"), f"{DST}/labels/train/{stem}.txt")
    n_keep += 1

U = ["person","head","helmet","safety_vest","foot","shoes","hands","gloves"]
open(f"{DST}/data.yaml","w").write(
    f"path: {DST}\ntrain: images/train\nval: images/train\nnames:\n" +
    "".join(f"  {i}: {n}\n" for i,n in enumerate(U)))
tot = collections.Counter()
for f in os.listdir(f"{DST}/labels/train"):
    for l in open(f"{DST}/labels/train/{f}", errors="ignore"):
        p = l.split()
        if p and p[0].isdigit(): tot[int(p[0])] += 1
n6 = len(os.listdir(f"{SRC6}/images/train"))
print(f"pilot6 {n6:,}장 → pilot7 {n_keep:,}장   (SH17 중 안전모 있는 {n_drop:,}장 제외)")
print(f"  최종 라벨: {{{', '.join(f'{U[k]}: {v:,}' for k,v in sorted(tot.items()))}}}")
assert n_drop > 100, f"제외가 너무 적다: {n_drop}"
assert n_keep + n_drop == n6, "장수가 안 맞는다"
print("★ 구성 완료")
