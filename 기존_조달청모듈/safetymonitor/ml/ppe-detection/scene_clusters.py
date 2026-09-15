#!/usr/bin/env python3
# 연속 촬영이 만든 중복 프레임을 지각 해시로 묶어 「실효 장면 수」를 세는 도구
#
# 왜 필요한가 — 같은 창에서 연달아 뽑은 프레임은 서로 거의 같은 표본이다.
# 장수는 늘지만 장면은 안 는다. 증강 배수·클래스 비·홀드아웃 가능 여부를
# 장수로 계산하면 전부 틀린다. 2026-09-10 현장 35장에서 실측으로 확인됐다.
#
# ⚠ 군집 수는 하나의 사실이 아니다. 해시 종류와 임계가 정한다.
#    그래서 이 도구는 한 수를 내놓지 않고 표를 내놓는다. 인용할 때 방식을 같이 적으라는 뜻이다.
import argparse, glob, os, re, sys
from PIL import Image, ImageOps


def _bits(vals, cmp):
    b = 0
    for v, w in zip(vals, cmp):
        b = (b << 1) | (v > w)
    return b


def dhash(im, n=16):
    """가로 인접 픽셀 비교. 전체 밝기가 흔들려도 잘 안 깨진다."""
    px = list(im.convert("L").resize((n + 1, n), Image.LANCZOS).tobytes())
    rows = [px[r * (n + 1):(r + 1) * (n + 1)] for r in range(n)]
    return _bits([v for r in rows for v in r[:n]], [v for r in rows for v in r[1:]])


def ahash(im, n=16):
    """전체 평균 대비. 노출이 바뀌면 통째로 흔들려 군집이 과하게 뭉친다."""
    px = list(im.convert("L").resize((n, n), Image.LANCZOS).tobytes())
    avg = sum(px) / len(px)
    return _bits(px, [avg] * len(px))


def cluster(hashes, thr):
    """해밍거리 thr 이하를 같은 장면으로 보고 union-find 로 묶는다."""
    par = list(range(len(hashes)))
    def find(x):
        while par[x] != x:
            par[x] = par[par[x]]; x = par[x]
        return x
    for i in range(len(hashes)):
        for j in range(i + 1, len(hashes)):
            if bin(hashes[i] ^ hashes[j]).count("1") <= thr:
                a, b = find(i), find(j)
                if a != b: par[a] = b
    sizes = {}
    for i in range(len(hashes)):
        r = find(i); sizes[r] = sizes.get(r, 0) + 1
    return sorted(sizes.values(), reverse=True)


def main():
    ap = argparse.ArgumentParser(description="지각 해시로 실효 장면 수를 센다")
    ap.add_argument("src", help="이미지 디렉터리 또는 glob")
    ap.add_argument("--by", help="파일명에서 창 라벨을 뽑는 정규식(그룹 1개). 없으면 전체를 한 덩이로 본다")
    ap.add_argument("--thr", default="16,20,24", help="해밍 임계 목록 (기본 16,20,24)")
    ap.add_argument("--bits", type=int, default=16, help="해시 격자 변 (기본 16 → 256비트)")
    a = ap.parse_args()

    pat = a.src if any(c in a.src for c in "*?[") else os.path.join(a.src, "*")
    files = sorted(f for f in glob.glob(pat)
                   if os.path.splitext(f)[1].lower() in (".jpg", ".jpeg", ".png", ".webp"))
    if not files:
        sys.exit(f"이미지 없음: {pat}")

    groups = {}
    for f in files:
        k = "전체"
        if a.by:
            m = re.search(a.by, os.path.basename(f))
            if not m:
                continue          # 규칙에 안 맞는 파일은 조용히 빼지 말고 아래에서 센다
            k = m.group(1)
        groups.setdefault(k, []).append(f)

    skipped = len(files) - sum(len(v) for v in groups.values())
    thrs = [int(t) for t in a.thr.split(",")]

    print(f"파일 {len(files)}장" + (f" · 규칙 불일치로 제외 {skipped}장" if skipped else ""))
    print(f"해시 {a.bits}×{a.bits} = {a.bits*a.bits}비트\n")
    head = f"{'창':<28}{'장수':>6}" + "".join(f"{'d'+str(t):>7}" for t in thrs) \
                                   + "".join(f"{'a'+str(t):>7}" for t in thrs) + f"{'최대군집':>10}"
    print(head); print("-" * 90)

    tot = {("d", t): 0 for t in thrs} | {("a", t): 0 for t in thrs}
    for k, fs in sorted(groups.items()):
        ims = [ImageOps.exif_transpose(Image.open(f)) for f in fs]   # EXIF 미적용은 오늘의 함정
        dh = [dhash(i, a.bits) for i in ims]
        ah = [ahash(i, a.bits) for i in ims]
        ds = [cluster(dh, t) for t in thrs]
        as_ = [cluster(ah, t) for t in thrs]
        dc, ac = [len(x) for x in ds], [len(x) for x in as_]
        for t, v in zip(thrs, dc): tot[("d", t)] += v
        for t, v in zip(thrs, ac): tot[("a", t)] += v
        biggest = max(ds[-1])          # 가장 느슨한 임계에서 가장 큰 장면 덩이
        print(f"{k:<28}{len(fs):>6}" + "".join(f"{v:>7}" for v in dc)
              + "".join(f"{v:>7}" for v in ac) + f"{biggest:>10}")

    if len(groups) > 1:
        print("-" * 90)
        print(f"{'합계(창 내부 기준)':<28}{sum(len(v) for v in groups.values()):>6}"
              + "".join(f"{tot[('d',t)]:>7}" for t in thrs)
              + "".join(f"{tot[('a',t)]:>7}" for t in thrs))
    print("\n※ d = dHash · a = aHash · 숫자는 임계. 군집 수를 인용할 때 이 둘을 같이 적을 것.")
    print("※ 창을 나눠 셌으므로 창끼리 겹치는 장면은 안 잡힌다. 창 간 중복이 의심되면 --by 없이 한 번 더 돌린다.")


if __name__ == "__main__":
    main()
