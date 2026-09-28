# 사람에게 안 붙은 안전모·머리를 화면이 「판정 제외」로 그리는지 픽셀로 확인하는 시험
#
# 돌리는 법   python3 test_draw_excluded.py
# 왜 필요한가  2026-09-22 에 세는 쪽을 고쳤는데 그리는 쪽이 그대로라, 집계는 의자를 안 세는데
#             화면은 계속 「의자가 안전모를 썼다」고 말했다. 사용자가 화면을 보고 지적했다.
#             수치 시험만으로는 이 어긋남을 못 잡는다 — 그려진 것을 직접 봐야 한다.
import sys
import types

if "flask" not in sys.modules:                 # 맥에 flask 가 없다. HTTP 를 안 쓰므로 최소만 끼운다
    _f = types.ModuleType("flask")
    _f.Flask = lambda *a, **k: types.SimpleNamespace(
        get=lambda *a, **k: (lambda fn: fn), post=lambda *a, **k: (lambda fn: fn), run=None)
    _f.Response = _f.jsonify = lambda *a, **k: None
    _f.request = types.SimpleNamespace(args={})
    sys.modules["flask"] = _f

import cv2                                                    # noqa: E402
import numpy as np                                            # noqa: E402

import gopro_ppe_edge as G                                    # noqa: E402

IW, IH, OW, OH = G.IW, G.IH, G.OW, G.OH
SX, SY = OW / IW, OH / IH

FAIL = []


def eq(label, got, want):
    ok = got == want
    print(f"  {'✓' if ok else '✗'} {label}: {got}" + ("" if ok else f"   ← 기대 {want}"))
    if not ok:
        FAIL.append(label)


def near(c, ref, tol=60):
    return sum((int(a) - int(b)) ** 2 for a, b in zip(c, ref)) ** 0.5 < tol


def box_color(img, box):
    """박스 테두리에서 가장 많이 나온 색이 평소 색인지 제외 색인지 가른다.

    JPEG 라 값이 정확히 안 맞는다. 그래서 같다/다르다가 아니라 **어느 쪽에 가까운가**로 센다.
    """
    x1, y1, x2, y2 = (int(v) for v in box)
    n_norm = n_excl = 0
    for x in range(max(0, x1), min(OW, x2)):
        for y in (y1, y1 + 1, y2 - 1, y2):
            if 0 <= y < OH:
                b, g, r = img[y, x]
                if near((r, g, b), G.COLOR["helmet"]):
                    n_norm += 1
                elif near((r, g, b), G.EXCLUDED_COLOR):
                    n_excl += 1
    return n_norm, n_excl


# ── 장면 — 사람 하나, 그 위의 안전모 하나, 멀리 떨어진 안전모 하나 ──
person = ("person", (300.0, 200.0, 400.0, 450.0), 0.9)
helmet_on = ("helmet", (330.0, 205.0, 370.0, 235.0), 0.9)     # 중심 (350,220) — 사람 안
helmet_off = ("helmet", (600.0, 300.0, 700.0, 360.0), 0.34)   # 중심 (650,330) — 사람 밖(의자)

print("⓪ 시험 장면이 의도대로인가 — 먼저 계기를 본다")
eq("사람 위 안전모가 사람 안", G._attached_to_person(helmet_on[1], [person[1]]), True)
eq("의자 안전모가 사람 밖", G._attached_to_person(helmet_off[1], [person[1]]), False)

frame = np.full((IH, IW, 3), 20, dtype=np.uint8)              # 어두운 바탕 — 색이 잘 갈리게
jpg = G.draw(frame, [person, helmet_on, helmet_off], ms=17.0, fps=30.0)
eq("그림이 나왔다", len(jpg) > 1000, True)
img = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)

print("\n① 사람 위 안전모는 평소 색(초록)으로 그린다")
on_box = (helmet_on[1][0] * SX, helmet_on[1][1] * SY, helmet_on[1][2] * SX, helmet_on[1][3] * SY)
n_norm, n_excl = box_color(img, on_box)
print(f"    평소색 화소 {n_norm} · 제외색 화소 {n_excl}")
eq("평소 색이 더 많다", n_norm > n_excl, True)

print("\n② ★ 의자 안전모는 제외 색(회색)으로 그린다 — 이것이 이 수정의 대상이다")
off_box = (helmet_off[1][0] * SX, helmet_off[1][1] * SY, helmet_off[1][2] * SX, helmet_off[1][3] * SY)
n_norm, n_excl = box_color(img, off_box)
print(f"    평소색 화소 {n_norm} · 제외색 화소 {n_excl}")
eq("제외 색이 더 많다", n_excl > n_norm, True)
eq("평소 색은 안 나온다", n_norm, 0)

print("\n③ 지우지 않는다 — 보이되 구별되게 둔다")
# 사람을 놓쳐서 밖으로 나온 안전모까지 숨으면 우리 검출 실패가 화면에서 사라진다.
eq("제외된 박스도 그려진다", n_excl > 0, True)

print("\n④ 사람이 하나도 없으면 전부 제외로 그린다 — 사람을 통째로 놓친 경우")
jpg2 = G.draw(frame, [helmet_off], ms=17.0, fps=30.0)
img2 = cv2.imdecode(np.frombuffer(jpg2, np.uint8), cv2.IMREAD_COLOR)
n_norm2, n_excl2 = box_color(img2, off_box)
print(f"    평소색 화소 {n_norm2} · 제외색 화소 {n_excl2}")
eq("제외 색으로 그린다", n_excl2 > n_norm2, True)

print("\n⑤ 집계와 같은 함수를 쓰나 — 화면과 수가 갈리지 않게 하는 장치")
# ★ 이 시험은 색이 아니라 **배선**을 본다. 각자 같은 식을 따로 쓰면 한쪽만 고쳐질 때 조용히 갈린다.
import inspect                                                # noqa: E402
src_draw = inspect.getsource(G.draw)
src_stats = inspect.getsource(G._zone_stats)
eq("draw 가 공용 함수를 쓴다", "_attached_to_person" in src_draw, True)
eq("_zone_stats 도 같은 함수를 쓴다", "_attached_to_person" in src_stats, True)

print("\n" + ("⛔ 실패 " + " · ".join(FAIL) if FAIL else "✅ 전부 통과"))
sys.exit(1 if FAIL else 0)
