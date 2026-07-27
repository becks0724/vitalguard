#!/usr/bin/env python3
# 낙상 감지 임계 최적화(트랙 A) — fall-export CSV 로 현재 규칙 기준선 산출 + 임계 그리드 탐색 + PR 곡선
#
# 입력  = 관리자 메뉴 → 낙상 ML → "ML CSV 다운로드" 로 받은 fall-export CSV.
# 출력  = (1) 현재 규칙 혼동행렬(기준선) (2) 비용최소 임계 조합 (3) 교차검증 (4) PR 곡선 PNG
#         (5) FallDetector.swift 에 넣을 권장 상수.
#
# 설계 — 무거운 라이브러리(pandas/sklearn/matplotlib)는 "지연 import + 선택적".
#   · 핵심 결정 로직(predict_one/cost/metrics)은 stdlib 만 → `--selftest` 로 설치 없이 검증.
#   · 그리드 탐색/데이터 적재 = pandas 필요. PR 곡선 = sklearn+matplotlib(없으면 우아하게 생략).
#
# 한계(데이터 생성 구조상) — 반드시 인지:
#   · 모든 후보는 충격 ≥ 2.8G(워치 게이트) → 충격 임계는 "올릴" 수만 있고 안전하게 "내릴" 순 없음.
#   · 자유낙하 임계(freefallG)·정지 밴드(stillBandG)·postWindow 는 워치에서 집계에 이미 반영돼
#     집계 feature 만 남으므로 본 CSV 로는 재튜닝 불가(원시 모션 윈도 수집 시 가능).
#   · 따라서 재최적화 가능 임계 = impact_g_min(≥2.8) · still_sec_min · rot_min(코로보레이션).

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass

# ── 핵심 결정 로직 (stdlib only — predict_one / cost / metrics) ─────────────────

FEATURES = ["accel_magnitude_g", "motion_still_sec", "freefall_preceded", "peak_rotation_rad_s"]

# FallDetector.swift 의 현재 상수(기준선).
DEFAULT_IMPACT_G = 2.8
DEFAULT_STILL_SEC = 1.2
DEFAULT_ROT_RAD_S = 6.0


@dataclass(frozen=True)
class Params:
    impact_g_min: float
    still_sec_min: float
    rot_min: float


