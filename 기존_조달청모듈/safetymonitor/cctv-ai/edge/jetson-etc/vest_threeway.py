# 조끼 중심점의 사람 상자 귀속으로 사진별 3분법 수치만 집계한다.
import argparse
import csv
import json
import os
import sys


CLASSES = ("착용", "미착용", "판정불가")
SUBJECT_CLASSES = ("착용", "미착용", "판정불가", "피사체 미검출")


def eprint(*parts):
    print(*parts, file=sys.stderr, flush=True)


def _mid(box):
    return (box[0] + box[2]) / 2, (box[1] + box[3]) / 2


def _inside(pt, box):
    return box[0] <= pt[0] <= box[2] and box[1] <= pt[1] <= box[3]


def _attached_to_person(box, persons):
    """이 박스가 어느 사람 박스 안에 있나.

    ★ 집계(_zone_stats ③④)와 그리기(draw)가 **같은 함수**를 쓰게 하려고 뺐다.
    각자 같은 식을 따로 쓰면 한쪽만 고쳐질 때 화면과 수가 조용히 갈린다.
    2026-09-22 에 그 반대가 실제로 났다 — 세는 쪽을 고쳤는데 그리는 쪽이 그대로라
    화면은 계속 「의자가 안전모를 썼다」고 말했다.
    """
    return any(_inside(_mid(box), p) for p in persons)


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def engine_by_name(probe, name):
    for engine in probe.get("engines", []):
        if engine.get("name") == name:
            return engine
    raise ValueError("엔진 이름 없음: " + name)


def boxes_for(result, names, confs=None):
    """이름별 상자를 돌려준다. confs가 있으면 클래스별 사후 문턱을 적용한다."""
    found = {"person": [], "safety_vest": [], "torso": []}
    for row in result.get("boxes", []):
        if not isinstance(row, list) or len(row) != 6:
            raise ValueError("상자 형식 오류")
        cls = str(int(row[0]))
        name = names.get(cls)
        if name in found and (confs is None or row[1] >= confs.get(name, 0)):
            found[name].append(row[2:6])
    return found


def iou(a, b):
    left, top = max(a[0], b[0]), max(a[1], b[1])
    right, bottom = min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0, right - left) * max(0, bottom - top)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection
    return intersection / union if union else 0.0


def manifest_sha16(path):
    manifest = load_json(path)
    files = manifest.get("files", {})
    values = set()
    for per_dir in files.values():
        if isinstance(per_dir, dict):
            values.update(str(value) for value in per_dir.values())
    return values, manifest.get("n", len(values))


def rate(count, total):
    return round(count / total, 4) if total else 0.0


def counts(rows):
    n = len(rows)
    return {"n": n, **{label: {"n": sum(row["cls3"] == label for row in rows),
                              "ratio": rate(sum(row["cls3"] == label for row in rows), n)}
                       for label in CLASSES}}


def subject_counts(rows):
    n = len(rows)
    return {"n": n, **{label: {"n": sum(row["subj_cls3"] == label for row in rows),
                               "ratio": rate(sum(row["subj_cls3"] == label for row in rows), n)}
                        for label in SUBJECT_CLASSES}}


