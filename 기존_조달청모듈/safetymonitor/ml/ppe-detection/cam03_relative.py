# CAM-03 착용자 오경보·맨머리 검출을 **상대 비교**로 잰다 — 09-12 분할의 절대 재현이 아니다
# ★ 09-15. 09-12 게이트의 「전환 29 · 판정불가 12」가 어느 파일인지 목록이 남지 않아 절대값을
#   재현할 수 없다. 대신 같은 분할을 두 모델에 똑같이 적용해 **증감**을 본다.
#   ⛔ 여기 나오는 수를 게이트 6/125·461/464 옆에 나란히 쓰지 말 것 — 다른 자다.
#
# 두 자로 같이 낸다([M/L] 제안).
#   (a) 깨끗한 부분집합  착용 = vest0_sit_front 35(사용자 확인 전량 착용) · 미착용 = 맨머리 창 435
#                       → n 은 작지만 왜곡 0
#   (b) 전량            착용 = 안전모 창 133 + 35 = 168 · 미착용 = 435
#                       → ⚠ 전환 29(실제로 벗은 프레임)가 착용에 섞여 오경보가 최대 29 부풀려진다
# 자 = subject_box 안에 중심이 든 head 검출 · conf 0.30 · ultralytics 기본 기하(= 젯슨 직사각 engine 과 동치)
import json
import os
import sys
from ultralytics import YOLO

S = os.path.expanduser("~/../../private/tmp/claude-501") if False else sys.argv[2]
W = sys.argv[1]
CONF = float(sys.argv[3]) if len(sys.argv) > 3 else 0.30
HEAD = 1                                   # NAMES = person head helmet safety_vest foot shoes hands gloves


def center_in(box, sb):
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    return sb[0] <= cx <= sb[2] and sb[1] <= cy <= sb[3]


def run(model, items, sbox):
    """items = [(file, path, label)] → head 가 피사체 안에서 검출된 장수"""
    hit = miss = nobox = 0
    for f, p, _ in items:
        sb = sbox.get(f.replace(".jpg", ".json"))
        if sb is None:                     # 피사체 박스가 없으면 셀 수 없다 — 따로 센다
            nobox += 1
            continue
        r = model.predict(p, conf=CONF, verbose=False)[0]
        got = False
        if r.boxes is not None:
            for b, c in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist()):
                if int(c) == HEAD and center_in(b, sb):
                    got = True
                    break
        hit += got
        miss += not got
    return hit, miss, nobox


def main():
    split = json.load(open(os.path.join(S, "split.json")))
    sbox = json.load(open(os.path.join(S, "subject_box.json")))
    m = YOLO(W)
    hel, sit, bare = split["helmet_win"], split["sit_front"], split["bare_win"]

    print(f"가중치 {os.path.basename(W)} · conf {CONF} · 기하 ultralytics 기본(직사각)")
    print("⛔ 게이트 6/125·461/464 와 다른 자다 — 나란히 쓰지 말 것\n")

    # (a) 깨끗한 부분집합
    fa, _, nb1 = run(m, sit, sbox)
    hb, mb, nb2 = run(m, bare, sbox)
    print(f"(a) 깨끗한 부분집합  [왜곡 0]")
    print(f"    착용자 오경보  {fa}/{len(sit)} = {fa/len(sit):.4f}   (박스없음 {nb1})")
    print(f"    맨머리 검출    {hb}/{len(bare)} = {hb/len(bare):.4f}   (놓침 {mb} · 박스없음 {nb2})")

    # (b) 전량 — 착용에 안전모 창 전체를 넣는다
    fh, _, nb3 = run(m, hel, sbox)
    tot = fa + fh
    n = len(sit) + len(hel)
    print(f"\n(b) 전량  [⚠ 전환 29 가 착용에 섞임 — 오경보가 최대 29 부풀려짐]")
    print(f"    착용자 오경보  {tot}/{n} = {tot/n:.4f}   (안전모창 {fh}/{len(hel)} + sit_front {fa}/{len(sit)} · 박스없음 {nb3})")
    print(f"    맨머리 검출    {hb}/{len(bare)} = {hb/len(bare):.4f}")

    json.dump({"weights": os.path.basename(W), "conf": CONF,
               "a": {"fp": fa, "n_worn": len(sit), "tp": hb, "n_bare": len(bare)},
               "b": {"fp": tot, "n_worn": n, "fp_helmet_win": fh, "tp": hb, "n_bare": len(bare)}},
              open(os.path.join(S, f"score_{os.path.basename(W)}.json"), "w"), ensure_ascii=False, indent=1)


main()
