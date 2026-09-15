#!/usr/bin/env python3
# 파일럿 9 자료 — pilot7 에서 **SH17 의 head 라벨만** 뺀다. 사진 구성·다른 라벨은 그대로.
#   묻는 것 하나: 남은 격차(pilot7 77 vs pilot5 94)를 SH17 의 맨머리 5,630개가 만드는가.
#   가설 = SH17 이 helmet:head 를 2.02 → 1.17 로 바꿔 head 가 helmet 을 눌렀다.
#   ★ 09-14 교훈 적용 — 라벨을 지워 **빈 라벨 파일이 되는 사진은 통째로 뺀다.**
#     빈 라벨은 "이 사진 전체가 배경" 을 가르치므로, 오늘 고친 것과 같은 병을 새로 만든다.
import os, collections
P = "~/Documents/조달청-공모전 관련자료/YOLO ML DATA/recall-plan-20260912"
SRC7 = f"{P}/runs/pilot7_data"; DST = f"{P}/runs/pilot9_data"
U = ["person","head","helmet","safety_vest","foot","shoes","hands","gloves"]
HEAD = 1

for sp in ("images/train", "labels/train"):
    os.makedirs(f"{DST}/{sp}", exist_ok=True)
    for f in os.listdir(f"{DST}/{sp}"): os.remove(f"{DST}/{sp}/{f}")

n_keep = n_empty = n_strip = 0
removed = 0
for f in sorted(os.listdir(f"{SRC7}/images/train")):
    stem = os.path.splitext(f)[0]
    lp = f"{SRC7}/labels/train/{stem}.txt"
    lines = [l for l in open(lp, errors="ignore").read().splitlines() if l.strip()]
    if stem.startswith("sh17_"):
        kept = [l for l in lines if int(l.split()[0]) != HEAD]
        removed += len(lines) - len(kept)
        if len(kept) != len(lines): n_strip += 1
        if not kept:                                  # ★ 빈 라벨이 되면 사진째 뺀다
            n_empty += 1
            continue
        os.symlink(os.path.realpath(f"{SRC7}/images/train/{f}"), f"{DST}/images/train/{f}")
        open(f"{DST}/labels/train/{stem}.txt", "w").write("\n".join(kept) + "\n")
    else:
        os.symlink(os.path.realpath(f"{SRC7}/images/train/{f}"), f"{DST}/images/train/{f}")
        os.symlink(os.path.realpath(lp), f"{DST}/labels/train/{stem}.txt")
    n_keep += 1

open(f"{DST}/data.yaml","w").write(
    f"path: {DST}\ntrain: images/train\nval: images/train\nnames:\n" +
    "".join(f"  {i}: {n}\n" for i,n in enumerate(U)))
tot = collections.Counter()
for f in os.listdir(f"{DST}/labels/train"):
    for l in open(f"{DST}/labels/train/{f}", errors="ignore"):
        p = l.split()
        if p and p[0].isdigit(): tot[int(p[0])] += 1
n7 = len(os.listdir(f"{SRC7}/images/train"))
print(f"pilot7 {n7:,}장 → pilot9 {n_keep:,}장")
print(f"  SH17 head 라벨 {removed:,}개 제거 · 라벨이 바뀐 사진 {n_strip:,}장")
print(f"  ★ 빈 라벨이 되어 통째로 뺀 사진 {n_empty:,}장 (빈 라벨은 '전부 배경' 을 가르친다)")
print(f"  최종 라벨: {{{', '.join(f'{U[k]}: {v:,}' for k,v in sorted(tot.items()))}}}")
print(f"  helmet:head = {tot[2]/max(tot[1],1):.2f} : 1   (pilot7 은 1.18 · pilot5 는 2.02)")
assert removed > 4000, f"제거가 너무 적다: {removed}"
print("★ 구성 완료")
