#!/usr/bin/env python3
# CAM-03 학습 프레임 수집기 — 사람이 /mark 로 선언한 창에서만 프레임과 검출을 함께 저장한다.
"""왜 이렇게 만드는가 (2026-09-10)

**자기 증류를 절반 끊는 것이 목적이다.** 모델 출력만으로 라벨을 만들면 모델의 오검출까지
굳는다(6차에서 대응 C 를 보류한 이유). 사람이 "지금 조끼 1명" 이라고 선언하면
"있는지"는 사람이 정한 독립 정답이 되고, "어디인지"만 검수 대상으로 남는다.

  있는지(분류)   /mark 선언   → 독립 정답 · 순환 끊김
  어디인지(박스)  모델 출력    → 초안일 뿐 · 사람이 검수

그래서 **선언이 없는 프레임은 저장하지 않는다.** 정답 없는 그림은 자기 증류 재료일 뿐이다.

설계 판단 넷
  ① 푸셔를 건드리지 않는다 — HTTP 로만 읽는다. GoPro 웨지 위험 0, 재시작 불필요.
  ② /capture 한 번으로 프레임·박스·라벨을 받는다 — 따로 부르면 그 사이 프레임이 바뀌어
     박스가 어긋난다. 라벨 오염은 에러를 안 내고 조용히 학습을 망친다.
  ③ 창 경계 SETTLE 초를 버린다 — 조끼를 입는 동안의 프레임이 "착용" 으로 라벨된다.
  ④ 지각 해시로 중복을 건다 — 같은 자세를 오래 유지하면 프레임만 쌓이고 정보는 안 는다.
     사진 35장이 실제로는 26 장면이었던 실측(09-10)이 이 필요를 보여준다.

사용법
  # 젯슨에서
  python3 cam03_collect.py --out ~/Documents/조달청-공모전\\ 관련자료/CAM03-COLLECT

  # 다른 창(또는 맥)에서 선언하고 연기한다
  curl "http://127.0.0.1:8444/mark?label=vest1&note=자리3_앉음_정면"
  ... 몇 초 연기 ...
  curl "http://127.0.0.1:8444/mark?label=vest1&note=자리3_구부림_후면"
  ... 끝나면 해제 ...
  curl "http://127.0.0.1:8444/mark"

  ★ 같은 사람이 조끼를 **벗은 창**도 반드시 찍는다. 한 사람이 늘 착용이면
    모델이 "그 사람인가?" 로 100% 맞출 수 있어 조끼를 안 배운다(507 안전화와 같은 함정).
"""
# ⚠ 백그라운드(nohup) 실행 시 stdout 이 블록 버퍼링된다 — 모든 print 에 flush=True 를 단다.
#   09-10 실측: 안 달았더니 nohup 로그가 0 바이트라 실패 원인을 못 봤다.
import argparse
import base64
import re
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request

HASH_SIDE = 16          # 지각 해시 격자 — 16×16 = 256비트


ROI_PAD = 0.08          # 박스 둘레 여유 — 경계에 걸친 옷·팔을 포함시킨다


def _subject_box(dets, size):
    """중복 판정에 쓸 **대상 한 명**의 영역.

    ★ 2026-09-10 재수정 — 처음엔 모든 사람 박스의 합집합을 썼는데, 사무실에 6명이 있으니
      합집합이 화면 대부분을 덮고 **누가 움직이든** 해시가 바뀌어 초당 1장씩 폭주했다
      (실측: 8초에 8장). 군중이 아니라 **찍고 있는 대상**을 재야 한다.
      우선순위 = 조끼 박스 > 가장 큰 사람 박스 > 화면 전체.
    """
    if not dets:
        return None
    W, H = size
    vest = [d["box"] for d in dets if d.get("cls") == "safety_vest"]
    if vest:
        b = max(vest, key=lambda x: (x[2] - x[0]) * (x[3] - x[1]))
    else:
        ppl = [d["box"] for d in dets if d.get("cls") == "person"]
        if not ppl:
            return None
        b = max(ppl, key=lambda x: (x[2] - x[0]) * (x[3] - x[1]))
    pw, ph_ = (b[2] - b[0]) * ROI_PAD, (b[3] - b[1]) * ROI_PAD
    box = (max(0, int(b[0] - pw)), max(0, int(b[1] - ph_)),
           min(W, int(b[2] + pw)), min(H, int(b[3] + ph_)))
    return box if box[2] - box[0] > 8 and box[3] - box[1] > 8 else None


