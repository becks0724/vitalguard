# 엔진 출력 지문 JSON 둘의 상자별 차이를 수치로 내는 비교 도구.
import argparse
import json
import sys


def read_probe(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict) or not isinstance(data.get("frames"), list) or not isinstance(data.get("engines"), list):
            raise ValueError("frames 또는 engines 형식 오류")
        frames = {}
        for row in data["frames"]:
            i, digest = row["i"], row["sha16"]
            if digest in frames:
                raise ValueError("중복 frame sha16 " + str(digest))
            frames[digest] = {"i": i, "file": row.get("file")}
        engines = {}
        for engine in data["engines"]:
            name = engine["name"]
            if name in engines:
                raise ValueError("중복 engine 이름 " + name)
            results = {}
            for row in engine["results"]:
                frame = row["frame"]
                if frame in results:
                    raise ValueError(name + ": 중복 frame " + str(frame))
                if not isinstance(row.get("boxes"), list) or row.get("n") != len(row["boxes"]):
                    raise ValueError(name + ": boxes 또는 n 형식 오류")
                results[frame] = row
            if set(results) != {frame["i"] for frame in frames.values()}:
                raise ValueError(name + ": frame 집합 불일치")
            engines[name] = results
        return frames, engines
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError(path + ": " + str(exc))


def iou(a, b):
    ax1, ay1, ax2, ay2 = (float(v) for v in a[2:6])
    bx1, by1, bx2, by2 = (float(v) for v in b[2:6])
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1) + max(0.0, bx2 - bx1) * max(0.0, by2 - by1) - inter
    return inter / union if union else 0.0


def match_boxes(a_boxes, b_boxes, threshold):
    """클래스별 최대 카디널리티 1:1 매칭을 (a index, b index)로 돌려준다."""
    matched = []
    classes = sorted({int(row[0]) for row in a_boxes} | {int(row[0]) for row in b_boxes})
    for cls in classes:
        a_indices = [i for i, row in enumerate(a_boxes) if int(row[0]) == cls]
        b_indices = [i for i, row in enumerate(b_boxes) if int(row[0]) == cls]
        edges = {i: sorted((j for j in b_indices if iou(a_boxes[i], b_boxes[j]) >= threshold),
                           key=lambda j: (-iou(a_boxes[i], b_boxes[j]), j)) for i in a_indices}
        owner = {}

        def augment(ai, seen):
            for bi in edges[ai]:
                if bi in seen:
                    continue
                seen.add(bi)
                if bi not in owner or augment(owner[bi], seen):
                    owner[bi] = ai
                    return True
            return False

        for ai in a_indices:
            augment(ai, set())
        matched.extend((ai, bi) for bi, ai in owner.items())
    return sorted(matched)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--a", required=True)
    p.add_argument("--b", required=True)
    p.add_argument("--iou", type=float, default=0.9)
    p.add_argument("--conf-tol", type=float, default=0.02)
    p.add_argument("--json-out")
    args = p.parse_args()
    if not 0 <= args.iou <= 1 or args.conf_tol < 0:
        p.error("--iou 는 0 이상 1 이하, --conf-tol 은 0 이상")
    try:
        a_frames, a_engines = read_probe(args.a)
        b_frames, b_engines = read_probe(args.b)
        if set(a_frames) != set(b_frames):
            raise ValueError("frame sha16 불일치")
        if set(a_engines) != set(b_engines):
            raise ValueError("engine 이름 집합 불일치")
    except ValueError as exc:
        print("비교 오류:", exc, file=sys.stderr)
        return 2

    summary = {"iou": args.iou, "conf_tol": args.conf_tol, "engines": []}
    total = {"frames": 0, "same_n_frames": 0, "a_only": 0, "b_only": 0, "conf_max": 0.0, "conf_over_tol": 0}
    for name in sorted(a_engines):
        row = {"name": name, "frames": len(a_frames), "same_n_frames": 0, "a_only": 0, "b_only": 0,
               "conf_max": 0.0, "conf_over_tol": 0, "results": []}
        for digest in sorted(a_frames):
            a_frame, b_frame = a_frames[digest], b_frames[digest]
            ar, br = a_engines[name][a_frame["i"]], b_engines[name][b_frame["i"]]
            pairs = match_boxes(ar["boxes"], br["boxes"], args.iou)
            deltas = [abs(float(ar["boxes"][ai][1]) - float(br["boxes"][bi][1])) for ai, bi in pairs]
            a_only, b_only = len(ar["boxes"]) - len(pairs), len(br["boxes"]) - len(pairs)
            item = {"frame": a_frame["i"], "sha16": digest, "a_n": ar["n"], "b_n": br["n"], "same_n": ar["n"] == br["n"],
                    "matched": len(pairs), "a_only": a_only, "b_only": b_only,
                    "conf_max": max(deltas, default=0.0), "conf_over_tol": sum(d > args.conf_tol for d in deltas)}
            file_name = a_frame.get("file") or b_frame.get("file")
            if file_name:
                item["file"] = file_name
            row["results"].append(item)
            row["same_n_frames"] += item["same_n"]
            row["a_only"] += a_only
            row["b_only"] += b_only
            row["conf_max"] = max(row["conf_max"], item["conf_max"])
            row["conf_over_tol"] += item["conf_over_tol"]
            if a_only or b_only:
                print(name, "· 미매칭 · frame", a_frame["i"], "· a만", a_only, "· b만", b_only,
                      *( ["· file", file_name] if file_name else []))
        summary["engines"].append(row)
        for key in total:
            if key != "conf_max":
                total[key] += row[key]
        total["conf_max"] = max(total["conf_max"], row["conf_max"])
        print(name, "· 프레임", row["frames"], "· 상자 수 같은 프레임", row["same_n_frames"],
              "· 미매칭 a만", row["a_only"], "· b만", row["b_only"], "· |Δconf| 최대", f'{row["conf_max"]:.4f}')
    summary["total"] = total
    print("전체 · 엔진", len(summary["engines"]), "· 프레임", total["frames"], "· 상자 수 같은 프레임", total["same_n_frames"],
          "· 미매칭 a만", total["a_only"], "· b만", total["b_only"], "· |Δconf| 최대", f'{total["conf_max"]:.4f}')
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=1)
            f.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
