# GoPro HERO9(USB-net UDP) 프레임을 젯슨에서 yolo26 추론·렌더 후 cctv-ai 로 중계하는 엣지 스크립트
"""
GoPro HERO9 --USB-net UDP 8554--> Jetson(이 스크립트) --HTTP--> cctv-ai(/cctv/ingest3?drawn=1) --> 관제웹 CAM-03

아이폰 경로(phone_ppe_relay.py)와 같은 구조인데 입력만 GoPro UDP 스트림이다.
유선이라 iOS Safari 타이머 스로틀(약 4.8fps 천장)이 없고, 높이 거치가 되니 CCTV 부감 화각을 재현한다.

★ 이 테스트의 핵심 계측 = 검출된 머리 박스의 정규화 높이.
  E63 학습 분포가 중앙값 0.051 · 5~95% 0.033~0.086 · 최대 0.141 이므로,
  이 범위에 들어와야 검출된다. 거리를 조정하며 이 숫자를 보면 배포 화각 조건이 잡힌다.

사용:
    CCTV_BASE=https://cctv-ai-....run.app nohup python3 gopro_ppe_edge.py > gopro_edge.log 2>&1 &
    확인: curl -s localhost:8444/health | python3 -m json.tool
          curl -s localhost:8444/snapshot -o /tmp/s.jpg
"""

import os
import re
import statistics
import threading
import time
import urllib.parse
import urllib.request
from collections import Counter, deque

import cv2
import numpy as np
from flask import Flask, Response, jsonify
from PIL import Image, ImageDraw, ImageFont

ENGINE = os.environ.get("PPE_ENGINE", "/home/jetson/ppe_yolo26s_640_v5_nc.engine")
CCTV_BASE = os.environ.get("CCTV_BASE", "").rstrip("/")
GOPRO_IP = os.environ.get("GOPRO_IP", "172.23.102.51")
GOPRO_RES = os.environ.get("GOPRO_RES", "1080")
GOPRO_FOV = os.environ.get("GOPRO_FOV", "4")          # 0=Wide 4=Narrow 6=Linear
UDP_URL = os.environ.get("UDP_URL", "udp://0.0.0.0:8554?overrun_nonfatal=1&fifo_size=5000000")
INFER_FPS = float(os.environ.get("INFER_FPS", "12"))   # 추론 cadence (엔진 여력 68fps)
PUSH_FPS = float(os.environ.get("PUSH_FPS", "6"))      # Cloud Run 푸시 cadence (429 회피)
PORT = int(os.environ.get("PORT", "8444"))
FONT_PATH = os.environ.get("FONT", "/home/jetson/NanumGothic-Regular.ttf")
CONF = float(os.environ.get("PPE_CONF", "0.30"))       # 5차 권장 운영 임계

# ★ 헤더 라벨은 엔진 파일명에서 뽑는다. 하드코딩하면 엔진만 바꿨을 때
#   관제웹에 옛 차수가 그대로 떠서 나중에 어느 모델이 돌았는지 알 수 없게 된다
#   (실제로 v5 엔진인데 헤더가 "yolo26 v4" 로 나갔다).
_mv = re.search(r"_(v\d+)_", os.path.basename(ENGINE))
ENGINE_TAG = _mv.group(1) if _mv else os.path.basename(ENGINE).replace(".engine", "")
OW, OH = 640, 360
HEADER_H = 22

# E63 학습 분포 — 검출 가능 범위 판정 기준
TRAIN_MED, TRAIN_LO, TRAIN_HI, TRAIN_MAX = 0.051, 0.033, 0.086, 0.141

NAMES = ["person", "head", "helmet", "safety_vest", "foot", "shoes", "hands", "gloves"]
KO = {"person": "작업자", "head": "안전모 미착용", "helmet": "안전모", "safety_vest": "안전조끼",
      "foot": "발", "shoes": "안전화", "hands": "손", "gloves": "장갑"}
SHOW = {"person", "head", "helmet", "safety_vest"}
COLOR = {"head": (220, 40, 40), "helmet": (40, 190, 90), "person": (70, 140, 240),
         "safety_vest": (240, 170, 40)}

app = Flask(__name__)
_model = None
_lock = threading.Lock()
_state = {"jpg": b"", "stats": None, "ts": 0.0, "frames": 0, "infers": 0,
          "infer_ms": 0.0, "stream_fps": 0.0, "reconnects": 0}
_head_sizes = deque(maxlen=4000)      # 정규화 높이 누적 — 화각 조건 판정용
_font = _fs = None


