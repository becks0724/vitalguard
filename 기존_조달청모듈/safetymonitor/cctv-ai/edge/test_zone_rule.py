# 구역(폴리곤) + 추적 지속 판정 규칙(_zone_stats)의 재현 시험 — 좌표는 09-16 CAM-03 실측을 쓴다
#
# 돌리는 법   python3 test_zone_rule.py       (flask 가 없어도 된다 — 아래에서 대신 끼운다)
# 왜 필요한가  이 규칙은 위반을 **줄이는** 쪽으로 동작한다. 줄이는 변경은 조용히 과하게 줄어도
#             화면이 평온해서 안 보인다. 그래서 「안 줄어야 하는 경우」를 같은 수로 함께 건다.
import sys
import types

# ── flask 가 맥에 없다. 이 시험은 HTTP 를 쓰지 않으므로 최소한만 끼운다 ──
if "flask" not in sys.modules:
    _f = types.ModuleType("flask")
    _f.Flask = lambda *a, **k: types.SimpleNamespace(
        get=lambda *a, **k: (lambda fn: fn), post=lambda *a, **k: (lambda fn: fn), run=None)
    _f.Response = _f.jsonify = lambda *a, **k: None
    _f.request = types.SimpleNamespace(args={})
    sys.modules["flask"] = _f

import gopro_ppe_edge as G                                    # noqa: E402

IW, IH = G.IW, G.IH                                           # 960 x 540
OW, OH = G.OW, G.OH                                           # 640 x 360


def disp(px, py):
    """표시 화면(640×360) 픽셀 → 정규화. 눈으로 고른 좌표를 그대로 쓰기 위한 것."""
    return px / OW, py / OH


def zs(*pts):
    return ",".join(f"{c:.4f}" for p in pts for c in p)


# 1단계에서 눈으로 고른 열린 바닥. ★ 사다리꼴이다 — 원근 때문에 안쪽(위)이 좁다.
#   사각형으로는 이 모양을 못 만든다. 그래서 사용자 결정(09-16)이 폴리곤이다.
FLOOR = zs(disp(180, 230), disp(330, 230), disp(420, 358), disp(110, 358))
# 같은 바닥을 사각형으로 두르면 이만큼이 딸려 들어온다 — 비교용
BBOX = "0.1719,0.6389,0.6563,0.9944"


def d(name, x1, y1, x2, y2, conf=0.9):
    return (name, (x1, y1, x2, y2), conf)


def person_at(fx, fy, h=140, w=60):
    """발밑이 (fx, fy) 인 사람 박스. 추론 좌표계(960×540)."""
    return d("person", fx - w / 2, fy - h, fx + w / 2, fy)


def person_disp(px, py, **kw):
    """표시 화면 픽셀로 발밑을 주면 추론 좌표로 바꿔 사람 박스를 만든다."""
    return person_at(px * IW / OW, py * IH / OH, **kw)


def head_of(p, conf=0.85):
    x1, y1, x2, _y2 = p[1]
    cx = (x1 + x2) / 2
    return d("head", cx - 16, y1 + 2, cx + 16, y1 + 36, conf)


def run(dets, zone=FLOOR, now=1000.0, reset=True):
    if reset:
        G._ztracks.clear()
    G._zone["poly"] = None if zone is None else G._zone_parse(zone)
    raw = [x[0] for x in dets]
    st = {"person_count": raw.count("person"), "violation_count": raw.count("head"),
          "no_hardhat_count": raw.count("head"), "hardhat_count": raw.count("helmet"),
          "compliance_rate": 0, "fall_count": 0, "no_vest_count": 0, "vest_count": 0}
    return G._zone_stats(dets, st, now=now)


FAIL = []


def eq(label, got, want):
    ok = got == want
    print(f"  {'✓' if ok else '✗'} {label}: {got}" + ("" if ok else f"   ← 기대 {want}"))
    if not ok:
        FAIL.append(label)


print("⓪ 파서 — 사각형도 폴리곤도 같은 모양(점 목록)으로 담는다")
eq("사각형 4수 → 점 4개", len(G._zone_parse("0.1,0.2,0.3,0.4")), 4)
eq("폴리곤 8수 → 점 4개", len(G._zone_parse(zs((0, 0), (1, 0), (1, 1), (0, 1)))), 4)
eq("삼각형 6수 → 점 3개", len(G._zone_parse("0,0,1,0,0.5,1")), 3)
for bad in ("0.5,0.1,0.2,0.9", "0.1,0.2,0.3", "1,1,1,1,1,1", "a,b,c,d"):
    try:
        G._zone_parse(bad)
        eq(f"잘못된 입력 거부 {bad!r}", "통과됨", "ValueError")
    except ValueError:
        pass
