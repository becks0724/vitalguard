#!/usr/bin/env python3
# 직접 촬영 시험지 사진의 EXIF 일관성을 검수하고 촬영 순서대로 워크시트를 만드는 도구

"""직접 촬영 시험지(PHOTO-TEST-30) 반입 검수 · 리네임.

7차 Phase 0 용. 두 단계로 쓴다.

  ① 검수 + 워크시트 생성
     python3 photo_audit.py --src ~/Desktop/원본사진

     - EXIF 일관성 판정(기종·초점거리·방향·해상도)
     - HEIC → JPEG 변환(sips · EXIF 보존)
     - 촬영 시각 순으로 정렬해 워크시트 CSV 생성

  ② 워크시트를 채운 뒤 리네임
     python3 photo_audit.py --rename

왜 필요한가 — 촬영가이드 4절의 파일명이 곧 정답표다. 거리별 검출률·조합별 판정·
함정 오판율이 전부 파일명에서 나온다. 라벨만으로는 거리·함정 종류·변형을 알 수 없다.

⚠️ 초점거리가 장마다 다르면 렌즈 배율이 바뀐 것이고, 그러면 "거리 ↔ 박스 크기" 관계가
   깨져 단절점 측정이 무의미해진다. 이 스크립트가 가장 먼저 보는 것이 그것이다.
"""

import argparse
import csv
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

from PIL import Image, ExifTags

DEST = Path.home() / 'Documents' / '조달청-공모전 관련자료' / 'PHOTO-TEST-30'
SRC_EXT = {'.heic', '.heif', '.jpg', '.jpeg', '.png'}
MIN_W, MIN_H = 1920, 1080

# 촬영가이드 4절 — <거리>m_<머리>_<신발>_<변형>_<번호>.jpg
DISTANCE = {'03', '06', '10'}
HEAD = {'helmet', 'bare', 'inhand', 'onground'}
SHOES = {'safety', 'sneakers'}
VARIANT = {'plain', 'two', 'occluded', 'back', 'backlit'}

TAG = {v: k for k, v in ExifTags.TAGS.items()}


def _exif(path):
    """EXIF 에서 검수에 쓰는 항목만 뽑는다. 없으면 None 으로 둔다."""
    try:
        with Image.open(path) as im:
            w, h = im.size
            ex = im.getexif()
    except Exception as e:                       # 손상·미지원 포맷
        return {'error': f'{e.__class__.__name__}: {e}'}

    def g(name):
        return ex.get(TAG.get(name, -1))

    return {
        'w': w, 'h': h,
        'dt': g('DateTimeOriginal') or g('DateTime'),
        'model': g('Model'),
        'focal35': g('FocalLengthIn35mmFilm'),
        'lens': g('LensModel'),
        'orient': g('Orientation'),
        'rendered': g('CustomRendered'),
    }


def _to_jpeg(src, dst):
    """HEIC 를 JPEG 로 변환한다. sips 는 macOS 기본 도구라 의존성이 늘지 않는다."""
    r = subprocess.run(
        ['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '95',
         str(src), '--out', str(dst)],
        capture_output=True, text=True)
    if r.returncode != 0 or not dst.exists():
        raise RuntimeError(f'sips 변환 실패 — {src.name}\n{r.stderr.strip()}')


