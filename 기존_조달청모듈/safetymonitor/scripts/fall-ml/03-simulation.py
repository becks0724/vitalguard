#!/usr/bin/env python3
# 계획 완성 시점 시뮬레이션 — 3층 구조(게이트→회전 3분류→회복 승격)를 합성 이벤트로 돌려
# 계획 지표(낙상 재현율·작업자-일당 오탐)를 현행 근사와 비교한다. 표준 라이브러리만 사용.
#
# ⚠ 이것은 "가정 기반" 시뮬레이션이다. 회전 분포는 문헌·물리 추정이지 실측이 아니며,
#   실제 판정은 P1 수집 + P2 산점도가 한다. 여기서는 (A) 분리가 문헌대로일 때 기대 성능과
#   (B) 분리가 나쁠 때 P2 게이트가 계획을 중단시키는지(계획의 안전장치)를 본다.
import random
import statistics

random.seed(42)

# ── 이벤트 생성 모델 ─────────────────────────────────────────────
# 클래스별 (accelG, 회전 rad/s, 자유낙하 확률, 정지초) 분포. lognormal(중앙값, sigma).
def lognorm(median, sigma):
    return median * pow(2.718281828, random.gauss(0, sigma))

SCEN = {
    # A: 문헌·물리 추정 — 망치질은 손목 국소 스윙(회전 중앙 3), 넘어짐은 몸통 회전(중앙 15)
    "A(낙관·문헌 분리)": dict(work_rot=3.0, trip_rot=15.0, fall_rot=20.0),
    # B: 비관 — 망치질 손목 회전이 예상보다 커서(중앙 8) 넘어짐(중앙 13)과 겹침
    "B(비관·겹침)": dict(work_rot=8.0, trip_rot=13.0, fall_rot=18.0),
}

def gen_event(cls, p, subj_mult):
    if cls == "work":
        acc = lognorm(4.5, 0.45)
        rot = lognorm(p["work_rot"], 0.5) * subj_mult
        ff = random.random() < 0.05           # 점프 등 드묾
        still = lognorm(0.5, 0.6)             # 계속 움직임
    elif cls == "trip":
        acc = lognorm(4.0, 0.45)              # ★ G는 망치질과 비슷 — G만으론 못 가름
        rot = lognorm(p["trip_rot"], 0.4) * subj_mult
        ff = random.random() < 0.35
        still = lognorm(5, 0.5)
    else:  # fall(추락)
        acc = lognorm(8.0, 0.4)
        rot = lognorm(p["fall_rot"], 0.4) * subj_mult
        ff = random.random() < 0.9
        still = lognorm(8, 0.5)
    return dict(cls=cls, acc=min(acc, 20), rot=rot, ff=ff, still=still)

def gen_subject(p, n_work=200, n_trip=60, n_fall=30):
    m = pow(2.718281828, random.gauss(0, 0.12))   # 작업자별 회전 배율(개인차)
    ev = [gen_event("work", p, m) for _ in range(n_work)]
    ev += [gen_event("trip", p, m) for _ in range(n_trip)]
    ev += [gen_event("fall", p, m) for _ in range(n_fall)]
    return ev

# ── 판정기 ──────────────────────────────────────────────────────
GATE_G = 2.8   # 층1: 고G·자유낙하 게이트(기존 v4 근사)

def gate(e):
    return e["acc"] >= GATE_G or e["ff"]

def baseline_is_fall(e):
    # 현행 근사: 회전 없이 G·자유낙하만 — "가중치가 안 잡힌" 이진 모델의 실효 거동
    return e["acc"] >= 5.0 or (e["ff"] and e["acc"] >= 3.5)

