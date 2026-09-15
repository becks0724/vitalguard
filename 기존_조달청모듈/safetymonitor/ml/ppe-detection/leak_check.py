# 학습 후보와 시험 전용 자료가 겹치는지 내용 해시로 대조하고, 겹치지 않는 목록만 내놓는다.
#
# 왜 있나 — 2026-09-12 에 `ppe.sample/` 100장을 학습 후보로 받았는데 그중 35장이
#   `PHOTO-FIELD-20260910/raw`(사람이 315박스를 단 **시험지**)와 **바이트 단위로 같았다.**
#   폴더 이름이 `전기공사/` 라 눈으로는 안 보였고, 파일명은 양쪽 다 `IMG_2224.JPG` 로 같았다.
#   그대로 넣었으면 7차가 자기 학습 자료를 채점한다.
#
# ⟹ 규칙. **자료를 받으면 이름이 아니라 해시로 대조한다.**
#    그리고 그 규칙을 주석이 아니라 코드로 둔다 — 같은 날 `train_v7.py` 에서 배운 것이다.
#
# 쓰기:
#   python3 leak_check.py --train <학습후보디렉터리> --test <시험전용디렉터리> [--test <또>] \
#                         [--out clean.txt]
#   겹치면 종료 코드 1. 목록은 --out 이 있을 때만 쓴다.

import argparse
import collections
import hashlib
import pathlib
import sys

IMG = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def scan(root):
    """디렉터리 아래 모든 이미지의 (해시 → 경로들) 을 만든다. 하위 폴더를 전부 훑는다."""
    by = collections.defaultdict(list)
    for p in sorted(pathlib.Path(root).rglob("*")):
        if p.is_file() and p.suffix.lower() in IMG:
            by[hashlib.md5(p.read_bytes()).hexdigest()].append(p)
    return by


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", required=True, help="학습 후보 디렉터리")
    ap.add_argument("--test", required=True, action="append", help="시험 전용 디렉터리(여러 번 가능)")
    ap.add_argument("--out", help="비누수 목록을 쓸 파일. 없으면 안 쓴다")
    a = ap.parse_args()

    tr = scan(a.train)
    te = {}
    for d in a.test:
        for h, ps in scan(d).items():
            te.setdefault(h, []).extend(ps)

    dup = {h: ps for h, ps in tr.items() if len(ps) > 1}
    leak = {h: ps for h, ps in tr.items() if h in te}
    clean = [ps[0] for h, ps in tr.items() if h not in te]

    nfile = sum(len(ps) for ps in tr.values())
    print(f"학습 후보   파일 {nfile}개 · 고유 이미지 {len(tr)}개")
    print(f"내부 중복   {len(dup)}쌍")
    for ps in list(dup.values())[:5]:
        print("            " + " == ".join(p.name for p in ps))
    print(f"시험 전용   고유 이미지 {len(te)}개")
    print(f"★ 겹침      {len(leak)}개")
    for h, ps in list(leak.items())[:5]:
        print(f"            {ps[0]}  ==  {te[h][0]}")
    print(f"⟹ 비누수 고유 {len(clean)}장")

    if a.out:
        pathlib.Path(a.out).write_text("\n".join(str(p) for p in sorted(clean)) + "\n")
        print(f"목록 → {a.out}")

    if leak:
        sys.exit(f"\n[중단] 학습 후보에 시험 전용 자료가 {len(leak)}개 섞여 있다. "
                 f"빼고 다시 돌린다 — 넣으면 자기 학습 자료를 채점하게 된다.")
    print("\n겹침 없음")


if __name__ == "__main__":
    main()
