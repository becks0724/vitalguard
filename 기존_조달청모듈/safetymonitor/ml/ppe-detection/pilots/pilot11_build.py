#!/usr/bin/env python3
# 파일럿 11 자료 — pilot10(GDUT+E63+CSS+HHW) + SH17(**안전모 있는 사진 제외**).
#   묻는 것 하나: 안전모와 안전화를 한 모델에서 둘 다 쓸 만하게 얻을 수 있는가.
#     pilot10  SH17 없음        helmet 97 · shoes  0   ← 안전모 최고, 안전화 전멸
#     pilot7   SH17 있음(구성분) helmet 77 · shoes 71   ← 그 반대. 단 CSS·HHW 가 없었다
#   ⟹ pilot11 은 그 둘을 합친 자리다. 여기서 helmet 이 90 근처면 교환 자체가 사라진다.
#   ★ SH17 은 pilot7_data 의 sh17_* 를 그대로 가져온다 — 이미 "안전모 있는 사진 237장 제외"가
#     적용된 집합이라 여기서 다시 거르지 않는다(같은 규칙을 두 번 구현하면 갈린다).
import os, collections
P = "~/Documents/조달청-공모전 관련자료/YOLO ML DATA/recall-plan-20260912"
S = "~/Documents/조달청-공모전 관련자료/SH17"
SRC10 = f"{P}/runs/pilot10_data"; SRC7 = f"{P}/runs/pilot7_data"; DST = f"{P}/runs/pilot11_data"
U = ["person","head","helmet","safety_vest","foot","shoes","hands","gloves"]
UI = {n:i for i,n in enumerate(U)}
HEL_S = 10                                      # SH17 디스크 id (README 아님 · 실측)

for sp in ("images/train","labels/train"):
    os.makedirs(f"{DST}/{sp}", exist_ok=True)
    for f in os.listdir(f"{DST}/{sp}"): os.remove(f"{DST}/{sp}/{f}")

def link(src_root, fn):
    stem = os.path.splitext(fn)[0]
    os.symlink(os.path.realpath(f"{src_root}/images/train/{fn}"), f"{DST}/images/train/{fn}")
    os.symlink(os.path.realpath(f"{src_root}/labels/train/{stem}.txt"), f"{DST}/labels/train/{stem}.txt")

n10 = n_sh = 0
for f in sorted(os.listdir(f"{SRC10}/images/train")):
    link(SRC10, f); n10 += 1
for f in sorted(os.listdir(f"{SRC7}/images/train")):
    if not f.startswith("sh17_"): continue
    link(SRC7, f); n_sh += 1

open(f"{DST}/data.yaml","w").write(
    f"path: {DST}\ntrain: images/train\nval: images/train\nnames:\n" +
    "".join(f"  {i}: {n}\n" for i,n in enumerate(U)))

tot = collections.Counter()
for f in os.listdir(f"{DST}/labels/train"):
    for l in open(f"{DST}/labels/train/{f}", errors="ignore"):
        p = l.split()
        if p and p[0].isdigit(): tot[int(p[0])] += 1
n_all = len(os.listdir(f"{DST}/images/train"))
print(f"pilot10 {n10:,} + SH17(제외분 적용) {n_sh:,} = {n_all:,}장")
print(f"  라벨: {{{', '.join(f'{U[k]}: {v:,}' for k,v in sorted(tot.items()))}}}")

# ── 검사 ────────────────────────────────────────────────────────────────
assert n_all == n10 + n_sh, "장수가 안 맞는다"
assert n_sh > 3000, f"SH17 이 너무 적다: {n_sh}"
# ★ 기대값은 추측이 아니라 pilot7·pilot10 실측에서 유도한다.
#   pilot11 의 SH17 분 = pilot7 의 SH17 분과 같은 집합이므로 합이 정확히 맞아야 한다.
_EXPECT = {"person": 12304+6290, "head": 11371+5495, "helmet": 25622+0,
           "safety_vest": 1072+75, "foot": 0+357, "shoes": 0+2007,
           "hands": 0+7642, "gloves": 0+1054}          # pilot10 + pilot7의SH17
for _n, _e in _EXPECT.items():
    _a = tot[UI[_n]]
    assert _a == _e, f"⛔ {_n} 라벨 {_a:,} ≠ 기대 {_e:,} — 자료 구성이 예상과 다르다"
assert tot[UI["helmet"]] == 25622, "helmet 이 변했다 — SH17 이 안전모를 더하면 안 된다(제외했으므로)"
assert tot[UI["shoes"]] == 2007, "안전화는 SH17 이 유일 공급원 — pilot7 과 같아야 한다"

# 통제군 ① — 가져온 SH17 에 착용 안전모 사진이 정말 없나 (원본 라벨을 다시 본다)
bad = 0
for f in os.listdir(f"{DST}/images/train"):
    if not f.startswith("sh17_"): continue
    lp = f"{S}/labels/{os.path.splitext(f)[0][5:]}.txt"
    if not os.path.exists(lp): continue
    for l in open(lp, errors="ignore"):
        p = l.split()
        if p and p[0].isdigit() and int(p[0]) == HEL_S: bad += 1; break
assert bad == 0, f"⛔ 착용 안전모가 있는 SH17 사진이 {bad}장 섞였다 — 그 화소가 배경이 된다"

# 통제군 ② — 그 검사가 살아 있나. pilot6(제외 전)에 넣으면 걸려야 한다
bad6 = 0
for f in os.listdir(f"{P}/runs/pilot6_data/images/train"):
    if not f.startswith("sh17_"): continue
    lp = f"{S}/labels/{os.path.splitext(f)[0][5:]}.txt"
    if not os.path.exists(lp): continue
    for l in open(lp, errors="ignore"):
        p = l.split()
        if p and p[0].isdigit() and int(p[0]) == HEL_S: bad6 += 1; break
assert bad6 > 100, f"⛔ 통제군이 죽었다 — pilot6 에서도 {bad6}장밖에 못 찾는다"
print(f"★ 검사 통과 — 착용 안전모 사진 0장 (통제군: 제외 전 pilot6 에선 {bad6}장 검출) ✓")

# 빈 라벨 — 있으면 사진 전체가 배경으로 학습된다
empty = [f for f in os.listdir(f"{DST}/labels/train") if os.path.getsize(f"{DST}/labels/train/{f}") == 0]
assert not empty, f"⛔ 빈 라벨 {len(empty)}개: {empty[:5]}"
print("★ 빈 라벨 0 · 구성 완료")