def _num(v):
    """None/NaN/빈값을 None 으로 정규화(stdlib·pandas 양쪽 입력 대비)."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f:  # NaN
        return None
    return f


def predict_one(row: dict, p: Params) -> bool:
    """후보 1건에 대한 낙상 판정 — FallDetector 의 최종 결정 규칙을 그대로 복제.
    충격 게이트 ∧ 정지 충족 ∧ (자유낙하 전조 ∨ 강회전 코로보레이션)."""
    g = _num(row.get("accel_magnitude_g"))
    still = _num(row.get("motion_still_sec"))
    if g is None or g < p.impact_g_min:
        return False
    if still is None or still < p.still_sec_min:
        return False
    ff = _num(row.get("freefall_preceded"))
    rot = _num(row.get("peak_rotation_rad_s"))
    corroborated = (ff == 1.0) or (rot is not None and rot >= p.rot_min)
    return bool(corroborated)


def count_confusion(rows: list[dict], labels: list[int], p: Params) -> tuple[int, int, int, int]:
    """(tp, fp, fn, tn) — labels: 1=true_fall, 0=false_positive."""
    tp = fp = fn = tn = 0
    for row, y in zip(rows, labels):
        pred = predict_one(row, p)
        if y == 1 and pred:
            tp += 1
        elif y == 1 and not pred:
            fn += 1
        elif y == 0 and pred:
            fp += 1
        else:
            tn += 1
    return tp, fp, fn, tn


def metrics_from_counts(tp: int, fp: int, fn: int, tn: int) -> dict:
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0  # 민감도 — 놓친 낙상의 반대
    fpr = fp / (fp + tn) if (fp + tn) else 0.0  # 오탐율
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return {"precision": precision, "recall": recall, "fpr": fpr, "f1": f1,
            "tp": tp, "fp": fp, "fn": fn, "tn": tn}


def cost(fn: int, fp: int, w_fn: float, w_fp: float) -> float:
    """비용 = 놓친 낙상(FN) 가중 + 오탐(FP) 가중. 산업안전상 w_fn ≫ w_fp."""
    return w_fn * fn + w_fp * fp


def frange(start: float, stop: float, step: float) -> list[float]:
    out, v = [], start
    while v <= stop + 1e-9:
        out.append(round(v, 4))
        v += step
    return out


# ── self-test (stdlib only — 설치 없이 결정 로직 검증) ──────────────────────────

def run_selftest() -> int:
    base = Params(DEFAULT_IMPACT_G, DEFAULT_STILL_SEC, DEFAULT_ROT_RAD_S)
    cases = [
        # (row, params, expect, 설명)
        ({"accel_magnitude_g": 4.0, "motion_still_sec": 1.5, "freefall_preceded": 1, "peak_rotation_rad_s": 3.0},
         base, True, "자유낙하 전조 → 발화"),
        ({"accel_magnitude_g": 3.5, "motion_still_sec": 1.5, "freefall_preceded": 0, "peak_rotation_rad_s": 8.0},
         base, True, "강회전 코로보레이션 → 발화"),
        ({"accel_magnitude_g": 3.2, "motion_still_sec": 1.5, "freefall_preceded": 0, "peak_rotation_rad_s": 2.0},
         base, False, "전조·회전 모두 없음 → 미발화(오탐 차단)"),
        ({"accel_magnitude_g": 3.0, "motion_still_sec": 0.5, "freefall_preceded": 1, "peak_rotation_rad_s": 9.0},
         base, False, "정지 미충족 → 미발화"),
        ({"accel_magnitude_g": 2.5, "motion_still_sec": 2.0, "freefall_preceded": 1, "peak_rotation_rad_s": 9.0},
         base, False, "충격 게이트 미만 → 미발화"),
        # 임계 변경 효과 — 회전 임계를 5.0 으로 낮추면 위 case3 이 발화로 바뀜.
        ({"accel_magnitude_g": 3.2, "motion_still_sec": 1.5, "freefall_preceded": 0, "peak_rotation_rad_s": 5.5},
         Params(2.8, 1.2, 5.0), True, "회전 임계 5.0 → 발화(임계 효과)"),
    ]
    ok = True
    for row, p, expect, desc in cases:
        got = predict_one(row, p)
        flag = "PASS" if got == expect else "FAIL"
        if got != expect:
            ok = False
        print(f"  {flag}  {desc} — expect={expect} got={got}")
    # 지표/비용 산식 검증.
    m = metrics_from_counts(tp=8, fp=2, fn=2, tn=88)
    assert abs(m["recall"] - 0.8) < 1e-9, m
    assert abs(m["fpr"] - 0.0222) < 1e-3, m
    assert cost(fn=2, fp=2, w_fn=10, w_fp=1) == 22, "cost 산식"
    print("  PASS  metrics/cost 산식")
    print("SELFTEST", "ALL PASS" if ok else "FAILED")
    return 0 if ok else 1


# ── 데이터 적재/생성 (pandas 필요 — 지연 import) ──────────────────────────────

def load_csv(path: str):
    import pandas as pd
    df = pd.read_csv(path)
    for col in FEATURES:
        if col not in df.columns:
            df[col] = None
    return df


def make_demo(n: int = 400):
    """파이프라인 검증용 합성 라벨 데이터 — 실데이터 아님(분포는 임의 가정)."""
    import numpy as np
    import pandas as pd
    rng = np.random.default_rng(20260605)
    half = n // 2
    # 양성(실제 낙상): 자유낙하 잦고, 회전 크고, 정지 길게.
    pos = pd.DataFrame({
        "accel_magnitude_g": rng.normal(4.2, 0.8, half).clip(2.8, 12),
        "motion_still_sec": rng.normal(1.6, 0.4, half).clip(0, 4),
        "freefall_preceded": (rng.random(half) < 0.7).astype(int),
        "peak_rotation_rad_s": rng.normal(7.5, 2.5, half).clip(0, 20),
        "ground_truth_label": "true_fall",
        "worker_id": rng.choice(["W1", "W2", "W3", "W4"], half),
    })
    # 음성(작업 충격): 자유낙하 드물고, 회전 작고, 정지 짧거나 없음.
    neg = pd.DataFrame({
        "accel_magnitude_g": rng.normal(3.4, 0.6, half).clip(2.8, 10),
        "motion_still_sec": rng.normal(0.9, 0.5, half).clip(0, 4),
        "freefall_preceded": (rng.random(half) < 0.1).astype(int),
        "peak_rotation_rad_s": rng.normal(2.5, 1.5, half).clip(0, 14),
        "ground_truth_label": "false_positive",
        "worker_id": rng.choice(["W1", "W2", "W3", "W4"], half),
    })
    df = pd.concat([pos, neg], ignore_index=True)
    # 라벨 노이즈 5% — 실 라벨링 오류 모사(정확도 천장).
    flip = rng.random(len(df)) < 0.05
    df.loc[flip, "ground_truth_label"] = df.loc[flip, "ground_truth_label"].map(
        {"true_fall": "false_positive", "false_positive": "true_fall"})
    df["fall_detected"] = None
    return df.sample(frac=1, random_state=1).reset_index(drop=True)


def prepare(df):
    """라벨링·feature 완전성 기준으로 분류하고, 재최적화 가능한 부분집합을 반환."""
    import pandas as pd
    labeled = df[df["ground_truth_label"].isin(["true_fall", "false_positive"])].copy()
    complete = labeled.dropna(subset=FEATURES).copy()
    summary = {
        "total": len(df),
        "labeled": len(labeled),
        "unsure_or_unlabeled": len(df) - len(labeled),
        "complete_feature": len(complete),
        "feature_incomplete_legacy": len(labeled) - len(complete),
    }
    complete["_y"] = (complete["ground_truth_label"] == "true_fall").astype(int)
    return complete, summary


def rows_and_labels(df):
    rows = df[FEATURES].to_dict("records")
    labels = df["_y"].tolist()
    return rows, labels


# ── 기준선 / 그리드 탐색 ──────────────────────────────────────────────────────

def report_baseline(rows, labels) -> dict:
    p = Params(DEFAULT_IMPACT_G, DEFAULT_STILL_SEC, DEFAULT_ROT_RAD_S)
    m = metrics_from_counts(*count_confusion(rows, labels, p))
    print("\n[기준선] 현재 FallDetector 임계 "
          f"(impact={p.impact_g_min} still={p.still_sec_min} rot={p.rot_min})")
    print(f"  recall(민감도)={m['recall']:.3f}  fpr(오탐율)={m['fpr']:.3f}  "
          f"precision={m['precision']:.3f}  f1={m['f1']:.3f}")
    print(f"  TP={m['tp']} FP={m['fp']} FN(놓친낙상)={m['fn']} TN={m['tn']}")
    return {"params": p.__dict__, "metrics": m}


def grid_search(rows, labels, w_fn: float, w_fp: float, fpr_cap: float | None,
                impact_grid_min: float = 2.8, still_grid_min: float = 0.6) -> dict:
    # 하한 기본값 = 기존 동작 유지(라이브 후보 CSV 는 2.8 게이트 조건부 수집이라 그 미만 탐색 불가).
    # 원시 파형 소스(imu_collect.imu_window)의 임계-독립 피처면 하한을 낮춰 게이트 자체를 탐색한다.
    grid_impact = frange(impact_grid_min, 4.0, 0.2)
    grid_still = frange(still_grid_min, 2.0, 0.1)
    grid_rot = frange(3.0, 10.0, 0.5)
    best = None
    evaluated = 0
    for gi in grid_impact:
        for gs in grid_still:
            for gr in grid_rot:
                p = Params(gi, gs, gr)
                tp, fp, fn, tn = count_confusion(rows, labels, p)
                m = metrics_from_counts(tp, fp, fn, tn)
                evaluated += 1
                if fpr_cap is not None and m["fpr"] > fpr_cap:
                    continue
                c = cost(fn, fp, w_fn, w_fp)
                key = (c, -m["recall"])  # 비용 최소 → 동률 시 recall 높은 쪽
                if best is None or key < best["key"]:
                    best = {"key": key, "params": p, "metrics": m, "cost": c}
    print(f"\n[그리드 탐색] 조합 {evaluated}개 평가 "
          f"(w_fn={w_fn} w_fp={w_fp} fpr_cap={fpr_cap})")
    if best is None:
        print("  → fpr_cap 을 만족하는 조합 없음. cap 완화 필요.")
        return {}
    p, m = best["params"], best["metrics"]
    print(f"  최적 임계: impact={p.impact_g_min}  still={p.still_sec_min}  rot={p.rot_min}")
    print(f"  recall={m['recall']:.3f}  fpr={m['fpr']:.3f}  precision={m['precision']:.3f}  "
          f"f1={m['f1']:.3f}  cost={best['cost']:.1f}")
    print(f"  TP={m['tp']} FP={m['fp']} FN(놓친낙상)={m['fn']} TN={m['tn']}")
    return {"params": p.__dict__, "metrics": m, "cost": best["cost"]}


def cross_validate(df, best_params: dict, w_fn: float, w_fp: float) -> None:
    """작업자 단위 GroupKFold — 최적 임계가 작업자 간 일반화되는지 점검(누수 방지)."""
    try:
        from sklearn.model_selection import GroupKFold
    except ImportError:
        print("\n[교차검증] sklearn 미설치 → 생략 (requirements.txt 설치 시 활성)")
        return
    if "worker_id" not in df.columns or df["worker_id"].nunique() < 2:
        print("\n[교차검증] 작업자 그룹 부족 → 생략")
        return
    p = Params(**best_params)
    n_splits = min(5, df["worker_id"].nunique())
    gkf = GroupKFold(n_splits=n_splits)
    recalls, fprs = [], []
    idx = list(range(len(df)))
    rows_all = df[FEATURES].to_dict("records")
    labels_all = df["_y"].tolist()
    groups = df["worker_id"].tolist()
    for _, test_idx in gkf.split(idx, labels_all, groups):
        r = [rows_all[i] for i in test_idx]
        y = [labels_all[i] for i in test_idx]
        m = metrics_from_counts(*count_confusion(r, y, p))
        recalls.append(m["recall"]); fprs.append(m["fpr"])
    import statistics as st
    print(f"\n[교차검증] 작업자 {n_splits}-fold (최적 임계 일반화 점검)")
    print(f"  recall 평균={st.mean(recalls):.3f} (±{st.pstdev(recalls):.3f})  "
          f"fpr 평균={st.mean(fprs):.3f} (±{st.pstdev(fprs):.3f})")


# ── PR 곡선 (sklearn + matplotlib 선택) ───────────────────────────────────────

def pr_curve(df, baseline: dict, best: dict, out_dir: str) -> None:
    try:
        import numpy as np
        from sklearn.linear_model import LogisticRegression
        from sklearn.metrics import average_precision_score, precision_recall_curve
    except ImportError:
        print("\n[PR곡선] sklearn 미설치 → 생략")
        return
    X = df[FEATURES].fillna(0.0).to_numpy(dtype=float)
    y = df["_y"].to_numpy(dtype=int)
    if len(set(y.tolist())) < 2:
        print("\n[PR곡선] 단일 클래스 → 생략(양성/음성 둘 다 필요)")
        return
    # 트랙 B 미리보기 — 연속 점수로 매끈한 PR 곡선을 얻기 위한 로지스틱(해석용 비교).
    clf = LogisticRegression(class_weight="balanced", max_iter=1000).fit(X, y)
    scores = clf.predict_proba(X)[:, 1]
    ap = average_precision_score(y, scores)
    prec, rec, _ = precision_recall_curve(y, scores)
    print(f"\n[PR곡선] 로지스틱(트랙B 미리보기) average_precision={ap:.3f}")
    print("  계수:", {f: round(c, 3) for f, c in zip(FEATURES, clf.coef_[0])})
    try:
        import os
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        os.makedirs(out_dir, exist_ok=True)
        plt.figure(figsize=(5, 4))
        # 라벨은 ASCII — matplotlib 기본 폰트에 한글이 없어 PNG 에서 깨짐(tofu) 방지.
        plt.plot(rec, prec, label=f"logistic AP={ap:.3f}")
        # 규칙 운영점(기준선·최적)을 PR 평면에 점으로.
        for name, d, mk in [("baseline", baseline, "o"), ("optimized", best, "*")]:
            m = d.get("metrics")
            if m:
                plt.scatter([m["recall"]], [m["precision"]], marker=mk, s=120, label=name, zorder=5)
        plt.xlabel("Recall"); plt.ylabel("Precision")
        plt.title("Fall Detection PR Curve"); plt.legend(); plt.grid(alpha=0.3)
        plt.xlim(0, 1.02); plt.ylim(0, 1.02); plt.tight_layout()
        out = os.path.join(out_dir, "pr_curve.png")
        plt.savefig(out, dpi=130)
        print(f"  저장: {out}")
    except ImportError:
        print("  matplotlib 미설치 → PNG 생략(수치만 출력)")


# ── 메인 ──────────────────────────────────────────────────────────────────────

def print_swift_recommendation(best: dict) -> None:
    if not best:
        return
    p = best["params"]
    print("\n[FallDetector.swift 권장 상수] — 검증 후 shadow 모드 비교 권장")
    print(f"  private let impactThresholdG = {p['impact_g_min']}       // (현재 2.8)")
    print(f"  private let stillRequiredSec = {p['still_sec_min']}       // (현재 1.2)")
    print(f"  private let tumbleRotThresholdRadS = {p['rot_min']}   // (현재 6.0)")
    print("  ※ freefallG/stillBandG/postWindowSec 는 본 데이터로 재튜닝 불가(원시 모션 윈도 필요).")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="낙상 감지 임계 최적화(트랙 A)")
    ap.add_argument("--csv", help="fall-export CSV 경로")
    ap.add_argument("--demo", action="store_true", help="합성 데이터로 파이프라인 검증(실데이터 아님)")
    ap.add_argument("--selftest", action="store_true", help="결정 로직 단위검증(설치 불필요)")
    ap.add_argument("--w-fn", type=float, default=10.0, help="놓친 낙상(FN) 비용 가중 (기본 10)")
    ap.add_argument("--w-fp", type=float, default=1.0, help="오탐(FP) 비용 가중 (기본 1)")
    ap.add_argument("--fpr-cap", type=float, default=None, help="오탐율 상한(예: 0.1)")
    ap.add_argument("--impact-grid-min", type=float, default=2.8,
                    help="충격 임계 그리드 하한 (기본 2.8 = 기존 동작. 원시 파형 피처면 낮춰 게이트 탐색)")
    ap.add_argument("--still-grid-min", type=float, default=0.6,
                    help="정지 임계 그리드 하한 (기본 0.6. 짧은 윈도 데이터면 0.0 으로 절단 대응)")
    ap.add_argument("--out-dir", default="./out", help="PR곡선/결과 저장 폴더")
    ap.add_argument("--no-plot", action="store_true", help="PR곡선 PNG 생략")
    args = ap.parse_args(argv)

    if args.selftest:
        return run_selftest()

    try:
        if args.demo:
            df = make_demo()
            print("⚠️  DEMO 모드 — 합성 데이터(실측 아님). 파이프라인 검증 전용.")
        elif args.csv:
            df = load_csv(args.csv)
        else:
            print("입력이 없습니다. --csv <경로> 또는 --demo 또는 --selftest 를 쓰세요.", file=sys.stderr)
            return 2
    except ImportError:
        print("pandas/numpy 미설치 — `pip install -r requirements.txt` 후 재실행하세요.\n"
              "(설치 없이 결정 로직만 보려면 `--selftest`)", file=sys.stderr)
        return 3

    complete, summary = prepare(df)
    print("\n[데이터 요약]")
    for k, v in summary.items():
        print(f"  {k}: {v}")

    if summary["complete_feature"] == 0:
        print("\n⚠️  재최적화 가능한 라벨·완전-feature 후보가 0건입니다.\n"
              "    → 워치 재설치 후 실데이터 누적 + 관리자 메뉴에서 라벨링이 선행되어야 합니다.\n"
              "    파이프라인 동작만 확인하려면 `--demo` 로 실행하세요.")
        return 0
    pos = int(complete["_y"].sum()); neg = int(len(complete) - pos)
    print(f"  → 분석 대상(완전-feature·라벨): 양성 {pos} · 음성 {neg}")
    if pos < 10 or neg < 10:
        print("  ※ 표본이 매우 적습니다(권장: 클래스별 수십+). 결과는 잠정으로만 해석하세요.")

    rows, labels = rows_and_labels(complete)
    baseline = report_baseline(rows, labels)
    best = grid_search(rows, labels, args.w_fn, args.w_fp, args.fpr_cap,
                       args.impact_grid_min, args.still_grid_min)
    if best:
        cross_validate(complete, best["params"], args.w_fn, args.w_fp)
        if not args.no_plot:
            pr_curve(complete, baseline, best, args.out_dir)
        print_swift_recommendation(best)
        # 결과 JSON 저장.
        try:
            import os
            os.makedirs(args.out_dir, exist_ok=True)
            with open(os.path.join(args.out_dir, "best_thresholds.json"), "w") as f:
                json.dump({"baseline": baseline, "best": best,
                           "weights": {"w_fn": args.w_fn, "w_fp": args.w_fp},
                           "data_summary": summary}, f, ensure_ascii=False, indent=2)
            print(f"\n결과 저장: {os.path.join(args.out_dir, 'best_thresholds.json')}")
        except OSError as e:
            print(f"결과 저장 실패: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
