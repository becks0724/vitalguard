# GoPro UDP 스트림을 CPU(FFmpeg) 와 NVDEC(GStreamer nvv4l2decoder) 로 번갈아 디코드해 CPU·fps·지연을 재는 측정기 (리서치 ③)
"""
같은 8554 스트림을 백엔드만 바꿔 DUR 초씩 읽는다. 푸셔(gopro_ppe_edge.py)와 같은 패턴 —
매 프레임 grab(), 12 fps 만 retrieve(). 프로세스 CPU 는 getrusage(스레드 포함), 시스템 CPU·NVDEC 은
tegrastats 로 같이 잰다. 8554 를 푸셔가 잡고 있으면 안 되므로 CCTV OFF 때만 돌린다.

사용:  GoPro 웹캠 START 뒤   DUR=30 python3 nvdec_probe.py
"""
import os
import re
import resource
import statistics
import subprocess
import time

import cv2

DUR = float(os.environ.get("DUR", "30"))
INFER_FPS = 12.0
FFMPEG_URL = "udp://0.0.0.0:8554?overrun_nonfatal=1&fifo_size=5000000"
GST_HEAD = ('udpsrc port=8554 buffer-size=5000000 caps="video/mpegts,systemstream=true,packetsize=188" '
            "! tsdemux ! queue ! h264parse ! nvv4l2decoder disable-dpb=true ! nvvidconv ")
GST_BGR = GST_HEAD + ("! video/x-raw,format=BGRx ! videoconvert ! video/x-raw,format=BGR "
                      "! appsink drop=true max-buffers=1 sync=false")
GST_BGRX = GST_HEAD + "! video/x-raw,format=BGRx ! appsink drop=true max-buffers=1 sync=false"

CASES = [("ffmpeg", FFMPEG_URL, cv2.CAP_FFMPEG),
         ("gst-nvdec-bgr", GST_BGR, cv2.CAP_GSTREAMER),
         ("gst-nvdec-bgrx", GST_BGRX, cv2.CAP_GSTREAMER),
         ("ffmpeg(재)", FFMPEG_URL, cv2.CAP_FFMPEG)]


def cpu_s():
    r = resource.getrusage(resource.RUSAGE_SELF)
    return r.ru_utime + r.ru_stime


def tegra_summary(lines):
    """tegrastats 줄들 → (시스템 CPU 합 평균 %, NVDEC 활성 줄 수/전체)"""
    cpu, nvdec_on = [], 0
    for ln in lines:
        m = re.search(r"CPU \[([^\]]+)\]", ln)
        if m:
            cpu.append(sum(float(x.split("%")[0]) for x in m.group(1).split(",") if "%" in x))
        n = re.search(r"NVDEC (\S+)", ln)
        if n and n.group(1).lower() != "off":
            nvdec_on += 1
    return (statistics.mean(cpu) if cpu else float("nan")), nvdec_on, len(lines)


def run(name, url, api):
    cap = cv2.VideoCapture(url, api)
    if not cap.isOpened():
        print(f"[{name}] 열기 실패", flush=True)
        return None
    t_open = time.time()
    while not cap.grab():
        if time.time() - t_open > 10:
            print(f"[{name}] 10초 내 프레임 없음", flush=True)
            cap.release()
            return None
        time.sleep(0.02)
    first_s = time.time() - t_open
    ts = subprocess.Popen(["tegrastats", "--interval", "1000"], stdout=subprocess.PIPE, text=True)
    grabs = fails = retr = 0
    r_ms, last_ret, shape = [], 0.0, None
    c0, w0 = cpu_s(), time.time()
    while time.time() - w0 < DUR:
        if not cap.grab():
            fails += 1
            time.sleep(0.02)
            continue
        grabs += 1
        now = time.time()
        if now - last_ret >= 1.0 / INFER_FPS:
            t = time.perf_counter()
            ok, frame = cap.retrieve()
            if ok and frame is not None and frame.shape[2] == 4:
                frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)   # BGRx 경로는 여기서만 변환(12 fps)
            r_ms.append((time.perf_counter() - t) * 1000)
            if ok and frame is not None:
                retr += 1
                shape, last_ret = frame.shape, now
    c1, w1 = cpu_s(), time.time()
    ts.terminate()
    tlines = ts.stdout.read().splitlines()
    cap.release()
    wall = w1 - w0
    sys_cpu, nv_on, nv_n = tegra_summary(tlines)
    print(f"[{name:15s}] 첫프레임 {first_s:4.1f}s  수신 {grabs / wall:5.1f} fps  grab실패 {fails:3d}  "
          f"retrieve {retr:3d}회 p50 {statistics.median(r_ms):5.1f} ms p95 "
          f"{sorted(r_ms)[int(len(r_ms) * 0.95) - 1]:5.1f} ms  "
          f"프로세스CPU {(c1 - c0) / wall * 100:5.1f}%  시스템CPU합 {sys_cpu:5.1f}%  "
          f"NVDEC on {nv_on}/{nv_n}  frame {shape}", flush=True)
    time.sleep(2)


if __name__ == "__main__":
    print(f"DUR={DUR}s · retrieve {INFER_FPS} fps · cv2 {cv2.__version__}", flush=True)
    for c in CASES:
        run(*c)
