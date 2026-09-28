# 조끼 200장 모델 측정 CSV를 만드는 도구.
import argparse
import base64
import csv
import hashlib
import json
import os
import sys
import time
from collections import Counter


CSV_FIELDS = ["dir", "file", "sha16", "vest_n", "vest_max", "person_n", "person_max", "in_h", "in_w", "run_label"]
IMGSZ = (544, 960)
CONF = 0.30


def eprint(*parts):
    print(*parts, file=sys.stderr, flush=True)


def sha16(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def load_manifest(args):
    if bool(args.manifest) == bool(args.manifest_b64):
        raise ValueError("--manifest 또는 --manifest-b64 중 하나가 필요합니다")
    if args.manifest:
        with open(args.manifest, encoding="utf-8") as f:
            return json.load(f)
    return json.loads(base64.b64decode(args.manifest_b64).decode("utf-8"))


def manifest_rows(manifest, root, only_dirs):
    files = manifest.get("files")
    if not isinstance(files, dict):
        raise ValueError("manifest files 형식 오류")
    selected = list(files)
    if only_dirs is not None:
        wanted = [x for x in only_dirs.split(",") if x]
        if not wanted or any(x not in files for x in wanted):
            raise ValueError("--only-dirs 가 manifest와 다릅니다")
        selected = wanted
    rows = []
    read_files = {}
    for dirname in selected:
        entries = files[dirname]
        if not isinstance(entries, dict):
            raise ValueError("manifest files 형식 오류")
        read_files[dirname] = {}
        for filename, expected in entries.items():
            path = os.path.join(root, dirname, filename)
            if not os.path.isfile(path):
                raise RuntimeError("누락 " + path)
            actual = sha16(path)
            if actual != expected:
                raise RuntimeError("sha16 불일치 " + path + " " + actual + " " + str(expected))
            read_files[dirname][filename] = actual
            rows.append((dirname, filename, path, actual))
    if only_dirs is None:
        actual_manifest_sha = hashlib.sha256(
            json.dumps(read_files, sort_keys=True).encode()
        ).hexdigest()[:16]
        if actual_manifest_sha != manifest.get("manifest_sha"):
            raise RuntimeError("manifest_sha 불일치 " + actual_manifest_sha + " " + str(manifest.get("manifest_sha")))
        if manifest.get("n") != len(rows):
            raise RuntimeError("manifest n 불일치 " + str(manifest.get("n")) + " " + str(len(rows)))
    return rows


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--root", required=True)
    p.add_argument("--manifest")
    p.add_argument("--manifest-b64")
    p.add_argument("--device", required=True)
    p.add_argument("--label", required=True)
    p.add_argument("--hz", type=float, default=0)
    p.add_argument("--only-dirs")
    p.add_argument("--out", required=True)
    p.add_argument("--imgsz", default="544,960", help="엔진을 구운 형상과 같게 · 콤마면 (h,w)")
    args = p.parse_args()
    IMGSZ = tuple(int(v) for v in args.imgsz.split(","))
    IMGSZ = IMGSZ if len(IMGSZ) > 1 else IMGSZ[0]
    if args.hz < 0:
        p.error("--hz 는 0 이상이어야 합니다")

    try:
        items = manifest_rows(load_manifest(args), args.root, args.only_dirs)
    except Exception as exc:
        eprint("대조 오류:", exc)
        return 3

    csv_stdout_fd = None
    if args.out == "-":
        # TensorRT C 로거는 fd 1에 직접 써서 파이썬 stdout 리디렉션으로는 막히지 않는다.
        # 모델 로딩 전 fd 1을 stderr로 돌리고, CSV만 보관한 원래 fd에 쓴다.
        csv_stdout_fd = os.dup(1)
        os.dup2(2, 1)

    try:
        import cv2
        import torch
        import ultralytics
        from ultralytics import YOLO
    except Exception as exc:
        eprint("모듈 오류:", exc)
        return 2
    try:
        model_sha = sha16(args.model)
        eprint("PID", os.getpid())
        eprint("python", sys.version.split()[0], "ultralytics", ultralytics.__version__, "torch", torch.__version__)
        eprint("model", args.model, "size", os.path.getsize(args.model), "sha16", model_sha)
        eprint("device", args.device, "imgsz", IMGSZ, "conf", CONF, "target", len(items))
        m = YOLO(args.model, task="detect")
        names = m.names
        name_to_id = {name: int(index) for index, name in (names.items() if isinstance(names, dict) else enumerate(names))}
        if "safety_vest" not in name_to_id or "person" not in name_to_id:
            eprint("클래스 오류:", sorted(name_to_id.values()))
            return 4
        vest_id, person_id = name_to_id["safety_vest"], name_to_id["person"]
        classes = sorted(m.names)
        period = 1.0 / args.hz if args.hz > 0 else 0.0
        last_start = [None]

        def predict(img):
            if last_start[0] is not None and period:
                rest = period - (time.perf_counter() - last_start[0])
                if rest > 0:
                    time.sleep(rest)
            last_start[0] = time.perf_counter()
            return m.predict(img, imgsz=IMGSZ, conf=CONF, device=args.device,
                             classes=classes, verbose=False)[0]

        warm = cv2.imread(items[0][2]) if items else None
        if warm is None:
            eprint("이미지 읽기 오류:", items[0][2] if items else "대상 없음")
            return 2
        predict(warm)
        seen_shape = [-1, -1]
        preprocess = m.predictor.preprocess

        def recorded_preprocess(images):
            tensor = preprocess(images)
            shape = getattr(tensor, "shape", ())
            if len(shape) >= 2:
                seen_shape[:] = [int(shape[-2]), int(shape[-1])]
            return tensor

        m.predictor.preprocess = recorded_preprocess
        output = []
        stats = {d: Counter() for d, _, _, _ in items}
        for index, (dirname, filename, path, digest) in enumerate(items, 1):
            img = cv2.imread(path)
            if img is None:
                eprint("이미지 읽기 오류:", path)
                return 2
            seen_shape[:] = [-1, -1]
            result = predict(img)
            vest_scores, person_scores = [], []
            for cls, score in zip(result.boxes.cls.tolist(), result.boxes.conf.tolist()):
                if int(cls) == vest_id:
                    vest_scores.append(float(score))
                if int(cls) == person_id:
                    person_scores.append(float(score))
            stats[dirname]["vest"] += bool(vest_scores)
            stats[dirname]["person"] += bool(person_scores)
            output.append({
                "dir": dirname, "file": filename, "sha16": digest,
                "vest_n": len(vest_scores), "vest_max": f"{max(vest_scores, default=0):.4f}",
                "person_n": len(person_scores), "person_max": f"{max(person_scores, default=0):.4f}",
                "in_h": seen_shape[0], "in_w": seen_shape[1], "run_label": args.label,
            })
            if index % 20 == 0:
                eprint("progress", index, "/", len(items))
        if len(output) != len(items):
            eprint("처리 장수 오류", len(output), len(items))
            return 2
        if args.out == "-":
            with os.fdopen(csv_stdout_fd, "w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, lineterminator="\n")
                writer.writeheader()
                writer.writerows(output)
        else:
            with open(args.out, "w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, lineterminator="\n")
                writer.writeheader()
                writer.writerows(output)
        for dirname in stats:
            eprint(dirname, "vest", stats[dirname]["vest"], "person", stats[dirname]["person"])
        eprint("processed", len(output), "/", len(items))
        return 0
    except Exception as exc:
        eprint("실행 오류:", repr(exc))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