def phash(raw_jpg, dets=None):
    """평균 밝기 기준 이진 해시. PIL 만 쓰고 모델은 안 부른다.

    ★ 2026-09-10 수정 — 화면 전체로 재던 것을 **사람·PPE 영역만** 재도록 바꿨다.
      실측: 사용자가 의자를 돌려 뒤돌아 앉았는데 전체 해밍거리가 6(문턱 12) 이라
      "중복" 으로 걷혔다. 960×540 사무실 화면에서 사람 한 명은 몇 % 밖에 안 되니
      전체 해시는 배경을 재는 셈이었다. 배경은 안 변하는 게 정상이고, 우리가 알고
      싶은 것은 **사람이 바뀌었는가** 다.
    """
    from PIL import Image
    im = Image.open(io.BytesIO(raw_jpg)).convert("L")
    box = _subject_box(dets, im.size)
    if box:
        im = im.crop(box)
    im = im.resize((HASH_SIDE, HASH_SIDE), Image.BILINEAR)
    px = list(im.getdata())
    avg = sum(px) / len(px)
    return [1 if v > avg else 0 for v in px]


def hamming(a, b):
    return sum(x != y for x, y in zip(a, b))


def get(url, timeout=8):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def parse_target(note):
    """창 목표 장수를 note 에서 읽는다 — 예: "흰안전모_뒤돌아 목표35".

    ★ 2026-09-10 추가 — 1인 촬영이라 자세를 잡는 동안 터미널을 볼 수 없다.
      목표를 채우면 수집기가 스스로 라벨을 해제해 그 창을 닫는다.
      목표가 없으면 종전대로 사람이 해제할 때까지 계속 모은다.
    """
    m = re.search(r"목표\s*(\d+)", note or "")
    return int(m.group(1)) if m else 0


def release(base):
    """창을 닫는다 — 푸셔의 라벨을 비우면 이후 프레임은 저장되지 않는다."""
    try:
        urllib.request.urlopen(base + "/mark", timeout=5).read()
        return True
    except (urllib.error.URLError, OSError) as e:
        print(f"[수집] ★ 라벨 자동 해제 실패 ({e}) — 손으로 해제해야 한다", flush=True)
        return False