print("  ✓ 잘못된 입력 4종 전부 거부")

print("\n① 구역이 없으면 화면 전체가 판정 구역이다 (지시 2026-09-22 로 의도가 바뀌었다)")
# ⚠ 이 장면은 옛 동작과 새 동작이 **같은 수**를 낸다 — 머리가 사람 박스 안에 있어서다.
#   그래서 이 시험만으로는 변경을 구별할 수 없다. 구별하는 것은 ⑬ 이다.
p = person_disp(520, 286)
s = run([p, head_of(p)], zone=None)
eq("맨머리는 위반", s["violation_count"], 1)
eq("판정불가 없음", s["unknown_count"], 0)
eq("화면의 사람은 작업자", s["worker_count"], 1)

print("\n② 오늘 아침 실제 장면 — 책상에 앉은 맨머리 동료는 위반이 아니다")
p1 = d("person", 743.75, 267.5, 803.56, 404.75)     # /health 실측 · 발밑 (773.7, 404.8)
p2 = person_disp(575, 172)
s = run([p1, head_of(p1), p2, head_of(p2)])
eq("위반", s["violation_count"], 0)
eq("작업자", s["worker_count"], 0)
eq("판정불가", s["unknown_count"], 0)                 # 머리가 사람 박스 안이므로 유령이 아니다

print("\n③ 열린 바닥에 선 맨머리는 위반이다 — 줄이기만 하는 규칙이 아님을 같은 수로 건다")
p = person_disp(265, 330)                            # 초록 매트 근처
s = run([p, head_of(p)])
eq("위반", s["violation_count"], 1)
eq("작업자", s["worker_count"], 1)
eq("준수율", s["compliance_rate"], 0)

print("\n④ ★ 사다리꼴이 사각형과 다르게 판정한다 — 폴리곤이어야 하는 이유")
p = person_disp(400, 250)                            # 바닥 경계 바깥, 책상 쪽
s = run([p, head_of(p)], zone=BBOX)
eq("사각형이면 작업자로 샌다", s["worker_count"], 1)
s = run([p, head_of(p)], zone=FLOOR)
eq("사다리꼴이면 빠진다", s["worker_count"], 0)
eq("사다리꼴 위반", s["violation_count"], 0)

print("\n⑤ 배타 — 그 사람에게 안전모가 잡히면 head 를 버린다")
p = person_disp(265, 330)
hd = head_of(p)
s = run([p, hd, d("helmet", *hd[1])])
eq("위반", s["violation_count"], 0)
eq("착용", s["hardhat_count"], 1)
eq("준수율", s["compliance_rate"], 100)

print("\n⑥ 책상 위 안전모는 착용으로 세지 않는다 ([CCTV/ML] 지적 09-16)")
p = person_disp(265, 330)
desk = d("helmet", 300, 470, 340, 505)               # 구역 안이지만 사람 박스 밖
s = run([p, head_of(p), desk])
eq("위반(맨머리가 가려지면 안 된다)", s["violation_count"], 1)
eq("착용", s["hardhat_count"], 0)

print("\n⑦ 사람에게 안 붙은 head 는 위반이 아니라 판정불가")
s = run([d("head", 400, 470, 432, 504)])
eq("위반", s["violation_count"], 0)
eq("판정불가", s["unknown_count"], 1)

print("\n⑧ 추적 지속 — 구역을 나가도 TTL 동안은 작업자로 남는다")
# ⚠ 한 걸음 거리로 움직여야 한다. 멀리 던지면 추적기가 **다른 사람**으로 보고 새 번호를 내주며,
#   그러면 이 시험은 TTL 이 아니라 매칭 실패를 재게 된다(09-16 처음에 그 함정에 빠졌다).
inside = person_disp(380, 340)                       # 사다리꼴 오른쪽 경계 **안**
s = run([inside, head_of(inside)], now=1000.0)
eq("t=0 구역 안", s["worker_count"], 1)
out = person_disp(425, 340)                          # 경계를 막 넘어선 자리 — 정규화 이동 0.07
s = run([out, head_of(out)], now=1001.5, reset=False)
eq("t=1.5s 아직 작업자", s["worker_count"], 1)
eq("t=1.5s 위반 유지", s["violation_count"], 1)
s = run([out, head_of(out)], now=1003.6, reset=False)
eq(f"t=3.6s(TTL {G.ZONE_TTL}) 작업자 아님", s["worker_count"], 0)
eq("t=3.6s 위반 0", s["violation_count"], 0)