def audit(src_dir, dst_dir):
    src_dir, dst_dir = Path(src_dir).expanduser(), Path(dst_dir).expanduser()
    files = sorted(p for p in src_dir.rglob('*')
                   if p.is_file() and p.suffix.lower() in SRC_EXT)
    if not files:
        sys.exit(f'사진이 없다 — {src_dir}')

    print(f'원본 {len(files)}장  ←  {src_dir}\n')

    rows, bad = [], []
    for p in files:
        e = _exif(p)
        if 'error' in e:
            bad.append((p.name, e['error']))
            continue
        e['src'] = p
        rows.append(e)

    if bad:
        print('⚠️ 읽지 못한 파일')
        for n, err in bad:
            print(f'   {n}  {err}')
        print()

    # ── 일관성 판정 ────────────────────────────────────────────────────
    models = Counter(r['model'] for r in rows)
    focals = Counter(r['focal35'] for r in rows)
    lenses = Counter(r['lens'] for r in rows)
    portrait = [r for r in rows if r['h'] > r['w']]
    small = [r for r in rows if min(r['w'], r['h']) < MIN_H or max(r['w'], r['h']) < MIN_W]
    nodt = [r for r in rows if not r['dt']]

    print('=== EXIF 일관성 ===')
    _verdict('기종', models, '기종이 섞이면 화각·센서가 달라 비교가 흐려진다')
    _verdict('초점거리(35mm)', focals,
             '★ 렌즈 배율이 바뀌었다는 뜻이다. 거리↔박스크기 결론을 못 낸다')
    _verdict('렌즈', lenses, '')

    print(f"  {'세로 촬영':<16} {len(portrait)}장"
          + ('  ⚠️ CCTV 와 방향이 다르다' if portrait else '  ✅'))
    print(f"  {'해상도 미달':<16} {len(small)}장"
          + (f'  ⚠️ {MIN_W}×{MIN_H} 미만' if small else '  ✅'))
    print(f"  {'촬영시각 없음':<16} {len(nodt)}장"
          + ('  ⚠️ 정렬을 순서대로 못 한다' if nodt else '  ✅'))

    rendered = Counter(r['rendered'] for r in rows)
    if len(rendered) > 1:
        print(f'  {"CustomRendered":<16} {dict(rendered)}  ⚠️ 인물 모드 혼입 가능 — 육안 확인 필요')
    print('\n  ※ 인물 모드(배경 흐림)는 EXIF 로 확실히 못 가른다. 배경이 흐린 장이 있는지'
          ' 워크시트 만든 뒤 눈으로 한 번 훑을 것.\n')

    # ── 변환·복사 ──────────────────────────────────────────────────────
    img_dir = dst_dir / 'images'
    img_dir.mkdir(parents=True, exist_ok=True)
    rows.sort(key=lambda r: (r['dt'] or '', r['src'].name))

    print(f'=== 반입 → {img_dir} ===')
    for i, r in enumerate(rows, 1):
        out = img_dir / f'_raw{i:03d}.jpg'
        if r['src'].suffix.lower() in {'.heic', '.heif'}:
            _to_jpeg(r['src'], out)
        elif r['src'].suffix.lower() == '.png':
            with Image.open(r['src']) as im:
                im.convert('RGB').save(out, quality=95)
        else:
            shutil.copy2(r['src'], out)
        r['staged'] = out.name
    print(f'{len(rows)}장 반입 완료 (임시 이름 _rawNNN.jpg · 촬영 시각 순)\n')

    # ── 워크시트 ───────────────────────────────────────────────────────
    ws = dst_dir / '워크시트.csv'
    with open(ws, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['순번', '임시파일', '촬영시각', '초점거리35', '해상도',
                    '거리', '머리', '신발', '변형', '비고'])
        for i, r in enumerate(rows, 1):
            w.writerow([i, r['staged'], r['dt'] or '', r['focal35'] or '',
                        f"{r['w']}x{r['h']}", '', '', '', '', ''])

    print(f'=== 워크시트 생성 — {ws} ===')
    print('  채울 칸 네 개')
    print(f"    거리   {' | '.join(sorted(DISTANCE))}")
    print(f"    머리   {' | '.join(sorted(HEAD))}")
    print(f"    신발   {' | '.join(sorted(SHOES))}")
    print(f"    변형   {' | '.join(sorted(VARIANT))}")
    print('\n  촬영 시각 순이라 같은 구도끼리 붙어 있다. 위에서부터 훑으면 빠르다.')
    print(f'\n  채운 뒤 →  python3 {Path(__file__).name} --rename')


def _verdict(label, counter, why):
    vals = [v for v in counter if v is not None]
    if len(counter) <= 1:
        print(f'  {label:<16} {vals[0] if vals else "없음"}  ✅')
    else:
        print(f'  {label:<16} {dict(counter)}  ⚠️ 섞였다')
        if why:
            print(f'  {"":<16} → {why}')


