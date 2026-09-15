#!/usr/bin/env python3
# 파일럿 10 자료 — pilot5(GDUT+E63) + CSS + HHW. **SH17 은 넣지 않는다.**
#   묻는 것 하나: 7차-E(SH17 제외) 가 현장 helmet 게이트 94 를 넘을 가능성이 있는가.
#   ⚠ 파일럿 1~9 는 전부 CSS·HHW 없이 돌았다. 그 둘이 최대 helmet(HHW 47,278)·유일 vest(CSS)
#     공급원이라, 이번 파일럿이 처음으로 7차-E 구성을 맥에서 흉내낸다.
#   변환 규칙은 노트북과 같게 — Roboflow 증강 사본 제거 + 해시 서브샘플 + 클래스 매핑.
import os, re, hashlib, collections, yaml
P = "~/Documents/조달청-공모전 관련자료/YOLO ML DATA/recall-plan-20260912"
W = "~/Documents/조달청-공모전 관련자료/YOLO ML DATA"
SRC5 = f"{P}/runs/pilot5_data"; DST = f"{P}/runs/pilot10_data"
U = ["person", "head", "helmet", "safety_vest", "foot", "shoes", "hands", "gloves"]
UI = {n: i for i, n in enumerate(U)}
RF_AUG = re.compile(r"^(.*?)_(?:jpg|jpeg|png)\.rf\.[0-9a-f]+$", re.I)
SRC = {  # (폴더, 매핑, 비율) — 노트북 CSS_MAP·HHW_MAP·FRACTION 그대로
    "css": ({"person": "person", "hardhat": "helmet", "nohardhat": "head",
             "safetyvest": "safety_vest"}, 1.0),
    "hhw": ({"helmet": "helmet", "head": "head", "person": "person"}, 0.45),
}

def norm(s): return s.lower().replace("-", "").replace("_", "").replace(" ", "")
def h1000(s): return int(hashlib.md5(s.encode()).hexdigest()[:8], 16) % 1000
def rf_base(stem):
    m = RF_AUG.match(stem)
    return m.group(1) if m else stem

for sp in ("images/train", "labels/train"):
    os.makedirs(f"{DST}/{sp}", exist_ok=True)
    for f in os.listdir(f"{DST}/{sp}"): os.remove(f"{DST}/{sp}/{f}")

n5 = 0
for f in sorted(os.listdir(f"{SRC5}/images/train")):
    stem = os.path.splitext(f)[0]
    os.symlink(os.path.realpath(f"{SRC5}/images/train/{f}"), f"{DST}/images/train/{f}")
    os.symlink(os.path.realpath(f"{SRC5}/labels/train/{stem}.txt"), f"{DST}/labels/train/{stem}.txt")
    n5 += 1

added = {}
for name, (mp, frac) in SRC.items():
    root = f"{W}/rf/{name}"
    y = yaml.safe_load(open(f"{root}/data.yaml"))
    names = y["names"] if isinstance(y["names"], list) else [y["names"][i] for i in sorted(y["names"])]
    idx = {i: UI[mp[norm(n)]] for i, n in enumerate(names) if norm(n) in mp}
    seen, kept, n_aug, n_frac = set(), 0, 0, 0
    cnt = collections.Counter()
    for sp in ("train", "valid", "test"):
        d = f"{root}/{sp}/images"
        if not os.path.isdir(d): continue
        for fn in sorted(os.listdir(d)):
            if not fn.lower().endswith((".jpg", ".jpeg", ".png")): continue
            stem = os.path.splitext(fn)[0]; base = rf_base(stem)
            if base in seen: n_aug += 1; continue
            seen.add(base)
            if frac < 1.0 and h1000("frac" + base) >= frac * 1000: n_frac += 1; continue
            lp = f"{root}/{sp}/labels/{stem}.txt"
            if not os.path.exists(lp): continue
            lines = []
            for l in open(lp, errors="ignore"):
                p = l.split()
                if len(p) < 5: continue
                try: new = idx.get(int(float(p[0])))
                except ValueError: continue          # classes.txt 류 방어(09-15 교훈)
                if new is None: continue
                lines.append("%d %s" % (new, " ".join(p[1:5]))); cnt[U[new]] += 1
            if not lines: continue                   # 빈 라벨은 "전부 배경"을 가르친다 → 사진째 제외
            out = f"{name}_{base}"
            os.symlink(f"{d}/{fn}", f"{DST}/images/train/{out}{os.path.splitext(fn)[1]}")
            open(f"{DST}/labels/train/{out}.txt", "w").write("\n".join(lines) + "\n")
            kept += 1
    added[name] = (kept, n_aug, n_frac, dict(cnt))
    print(f"[{name}] 유지 {kept:,} (증강제외 {n_aug:,} · 서브샘플제외 {n_frac:,} · 비율 {frac})")
    print(f"   {dict(cnt)}")

open(f"{DST}/data.yaml", "w").write(
    f"path: {DST}\ntrain: images/train\nval: images/train\nnames:\n" +
    "".join(f"  {i}: {n}\n" for i, n in enumerate(U)))
tot = collections.Counter()
for f in os.listdir(f"{DST}/labels/train"):
    for l in open(f"{DST}/labels/train/{f}", errors="ignore"):
        p = l.split()
        if p and p[0].isdigit(): tot[int(p[0])] += 1
n_all = len(os.listdir(f"{DST}/images/train"))
print(f"\npilot5 {n5:,} + CSS {added['css'][0]:,} + HHW {added['hhw'][0]:,} = {n_all:,}장")
print("최종 라벨:", {U[k]: v for k, v in sorted(tot.items())})
assert not [p for p in os.listdir(f"{DST}/images/train") if p.startswith("sh17_")], "SH17 이 섞였다"
assert tot[UI["helmet"]] > 20000, f"helmet 이 너무 적다: {tot[UI['helmet']]}"
print("★ SH17 0장 확인 ✓ · 구성 완료")