def _fonts():
    global _font, _fs
    if _font is None:
        try:
            _font = ImageFont.truetype(FONT_PATH, 15)
            _fs = ImageFont.truetype(FONT_PATH, 13)
        except Exception:
            _font = _fs = ImageFont.load_default()
    return _font, _fs


def _ensure_model():
    global _model
    if _model is None:
        from ultralytics import YOLO
        _model = YOLO(ENGINE, task="detect")
        print(f"[gopro] engine loaded: {ENGINE}", flush=True)
    return _model


def webcam_start():
    """웹캠 모드 재시작 — 스트림이 죽으면 이걸로 되살린다."""
    for path in (f"http://{GOPRO_IP}/gp/gpWebcam/STOP",
                 f"http://{GOPRO_IP}/gp/gpWebcam/START?res={GOPRO_RES}&fov={GOPRO_FOV}"):
        try:
            urllib.request.urlopen(path, timeout=5).read()
            time.sleep(2)
        except Exception as e:
            print(f"[gopro] webcam cmd 실패 ({e})", flush=True)


def infer(frame):
    m = _ensure_model()
    t0 = time.perf_counter()
    r = m.predict(frame, imgsz=640, conf=CONF, verbose=False)[0]
    ms = (time.perf_counter() - t0) * 1000
    dets = []
    for b, c, f in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist(), r.boxes.conf.tolist()):
        i = int(c)
        dets.append((NAMES[i] if i < len(NAMES) else str(i), tuple(map(float, b)), float(f)))
    cnt = Counter(d[0] for d in dets)
    bare, worn = cnt.get("head", 0), cnt.get("helmet", 0)
    tot = bare + worn
    stats = {"person_count": cnt.get("person", 0), "fall_count": 0,
             "violation_count": bare, "no_hardhat_count": bare, "hardhat_count": worn,
             "compliance_rate": int(round(100 * worn / tot)) if tot else 100,
             "no_vest_count": 0, "vest_count": cnt.get("safety_vest", 0)}
    # ★ 머리류 박스 정규화 높이 기록 — 학습 범위 대조용
    for name, (x1, y1, x2, y2), _c in dets:
        if name in ("head", "helmet"):
            _head_sizes.append((y2 - y1) / OH)
    return dets, stats, ms


def draw(frame, dets, ms, fps):
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(img)
    f, fs = _fonts()
    d.rectangle((0, 0, OW, HEADER_H), fill=(0, 0, 0))
    d.text((8, 3), f"CAM-03  GoPro (Jetson TensorRT)  PPE (yolo26 {ENGINE_TAG})",
           font=f, fill=(240, 240, 240))
    d.text((OW - 150, 3), f"{ms:.0f}ms {fps:.0f}fps {time.strftime('%H:%M:%S')}",
           font=f, fill=(230, 90, 90))
    for name, (x1, y1, x2, y2), conf in dets:
        if name not in SHOW:
            continue
        col = COLOR.get(name, (200, 200, 200))
        d.rectangle((x1, y1, x2, y2), outline=col, width=2)
        label = f"{KO.get(name, name)} {conf*100:.0f}"
        if name in ("head", "helmet"):          # ★ 머리 크기를 라벨에 함께 표시
            label += f" h{(y2-y1)/OH:.3f}"
        tw = d.textlength(label, font=fs)
        ty = y1 - 17
        if ty < HEADER_H + 1:
            ty = min(y1 + 2, OH - 18)
        tx = min(max(0, x1), OW - tw - 9)
        d.rectangle((tx, ty, tx + tw + 8, ty + 17), fill=col)
        d.text((tx + 4, ty + 1), label, font=fs, fill=(255, 255, 255))
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR),
                           [int(cv2.IMWRITE_JPEG_QUALITY), 72])
    return buf.tobytes() if ok else b""


