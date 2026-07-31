# AI Hub 507(고소작업 현장) 안전화·안전모 미착용 라벨을 통합 9클래스 YOLO 형식으로 변환하는 스크립트
"""
AI Hub `고소작업 현장 실시간 영상 데이터`(dataSetSn=507) 를 우리 통합 클래스로 변환한다.

    WO-07 (UA-03 안전화 미착용의 발 부위)  → no_safety_shoes   ★ 신규 9번째 클래스
    WO-04 (UA-04 안전모 미착용의 머리)     → head
    WO-01 (작업자 전신 · WS·UC 에만 존재)  → person            (--with-person 지정 시)

판정은 안전모와 같은 구조다 — 미착용을 별도 클래스로 두지 않는 것이 원칙이지만,
507 은 `head`(맨머리)에 해당하는 "안전화 안 신은 발" 을 직접 라벨하지 않고
**무릎~발 영역**을 통째로 준다. 그래서 `foot`(SH17 유래·신발 단위)에 병합하지 않고
별도 클래스로 둔다. 근거는 `docs/ppe-ml-run-20260729.md` 14절 실측 —

    SH17 foot   사람 대비 면적  1.79%   (전체 759개)
    507  WO-07  사람 대비 면적 17.70%   (32,137개)   ← 10배

이름이 같고 부위가 같아도 박스가 덮는 범위가 다르면 병합은 오염이다
(3절 `helmet`↔`head` 78.2% 겹침과 같은 종류).

⚠️ 507 자체 train/val 분할은 **프레임 단위라 누수**다 — Training 의 UA-03 시퀀스 23개가
   Validation 에도 23개 전부 들어 있다. 그래서 이 스크립트는 원본 분할을 무시하고
   **시퀀스 단위로 다시 나눈다**(해시 결정성 — 같은 입력이면 항상 같은 분할).

⚠️ 부분 라벨이다. UA 프레임에는 위반 작업자 1명분만 박스가 있고 같은 장면의 다른
   작업자·안전모는 라벨이 없다. 학습에는 넣되 **평가는 `fair_eval` 로 출처를 제한**할 것.

       SOURCE_CLASSES['a507'] = {'no_safety_shoes', 'head'}   # --with-person 이면 person 추가

⚠️ AI Hub 데이터는 학습용으로만 제공된다(상업적 이용은 수행기관 별도 협의).
   산출 가중치는 `_nc` 계열로 관리할 것.

사용 예 — 라벨·이미지 zip 을 그대로 읽는다(16GB 를 풀지 않는다).

    python3 convert_aihub_507.py \
        --labels VL_03_공통.zip --images VS_03_공통.zip \
        --dst /content/a507_yolo --stride 5
"""

import argparse
import hashlib
import io
import json
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image

# ★ 8클래스에 no_safety_shoes 를 더한 9클래스. 노트북의 UNIFIED 도 함께 바꿔야 한다.
UNIFIED = ['person', 'head', 'helmet', 'safety_vest', 'foot', 'shoes',
           'hands', 'gloves', 'no_safety_shoes']
UNIFIED_IDX = {n: i for i, n in enumerate(UNIFIED)}

CLASS_MAP = {'WO-07': 'no_safety_shoes', 'WO-04': 'head'}
PERSON_MAP = {'WO-01': 'person'}

RES_W, RES_H = 1920.0, 1080.0        # 507 은 전 프레임 고정 해상도. JSON 값이 있으면 그걸 쓴다


def dec(info):
    """507 zip 내부 파일명은 CP949 다. zipfile 이 이미 cp437 로 디코드해 두므로 되돌린다."""
    return info.orig_filename.encode('cp437').decode('cp949')


def seq_of(name):
    """'공통/불안전한행동(UA)/H-210825_A03_F_UA-03_201/....json' → 시퀀스명."""
    parts = name.split('/')
    return parts[2] if len(parts) > 2 else parts[0]


def split_of(seq, val_ratio):
    """시퀀스 단위 결정성 분할 — 프레임 단위로 나누면 인접 프레임 누수로 홀드아웃이 성립하지 않는다."""
    h = int(hashlib.md5(seq.encode()).hexdigest()[:8], 16)
    return 'val' if (h % 1000) < val_ratio * 1000 else 'train'


