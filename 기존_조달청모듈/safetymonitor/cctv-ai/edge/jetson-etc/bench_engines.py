# 엔진 여러 개를 단독·순차로 돌려 호출당 지연과 적재 메모리를 JSON 으로 내는 측정기 (세 번째 엔진 비용 판정용)
#
# 쓰임: python3 bench_engines.py --engine PATH@544,960 --engine PATH@640@pose --device 0 --hz 2 --iter 150 --json -
#   · 엔진마다 단독으로 잰 뒤(전처리·추론·후처리·wall), 목록 전체를 한 프레임에 순차로 돌린 wall 을 잰다
#   · --hz 는 호출(순차 모드에선 한 바퀴) 시작 간격의 상한이다. 0 이면 제한 없음. 실제 간격도 함께 적는다
#   · 결론 문장은 찍지 않는다. 수와 통제만 낸다. 판정은 읽는 쪽이 한다
#   · 표준입력 실행(python3 - … < 이 파일)을 지원한다 — 젯슨에 파일을 남기지 않기 위해서다
#   · --json - 이면 모델을 불러오기 전에 fd 1 을 표준오류로 돌린다. TensorRT 로거가 fd 1 에 직접 쓰기 때문이다
import argparse
import hashlib
import json
import os
import platform
import statistics
import subprocess
import sys
import time


def eprint(*parts):
    print(*parts, file=sys.stderr, flush=True)