def rename(dst_dir):
    dst_dir = Path(dst_dir).expanduser()
    ws, img_dir = dst_dir / '워크시트.csv', dst_dir / 'images'
    if not ws.exists():
        sys.exit(f'워크시트가 없다 — 먼저 검수를 돌릴 것 ({ws})')

    with open(ws, encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))

    # ★ 이름을 바꾸기 전에 전부 검증한다. 절반만 바뀌면 되돌리기가 더 어렵다.
    plan, errs = [], []
    seen = Counter()
    for r in rows:
        n, src = r['순번'], img_dir / r['임시파일']
        d, hd, sh, va = (r['거리'].strip(), r['머리'].strip(),
                         r['신발'].strip(), r['변형'].strip())
        if not src.exists():
            errs.append(f'{n}행 — 파일 없음 {r["임시파일"]}')
            continue
        for val, ok, name in ((d, DISTANCE, '거리'), (hd, HEAD, '머리'),
                              (sh, SHOES, '신발'), (va, VARIANT, '변형')):
            if val not in ok:
                errs.append(f'{n}행 {name} "{val}" — 허용값 {sorted(ok)}')
        if errs and errs[-1].startswith(f'{n}행'):
            continue
        key = (d, hd, sh, va)
        seen[key] += 1
        plan.append((src, f'{d}m_{hd}_{sh}_{va}_{seen[key]:02d}.jpg'))

    if errs:
        print(f'⚠️ 워크시트 오류 {len(errs)}건 — 이름을 바꾸지 않았다\n')
        for e in errs:
            print(f'   {e}')
        sys.exit(1)

    for src, new in plan:
        src.rename(img_dir / new)
    print(f'✅ {len(plan)}장 리네임 완료 → {img_dir}\n')
    _coverage(seen)


def _coverage(seen):
    """4조합 × 3거리 12칸이 채워졌는지 본다. 빈 칸은 그 구간을 못 잰다는 뜻이다."""
    combo = {('helmet', 'safety'): 'A 정상',
             ('bare', 'safety'): 'B 안전모 미착용',
             ('helmet', 'sneakers'): 'C 안전화 미착용',
             ('bare', 'sneakers'): 'D 둘 다 미착용'}
    print('=== 커버리지 — 기본 격자 (변형 plain) ===')
    print(f'  {"조합":<20} {"03m":>5} {"06m":>5} {"10m":>5}')
    holes = 0
    for (hd, sh), name in combo.items():
        cnt = [seen.get((d, hd, sh, 'plain'), 0) for d in ('03', '06', '10')]
        holes += sum(1 for c in cnt if c == 0)
        print(f'  {name:<20} ' + ''.join(f'{c:>5}' for c in cnt)
              + ('   ⚠️' if 0 in cnt else ''))

    print('\n=== 함정·변형 ===')
    for va in ('two', 'occluded', 'back', 'backlit'):
        n = sum(v for k, v in seen.items() if k[3] == va)
        print(f'  {va:<12} {n:>3}장' + ('  ⚠️ 없음' if n == 0 else ''))
    for hd in ('inhand', 'onground'):
        n = sum(v for k, v in seen.items() if k[1] == hd)
        print(f'  {hd:<12} {n:>3}장'
              + ('  ⚠️ 없음 — 공개셋으로 못 재는 항목이다' if n == 0 else ''))

    print(f'\n총 {sum(seen.values())}장')
    if holes:
        print(f'⚠️ 기본 격자 빈 칸 {holes}개 — 그 칸은 결론을 낼 수 없다.')
        print('   추정으로 채우지 말고 재촬영 여부를 판단할 것.')
    else:
        print('✅ 기본 격자 12칸 전부 채워졌다.')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='PHOTO-TEST-30 반입 검수·리네임')
    ap.add_argument('--src', help='아이폰에서 내보낸 원본 폴더')
    ap.add_argument('--dst', default=str(DEST), help=f'보관 위치 (기본 {DEST})')
    ap.add_argument('--rename', action='store_true', help='워크시트대로 리네임')
    a = ap.parse_args()

    if a.rename:
        rename(a.dst)
    elif a.src:
        audit(a.src, a.dst)
    else:
        ap.error('--src 또는 --rename 중 하나가 필요하다')
