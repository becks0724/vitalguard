# 같은 입력으로 모델 출력 상자를 기록해 판본 교체 전후를 대조하는 지문 도구.
import argparse
import hashlib
import json
import os
import platform
import sys
import time


def eprint(*parts):
    print(*parts, file=sys.stderr, flush=True)


def sha16_bytes(data):
    return hashlib.sha256(data).hexdigest()[:16]


def sha16_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def parse_engine(spec):
    """PATH@IMGSZ[@TASK] -> (path, imgsz, task)."""
    parts = spec.rsplit("@", 2)
    if len(parts) < 2 or not parts[0] or not parts[1]:
        raise ValueError("--engine 은 PATH@IMGSZ[@TASK] 꼴이어야 합니다: " + spec)
    path, raw = parts[0], parts[1]
    task = parts[2] if len(parts) == 3 else "detect"
    if task not in ("detect", "pose"):
        raise ValueError("task 는 detect 또는 pose 여야 합니다: " + task)
    try:
        values = [int(v) for v in raw.split(",")]
    except ValueError:
        raise ValueError("imgsz 는 정수 또는 h,w 여야 합니다: " + raw)
    if len(values) not in (1, 2) or any(v < 1 for v in values):
        raise ValueError("imgsz 는 양의 정수 또는 h,w 여야 합니다: " + raw)
    return path, values[0] if len(values) == 1 else values, task


def record_boxes(result):
    rows = []
    boxes = getattr(result, "boxes", None)
    if boxes is not None and len(boxes):
        for cls, conf, xyxy in zip(boxes.cls.tolist(), boxes.conf.tolist(), boxes.xyxy.tolist()):
            rows.append([int(cls), round(float(conf), 4), *[round(float(v), 1) for v in xyxy]])
    rows.sort(key=lambda row: (row[0], row[2], row[3]))
    return rows


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--engine", action="append", required=True, help="PATH@IMGSZ[@TASK] · 여러 번")
    p.add_argument("--device", required=True)
    p.add_argument("--frames", type=int, default=8)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--conf", type=float, default=0.30)
    p.add_argument("--images", help="재귀적으로 읽을 JPG 사진 디렉터리 (있으면 --frames 대신 사용)")
    p.add_argument("--hz", type=float, default=0, help="predict 호출 시작 속도 상한 (0 이면 제한 없음)")
    p.add_argument("--json", required=True, help="파일 경로 또는 - (표준출력)")
    p.add_argument("--label", default="")
    args = p.parse_args()
    if args.frames < 1:
        p.error("--frames 는 1 이상")
    if not 0 <= args.conf <= 1:
        p.error("--conf 는 0 이상 1 이하여야 합니다")
    if args.hz < 0:
        p.error("--hz 는 0 이상")
    try:
        specs = [parse_engine(spec) for spec in args.engine]
    except ValueError as exc:
        eprint("인자 오류:", exc)
        return 2
    for path, _, _ in specs:
        if not os.path.isfile(path):
            eprint("파일 없음:", path)
            return 2

    json_fd = None
    if args.json == "-":
        # TensorRT C 로거는 fd 1에 직접 써서 모델 적재 전에 JSON용 fd를 보관해야 한다.
        json_fd = os.dup(1)
        os.dup2(2, 1)

    try:
        import numpy as np
        import torch
        import ultralytics
        from ultralytics import YOLO
    except Exception as exc:
        eprint("모듈 오류:", repr(exc))
        return 2

    if args.images:
        if not os.path.isdir(args.images):
            eprint("사진 디렉터리 없음:", args.images)
            return 2
        try:
            import cv2
        except Exception as exc:
            eprint("모듈 오류:", repr(exc))
            return 2
        image_paths = []
        for root, dirs, names in os.walk(args.images):
            dirs.sort()
            image_paths.extend(os.path.join(root, name) for name in sorted(names) if name.endswith(".jpg"))
        image_paths.sort(key=lambda path: os.path.relpath(path, args.images))
        if not image_paths:
            eprint("JPG 사진 없음:", args.images)
            return 2
        frame_rows = []
        for i, path in enumerate(image_paths):
            frame_rows.append({"i": i, "sha16": sha16_file(path),
                               "file": os.path.relpath(path, args.images)})
    else:
        rng = np.random.default_rng(args.seed)
        frames = [rng.integers(0, 256, size=(540, 960, 3), dtype=np.uint8) for _ in range(args.frames)]
        frame_rows = [{"i": i, "sha16": sha16_bytes(frame.tobytes())} for i, frame in enumerate(frames)]
        image_paths = None
    result = {
        "label": args.label,
        "python": platform.python_version(),
        "ultralytics": ultralytics.__version__,
        "ultralytics_file": os.path.abspath(ultralytics.__file__),
        "torch": torch.__version__,
        "device": args.device,
        "seed": args.seed,
        "conf": args.conf,
        "hz": args.hz,
        "frames": frame_rows,
        "engines": [],
    }
    eprint("python", result["python"], "ultralytics", result["ultralytics"], "torch", result["torch"],
           "device", args.device, "frames", len(frame_rows), "seed", args.seed)
    try:
        previous_predict_start = None
        for path, imgsz, task in specs:
            model = YOLO(path, task=task)
            engine = {"path": path, "name": os.path.basename(path), "size": os.path.getsize(path),
                      "sha16": sha16_file(path), "imgsz": imgsz, "task": task,
                      "names": {str(key): str(value) for key, value in model.names.items()}, "results": []}
            for i in range(len(frame_rows)):
                if image_paths is not None:
                    frame = cv2.imread(image_paths[i])
                    if frame is None:
                        eprint("사진 읽기 오류:", image_paths[i])
                        return 2
                else:
                    frame = frames[i]
                if args.hz > 0 and previous_predict_start is not None:
                    remaining = 1 / args.hz - (time.monotonic() - previous_predict_start)
                    if remaining > 0:
                        time.sleep(remaining)
                previous_predict_start = time.monotonic()
                prediction = model.predict(frame, imgsz=imgsz, conf=args.conf, device=args.device, verbose=False)[0]
                item = {"frame": i, "n": len(prediction.boxes) if prediction.boxes is not None else 0,
                        "boxes": record_boxes(prediction)}
                if task == "pose":
                    keypoints = getattr(prediction, "keypoints", None)
                    item["keypoints_n"] = len(keypoints) if keypoints is not None else 0
                engine["results"].append(item)
            result["engines"].append(engine)
            eprint("engine", engine["name"], "sha16", engine["sha16"], "frames", len(engine["results"]))
    except Exception as exc:
        eprint("실행 오류:", repr(exc))
        return 2

    text = json.dumps(result, ensure_ascii=False, indent=1) + "\n"
    if json_fd is not None:
        with os.fdopen(json_fd, "w", encoding="utf-8") as f:
            f.write(text)
    else:
        with open(args.json, "w", encoding="utf-8") as f:
            f.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
