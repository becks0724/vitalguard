# D-0 수집 프레임의 머리 정규화 높이를 960 엔진으로 재서 거리 구간(Dnear/Dmid/Dfar)을 붙이는 사후 판정기
"""
수집기(cam03_collect.py)는 추론이 없어 촬영 중에 거리 구간을 못 잰다. 이 스크립트가 manifest 를 읽어
아직 안 잰 파일에 v5 960 엔진을 돌려 가장 큰 head/helmet 박스 높이 ÷ 프레임 높이를 headsize.jsonl 에
적고, 태그별 구간 분포를 출력한다. 경계는 D-0-조합표.md 와 같다(near ≥ 0.25 · mid 0.12~0.25 · far < 0.12).
Dsweep 처럼 한 번에 거리를 훑은 태그를 격자 칸으로 나누는 용도다.

사용:  python3 cam03_headsize.py                 # ~/cam03_data 의 미판정분 측정 + 요약
       python3 cam03_headsize.py --summary       # 측정 없이 요약만
"""
import argparse
import collections
import json
import os

import cv2

ENGINE = os.environ.get("PPE_ENGINE", "/home/jetson/ppe_yolo26s_960_v5_nc.engine")
IMGSZ = int(os.environ.get("PPE_IMGSZ", "960"))
CONF = 0.3
NEAR, MID = 0.25, 0.12


def bucket(h):
    if h is None:
        return "none"
    return "near" if h >= NEAR else "mid" if h >= MID else "far"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.expanduser("~/cam03_data"))
    ap.add_argument("--summary", action="store_true")
    a = ap.parse_args()
    man, hs = os.path.join(a.out, "manifest.jsonl"), os.path.join(a.out, "headsize.jsonl")
    rows = [json.loads(l) for l in open(man) if l.strip()]
    done = {}
    if os.path.exists(hs):
        for l in open(hs):
            if l.strip():
                r = json.loads(l)
                done[r["file"]] = r["head_h"]
    todo = [r for r in rows if r["file"] not in done]
    if todo and not a.summary:
        from ultralytics import YOLO
        m = YOLO(ENGINE, task="detect")
        with open(hs, "a") as f:
            for i, r in enumerate(todo, 1):
                img = cv2.imread(os.path.join(a.out, r["file"]))
                if img is None:
                    continue
                res = m.predict(img, imgsz=IMGSZ, conf=CONF, verbose=False)[0]
                best = None
                for b, c in zip(res.boxes.xyxy.tolist(), res.boxes.cls.tolist()):
                    if res.names[int(c)] in ("head", "helmet"):
                        h = (b[3] - b[1]) / img.shape[0]
                        best = h if best is None or h > best else best
                done[r["file"]] = best
                f.write(json.dumps({"file": r["file"], "tag": r["tag"], "head_h": best}) + "\n")
                if i % 20 == 0 or i == len(todo):
                    print(f"[{i}/{len(todo)}]", flush=True)
    per = collections.defaultdict(collections.Counter)
    for r in rows:
        per[r["tag"]][bucket(done.get(r["file"]))] += 1
    print(f"{'tag':38s} {'n':>4s} {'near':>5s} {'mid':>4s} {'far':>4s} {'none':>5s}")
    for t in sorted(per):
        c = per[t]
        print(f"{t:38s} {sum(c.values()):4d} {c['near']:5d} {c['mid']:4d} {c['far']:4d} {c['none']:5d}")


if __name__ == "__main__":
    main()
