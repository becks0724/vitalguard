# 조끼 200장 측정 CSV를 비교하는 도구.
import argparse
import csv
import json
import math
import statistics
import sys
from collections import Counter


REQUIRED = {"dir", "file", "sha16", "vest_n", "vest_max", "person_n", "person_max", "in_h", "in_w", "run_label"}


def read_csv(path):
    try:
        with open(path, encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            if reader.fieldnames is None or not REQUIRED.issubset(reader.fieldnames):
                raise ValueError("필요 열 누락")
            rows = {}
            for raw in reader:
                key = (raw["dir"], raw["file"])
                if key in rows:
                    raise ValueError("중복 키 " + "/".join(key))
                rows[key] = {
                    "sha16": raw["sha16"], "vest_n": int(raw["vest_n"]), "vest_max": float(raw["vest_max"]),
                    "person_n": int(raw["person_n"]), "person_max": float(raw["person_max"]),
                    "in_h": int(raw["in_h"]), "in_w": int(raw["in_w"]),
                }
            return rows
    except Exception as exc:
        raise ValueError(path + ": " + str(exc))


def mcnemar_exact(a_only, b_only):
    n = a_only + b_only
    if n == 0:
        return 1.0
    tail = sum(math.comb(n, k) for k in range(min(a_only, b_only) + 1)) / (2 ** n)
    return min(1.0, 2.0 * tail)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--a", required=True)
    p.add_argument("--b", required=True)
    p.add_argument("--b2")
    p.add_argument("--json-out")
    args = p.parse_args()
    try:
        a, b = read_csv(args.a), read_csv(args.b)
        if set(a) != set(b):
            raise ValueError("a/b 키 집합 불일치")
        for key in a:
            if a[key]["sha16"] != b[key]["sha16"]:
                raise ValueError("sha16 불일치 " + "/".join(key))
        b2 = read_csv(args.b2) if args.b2 else None
        if b2 is not None:
            for key, row in b2.items():
                if key not in b or row["sha16"] != b[key]["sha16"]:
                    raise ValueError("b2 키 또는 sha16 불일치 " + "/".join(key))
    except ValueError as exc:
        print("비교 오류:", exc, file=sys.stderr)
        return 2

    both = neither = a_only = b_only = 0
    mismatches, diffs = [], []
    dirs = sorted({key[0] for key in a})
    per_dir = {dirname: {"a_vest": 0, "b_vest": 0, "a_person": 0, "b_person": 0} for dirname in dirs}
    shapes_a, shapes_b = set(), set()
    near_a = near_b = 0
    for key in sorted(a):
        ar, br = a[key], b[key]
        av, bv = ar["vest_n"] > 0, br["vest_n"] > 0
        if av and bv:
            both += 1
            diffs.append(abs(ar["vest_max"] - br["vest_max"]))
        elif not av and not bv:
            neither += 1
        elif av:
            a_only += 1
            mismatches.append({"dir": key[0], "file": key[1], "a_vest_max": ar["vest_max"], "b_vest_max": br["vest_max"]})
        else:
            b_only += 1
            mismatches.append({"dir": key[0], "file": key[1], "a_vest_max": ar["vest_max"], "b_vest_max": br["vest_max"]})
        per_dir[key[0]]["a_vest"] += av
        per_dir[key[0]]["b_vest"] += bv
        per_dir[key[0]]["a_person"] += ar["person_n"] > 0
        per_dir[key[0]]["b_person"] += br["person_n"] > 0
        shapes_a.add((ar["in_h"], ar["in_w"]))
        shapes_b.add((br["in_h"], br["in_w"]))
        near_a += 0.25 <= ar["vest_max"] <= 0.35
        near_b += 0.25 <= br["vest_max"] <= 0.35
    b2_result = None
    if b2 is not None:
        equal_counts = 0
        score_diffs = []
        for key, row in b2.items():
            base = b[key]
            equal_counts += row["vest_n"] == base["vest_n"] and row["person_n"] == base["person_n"]
            score_diffs.append(abs(row["vest_max"] - base["vest_max"]))
        b2_result = {"rows": len(b2), "same_vest_person_n": equal_counts,
                     "vest_max_abs_diff_max": max(score_diffs, default=0.0)}
    result = {
        "rows": len(a), "vest_2x2": {"both": both, "neither": neither, "a_only": a_only, "b_only": b_only},
        "mismatches": mismatches, "mcnemar_exact_two_sided_p": mcnemar_exact(a_only, b_only),
        "per_dir": per_dir, "input_shapes": {"a": sorted(shapes_a), "b": sorted(shapes_b)},
        "both_vest_abs_diff": {"median": statistics.median(diffs) if diffs else 0.0, "max": max(diffs, default=0.0)},
        "vest_max_025_035": {"a": near_a, "b": near_b}, "b2": b2_result,
    }
    print("rows", result["rows"])
    print("vest_2x2", both, neither, a_only, b_only)
    for row in mismatches:
        print("mismatch", row["dir"] + "/" + row["file"], f'{row["a_vest_max"]:.4f}', f'{row["b_vest_max"]:.4f}')
    print("mcnemar_p", result["mcnemar_exact_two_sided_p"])
    for dirname in dirs:
        x = per_dir[dirname]
        print("dir", dirname, "vest", x["a_vest"], x["b_vest"], "person", x["a_person"], x["b_person"])
    print("input_shapes", "a", sorted(shapes_a), "b", sorted(shapes_b))
    print("both_vest_abs_diff", result["both_vest_abs_diff"]["median"], result["both_vest_abs_diff"]["max"])
    print("vest_max_025_035", near_a, near_b)
    if b2_result is not None:
        print("b2", b2_result["rows"], b2_result["same_vest_person_n"], b2_result["vest_max_abs_diff_max"])
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
            f.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
