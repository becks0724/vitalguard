#!/usr/bin/env python3
# 파일럿 5 자료 구성 — pilot4 자료(GDUT+의사라벨) + E63 을 7차-A 와 같은 분량으로 더한다.
#   pilot4 와 **자료만** 다르다. 시작 가중치·에포크·배치·imgsz·기기 전부 동일.
#   E63 선택 규칙은 노트북 link_yolo 와 같은 해시(md5('frac'+stem)[:8] % 1000 < fraction*1000).
#   fraction 0.28 = 7차-A 의 실효 비율(홀드아웃 30% 예약 후 0.4) → 약 8,767장으로 분량을 맞춘다.
import os, hashlib, shutil, collections
P = "~/Documents/조달청-공모전 관련자료/YOLO ML DATA/recall-plan-20260912"
SRC4 = f"{P}/runs/pilot3_data"        # pilot4 가 쓴 자료 그대로
E63  = f"{P}/e63_src"
DST  = f"{P}/runs/pilot5_data"
FRAC = 0.28

def h1000(s): return int(hashlib.md5(s.encode()).hexdigest()[:8], 16) % 1000

for sp in ("images/train", "labels/train"):
    os.makedirs(f"{DST}/{sp}", exist_ok=True)
# 기존 링크 청소 — 재실행해도 같은 결과가 나오게
for sp in ("images/train", "labels/train"):
    for f in os.listdir(f"{DST}/{sp}"): os.remove(f"{DST}/{sp}/{f}")

n_g = 0
for f in sorted(os.listdir(f"{SRC4}/images/train")):
    stem = os.path.splitext(f)[0]
    os.symlink(os.path.realpath(f"{SRC4}/images/train/{f}"), f"{DST}/images/train/{f}")
    os.symlink(os.path.realpath(f"{SRC4}/labels/train/{stem}.txt"), f"{DST}/labels/train/{stem}.txt")
    n_g += 1

n_e = 0; cnt = collections.Counter()
NM = {0:"person",1:"head",2:"helmet",3:"safety_vest"}
for f in sorted(os.listdir(f"{E63}/images/train")):
    stem = os.path.splitext(f)[0]
    if h1000("frac" + stem) >= FRAC * 1000: continue
    lp = f"{E63}/labels/train/{stem}.txt"
    if not os.path.exists(lp): continue
    os.symlink(f"{E63}/images/train/{f}", f"{DST}/images/train/{f}")
    os.symlink(lp, f"{DST}/labels/train/{stem}.txt")
    n_e += 1
    for l in open(lp, errors="ignore"):
        p = l.split()
        if p and p[0].isdigit(): cnt[NM.get(int(p[0]), p[0])] += 1

open(f"{DST}/data.yaml", "w").write(
    f"path: {DST}\ntrain: images/train\nval: images/train\nnames:\n" +
    "".join(f"  {i}: {n}\n" for i, n in enumerate(
        ["person","head","helmet","safety_vest","foot","shoes","hands","gloves"])))

tot = collections.Counter()
for f in os.listdir(f"{DST}/labels/train"):
    for l in open(f"{DST}/labels/train/{f}", errors="ignore"):
        p = l.split()
        if p and p[0].isdigit(): tot[int(p[0])] += 1
U = ["person","head","helmet","safety_vest","foot","shoes","hands","gloves"]
print(f"GDUT {n_g:,}장 + E63 {n_e:,}장 = {n_g+n_e:,}장")
print(f"  (7차-A 의 E63 학습분 추정 8,767장 · pilot4 는 GDUT {n_g:,}장 단독)")
print("  E63 이 더한 라벨:", dict(cnt))
print("  최종 라벨:", {U[k]: v for k, v in sorted(tot.items())})
assert n_e > 5000, f"E63 선택이 너무 적다: {n_e}"
assert len(os.listdir(f"{DST}/images/train")) == len(os.listdir(f"{DST}/labels/train")), "짝이 안 맞는다"
print("★ 구성 완료")