def learn_rot_thr(train):
    # 층2 학습: work vs (trip+fall) 회전 단일 임계 최적화(규칙 기반 최소판)
    neg = sorted(e["rot"] for e in train if e["cls"] == "work")
    pos = sorted(e["rot"] for e in train if e["cls"] != "work")
    cands = sorted(set(neg + pos))
    best_thr, best_acc = 0, 0
    for thr in cands[:: max(1, len(cands) // 200)]:
        ok = sum(1 for v in neg if v < thr) + sum(1 for v in pos if v >= thr)
        acc = ok / (len(neg) + len(pos))
        if acc > best_acc:
            best_thr, best_acc = thr, acc
    return best_thr, best_acc

def layered_classify(e, rot_thr):
    if not gate(e):
        return "none"
    if e["rot"] < rot_thr:
        return "work"
    return "fall" if (e["ff"] or e["acc"] >= 10) else "trip"

# ── 평가 (subject-disjoint LOSO 교차검증) ───────────────────────
def evaluate(scen_name, p, n_subjects=5):
    subs = [gen_subject(p) for _ in range(n_subjects)]
    res = dict(base_far=[], base_rec_trip=[], base_rec_fall=[],
               new_far=[], new_rec_trip=[], new_rec_fall=[], thr_acc=[])
    for i in range(n_subjects):
        train = [e for j, s in enumerate(subs) if j != i for e in s if gate(e)]
        test = [e for e in subs[i] if gate(e)]
        thr, acc = learn_rot_thr(train)
        res["thr_acc"].append(acc)
        w = [e for e in test if e["cls"] == "work"]
        t = [e for e in test if e["cls"] == "trip"]
        f = [e for e in test if e["cls"] == "fall"]
        # 현행: 낙상 이진
        res["base_far"].append(sum(1 for e in w if baseline_is_fall(e)) / len(w))
        res["base_rec_trip"].append(sum(1 for e in t if baseline_is_fall(e)) / len(t))
        res["base_rec_fall"].append(sum(1 for e in f if baseline_is_fall(e)) / len(f))
        # 3층: trip/fall 로 분류되면 경보
        res["new_far"].append(sum(1 for e in w if layered_classify(e, thr) != "work") / len(w))
        res["new_rec_trip"].append(sum(1 for e in t if layered_classify(e, thr) in ("trip", "fall")) / len(t))
        res["new_rec_fall"].append(sum(1 for e in f if layered_classify(e, thr) in ("trip", "fall")) / len(f))
    return {k: statistics.mean(v) for k, v in res.items()}

# ── P2 파일럿 게이트 통과 확률(2명×20+20, 500회 반복) ────────────
def pilot_pass_prob(p, trials=500):
    passed = 0
    for _ in range(trials):
        ev = []
        for _ in range(2):
            m = pow(2.718281828, random.gauss(0, 0.12))
            ev += [gen_event("work", p, m) for _ in range(20)]
            ev += [gen_event("trip", p, m) for _ in range(20)]
        _, acc = learn_rot_thr(ev)
        if acc >= 0.85:
            passed += 1
    return passed / trials

# ── 층3: 쓰러짐 승격(정지 30초 임계) ────────────────────────────
def layer3_eval(trials=4000):
    ok = 0
    for _ in range(trials):
        collapsed = random.random() < 0.33
        still = lognorm(90, 0.5) if collapsed else lognorm(6, 0.6)
        if (still >= 30) == collapsed:
            ok += 1
    return ok / trials

# ── 실행 ────────────────────────────────────────────────────────
WORK_PER_DAY = 60   # 작업자-일당 게이트 통과 작업충격 수(목수 가정 — 파라미터)

print("=" * 74)
print("낙상 ML 3층 구조 — 완성 시점 시뮬레이션 (합성 데이터·가정 명시)")
print(f"가정: 작업자-일당 게이트 통과 작업충격 {WORK_PER_DAY}건, 작업자 5명 LOSO 교차검증")
print("=" * 74)
for name, p in SCEN.items():
    r = evaluate(name, p)
    pp = pilot_pass_prob(p)
    print(f"\n■ 시나리오 {name}  — work 회전중앙 {p['work_rot']} vs trip {p['trip_rot']} rad/s")
    print(f"  P2 파일럿(2명×20+20) 게이트[임계정확도≥85%] 통과 확률: {pp*100:.0f}%")
    print(f"  회전 임계 학습 정확도(LOSO 평균): {r['thr_acc']*100:.1f}%")
    print(f"  {'지표':<26}{'현행(G 이진 근사)':>18}{'3층(회전 3분류)':>16}")
    print(f"  {'오탐(작업충격→낙상경보)':<24}{r['base_far']*100:>16.1f}%{r['new_far']*100:>15.1f}%")
    print(f"  {'  = 작업자-일당 오경보':<24}{r['base_far']*WORK_PER_DAY:>15.1f}건{r['new_far']*WORK_PER_DAY:>14.1f}건")
    print(f"  {'넘어짐 재현율':<26}{r['base_rec_trip']*100:>16.1f}%{r['new_rec_trip']*100:>15.1f}%")
    print(f"  {'추락 재현율':<27}{r['base_rec_fall']*100:>16.1f}%{r['new_rec_fall']*100:>15.1f}%")

l3 = layer3_eval()
print(f"\n■ 층3 쓰러짐 승격(정지 30초 임계, 쓰러짐 1/3 가정): 정확도 {l3*100:.1f}%")
print("\n⚠ 주의: 회전 분포는 가정이다. 실제 성능은 P1 수집 + P2 산점도가 판정한다.")
print("   시나리오 B에서 P2 통과 확률이 낮게 나오는 것 = 계획의 게이트가 의도대로 작동한다는 뜻.")
