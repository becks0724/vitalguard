# v5 와 v7d 를 같은 이미지에서 짝지어 비교한다 — 파일별 결과를 남겨 b·c 와 교차표를 낸다
# ★ 09-15. 09-12 게이트 분할이 복원 불가라 절대 판정은 하지 않는다. 증감만 본다.
#   ⛔ 여기 수를 게이트 6/125·461/464 옆에 나란히 쓰지 말 것.
import json
import os
import sys
from ultralytics import YOLO

S = sys.argv[1]
HEAD, HELM = 1, 2
W = {"v5": os.path.expanduser("~/Documents/조달청-공모전 관련자료/YOLO ML DATA/ppe_yolo26s_640_v5_nc_best.pt"),
     "v7d": os.path.expanduser("~/Documents/조달청-공모전 관련자료/YOLO ML DATA/ppe_yolo26s_640_v7d_nc.pt")}


def center_in(b, sb):
    cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    return sb[0] <= cx <= sb[2] and sb[1] <= cy <= sb[3]


def scan(model, items, sbox):
    """파일 → {head: bool, helmet: bool} — 피사체 안에서만 본다"""
    out = {}
    for f, p, _ in items:
        sb = sbox.get(f.replace(".jpg", ".json"))
        if sb is None:
            continue
        r = model.predict(p, conf=0.30, verbose=False)[0]
        h = hm = False
        if r.boxes is not None:
            for b, c in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist()):
                if not center_in(b, sb):
                    continue
                if int(c) == HEAD: h = True
                if int(c) == HELM: hm = True
        out[f] = {"head": h, "helmet": hm}
    return out


split = json.load(open(f"{S}/split.json"))
sbox = json.load(open(f"{S}/subject_box.json"))
worn = split["helmet_win"] + split["sit_front"]          # 착용 168
bare = split["bare_win"]                                  # 미착용 435

res = {}
for tag, w in W.items():
    m = YOLO(w)
    res[tag] = {"worn": scan(m, worn, sbox), "bare": scan(m, bare, sbox)}
json.dump(res, open(f"{S}/paired.json", "w"))


def mcnemar(a, b_):
    """a·b_ = {file: bool} 성공 여부. (b, c, p) — b=후자만 성공, c=전자만 성공"""
    keys = set(a) & set(b_)
    b = sum(1 for k in keys if not a[k] and b_[k])
    c = sum(1 for k in keys if a[k] and not b_[k])
    n = b + c
    if n == 0:
        return b, c, 1.0
    from math import comb
    lo = min(b, c)
    p = min(1.0, 2 * sum(comb(n, i) for i in range(lo + 1)) / 2 ** n)
    return b, c, p


print("CAM-03 상대비교 (09-15 재구성 분할) · conf 0.30 · subject_box · 중심포함")
print("⛔ 09-12 게이트(6/125·461/464)와 다른 자다 — 나란히 쓰지 말 것\n")

# 검출 (미착용에서 head 를 맞히면 성공)
a = {k: v["head"] for k, v in res["v5"]["bare"].items()}
b_ = {k: v["head"] for k, v in res["v7d"]["bare"].items()}
bb, cc, p = mcnemar(a, b_)
print(f"검출 (미착용 {len(a)})   v5 {sum(a.values())} → v7d {sum(b_.values())}"
      f"   b={bb} c={cc} p={p:.4f} {'✅' if p < 0.05 else '⛔'}")

# 오경보 (착용에서 head 가 나오면 실패 → 성공 = head 없음)
a = {k: not v["head"] for k, v in res["v5"]["worn"].items()}
b_ = {k: not v["head"] for k, v in res["v7d"]["worn"].items()}
bb, cc, p = mcnemar(a, b_)
print(f"오경보 (착용 {len(a)})    v5 {sum(1 for x in a.values() if not x)} → v7d {sum(1 for x in b_.values() if not x)}"
      f"   b={bb}(고침) c={cc}(새로망침) p={p:.4f} {'✅' if p < 0.05 else '⛔'}")

# helmet 검출 — 기전
for tag in ("v5", "v7d"):
    w = res[tag]["worn"]
    sf = {f for f, _, _ in split["sit_front"]}
    print(f"helmet 검출 ({tag})     착용 168 중 {sum(1 for v in w.values() if v['helmet'])}"
          f"   · sit_front 35 중 {sum(1 for k, v in w.items() if k in sf and v['helmet'])}")

# ★ 교차표 — helmet 검출 × 오경보
print("\n★ 교차표 — helmet 검출 × head 오경보 (착용 168)")
print("   레포 09-12 기록: helmet O → 오경보 0.000 · helmet X → 오경보 0.976")
for tag in ("v5", "v7d"):
    w = res[tag]["worn"]
    t = {(hm, h): sum(1 for v in w.values() if v["helmet"] == hm and v["head"] == h)
         for hm in (True, False) for h in (True, False)}
    print(f"\n  [{tag}]          오경보 O   오경보 X    오경보율")
    for hm, name in ((True, "helmet 검출 O"), (False, "helmet 검출 X")):
        o, x = t[(hm, True)], t[(hm, False)]
        r = o / (o + x) if o + x else float("nan")
        print(f"  {name:14s} {o:8d} {x:10d}    {r:.3f}")
