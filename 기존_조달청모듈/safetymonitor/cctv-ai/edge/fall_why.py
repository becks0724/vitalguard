# 로그에서 낙상/누움으로 찍힌 기록의 특징값을 뽑아 오탐 원인을 찾는 분석기
import glob
import json
import sys
from collections import Counter

files = sorted(glob.glob(sys.argv[1] if len(sys.argv) > 1 else "/home/jetson/pose_log/*.jsonl"))
hits, tiers = [], Counter()
seated_like = 0
for f in files:
    for line in open(f, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        for q in r.get("p", []):
            if q["st"] not in ("fallen", "lying"):
                continue
            tiers[(q["st"], q["tr"])] += 1
            hits.append(q)
            # 몸통은 서 있는데 다리만 수평인 경우 = 앉은 사람
            if q["to"] is not None and q["to"] < 35 and (q["lg"] or 0) >= 65:
                seated_like += 1

print("낙상/누움 기록", len(hits), "건")
print("상태·근거단", dict(tiers))
print("\n★ 몸통은 직립(<35°)인데 다리만 수평(≥65°) =", seated_like, "건",
      f"({100*seated_like/max(len(hits),1):.0f}%)")
print("\n표본 12건 (몸통° · 다리° · 허벅지° · 낙하 · 이동 · 자세세부)")
for q in hits[:12]:
    print(f"  {q['st']:6s} {q['tr']:2s} 몸통 {str(q['to']):>6s}  다리 {str(q['lg']):>6s}  "
          f"허벅지 {str(q['th']):>6s}  낙하 {q['dr']:.3f}  이동 {q['sp']:.3f}  ({q['po']})")
to = [q["to"] for q in hits if q["to"] is not None]
lg = [q["lg"] for q in hits if q["lg"] is not None]
if to:
    to.sort(); print(f"\n몸통° 분포  최소 {to[0]:.0f} · 중앙 {to[len(to)//2]:.0f} · 최대 {to[-1]:.0f}")
if lg:
    lg.sort(); print(f"다리° 분포  최소 {lg[0]:.0f} · 중앙 {lg[len(lg)//2]:.0f} · 최대 {lg[-1]:.0f}")