def _reader():
    """UDP 스트림을 읽어 추론·렌더. 스트림이 끊기면 웹캠 모드를 재시작해 복구한다."""
    interval = 1.0 / INFER_FPS
    while True:
        cap = cv2.VideoCapture(UDP_URL, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            print("[gopro] 스트림 열기 실패 — 웹캠 재시작", flush=True)
            webcam_start()
            with _lock:
                _state["reconnects"] += 1
            time.sleep(3)
            continue
        print("[gopro] 스트림 연결", flush=True)
        last_infer = 0.0
        fail = 0
        t_win, n_win = time.time(), 0
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                fail += 1
                if fail > 60:
                    print("[gopro] 프레임 끊김 — 재연결", flush=True)
                    break
                time.sleep(0.02)
                continue
            fail = 0
            n_win += 1
            if time.time() - t_win >= 2.0:
                with _lock:
                    _state["stream_fps"] = n_win / (time.time() - t_win)
                    _state["frames"] += n_win
                t_win, n_win = time.time(), 0
            now = time.time()
            if now - last_infer < interval:
                continue
            last_infer = now
            small = cv2.resize(frame, (OW, OH))
            try:
                dets, stats, ms = infer(small)
            except Exception as e:
                print(f"[gopro] infer error ({e})", flush=True)
                continue
            with _lock:
                fps = _state["stream_fps"]
            jpg = draw(small, dets, ms, fps)
            with _lock:
                _state.update(jpg=jpg, stats=stats, ts=now, infer_ms=ms)
                _state["infers"] += 1
        cap.release()
        with _lock:
            _state["reconnects"] += 1
        webcam_start()
        time.sleep(2)


def _pusher():
    if not CCTV_BASE:
        print("[gopro] CCTV_BASE 미설정 — 로컬 확인 전용", flush=True)
        return
    url = f"{CCTV_BASE}/cctv/ingest3"
    interval = 1.0 / PUSH_FPS
    sent = 0
    last = 0.0
    while True:
        t0 = time.time()
        with _lock:
            jpg, s, ts = _state["jpg"], _state["stats"], _state["ts"]
        if jpg and ts != last:
            last = ts
            q = urllib.parse.urlencode({
                "drawn": "1",
                "persons": (s or {}).get("person_count", 0),
                "violations": (s or {}).get("violation_count", 0),
                "compliance": (s or {}).get("compliance_rate", 100),
                "hardhat": (s or {}).get("hardhat_count", 0),
                "no_hardhat": (s or {}).get("no_hardhat_count", 0),
            })
            try:
                req = urllib.request.Request(f"{url}?{q}", data=jpg,
                                             headers={"Content-Type": "image/jpeg"})
                with urllib.request.urlopen(req, timeout=4):
                    sent += 1
                    if sent % 100 == 0:
                        print(f"[gopro] pushed {sent}", flush=True)
            except Exception as e:
                print(f"[gopro] push error ({e})", flush=True)
        time.sleep(max(interval - (time.time() - t0), 0.01))


@app.get("/health")
def health():
    with _lock:
        s = dict(_state)
        sizes = list(_head_sizes)
    s.pop("jpg", None)
    s["age"] = round(time.time() - s["ts"], 2) if s["ts"] else None
    s["engine"] = ENGINE.split("/")[-1]
    s["conf"] = CONF
    s["gopro"] = {"ip": GOPRO_IP, "res": GOPRO_RES, "fov": GOPRO_FOV}
    if sizes:
        v = sorted(sizes)
        q = lambda p: v[min(len(v) - 1, int(len(v) * p))]
        inrange = sum(1 for x in v if TRAIN_LO <= x <= TRAIN_HI)
        s["head_size"] = {
            "n": len(v), "median": round(statistics.median(v), 4),
            "p5": round(q(.05), 4), "p95": round(q(.95), 4),
            "min": round(v[0], 4), "max": round(v[-1], 4),
            "in_train_range_pct": round(100 * inrange / len(v), 1),
            "train_ref": {"median": TRAIN_MED, "lo": TRAIN_LO, "hi": TRAIN_HI, "max": TRAIN_MAX},
        }
    else:
        s["head_size"] = None
    return jsonify(s)


@app.get("/snapshot")
def snapshot():
    with _lock:
        jpg = _state["jpg"]
    if not jpg:
        return jsonify({"ok": False, "error": "no frame"}), 404
    return Response(jpg, mimetype="image/jpeg", headers={"Cache-Control": "no-store"})


@app.post("/reset")
def reset():
    """거리별 측정 구간을 나눌 때 머리 크기 누적을 비운다."""
    with _lock:
        _head_sizes.clear()
    return jsonify({"ok": True, "cleared": True})


if __name__ == "__main__":
    _ensure_model()
    webcam_start()
    threading.Thread(target=_reader, daemon=True).start()
    threading.Thread(target=_pusher, daemon=True).start()
    print(f"[gopro] http://0.0.0.0:{PORT}/health · engine={ENGINE.split('/')[-1]} conf={CONF}", flush=True)
    app.run(host="0.0.0.0", port=PORT, threaded=True)
