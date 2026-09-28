# 상시 로그가 학습 재료로 무엇을 제공하는지 세는 스크립트 (양성 유무·근접 사례·시퀀스 길이)
import glob
import json
import sys
from collections import Counter, defaultdict

files = sorted(glob.glob(sys.argv[1] if len(sys.argv) > 1 else "/home/jetson/pose_log/*.jsonl"))
pf = 0
labels = Counter()
near_torso = near_drop = 0
seq_len = defaultdict(int)          # (파일, 추적id) → 연속 관측 수
kp_full = 0
for path in files:
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        if r.get("_meta"):
            continue
        labels[r.get("label", "(무라벨)")] += 1
        for q in r.get("p", []):
            pf += 1
            to, dr = q.get("to"), q.get("dr") or 0
            if to is not None and 45 <= to < 65:
                near_torso += 1          # 수평 임계에 근접 — 임계를 내리면 발화할 후보
            if 0.10 <= dr < 0.15:
                near_drop += 1
            seq_len[(path, q["id"])] += 1
            k = q.get("kp")
            if k and sum(1 for a in k if a[2] >= 0.5) >= 10:
                kp_full += 1

lens = sorted(seq_len.values(), reverse=True)
w2s = sum(1 for v in lens if v >= 24)   # 12fps 기준 2초 창을 만들 수 있는 추적 수
print(f"사람-프레임 {pf:,} · 추적 {len(lens):,} · 키포인트 10개 이상 {kp_full:,} ({100*kp_full/max(pf,1):.0f}%)")
print(f"2초 창(24프레임) 이상 이어진 추적 {w2s:,}개 · 최장 {lens[0] if lens else 0}프레임")
print(f"라벨 분포 {dict(labels)}")
print(f"\n임계 근접 사례 — 임계를 조금만 내리면 발화할 것들")
print(f"  몸통 45~65°  {near_torso:,} ({100*near_torso/max(pf,1):.1f}%)")
print(f"  낙하 0.10~0.15  {near_drop:,} ({100*near_drop/max(pf,1):.1f}%)")
print(f"\n★ 낙상 양성(사람이 실제로 넘어진 라벨) = 0 — 상시 로그에는 없다")