print("\n⑨ 저장·복원 — 재시작 한 번에 구역이 사라지면 안 된다")
import os                                                     # noqa: E402
import tempfile                                               # noqa: E402
_tmp = tempfile.mkdtemp()
G._ZONE_FILE = os.path.join(_tmp, "zone.json")

G._zone["poly"] = G._zone_parse(FLOOR)
G._zone["label"] = "판정 구역"
G._zone_save()
saved = list(G._zone["poly"])
G._zone["poly"], G._zone["label"] = None, "지워짐"            # 재시작을 흉내낸다
G._zone_restore()
eq("복원된 점 개수", len(G._zone["poly"] or []), len(saved))
eq("복원된 좌표가 같다", [(round(x, 4), round(y, 4)) for x, y in G._zone["poly"]],
   [(round(x, 4), round(y, 4)) for x, y in saved])
eq("라벨도 복원", G._zone["label"], "판정 구역")

print("\n⑩ off 는 off 로 남는다 — 끈 것도 상태다")
G._zone["poly"] = None
G._zone_save()
G._zone["poly"] = G._zone_parse(FLOOR)                        # 엉뚱한 값을 넣어 두고
G._zone_restore()                                             # 복원하면 off 가 이겨야 한다
eq("복원 후 구역 없음", G._zone["poly"], None)

print("\n⑪ 깨진 파일이 기동을 막지 않는다")
for junk in ('{"zone": "0.9,0.1,0.2,0.8"}', '{"zone": "말도 안 되는 값"}', 'not json at all'):
    open(G._ZONE_FILE, "w").write(junk)
    G._zone["poly"] = None
    try:
        G._zone_restore()
        ok = G._zone["poly"] is None
    except Exception as e:
        ok = False
        print(f"    ⛔ 예외가 났다: {e}")
    eq(f"{junk[:22]!r} → 구역 없이 통과", ok, True)

print("\n⑫ 파일이 없으면 조용히 지나간다")
os.remove(G._ZONE_FILE)
G._zone["poly"] = None
G._zone_restore()
eq("구역 없음", G._zone["poly"], None)

print("\n⑬ ★ 구역이 없어도 귀속 규칙은 돈다 — 가구 안전모·유령 머리를 세지 않는다")
# 왜 이 시험이 필요한가 — 옛 코드는 구역이 없으면 조기 반환해 **원시 계수**를 그대로 뒀다.
#   그러면 의자에 붙은 안전모가 착용으로, 사람 밖 유령 head 가 위반으로 들어간다.
#   2026-09-22 CAM-03 실측 = 사람 1명·head 2개(1개는 사람 밖)에 위반이 2건으로 찍혔다.
# ★ 이 시험은 옛 코드에서 **반드시 실패해야 한다**(착용 1 · 위반 2 · 판정불가 0).
#   실패하지 않으면 시험이 변화를 안 재고 있는 것이다.
G._ztracks.clear()
p = person_disp(265, 330)
desk = d("helmet", 300, 470, 340, 505)          # 사람 박스 밖 — 의자·책상에 붙은 안전모
ghost = d("head", 700, 200, 732, 234)           # 어느 사람에게도 안 붙은 머리 (사람 박스에서 멀다)
s = run([p, head_of(p), desk, ghost], zone=None)
eq("가구 안전모는 착용이 아니다", s["hardhat_count"], 0)
eq("유령 머리는 위반이 아니다", s["violation_count"], 1)
eq("유령은 판정불가로 뺀다", s["unknown_count"], 1)
eq("화면의 사람은 전부 작업자", s["worker_count"], 1)
eq("준수율", s["compliance_rate"], 0)

print("\n⑭ 구역이 없을 때 추적기를 건드리지 않는다 — 쓸데없는 상태가 쌓이면 안 된다")
G._ztracks.clear()
run([person_disp(265, 330)], zone=None)
eq("추적 항목 0", len(G._ztracks), 0)

print("\n" + ("⛔ 실패 " + " · ".join(FAIL) if FAIL else "✅ 전부 통과"))
sys.exit(1 if FAIL else 0)