def safe_name(s):
    """파일명에 쓸 수 있게 — 경로 구분자와 공백만 막는다. 한글은 그대로 둔다."""
    out = "".join("_" if c in '/\\:*?"<>| \t\n' else c for c in (s or ""))
    return out[:60] or "nolabel"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8444")
    ap.add_argument("--out", required=True, help="저장 루트 (저장소 밖이어야 한다)")
    ap.add_argument("--interval", type=float, default=1.0, help="조회 주기(초)")
    ap.add_argument("--settle", type=float, default=5.0,
                    help="라벨이 바뀐 뒤 버리는 시간(초) — 창 경계 오염 방지")
    ap.add_argument("--hash-dist", type=int, default=14,
                    help="직전 저장분과 이 거리 이하면 중복으로 보고 건너뛴다")
    ap.add_argument("--max-age", type=float, default=2.0,
                    help="프레임이 이보다 오래됐으면 건너뛴다(정지 화면 방지)")
    ap.add_argument("--min-gap", type=float, default=3.0,
                    help="이보다 자주 저장하지 않는다 — 해시가 예민해도 폭주를 막는 안전장치")
    ap.add_argument("--max-gap", type=float, default=20.0,
                    help="선언 중인데 이 시간 넘게 한 장도 안 남았으면 중복이어도 저장한다")
    a = ap.parse_args()

    os.makedirs(a.out, exist_ok=True)
    manifest = os.path.join(a.out, "manifest.jsonl")
    last_hash, last_label, label_since = None, None, 0.0
    last_saved_at = 0.0
    win_saved, win_target, win_since = 0, 0, 0.0
    saved = skipped_dup = skipped_nolabel = skipped_settle = 0
    t0 = time.time()
    print(f"[수집] 시작 · out={a.out} · 주기 {a.interval}s · settle {a.settle}s", flush=True)
    print("[수집] 선언이 없는 프레임은 저장하지 않는다. /mark?label=... 로 시작하라.", flush=True)

    try:
        while True:
            time.sleep(a.interval)
            try:
                c = get(f"{a.base}/capture")
            except (urllib.error.URLError, OSError, ValueError) as e:
                print(f"[수집] 조회 실패 ({e}) — 계속", flush=True)
                continue
            if not c.get("ok"):
                continue

            label = (c.get("label") or "").strip()
            if not label:
                skipped_nolabel += 1
                last_label = None
                continue
            if label != last_label:                     # 창이 바뀌었다
                last_label, label_since = label, time.time()
                last_saved_at = 0.0
                last_hash = None                        # 창마다 중복 판정을 새로 시작
                win_saved, win_since = 0, time.time()
                win_target = parse_target(c.get("note"))
                tgt = f" · 목표 {win_target}장 (채우면 자동 종료)" if win_target else " · 목표 없음"
                print(f"[수집] 창 시작 — {label} ({c.get('note') or ''}){tgt}", flush=True)
            if time.time() - label_since < a.settle:    # 경계는 버린다
                skipped_settle += 1
                continue
            if c.get("age") is not None and c["age"] > a.max_age:
                continue

            jpg = base64.b64decode(c["jpg_b64"])
            h = phash(jpg, c.get("dets"))
            if time.time() - last_saved_at < a.min_gap:   # 폭주 방지
                skipped_dup += 1
                continue
            dup = last_hash is not None and hamming(h, last_hash) <= a.hash_dist
            # 중복이어도 오래 굶었으면 한 장 남긴다 — 가만히 있는 자세도 표본이 필요하다.
            if dup and time.time() - last_saved_at < a.max_gap:
                skipped_dup += 1
                continue
            last_hash = h

            stamp = time.strftime("%Y%m%dT%H%M%S", time.localtime()) + "_%03d" % (
                int(time.time() * 1000) % 1000)
            d = os.path.join(a.out, safe_name(label))
            os.makedirs(d, exist_ok=True)
            stem = os.path.join(d, stamp)
            with open(stem + ".jpg", "wb") as f:
                f.write(jpg)
            meta = {"file": os.path.basename(stem) + ".jpg",
                    "label": label, "note": c.get("note"),
                    "ts": c.get("ts"), "wh": c.get("wh"),
                    "dets": c.get("dets"), "stats": c.get("stats"),
                    "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
            with open(stem + ".json", "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=1)
            with open(manifest, "a", encoding="utf-8") as f:
                f.write(json.dumps({**meta, "dir": safe_name(label)},
                                   ensure_ascii=False) + "\n")
            saved += 1
            win_saved += 1
            last_saved_at = time.time()
            nd = len(c.get("dets") or [])
            prog = f" [{win_saved}/{win_target}]" if win_target else ""
            print(f"[수집] +{saved:<4d} {label:<22s} 박스 {nd:2d}개  {stamp}{prog}"
                  f"{'  (간격보충)' if dup else ''}", flush=True)

            # ★ 목표를 채우면 스스로 창을 닫는다 — 1인 촬영이라 사람이 화면을 못 본다.
            if win_target and win_saved >= win_target:
                dt = time.time() - win_since
                ok = release(a.base)
                print(f"[수집] ══ 창 완료 — {label} · {win_saved}장 · {dt/60:.1f}분"
                      f"{'' if ok else ' (해제 실패)'}", flush=True)
                last_label, win_target, win_saved = None, 0, 0
    except KeyboardInterrupt:
        pass
    finally:
        dt = time.time() - t0
        print(f"\n[수집] 종료 · {dt/60:.1f}분", flush=True)
        print(f"  저장 {saved} · 중복건너뜀 {skipped_dup} · 경계버림 {skipped_settle} "
              f"· 선언없음 {skipped_nolabel}", flush=True)
        print(f"  목록 {manifest}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
