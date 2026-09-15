# 현장 35장 게이트 채점의 **독립 교차검증본** — gate_score.py 와 따로 구현해 두 값이 맞는지 본다
#   09-14 신설. 같은 날 imgsz 640/960 혼선으로 person·vest 판정이 한 번 뒤집혔고, 두 도구를
#   맞대 보고서야 확정됐다. 그래서 일부러 합치지 않는다 — 합치면 교차검증이 사라진다.
#   통제군 = v5·pilot3 의 기록된 기준값 7개를 재현해야 도구를 믿는다.
#   자: helmet=중심포함 · 나머지=IoU0.5 · conf 0.30 · imgsz 960 · norm
import glob, os
from ultralytics import YOLO
F = os.path.expanduser("~/Documents/조달청-공모전 관련자료/PHOTO-FIELD-20260910")
W = os.path.expanduser("~/Documents/조달청-공모전 관련자료/YOLO ML DATA")
P = f"{W}/recall-plan-20260912"
IDX = {"person":0, "helmet":2, "safety_vest":3, "shoes":5}
GATE = {"helmet":(94,2,100), "person":(96,17,113), "safety_vest":(69,5,100), "shoes":(None,None,118)}
imgs = sorted(glob.glob(f"{F}/norm/*"))

def iou(a,b):
    ix=max(0,min(a[2],b[2])-max(a[0],b[0])); iy=max(0,min(a[3],b[3])-max(a[1],b[1])); i=ix*iy
    u=(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-i
    return i/u if u>0 else 0

def score(tag, weights, conf=0.30, imgsz=960):
    m = YOLO(weights); acc={k:[0,0,0] for k in IDX}          # TP, FP, gt
    for f in imgs:
        r = m.predict(f, imgsz=imgsz, conf=conf, iou=0.7, device="mps", verbose=False)[0]
        assert os.path.basename(r.path)==os.path.basename(f), "res.path 불일치"
        H_,W_ = r.orig_shape
        stem = os.path.splitext(os.path.basename(f))[0]
        gt={k:[] for k in IDX}
        for l in open(f"{F}/labels/{stem}.txt"):
            t=l.split()
            if not t: continue
            n=next((k for k,v in IDX.items() if v==int(t[0])), None)
            if not n: continue
            cx,cy,w,h=(float(x) for x in t[1:5])
            gt[n].append(((cx-w/2)*W_,(cy-h/2)*H_,(cx+w/2)*W_,(cy+h/2)*H_))
        for n in IDX: acc[n][2]+=len(gt[n])
        for n,ci in IDX.items():
            pr=sorted([(cf,b) for cf,cl,b in zip(r.boxes.conf.tolist(),r.boxes.cls.tolist(),r.boxes.xyxy.tolist())
                       if int(cl)==ci], key=lambda x:-x[0])
            used=set()
            for cf,b in pr:
                if n=="helmet":
                    mx,my=(b[0]+b[2])/2,(b[1]+b[3])/2
                    hit=next((i for i,g in enumerate(gt[n]) if i not in used and g[0]<=mx<=g[2] and g[1]<=my<=g[3]),None)
                else:
                    cands=[(iou(b,g),i) for i,g in enumerate(gt[n]) if i not in used]
                    cands=[c for c in cands if c[0]>=0.5]
                    hit=max(cands)[1] if cands else None
                if hit is None: acc[n][1]+=1
                else: used.add(hit); acc[n][0]+=1
    print(f"  {tag}")
    for n in ("helmet","person","safety_vest","shoes"):
        tp,fp,g=acc[n]; tmin,fmax,_=GATE[n]
        v="감시" if tmin is None else ("통과 ✅" if (tp>=tmin and fp<=fmax) else "실패 ⛔")
        need=("" if tmin is None else f"  게이트 {tmin}/FP{fmax}")
        print(f"     {n:<12} TP {tp:>3}/{g:<3} FP {fp:>3}   {v}{need}")

score("★통제군 v5   (기준값 person 89/FP15 · vest 69/FP5 · shoes 82)", f"{W}/ppe_yolo26s_640_v5_nc_best.pt")
score("★통제군 pilot3 (기준값 helmet 94/FP2 · person 96/FP17 · vest 69/FP2)", f"{P}/runs/pilot3_preserve/weights/best.pt")
score("v7a", f"{W}/ppe_yolo26s_640_v7a_nc.pt")
