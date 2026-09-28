# vest_threeway.py의 3분법과 manifest 필터를 독립 실행으로 확인한다.
import json
import os
import subprocess
import sys
import tempfile


HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "vest_threeway.py")


def check(name, condition):
    if not condition:
        raise AssertionError(name)
    print(name, "OK")


def box(cls, x1, y1, x2, y2, conf=0.9):
    return [cls, conf, x1, y1, x2, y2]


def probe():
    frames = [{"i": i, "sha16": f"sha{i}", "file": f"set{i % 2}/frame{i}.jpg"} for i in range(4)]
    persons = [[box(0, 0, 0, 100, 200)], [box(0, 0, 0, 100, 200)], [box(0, 0, 0, 100, 200)], []]
    vests = [[box(1, 20, 50, 80, 120)], [box(1, 300, 300, 340, 340)], [], [box(1, 20, 50, 80, 120)]]
    torsos = [[], [box(2, 20, 50, 80, 120)], [], []]
    return {"conf": 0.3, "hz": 4, "frames": frames, "engines": [
        {"name": "ppe", "sha16": "ppehash", "names": {"0": "person"},
         "results": [{"frame": i, "boxes": persons[i]} for i in range(4)]},
        {"name": "vest", "sha16": "vesthash", "names": {"0": "person", "1": "safety_vest", "2": "torso"},
         "results": [{"frame": i, "boxes": vests[i] + torsos[i]} for i in range(4)]},
    ]}


def run(temp, manifest=None, subject=None, conf_vest=None):
    output_json = os.path.join(temp, "summary.json")
    output_csv = os.path.join(temp, "rows.csv")
    command = [sys.executable, SCRIPT, "--probe", os.path.join(temp, "probe.json"), "--ppe", "ppe", "--vest", "vest",
               "--csv", output_csv, "--json-out", output_json]
    if manifest:
        command.extend(["--manifest", manifest])
    if subject:
        command.extend(["--subject", subject])
    if conf_vest is not None:
        command.extend(["--conf-vest", str(conf_vest)])
    completed = subprocess.run(command, text=True, capture_output=True)
    summary = json.load(open(output_json, encoding="utf-8")) if os.path.exists(output_json) else None
    return completed, summary


def subject_probe():
    """피사체와 방관자를 분리한 손 채점 자료다."""
    frames = [{"i": i, "sha16": f"subj{i}", "file": f"set/frame{i}.jpg"} for i in range(5)]
    persons = [
        [box(0, 0, 0, 100, 200), box(0, 200, 0, 300, 200)],
        [box(0, 0, 0, 100, 200), box(0, 200, 0, 300, 200)],
        [box(0, 0, 0, 100, 200)],
        [box(0, 0, 0, 100, 200)],
        [box(0, 0, 0, 100, 200), box(0, 200, 0, 300, 200)],
    ]
    detections = [
        [box(1, 20, 50, 80, 120)],
        [box(2, 220, 50, 280, 120)],
        [],
        [box(1, 20, 50, 80, 120, conf=0.20)],
        [],
    ]
    return {"conf": 0.10, "hz": 4, "frames": frames, "engines": [
        {"name": "ppe", "sha16": "ppehash", "names": {"0": "person"},
         "results": [{"frame": i, "boxes": persons[i]} for i in range(5)]},
        {"name": "vest", "sha16": "vesthash", "names": {"0": "person", "1": "safety_vest", "2": "torso"},
         "results": [{"frame": i, "boxes": detections[i]} for i in range(5)]},
    ]}


def main():
    with tempfile.TemporaryDirectory() as temp:
        with open(os.path.join(temp, "probe.json"), "w", encoding="utf-8") as f:
            json.dump(probe(), f)
        completed, summary = run(temp)
        check("3분법 exit", completed.returncode == 0)
        check("3분법 사진", (summary["착용"]["n"], summary["미착용"]["n"], summary["판정불가"]["n"]) == (1, 1, 2))
        check("사람 단위", tuple(summary["persons"][key] for key in ("person_n", "has_vest", "torso_only", "neither")) == (3, 1, 1, 1))
        check("사람 밖 조끼", summary["vest_outside_person"] == 2)
        manifest = os.path.join(temp, "manifest.json")
        with open(manifest, "w", encoding="utf-8") as f:
            json.dump({"n": 2, "files": {"set0": {"frame0.jpg": "sha0", "frame2.jpg": "sha2"}}}, f)
        completed, summary = run(temp, manifest)
        check("manifest 일치", completed.returncode == 0 and summary["n"] == 2 and summary["matched"] == 2 and summary["missing"] == 0)
        with open(manifest, "w", encoding="utf-8") as f:
            json.dump({"n": 3, "files": {"set0": {"frame0.jpg": "sha0", "frame2.jpg": "sha2", "lost.jpg": "absent"}}}, f)
        completed, summary = run(temp, manifest)
        check("manifest missing", completed.returncode == 3 and summary["missing"] == 1)
        positive = probe()
        positive["engines"][1]["results"][0]["boxes"][0] = box(1, 300, 300, 340, 340)
        with open(os.path.join(temp, "probe.json"), "w", encoding="utf-8") as f:
            json.dump(positive, f)
        completed, summary = run(temp)
        check("양성 통제", completed.returncode == 0 and summary["착용"]["n"] == 0)
        with open(os.path.join(temp, "probe.json"), "w", encoding="utf-8") as f:
            json.dump(subject_probe(), f)
        subject = os.path.join(temp, "subject.json")
        with open(subject, "w", encoding="utf-8") as f:
            json.dump({"frame0.json": [0, 0, 100, 200], "frame1.json": [0, 0, 100, 200],
                       "frame2.json": [300, 300, 400, 400], "frame3.json": [0, 0, 100, 200],
                       "frame4.json": [0, 0, 100, 200]}, f)
        completed, summary = run(temp, subject=subject)
        check("피사체 착용", completed.returncode == 0 and summary["subjects"]["착용"]["n"] == 1)
        check("방관자 torso", summary["미착용"]["n"] == 1 and summary["subjects"]["판정불가"]["n"] == 3)
        check("피사체 미검출", summary["subjects"]["피사체 미검출"]["n"] == 1)
        completed, summary = run(temp, subject=subject, conf_vest=0.10)
        check("조끼 문턱", completed.returncode == 0 and summary["subjects"]["착용"]["n"] == 2)
        with open(subject, "w", encoding="utf-8") as f:
            json.dump({"frame0.json": [200, 0, 300, 200], "frame1.json": [0, 0, 100, 200],
                       "frame2.json": [300, 300, 400, 400], "frame3.json": [0, 0, 100, 200],
                       "frame4.json": [0, 0, 100, 200]}, f)
        completed, summary = run(temp, subject=subject)
        check("피사체 양성 통제", completed.returncode == 0 and summary["subjects"]["착용"]["n"] == 0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