def sha16(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def parse_engine(spec):
    """PATH@IMGSZ[@TASK] → (경로, imgsz, task). imgsz 는 '544,960' 또는 '640'."""
    parts = spec.split("@")
    if len(parts) < 2:
        raise ValueError("--engine 은 PATH@IMGSZ[@TASK] 꼴이어야 합니다: " + spec)
    path, raw = parts[0], parts[1]
    task = parts[2] if len(parts) > 2 else "detect"
    imgsz = [int(v) for v in raw.split(",")]
    imgsz = imgsz if len(imgsz) > 1 else imgsz[0]
    return path, imgsz, task


def mem_now():
    """가용 메모리(MB)·이 프로세스 RSS(MB). 리눅스는 /proc, 맥은 ps. 못 재면 None."""
    out = {"avail_mb": None, "rss_mb": None, "tegrastats": None}
    try:
        if os.path.exists("/proc/meminfo"):
            for line in open("/proc/meminfo"):
                if line.startswith("MemAvailable:"):
                    out["avail_mb"] = int(line.split()[1]) // 1024
            for line in open("/proc/self/status"):
                if line.startswith("VmRSS:"):
                    out["rss_mb"] = int(line.split()[1]) // 1024
        else:
            rss = subprocess.run(["ps", "-o", "rss=", "-p", str(os.getpid())], capture_output=True, text=True)
            out["rss_mb"] = int(rss.stdout.strip() or 0) // 1024
    except Exception as exc:
        out["error"] = repr(exc)
    try:
        r = subprocess.run(["tegrastats", "--interval", "500"], capture_output=True, text=True, timeout=1.5)
        out["tegrastats"] = (r.stdout.splitlines() or [None])[0]
    except subprocess.TimeoutExpired as exc:
        out["tegrastats"] = ((exc.stdout or b"").decode(errors="replace").splitlines() or [None])[0]
    except Exception:
        pass
    return out


def stats(vals):
    s = sorted(vals)
    return {"n": len(s), "mean": round(statistics.mean(s), 3), "p50": round(s[len(s) // 2], 3),
            "p95": round(s[max(0, int(len(s) * 0.95) - 1)], 3), "max": round(s[-1], 3)}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--engine", action="append", required=True, help="PATH@IMGSZ[@TASK] · 여러 번")
    p.add_argument("--device", required=True)
    p.add_argument("--hz", type=float, default=0.0)
    p.add_argument("--iter", type=int, default=150)
    p.add_argument("--warm", type=int, default=10)
    p.add_argument("--frame", default="960x540")
    p.add_argument("--conf", type=float, default=0.30)
    p.add_argument("--label", default="")
    p.add_argument("--json", required=True, help="파일 경로 또는 - (표준출력)")
    a = p.parse_args()
    if a.hz < 0 or a.iter < 1:
        p.error("--hz 는 0 이상, --iter 는 1 이상")
    try:
        specs = [parse_engine(s) for s in a.engine]
    except ValueError as exc:
        eprint("인자 오류:", exc)
        return 2
    for path, _, _ in specs:
        if not os.path.isfile(path):
            eprint("파일 없음:", path)
            return 2

    json_fd = None
    if a.json == "-":
        # TensorRT C 로거는 fd 1 에 직접 쓴다. 모델 적재 전에 fd 1 을 표준오류로 돌리고 JSON 은 보관한 fd 로만 쓴다.
        json_fd = os.dup(1)
        os.dup2(2, 1)

    import numpy as np
    import torch
    import ultralytics
    from ultralytics import YOLO

    w, h = (int(v) for v in a.frame.lower().split("x"))
    rng = np.random.default_rng(0)
    frame = (rng.random((h, w, 3)) * 255).astype(np.uint8)
    period = 1.0 / a.hz if a.hz > 0 else 0.0
    eprint("PID", os.getpid(), "· python", platform.python_version(), "· ultralytics", ultralytics.__version__,
           "· torch", torch.__version__, "· device", a.device, "· hz", a.hz, "· iter", a.iter, "· frame", a.frame)

    result = {"label": a.label, "device": a.device, "hz": a.hz, "iter": a.iter, "warm": a.warm, "frame": a.frame,
              "conf": a.conf, "python": platform.python_version(), "ultralytics": ultralytics.__version__,
              "torch": torch.__version__, "mem_before_load": mem_now(), "engines": [], "sequential": None}

    models = []
    for path, imgsz, task in specs:
        before = mem_now()
        m = YOLO(path, task=task)
        m.predict(frame, imgsz=imgsz, conf=a.conf, device=a.device, verbose=False)  # 적재를 끝내는 첫 호출
        after = mem_now()
        info = {"path": path, "name": os.path.basename(path), "size": os.path.getsize(path), "sha16": sha16(path),
                "imgsz": imgsz, "task": task, "names_n": len(m.names),
                "load_rss_delta_mb": (after["rss_mb"] - before["rss_mb"]) if None not in (after["rss_mb"], before["rss_mb"]) else None,
                "load_avail_delta_mb": (after["avail_mb"] - before["avail_mb"]) if None not in (after["avail_mb"], before["avail_mb"]) else None}
        models.append((m, imgsz, info))
        eprint("적재", info["name"], "· 크기", info["size"], "· sha16", info["sha16"], "· 클래스", info["names_n"],
               "· RSS +", info["load_rss_delta_mb"], "MB")
    result["mem_after_load"] = mem_now()

    def run(group, label):
        """group 의 엔진들을 한 바퀴에 순차로 돌린다. 바퀴 시작 간격을 period 로 제한한다."""
        last = None
        for _ in range(a.warm):
            for m, imgsz, _i in group:
                m.predict(frame, imgsz=imgsz, conf=a.conf, device=a.device, verbose=False)
        walls, starts, pre, inf, post = [], [], [], [], []
        done = 0
        for _ in range(a.iter):
            if last is not None and period:
                rest = period - (time.perf_counter() - last)
                if rest > 0:
                    time.sleep(rest)
            last = time.perf_counter()
            starts.append(last)
            for m, imgsz, _i in group:
                r = m.predict(frame, imgsz=imgsz, conf=a.conf, device=a.device, verbose=False)[0]
                if len(group) == 1:
                    pre.append(r.speed["preprocess"]); inf.append(r.speed["inference"]); post.append(r.speed["postprocess"])
            walls.append((time.perf_counter() - last) * 1000)
            done += 1
        if done != a.iter:
            raise RuntimeError(f"{label} 반복 {done}/{a.iter}")
        gaps = [(b - c) * 1000 for c, b in zip(starts, starts[1:])]
        out = {"wall_ms": stats(walls), "start_interval_ms": stats(gaps) if gaps else None,
               "elapsed_s": round(starts[-1] - starts[0] + walls[-1] / 1000, 3)}
        if len(group) == 1:
            out.update({"pre_ms": stats(pre), "inf_ms": stats(inf), "post_ms": stats(post)})
        return out

    try:
        for m, imgsz, info in models:
            info["single"] = run([(m, imgsz, info)], info["name"])
            eprint("단독", info["name"], "wall", info["single"]["wall_ms"], "· 간격", info["single"]["start_interval_ms"])
            result["engines"].append(info)
        if len(models) > 1:
            seq = run(models, "sequential")
            seq["order"] = [i["name"] for _, _, i in models]
            seq["sum_of_singles_mean_ms"] = round(sum(i["single"]["wall_ms"]["mean"] for _, _, i in models), 3)
            result["sequential"] = seq
            eprint("순차", seq["order"], "wall", seq["wall_ms"], "· 단독 합", seq["sum_of_singles_mean_ms"])
    except Exception as exc:
        eprint("실행 오류:", repr(exc))
        return 2
    result["mem_after_run"] = mem_now()

    text = json.dumps(result, ensure_ascii=False, indent=1) + "\n"
    if json_fd is not None:
        with os.fdopen(json_fd, "w", encoding="utf-8") as f:
            f.write(text)
    else:
        with open(a.json, "w", encoding="utf-8") as f:
            f.write(text)
    eprint("완료 · 엔진", len(models), "· 반복", a.iter)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