def summarize(rows, manifest_info, probe_name, ppe, vest, probe, subject_enabled, thresholds):
    result = counts(rows)
    by_dir = {}
    for directory in sorted({row["dir"] for row in rows}):
        by_dir[directory] = counts([row for row in rows if row["dir"] == directory])
    person_n = sum(row["person_n"] for row in rows)
    result.update({
        "by_dir": by_dir,
        "persons": {
            "person_n": person_n,
            "has_vest": sum(row["has_vest"] for row in rows),
            "torso_only": sum(row["torso_only"] for row in rows),
            "neither": sum(row["neither"] for row in rows),
        },
        "person_n_zero": sum(row["person_n"] == 0 for row in rows),
        "vest_outside_person": sum(row["vest_n"] >= 1 and row["vest_on_person"] == 0 for row in rows),
        "matched": manifest_info[0],
        "manifest_n": manifest_info[1],
        "missing": manifest_info[2],
        "probe": probe_name,
        "engines": {
            "ppe": {"name": ppe["name"], "sha16": ppe.get("sha16", "")},
            "vest": {"name": vest["name"], "sha16": vest.get("sha16", "")},
        },
        "conf": probe.get("conf"),
        "hz": probe.get("hz"),
    })
    result.update(result["persons"])
    result["probe_file"] = probe_name
    result["ppe"] = result["engines"]["ppe"]
    result["vest"] = result["engines"]["vest"]
    result["probe_conf"] = probe.get("conf")
    result["thresholds"] = thresholds
    warnings = []
    if isinstance(probe.get("conf"), (int, float)) and any(probe["conf"] > value for value in thresholds.values()):
        warnings.append("경고: probe_conf가 클래스별 채점 문턱보다 높아 낮은 신뢰도 상자는 probe에 없습니다")
    result["warnings"] = warnings
    if subject_enabled:
        subjects = subject_counts(rows)
        subject_by_dir = {}
        for directory in sorted({row["dir"] for row in rows}):
            subject_by_dir[directory] = subject_counts([row for row in rows if row["dir"] == directory])
        ious = [row["subj_iou"] for row in rows if isinstance(row["subj_iou"], (int, float))]
        result.update({
            "subjects": subjects,
            "subject_by_dir": subject_by_dir,
            "subj_iou_median": sorted(ious)[len(ious) // 2] if len(ious) % 2 else
                               ((sorted(ious)[len(ious) // 2 - 1] + sorted(ious)[len(ious) // 2]) / 2 if ious else None),
            "subj_iou_min": min(ious) if ious else None,
            "subject_box_missing": sum(row["subject_box_missing"] for row in rows),
            "shortcut": {"same": sum(row["shortcut"] == "같음" for row in rows),
                         "diff": sum(row["shortcut"] == "다름" for row in rows),
                         "na": sum(row["shortcut"] == "해당없음" for row in rows)},
        })
    return result


def print_table(summary):
    print("구분,n,착용,착용비율,미착용,미착용비율,판정불가,판정불가비율")
    def line(name, data):
        print(",".join(str(value) for value in (name, data["n"], data["착용"]["n"], data["착용"]["ratio"],
                                                    data["미착용"]["n"], data["미착용"]["ratio"],
                                                    data["판정불가"]["n"], data["판정불가"]["ratio"])))
    line("전체", summary)
    for directory, data in summary["by_dir"].items():
        line(directory, data)
    persons = summary["persons"]
    print("사람수,has_vest,torso_only,neither")
    print(",".join(str(persons[key]) for key in ("person_n", "has_vest", "torso_only", "neither")))
    if "subjects" in summary:
        subjects = summary["subjects"]
        print("피사체,n,착용,미착용,판정불가,피사체 미검출")
        print(",".join(str(subjects[key]["n"] if isinstance(subjects[key], dict) else subjects[key])
                       for key in ("n", "착용", "미착용", "판정불가", "피사체 미검출")))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", required=True)
    parser.add_argument("--ppe", required=True)
    parser.add_argument("--vest", required=True)
    parser.add_argument("--manifest")
    parser.add_argument("--csv", required=True)
    parser.add_argument("--json-out", required=True)
    parser.add_argument("--conf-person", type=float, default=0.30)
    parser.add_argument("--conf-vest", type=float, default=0.30)
    parser.add_argument("--conf-torso", type=float, default=0.30)
    parser.add_argument("--subject", help="사진 basename.json 별 피사체 상자 JSON")
    args = parser.parse_args()
    try:
        thresholds = {"person": args.conf_person, "safety_vest": args.conf_vest, "torso": args.conf_torso}
        if any(value < 0 or value > 1 for value in thresholds.values()):
            raise ValueError("클래스별 conf 는 0 이상 1 이하여야 합니다")
        probe = load_json(args.probe)
        ppe = engine_by_name(probe, args.ppe)
        vest = engine_by_name(probe, args.vest)
        ppe_names = ppe.get("names")
        vest_names = vest.get("names")
        if not isinstance(ppe_names, dict) or not isinstance(vest_names, dict):
            raise ValueError("엔진 names 없음")
        ppe_results = ppe.get("results", [])
        vest_results = vest.get("results", [])
        if len(ppe_results) != len(vest_results):
            raise ValueError("엔진 프레임 수 다름")
        ppe_by_frame = {item.get("frame"): item for item in ppe_results}
        vest_by_frame = {item.get("frame"): item for item in vest_results}
        if len(ppe_by_frame) != len(ppe_results) or set(ppe_by_frame) != set(vest_by_frame):
            raise ValueError("엔진 프레임 번호 다름")
        frame_info = {item.get("i"): item for item in probe.get("frames", [])}
        if set(ppe_by_frame) != set(frame_info):
            raise ValueError("probe 프레임 번호 다름")
        subjects = load_json(args.subject) if args.subject else None
        if subjects is not None and not isinstance(subjects, dict):
            raise ValueError("피사체 상자 JSON은 객체여야 합니다")
        selected_sha16 = None
        if args.manifest:
            selected_sha16, manifest_n = manifest_sha16(args.manifest)
            missing = len(selected_sha16 - {str(item.get("sha16")) for item in frame_info.values()})
        else:
            manifest_n = len(frame_info)
            missing = 0
        rows = []
        for frame in sorted(ppe_by_frame):
            info = frame_info[frame]
            sha16 = str(info.get("sha16", ""))
            if selected_sha16 is not None and sha16 not in selected_sha16:
                continue
            ppe_boxes = boxes_for(ppe_by_frame[frame], ppe_names, thresholds)
            vest_boxes = boxes_for(vest_by_frame[frame], vest_names, thresholds)
            persons = ppe_boxes["person"]
            vests = vest_boxes["safety_vest"]
            torsos = vest_boxes["torso"]
            vest_on_person = sum(_attached_to_person(box, persons) for box in vests)
            torso_on_person = sum(_attached_to_person(box, persons) for box in torsos)
            cls3 = "착용" if vest_on_person >= 1 else "미착용" if torso_on_person >= 1 else "판정불가"
            person_marks = [(any(_attached_to_person(box, [person]) for box in vests),
                             any(_attached_to_person(box, [person]) for box in torsos)) for person in persons]
            relpath = str(info.get("file", ""))
            parts = relpath.replace("\\", "/").split("/")
            file_name = parts[-1] if parts else ""
            row = {"dir": parts[0] if parts else "", "file": file_name, "sha16": sha16,
                         "person_n": len(persons), "vest_n": len(vests), "torso_n": len(torsos),
                         "vest_on_person": vest_on_person, "torso_on_person": torso_on_person, "cls3": cls3,
                         "has_vest": sum(mark[0] for mark in person_marks),
                         "torso_only": sum(mark[1] and not mark[0] for mark in person_marks),
                         "neither": sum(not mark[0] and not mark[1] for mark in person_marks),
                         "subj_iou": "", "subj_cls3": "", "subject_box_missing": False, "shortcut": "해당없음"}
            if subjects is not None:
                subject_key = os.path.splitext(os.path.basename(file_name))[0] + ".json"
                subject_box = subjects.get(subject_key)
                if not isinstance(subject_box, list) or len(subject_box) != 4:
                    row["subject_box_missing"] = True
                    row["subj_cls3"] = "피사체 미검출"
                elif not persons:
                    row["subj_cls3"] = "피사체 미검출"
                else:
                    best_index, best_iou = max(enumerate(iou(subject_box, person) for person in persons),
                                               key=lambda pair: pair[1])
                    row["subj_iou"] = round(best_iou, 6)
                    if best_iou < 0.30:
                        row["subj_cls3"] = "피사체 미검출"
                    else:
                        subject_person = persons[best_index]
                        subject_vest = any(_inside(_mid(box), subject_person) for box in vests)
                        subject_torso = any(_inside(_mid(box), subject_person) for box in torsos)
                        row["subj_cls3"] = "착용" if subject_vest else "미착용" if subject_torso else "판정불가"
                        if row["has_vest"] == 1:
                            row["shortcut"] = "같음" if person_marks[best_index][0] else "다름"
            rows.append(row)
        summary = summarize(rows, (len(rows), manifest_n, missing), os.path.basename(args.probe), ppe, vest, probe,
                            subjects is not None, thresholds)
        with open(args.csv, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=("dir", "file", "sha16", "person_n", "vest_n", "torso_n",
                                                    "vest_on_person", "torso_on_person", "cls3", "subj_iou", "subj_cls3"))
            writer.writeheader()
            writer.writerows({key: row[key] for key in writer.fieldnames} for row in rows)
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print_table(summary)
        return 3 if missing > 0 else 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        eprint("오류:", exc)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
