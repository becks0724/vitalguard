# 현장 35장 라벨(YOLO txt)이 학습·채점에 쓸 수 있는 상태인지 검사한다. 통과 전에는 채점하지 않는다.
#
# 왜 필요한가 — 5차에서 ultralytics 가 입력 리스트와 다른 것을 조용히 채점해 평가가 통째로 무효가 됐다.
#   그때 깨진 것이 「입력과 정답의 1:1」이라 이 검사의 첫 항목이 zip 1:1 이다.
#
# 쓰기:  python3 label_check.py <labels_dir> <images_dir>
import os, sys, collections

NAMES = ["person", "head", "helmet", "safety_vest", "foot",
         "shoes", "hands", "gloves", "no_safety_shoes"]   # v6 가중치에서 읽은 정본 순서
EXT = (".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG")
MIN_PX = 2.0        # 이보다 작은 변은 축퇴로 본다. 픽셀 기준이라 사진 크기를 읽어야 한다
IOU_SAME = 0.5      # 이 이상 겹친 head·helmet 한 쌍은 같은 머리에 두 번 붙인 것이다


def stem(f):
    return os.path.splitext(f)[0]


def iou(a, b):
    """xyxy 두 박스의 IoU. 정규화 좌표 그대로 쓴다 — 비율이라 축척과 무관하다."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def parse(path):
    """한 줄씩 읽어 (cls, cx, cy, w, h) 로 돌려준다. 형식이 깨진 줄은 사유와 함께 모은다."""
    rows, bad = [], []
    for ln, raw in enumerate(open(path, encoding="utf-8"), 1):
        s = raw.strip()
        if not s:
            continue
        p = s.split()
        if len(p) != 5:
            bad.append((ln, f"칸이 {len(p)}개 (5개여야 한다)"))
            continue
        try:
            c = int(p[0]); v = [float(x) for x in p[1:]]
        except ValueError:
            bad.append((ln, "숫자로 못 읽음"))
            continue
        if not 0 <= c < len(NAMES):
            bad.append((ln, f"클래스 인덱스 {c} — 0~{len(NAMES)-1} 밖"))
            continue
        rows.append((ln, c, *v))
    return rows, bad


def main(ldir, idir):
    imgs = {stem(f): f for f in os.listdir(idir) if f.endswith(EXT)}
    labs = {stem(f): f for f in os.listdir(ldir) if f.endswith(".txt")}

    # ① zip 1:1 — 5차 평가를 무효화한 그 자리다
    only_i, only_l = sorted(set(imgs) - set(labs)), sorted(set(labs) - set(imgs))
    print(f"사진 {len(imgs)} · 라벨 {len(labs)} · 짝 {len(set(imgs) & set(labs))}")
    for k in only_i:
        print(f"  [짝없음] 사진만 있다  {imgs[k]}")
    for k in only_l:
        print(f"  [짝없음] 라벨만 있다  {labs[k]}")

    from PIL import Image
    cnt, errs, files = collections.Counter(), 0, 0
    for k in sorted(set(imgs) & set(labs)):
        W, H = Image.open(os.path.join(idir, imgs[k])).size
        rows, bad = parse(os.path.join(ldir, labs[k]))
        msgs = [f"{ln}행 {why}" for ln, why in bad]
        boxes = []
        for ln, c, cx, cy, w, h in rows:
            cnt[NAMES[c]] += 1
            if not all(0.0 <= v <= 1.0 for v in (cx, cy, w, h)):
                msgs.append(f"{ln}행 좌표가 0~1 밖 ({cx:.3f} {cy:.3f} {w:.3f} {h:.3f})")
                continue
            if w * W < MIN_PX or h * H < MIN_PX:
                msgs.append(f"{ln}행 축퇴 박스 {w*W:.1f}×{h*H:.1f}px")
            x1, y1, x2, y2 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
            if x1 < -1e-6 or y1 < -1e-6 or x2 > 1 + 1e-6 or y2 > 1 + 1e-6:
                msgs.append(f"{ln}행 박스가 화면 밖으로 나간다")
            boxes.append((ln, c, (x1, y1, x2, y2)))

        # ② head ↔ helmet 배타 — 한 머리는 맨머리이거나 덮였거나 둘 중 하나다
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                (li, ci, bi), (lj, cj, bj) = boxes[i], boxes[j]
                if {ci, cj} == {1, 2} and iou(bi, bj) >= IOU_SAME:
                    msgs.append(f"{li}·{lj}행 head 와 helmet 이 IoU {iou(bi,bj):.2f} 로 겹친다")

        if msgs:
            files += 1; errs += len(msgs)
            print(f"  [{labs[k]}]")
            for m in msgs:
                print(f"    {m}")

    print("\n클래스별 개수")
    for nm in NAMES:
        if cnt[nm]:
            print(f"  {nm:16s} {cnt[nm]}")
    miss = [nm for nm in ("head", "helmet") if not cnt[nm]]
    if miss:
        print(f"  ⚠ {' · '.join(miss)} 가 0개다 — 라벨링이 안 끝났거나 클래스를 빠뜨렸다")

    ok = not (only_i or only_l or errs)
    print(f"\n{'통과' if ok else '실패'} — 짝없음 {len(only_i)+len(only_l)} · 문제 {errs}건 / {files}파일")
    return 0 if ok else 1


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__ or "쓰기: python3 label_check.py <labels_dir> <images_dir>")
    sys.exit(main(sys.argv[1], sys.argv[2]))
