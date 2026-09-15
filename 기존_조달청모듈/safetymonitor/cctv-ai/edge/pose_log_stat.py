# 자세 판정 로그(JSONL)를 읽어 라벨·자세 분포와 특징값 범위를 요약하는 스크립트 (임계 조정 근거용)
"""
`pose_fall.PoseLog` 가 남긴 파일을 읽는다. 라벨이 붙어 있으면 **라벨별로** 자세 판정 분포를 내므로
"앉음이라고 표시하고 찍었는데 시스템은 무엇이라 했는가" 를 바로 볼 수 있다 — 임계를 그 표로 정한다.

사용:  python3 pose_log_stat.py ~/pose_log/pose-*.jsonl
       python3 pose_log_stat.py ~/pose_log/*.jsonl --label 앉음     # 그 라벨만
"""

import argparse
import collections
import glob
import json
import os
import statistics
import sys

KO = {"walking": "직립", "standing": "서있음", "seated": "앉음", "upright": "몸통직립",
      "unstable": "불안정", "lying": "누움", "fallen": "낙상", "unknown": "판정불가"}


def rng(vals):
    v = [x for x in vals if x is not None]
    if not v:
        return "—"
    v.sort()
    return f"{v[0]:.0f}~{v[-1]:.0f} (중앙 {statistics.median(v):.0f})"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--label", default=None, help="이 라벨이 붙은 기록만 본다")
    a = ap.parse_args()

    files = sorted({f for pat in a.files for f in glob.glob(os.path.expanduser(pat))})
    if not files:
        print("파일 없음")
        return 1

    metas = []
    frames = people = kp_have = 0
    per_label = collections.defaultdict(collections.Counter)   # 라벨 → 자세 분포
    tiers = collections.Counter()
    joints = collections.Counter()
    torso, thigh, speed, drop = [], [], [], []
    t0 = t1 = None

    for path in files:
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if r.get("_meta"):                 # 파일 머리글 — 그 파일이 어느 기준으로 판정했는지
                metas.append((os.path.basename(path), r))
                continue
            lab = r.get("label", "(라벨없음)")
            if a.label and lab != a.label:
                continue
            frames += 1
            t0 = r["ts"] if t0 is None else min(t0, r["ts"])
            t1 = r["ts"] if t1 is None else max(t1, r["ts"])
            for q in r.get("p", []):
                people += 1
                key = q["st"] if q["st"] in ("lying", "fallen", "unstable") else q["po"]
                per_label[lab][key] += 1
                tiers[q["tr"]] += 1
                if q.get("kp"):
                    kp_have += 1
                    for name, idx in (("어깨", (5, 6)), ("엉덩이", (11, 12)),
                                      ("무릎", (13, 14)), ("발목", (15, 16))):
                        if all(q["kp"][i][2] >= 0.5 for i in idx):
                            joints[name] += 1
                torso.append(q.get("to"))
                thigh.append(q.get("th"))
                speed.append(q.get("sp"))
                drop.append(q.get("dr"))

    if not frames:
        print("해당 기록 없음")
        return 1

    dur = (t1 - t0) if (t0 and t1) else 0
    if metas:
        seen = {}
        for fn, m in metas:
            key = json.dumps(m.get("thresholds"), sort_keys=True)
            seen.setdefault(key, []).append(fn)
        if len(seen) > 1:
            print("⚠ 임계가 서로 다른 파일이 섞여 있다 — 나눠서 채점할 것")
        for key, fns in seen.items():
            th = json.loads(key)
            print(f"기준: 몸통수평 {th.get('torso_down')}° · 낙하 {th.get('drop_rate')} · "
                  f"지속 {th.get('fall_hold_s')}s · 파일 {len(fns)}개")
    print(f"파일 {len(files)}개 · 프레임 {frames:,} · 사람-프레임 {people:,} · "
          f"{dur / 60:.1f}분 · 키포인트 보유 {kp_have:,}")
    print(f"판정 근거 {dict(tiers)}")
    print(f"관절 관측(사람-프레임 대비)  " +
          " · ".join(f"{k} {100 * v / max(people, 1):.1f}%" for k, v in joints.items()))
    print(f"몸통° {rng(torso)}   허벅지° {rng(thigh)}")
    print(f"이동 {rng([x * 1000 if x is not None else None for x in speed])} (×0.001)   "
          f"낙하 {rng([x * 1000 if x is not None else None for x in drop])} (×0.001)")
    print("\n라벨별 자세 판정 분포")
    for lab in sorted(per_label):
        c = per_label[lab]
        tot = sum(c.values())
        detail = " · ".join(f"{KO.get(k, k)} {v}({100 * v / tot:.0f}%)"
                            for k, v in c.most_common())
        print(f"  {lab:14s} {tot:6,}  {detail}")
    print("\n읽는 법 — 라벨과 판정이 어긋나는 칸이 곧 오탐이고, 그 칸의 특징값 범위가 임계다.")

    # ── 구간(시행) 단위 채점 — 낙상은 비율이 아니라 "그 한 번을 잡았나" 로 센다
    print("\n구간 단위 채점 (라벨이 붙어 있는 연속 구간 = 시행 1회)")
    segs, cur = [], None
    for path in files:
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if r.get("_meta"):
                continue
            lab = r.get("label")
            if not lab:
                cur = None
                continue
            if cur is None or cur["label"] != lab or r["ts"] - cur["end"] > 3.0:
                cur = {"label": lab, "start": r["ts"], "end": r["ts"],
                       "fallen": 0, "lying": 0, "unstable": 0, "torso": 0.0, "drop": 0.0}
                segs.append(cur)
            cur["end"] = r["ts"]
            for q in r.get("p", []):
                if q["st"] in ("fallen", "lying", "unstable"):
                    cur[q["st"]] += 1
                cur["torso"] = max(cur["torso"], q["to"] or 0)
                cur["drop"] = max(cur["drop"], q["dr"] or 0)
    if not segs:
        print("  라벨 구간 없음 — /mark 로 라벨을 붙이고 촬영하면 여기에 채점표가 나온다")
        return 0
    print(f"  {'라벨':16s} {'길이':>5s} {'낙상':>5s} {'누움':>5s} {'불안정':>6s} {'최대몸통°':>9s} {'최대낙하':>8s}")
    for g in segs:
        print(f"  {g['label']:16s} {g['end'] - g['start']:4.0f}s "
              f"{g['fallen']:5d} {g['lying']:5d} {g['unstable']:6d} "
              f"{g['torso']:9.0f} {g['drop']:8.3f}")
    hit = sum(1 for g in segs if g["fallen"] and "넘어" in g["label"] or g["fallen"] and "낙상" in g["label"])
    fall_segs = [g for g in segs if ("넘어" in g["label"] or "낙상" in g["label"])]
    other = [g for g in segs if g not in fall_segs]
    if fall_segs:
        print(f"\n  낙상 시행 {len(fall_segs)}회 중 검출 {hit}회  → recall {hit / len(fall_segs):.2f}")
    if other:
        fp = sum(1 for g in other if g["fallen"])
        print(f"  반례 시행 {len(other)}회 중 낙상 오탐 {fp}회")
    return 0


if __name__ == "__main__":
    sys.exit(main())
