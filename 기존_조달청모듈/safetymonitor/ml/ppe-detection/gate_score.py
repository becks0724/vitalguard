# PPE 가중치를 GATE_COUNTS 정본 자로 채점한다 — conf 스윕으로 내어 문턱 민감도를 함께 본다
# ★ 09-14 정정: 처음엔 「자에 conf 가 없어서」 스윕했으나, 그 뒤 [M/L] 이 키에 conf0.30·imgsz960 을 박았다.
#   스윕은 그대로 둔다 — 게이트 근처의 민감도(예: vest 가 FP 하나로 갈리는지)를 보려면 단일 값으로는 부족하다.
# ⚠ [M/L] 의 gate_score_xcheck.py 와 **일부러 합치지 않는다.** 오늘 imgsz 640/960 혼선이 두 도구를 맞대서야 닫혔다.
import sys, os, glob, json
from collections import defaultdict
from ultralytics import YOLO

NAMES = ["person","head","helmet","safety_vest","foot","shoes","hands","gloves"]
CID = {n:i for i,n in enumerate(NAMES)}
D = os.path.expanduser("~/Documents/조달청-공모전 관련자료")
W = sys.argv[1]
IMGSRC = sys.argv[2] if len(sys.argv) > 2 else "norm"
IMGSZ = int(sys.argv[3]) if len(sys.argv) > 3 else 640
CONFS = [0.001,0.05,0.25,0.30,0.35]

def load_lbl(p, wh):
    w,h = wh; out=[]
    if not os.path.exists(p): return out
    for ln in open(p):
        f = ln.split()
        if len(f) < 5: continue
        c=int(f[0]); cx,cy,bw,bh = [float(x) for x in f[1:5]]
        out.append((c, (cx-bw/2)*w, (cy-bh/2)*h, (cx+bw/2)*w, (cy+bh/2)*h))
    return out

def iou(a,b):
    x1,y1=max(a[0],b[0]),max(a[1],b[1]); x2,y2=min(a[2],b[2]),min(a[3],b[3])
    w,h=max(0,x2-x1),max(0,y2-y1); it=w*h
    ua=(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-it
    return it/ua if ua>0 else 0.0

def center_in(pred, gt):
    cx,cy=(pred[0]+pred[2])/2,(pred[1]+pred[3])/2
    return gt[0]<=cx<=gt[2] and gt[1]<=cy<=gt[3]

def score(pairs, cls, rule, conf):
    """pairs = [(preds, gts)] · preds=[(cls,conf,box)] gts=[(cls,box)]"""
    TP=FP=GT=0
    for preds,gts in pairs:
        g=[b for c,b in gts if c==cls]; GT+=len(g)
        p=sorted([(cf,b) for c,cf,b in preds if c==cls and cf>=conf], reverse=True, key=lambda x:x[0])
        used=[False]*len(g)
        for cf,pb in p:
            hit=-1
            for k,gb in enumerate(g):
                if used[k]: continue
                ok = center_in(pb,gb) if rule=="center" else iou(pb,gb)>=0.5
                if ok: hit=k; break
            if hit>=0: used[hit]=True; TP+=1
            else: FP+=1
    return TP,FP,GT

def run(name, img_paths, lbl_of, targets):
    m = YOLO(W)
    pairs=[]
    for ip in img_paths:
        r = m.predict(ip, imgsz=IMGSZ, conf=0.001, verbose=False)[0]
        W_,H_ = r.orig_shape[1], r.orig_shape[0]
        preds=[]
        if r.boxes is not None:
            for b,c,cf in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist(), r.boxes.conf.tolist()):
                preds.append((int(c), float(cf), b))
        gts=[(c,(x1,y1,x2,y2)) for c,x1,y1,x2,y2 in load_lbl(lbl_of(ip), (W_,H_))]
        pairs.append((preds,gts))
    print("\n=== %s · 이미지 %d장 ===" % (name, len(pairs)))
    for cls_name, rule, gate in targets:
        print("  [%s · %s]  게이트 %s" % (cls_name, "중심포함" if rule=="center" else "IoU0.5",
              ("TP>=%d FP<=%d / gt %d"%(gate[0],gate[1],gate[2])) if gate[0] else "회귀 감시(gt %d)"%gate[2]))
        print("    conf   TP    FP    GT   판정")
        for cf in CONFS:
            TP,FP,GT = score(pairs, CID[cls_name], rule, cf)
            if gate[0] is None: v="감시"
            else:
                bad=[]
                if TP<gate[0]: bad.append("TP%d<%d"%(TP,gate[0]))
                if FP>gate[1]: bad.append("FP%d>%d"%(FP,gate[1]))
                v="통과" if not bad else " · ".join(bad)
            print("    %.2f  %4d  %4d  %4d   %s" % (cf,TP,FP,GT,v))

F=os.path.join(D,"PHOTO-FIELD-20260910")
imgs=sorted(glob.glob(os.path.join(F,IMGSRC,"*.JPG")))
run("현장 35장 (%s)"%IMGSRC, imgs,
    lambda p: os.path.join(F,"labels",os.path.splitext(os.path.basename(p))[0]+".txt"),
    [("helmet","center",(94,2,100)), ("person","iou",(96,17,113)),
     ("safety_vest","iou",(69,5,100)), ("shoes","iou",(None,None,118))])
