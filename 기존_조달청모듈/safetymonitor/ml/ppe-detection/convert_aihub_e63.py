# AI Hub E63(전기설비 공사현장) 안전장비 라벨을 통합 8클래스 YOLO 형식으로 변환하는 스크립트
"""
AI Hub `전기 설비 공사 현장 위험 상태 판단 데이터`(dataSetSn=71771) 의
`안전장비-E63_DATA3` 를 우리 통합 클래스로 변환한다.

    안전모 착용머리    → helmet
    안전모 미착용머리  → head
    절연장갑 착용손    → gloves
    절연장갑 미착용손  → hands
    안전대 착용몸통    → (미사용 · 필요 시 클래스 추가)

원본은 1920×1080 JPG + 이미지당 JSON 하나. 학습이 640 이므로 리사이즈해 저장한다
(3.3GB → 약 400MB). 박스는 정규화 좌표라 리사이즈해도 그대로 쓸 수 있다.

    python3 convert_aihub_e63.py --src <E63 루트> --dst <출력> --imgsz 640

⚠️ AI Hub 데이터는 학습용으로만 제공된다(상업적 이용은 수행기관 별도 협의).
   산출 가중치는 `-nc` 계열로 관리할 것.
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

UNIFIED = ['person', 'head', 'helmet', 'safety_vest', 'foot', 'shoes', 'hands', 'gloves']
UNIFIED_IDX = {n: i for i, n in enumerate(UNIFIED)}

# AI Hub 클래스명(정규화) → 통합 클래스명. 표에 없으면 버린다.
E63_MAP = {
    '안전모착용머리': 'helmet',
    '안전모미착용머리': 'head',
    '절연장갑착용손': 'gloves',
    '절연장갑미착용손': 'hands',
}


def _norm(s):
    """공백·하이픈 제거해 비교용으로 정규화."""
    return ''.join(ch for ch in str(s) if not ch.isspace() and ch not in '-_')


def find_pairs(src):
    """(이미지, 라벨 JSON) 쌍을 찾는다. 원천/라벨 폴더가 같은 트리에 있다고 가정."""
    src = Path(src)
    labels = {p.stem: p for p in src.rglob('*.json')}
    pairs = []
    for img in src.rglob('*.jpg'):
        j = labels.get(img.stem)
        if j:
            pairs.append((img, j))
    return pairs, len(labels)


def split_of(path_parts):
    """경로에 Validation 이 있으면 val, 아니면 train."""
    low = {p.lower() for p in path_parts}
    return 'val' if {'validation', 'valid', 'val'} & low else 'train'


def convert(src, dst, imgsz=640, quality=88, limit=None):
    dst = Path(dst)
    pairs, n_lbl = find_pairs(src)
    if limit:
        pairs = pairs[:limit]
    print(f'라벨 {n_lbl:,}개 · 이미지-라벨 쌍 {len(pairs):,}개')
    if not pairs:
        sys.exit('쌍을 못 찾음 — --src 경로 확인')

    counts, per_split, dropped = Counter(), Counter(), 0
    unmapped = Counter()

    for i, (img_p, json_p) in enumerate(pairs, 1):
        d = json.loads(json_p.read_text(encoding='utf-8'))
        im_meta = d.get('images', {})
        W = im_meta.get('width') or 1920
        H = im_meta.get('height') or 1080

        # class id → 통합 인덱스
        id2uni = {}
        for c in d.get('class', []):
            tgt = E63_MAP.get(_norm(c.get('name')))
            if tgt:
                id2uni[c.get('id')] = UNIFIED_IDX[tgt]
            else:
                unmapped[c.get('name')] += 1

        lines = []
        for a in d.get('annotations', []):
            ui = id2uni.get(a.get('object_class'))
            if ui is None:
                continue
            b = a.get('bbox') or []
            if len(b) != 4:
                continue
            x1, y1, x2, y2 = b
            x1, x2 = sorted((max(0.0, x1), min(float(W), x2)))
            y1, y2 = sorted((max(0.0, y1), min(float(H), y2)))
            bw, bh = (x2 - x1) / W, (y2 - y1) / H
            if bw <= 0 or bh <= 0:
                continue
            cx, cy = (x1 + x2) / 2 / W, (y1 + y2) / 2 / H
            lines.append(f'{ui} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}')
            counts[UNIFIED[ui]] += 1

        if not lines:
            dropped += 1
            continue

        sp = split_of(img_p.parts)
        io_ = dst / 'images' / sp
        lo_ = dst / 'labels' / sp
        io_.mkdir(parents=True, exist_ok=True)
        lo_.mkdir(parents=True, exist_ok=True)

        stem = 'e63_' + img_p.stem
        out_img = io_ / (stem + '.jpg')
        if not out_img.exists():
            im = Image.open(img_p).convert('RGB')
            im.thumbnail((imgsz, imgsz))          # 종횡비 유지 — 정규화 박스는 그대로 유효
            im.save(out_img, quality=quality, optimize=True)
        (lo_ / (stem + '.txt')).write_text('\n'.join(lines) + '\n')
        per_split[sp] += 1

        if i % 2000 == 0:
            print(f'  {i:,}/{len(pairs):,} 처리…')

    print(f'\n변환 완료 — 유지 {sum(per_split.values()):,} / 제외 {dropped:,}(매핑 대상 없음)')
    print('split :', dict(per_split))
    print('클래스:', dict(counts))
    if unmapped:
        print('미매핑 클래스(무시됨):', dict(unmapped.most_common(10)))

    yml = dst / 'data.yaml'
    yml.write_text(
        f'path: {dst}\ntrain: images/train\nval: images/val\n'
        + 'names:\n' + ''.join(f'  {i}: {n}\n' for i, n in enumerate(UNIFIED)),
        encoding='utf-8')
    print('data.yaml :', yml)
    return counts, per_split


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True, help='E63 다운로드 루트(원천·라벨 포함)')
    ap.add_argument('--dst', required=True, help='YOLO 출력 폴더')
    ap.add_argument('--imgsz', type=int, default=640)
    ap.add_argument('--quality', type=int, default=88)
    ap.add_argument('--limit', type=int, default=None, help='앞 N개만 (테스트용)')
    a = ap.parse_args()
    convert(a.src, a.dst, a.imgsz, a.quality, a.limit)