def convert(labels_zip, images_zip, dst, imgsz=640, quality=88,
            stride=5, val_ratio=0.3, with_person=False, limit=None):
    dst = Path(dst)
    cmap = dict(CLASS_MAP)
    if with_person:
        cmap.update(PERSON_MAP)

    lz = zipfile.ZipFile(labels_zip)
    iz = zipfile.ZipFile(images_zip)

    imgs = {}
    for i in iz.infolist():
        n = dec(i)
        if n.lower().endswith(('.jpg', '.jpeg', '.png')):
            imgs[Path(n).stem] = i
    jsons = [i for i in lz.infolist() if dec(i).lower().endswith('.json')]
    print(f'라벨 {len(jsons):,}개 · 이미지 {len(imgs):,}장 · 매핑 {cmap}')
    if not jsons or not imgs:
        sys.exit('라벨 또는 이미지를 못 찾음 — zip 경로 확인')

    # 시퀀스별로 모아 stride 로 솎는다 — 30fps 연속 프레임은 거의 같은 그림이다
    by_seq = defaultdict(list)
    for i in jsons:
        by_seq[seq_of(dec(i))].append(i)
    picked = []
    for seq in sorted(by_seq):
        lst = sorted(by_seq[seq], key=lambda i: dec(i))
        picked.extend(lst[::stride])
    if limit:
        picked = picked[:limit]
    print(f'시퀀스 {len(by_seq):,}개 · stride {stride} → 프레임 {len(picked):,}장')

    counts, per_split, dropped, degen, no_img = Counter(), Counter(), 0, 0, 0
    seen_seq = defaultdict(Counter)

    for k, info in enumerate(picked, 1):
        name = dec(info)
        d = json.loads(lz.read(info).decode('utf-8-sig'))
        ldi = d['Learning Data Info.']
        stem = ldi['json_data_ID']
        ii = imgs.get(stem)
        if ii is None:
            no_img += 1
            continue

        res = d.get('Raw Data Info.', {}).get('resolution') or (RES_W, RES_H)
        W, H = float(res[0]), float(res[1])

        lines = []
        for a in ldi.get('annotation', []):
            tgt = cmap.get(a.get('class_id'))
            if tgt is None:
                continue
            b = a.get('box') or []
            if len(b) != 4:
                continue
            # ★ 507 은 [x, y, w, h] 좌상단 기준 픽셀 (E63 의 [x1,y1,x2,y2] 와 다르다)
            x, y, bw, bh = (float(v) for v in b)
            if bw <= 1 or bh <= 1:          # UA-06·UA-10 등에 0×0 축퇴 박스가 있다
                degen += 1
                continue
            x1, y1 = max(0.0, x), max(0.0, y)
            x2, y2 = min(W, x + bw), min(H, y + bh)
            nw, nh = (x2 - x1) / W, (y2 - y1) / H
            if nw <= 0 or nh <= 0:
                degen += 1
                continue
            ui = UNIFIED_IDX[tgt]
            lines.append(f'{ui} {(x1 + x2) / 2 / W:.6f} {(y1 + y2) / 2 / H:.6f} {nw:.6f} {nh:.6f}')
            counts[tgt] += 1

        if not lines:
            dropped += 1
            continue

        seq = seq_of(name)
        sp = split_of(seq, val_ratio)
        io_dir = dst / 'images' / sp
        lb_dir = dst / 'labels' / sp
        io_dir.mkdir(parents=True, exist_ok=True)
        lb_dir.mkdir(parents=True, exist_ok=True)

        out_stem = 'a507_' + stem
        out_img = io_dir / (out_stem + '.jpg')
        if not out_img.exists():
            im = Image.open(io.BytesIO(iz.read(ii))).convert('RGB')
            im.thumbnail((imgsz, imgsz))      # 종횡비 유지 — 정규화 박스는 그대로 유효
            im.save(out_img, quality=quality, optimize=True)
        (lb_dir / (out_stem + '.txt')).write_text('\n'.join(lines) + '\n')
        per_split[sp] += 1
        seen_seq[sp][seq] += 1

        if k % 1000 == 0:
            print(f'  {k:,}/{len(picked):,} 처리…')

    print(f'\n변환 완료 — 유지 {sum(per_split.values()):,} / '
          f'라벨없음 {dropped:,} / 이미지없음 {no_img:,} / 축퇴박스 {degen:,}')
    print('split  :', dict(per_split))
    print('클래스 :', dict(counts))
    print(f'시퀀스 : train {len(seen_seq["train"]):,} · val {len(seen_seq["val"]):,}')

    overlap = set(seen_seq['train']) & set(seen_seq['val'])
    assert not overlap, f'시퀀스가 양쪽에 걸쳤다 — 분할 버그: {sorted(overlap)[:5]}'
    assert counts, '변환된 박스가 0개다 — class_id 매핑을 확인할 것'
    print('✅ 시퀀스 교집합 0 · 박스 > 0')

    yml = dst / 'data.yaml'
    yml.write_text(
        f'path: {dst}\ntrain: images/train\nval: images/val\n'
        + 'names:\n' + ''.join(f'  {i}: {n}\n' for i, n in enumerate(UNIFIED)),
        encoding='utf-8')
    print('data.yaml :', yml)
    print('\n⚠️ AI Hub 학습용 한정 — 산출 가중치는 `_nc` 로 관리할 것')
    return counts, per_split


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--labels', required=True, help='라벨 zip (예 VL_03_공통.zip · TL_03_공통.zip)')
    ap.add_argument('--images', required=True, help='원천 zip (예 VS_03_공통.zip)')
    ap.add_argument('--dst', required=True, help='YOLO 출력 폴더')
    ap.add_argument('--imgsz', type=int, default=640)
    ap.add_argument('--quality', type=int, default=88)
    ap.add_argument('--stride', type=int, default=5,
                    help='시퀀스 안에서 N프레임마다 1장 (30fps 연속 프레임은 중복이 심하다)')
    ap.add_argument('--val-ratio', type=float, default=0.3, help='시퀀스 단위 val 비율')
    ap.add_argument('--with-person', action='store_true',
                    help='WO-01 → person 도 편입 (WS·UC 에만 있고 부분 라벨이라 기본 off)')
    ap.add_argument('--limit', type=int, default=None, help='앞 N개만 (테스트용)')
    a = ap.parse_args()
    convert(a.labels, a.images, a.dst, a.imgsz, a.quality,
            a.stride, a.val_ratio, a.with_person, a.limit)
