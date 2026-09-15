# E63 「맨머리뿐」 라벨 사진에 착용 안전모가 있는지 감사한다 — 09-14 진단의 재현 코드
#   codex 2차 지적 ③ 반영: "60프레임=23장면" 이 서술로만 있고 재현 코드가 없었다.
#   seed 고정 · 장면 단위 집계 · 사람이 볼 크롭 저장까지 한 파일에서 끝낸다.
#   ⚠ 감사자(pilot3)는 정답이 아니다. 반드시 크롭을 눈으로 확인하고 그 수를 함께 적을 것.
import os, re, glob, random, collections, argparse
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--src", required=True, help="E63 해제 폴더 (images/train, labels/train 보유)")
ap.add_argument("--auditor", required=True, help="안전모를 볼 줄 아는 가중치 (예: pilot3 best.pt)")
ap.add_argument("--n", type=int, default=60)
ap.add_argument("--seed", type=int, default=0)
ap.add_argument("--conf", type=float, default=0.30)
ap.add_argument("--imgsz", type=int, default=960)
ap.add_argument("--out", default="e63_audit_crops.png")
a = ap.parse_args()

HEAD, HELMET = 1, 2
SEQ = re.compile(r'(.+_D\d{4}-\d{2}-\d{2}-\d{2}-\d{2}_\d+)_\d+$')
def seq_of(name):
    m = SEQ.match(os.path.splitext(name)[0])
    return m.group(1) if m else name

head_only = []
for lp in sorted(glob.glob(f"{a.src}/labels/train/*.txt")):
    cls = {int(l.split()[0]) for l in open(lp, errors="ignore")
           if l.split() and l.split()[0].isdigit()}
    if cls == {HEAD}: head_only.append(lp)
print(f"'head 만' 라벨 파일 {len(head_only):,}개")
random.seed(a.seed)
sel = random.sample(head_only, min(a.n, len(head_only)))

from ultralytics import YOLO
m = YOLO(a.auditor)
seqs = collections.Counter(seq_of(os.path.basename(p)) for p in sel)
pos_seq, crops, as_head, as_none = set(), [], 0, 0
for lp in sel:
    stem = os.path.splitext(os.path.basename(lp))[0]
    ip = next((f"{a.src}/images/train/{stem}{e}" for e in ('.jpg', '.jpeg', '.png')
               if os.path.exists(f"{a.src}/images/train/{stem}{e}")), None)
    if not ip: continue
    r = m.predict(ip, imgsz=a.imgsz, conf=a.conf, iou=0.7, device="mps", verbose=False)[0]
    assert os.path.basename(r.path) == os.path.basename(ip), "res.path 불일치"
    hel = [(cf, b) for cf, cl, b in zip(r.boxes.conf.tolist(), r.boxes.cls.tolist(),
                                        r.boxes.xyxy.tolist()) if int(cl) == HELMET]
    if not hel: continue
    pos_seq.add(seq_of(os.path.basename(ip)))
    W, H = Image.open(ip).size
    gt = []
    for l in open(lp, errors="ignore"):
        p = l.split()
        if len(p) >= 5 and int(p[0]) == HEAD:
            cx, cy, w, h = (float(x) for x in p[1:5])
            gt.append(((cx-w/2)*W, (cy-h/2)*H, (cx+w/2)*W, (cy+h/2)*H))
    for cf, b in hel:
        mx, my = (b[0]+b[2])/2, (b[1]+b[3])/2
        if any(g[0] <= mx <= g[2] and g[1] <= my <= g[3] for g in gt): as_head += 1
        else: as_none += 1
        crops.append((cf, ip, b))

n_pos_img = len({c[1] for c in crops})
print(f"\n표본 {len(sel)}장 → 서로 다른 장면 {len(seqs)}개   (seed {a.seed})")
print(f"안전모가 보인 사진 {n_pos_img}장 → 장면 {len(pos_seq)}개")
print(f"  장면 단위 {len(pos_seq)}/{len(seqs)} = {len(pos_seq)/len(seqs)*100:.0f}%"
      f"  ·  프레임 단위 {n_pos_img}/{len(sel)} = {n_pos_img/len(sel)*100:.0f}%")
tot = as_head + as_none
print(f"\n착용 안전모로 보이는 자리 {tot}개의 E63 라벨")
print(f"  'head'(맨머리)로 부름  {as_head:>3}  ({as_head/max(tot,1)*100:.0f}%)")
print(f"  아무것도 없음          {as_none:>3}  ({as_none/max(tot,1)*100:.0f}%)")

crops.sort(reverse=True, key=lambda x: x[0])
COLS, N, SZ = 6, 12, 200
sheet = Image.new("RGB", (COLS*SZ, -(-min(N, len(crops))//COLS)*SZ), (20, 20, 24))
for i, (cf, f, b) in enumerate(crops[:N]):
    im = Image.open(f); W, H = im.size; pad = (b[2]-b[0]) * 1.1
    box = (max(0, b[0]-pad), max(0, b[1]-pad), min(W, b[2]+pad), min(H, b[3]+pad))
    sheet.paste(im.crop(box).resize((SZ, SZ)), ((i % COLS)*SZ, (i//COLS)*SZ))
sheet.save(a.out)
print(f"\n★ 크롭 {min(N,len(crops))}장 → {a.out}  — 눈으로 확인하고 진짜 안전모 수를 기록할 것")
