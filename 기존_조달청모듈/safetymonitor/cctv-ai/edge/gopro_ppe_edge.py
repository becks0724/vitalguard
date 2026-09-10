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
    ★ 로컬 확인만 할 때는 CCTV_BASE 를 빼고 띄운다 — 클라우드에 아무것도 보내지 않아 과금 0 이다.
      nohup python3 gopro_ppe_edge.py > gopro_edge.log 2>&1 &
      브라우저에서  http://yahboom-1:8444/   ← 영상·지표·fps 조절이 한 화면에 있다
    확인: curl -s localhost:8444/health | python3 -m json.tool
          curl -s localhost:8444/snapshot -o /tmp/s.jpg
    fps 조정(재기동 없이 · GoPro 무접촉): curl -s "localhost:8444/config?push_fps=10&infer_fps=15"
    자세(낙상 1단계) 함께 돌리기: POSE_FALL=1 nohup python3 gopro_ppe_edge.py > gopro_edge.log 2>&1 &
      기본은 꺼짐이라 프로덕션 경로는 그대로다. 켜도 경보를 내지 않고 화면 표시와 계수만 한다(pose_fall.py).
    자세 로그(데이터셋용): POSE_FALL=1 POSE_LOG=1 … → ~/pose_log/pose-*.jsonl (키포인트 17×3 포함)
      라벨 붙이기: curl -s "localhost:8444/mark?label=앉음"  ·  해제: curl -s localhost:8444/mark
      요약 보기:  python3 pose_log_stat.py ~/pose_log/pose-*.jsonl

2026-09-07 (8GB 교체 후):
  · 추론 입력을 640×360 → 960×540 으로 올렸다(엔진 imgsz 960). 640×360 에선 E63 학습 머리 크기(중앙값 33 px ·
    최소 21 px) 아래인 18 px 로 들어가 원거리 작업자가 빠졌다. 960×540 이면 28 px. 표시용 JPEG 는 640×360 그대로.
  · 푸시가 POST 마다 새 TLS 를 맺어 장당 ~150 ms 였다 → 워커당 연결 1개를 재사용(keep-alive).
  · fps 를 바꾸려고 재기동하면 GoPro 웹캠이 STOP/START 를 반복하다 굳는다(11:51 사고) → /config 로 런타임 조정.
"""

import fcntl
import http.client
import json
import os
import re
import socket
import statistics
import struct
import threading
import time
import urllib.parse
import urllib.request
from collections import Counter, deque

import cv2
import numpy as np
from flask import Flask, Response, jsonify, request
from PIL import Image, ImageDraw, ImageFont

ENGINE = os.environ.get("PPE_ENGINE", "/home/jetson/ppe_yolo26s_960_v5_nc.engine")
IMGSZ = int(os.environ.get("PPE_IMGSZ", "960"))        # 엔진을 구운 imgsz 와 반드시 같게
IW, IH = map(int, os.environ.get("INFER_SIZE", "960x540").split("x"))  # 추론 입력 크기(원본 1080p 에서 리사이즈)
CCTV_BASE = os.environ.get("CCTV_BASE", "").rstrip("/")
GOPRO_IP = os.environ.get("GOPRO_IP", "172.23.102.51")
# 관제망 유선 NIC — duckdns_update.sh 의 DUCKDNS_IFACE 와 같은 기준을 쓴다(둘이 어긋나면 진단이 엇갈린다).
WIRE_IFACE = os.environ.get("WIRE_IFACE", "enP8p1s0")
NET_HOST = os.environ.get("NET_HOST", "cctv-gate.example.invalid")   # 관제웹이 젯슨을 찾아오는 이름
GOPRO_RES = os.environ.get("GOPRO_RES", "1080")
GOPRO_FOV = os.environ.get("GOPRO_FOV", "4")          # 0=Wide 4=Narrow 6=Linear
UDP_URL = os.environ.get("UDP_URL", "udp://0.0.0.0:8554?overrun_nonfatal=1&fifo_size=5000000")
PUSH_WORKERS = int(os.environ.get("PUSH_WORKERS", "2"))  # 동시 푸시 워커 수 — keep-alive 로 장당 ~30ms 라 2개면 12fps 넘는다
PORT = int(os.environ.get("PORT", "8444"))
FONT_PATH = os.environ.get("FONT", "/home/jetson/NanumGothic-Regular.ttf")
CONF = float(os.environ.get("PPE_CONF", "0.30"))       # 5차 권장 운영 임계
# 자세(낙상 1단계) — 기본 꺼짐. POSE_FALL=1 로 켠다. 켜도 경보는 내지 않고 표시·계수만 한다.
POSE_FALL = os.environ.get("POSE_FALL", "0") == "1"
POSE_ENGINE = os.environ.get("POSE_ENGINE", "/home/jetson/ultralytics/ultralytics/yolo11n-pose.engine")
POSE_IMGSZ = int(os.environ.get("POSE_IMGSZ", "640"))   # 엔진을 구운 크기와 같아야 한다(정적 shape)
POSE_CONF = float(os.environ.get("POSE_CONF", "0.25"))  # PPE 보다 낮은 해상도라 임계를 낮춰 검출 인원을 맞춘다
POSE_TAG = os.path.basename(POSE_ENGINE).replace(".engine", "")
# 자세 판정 로그 — 임계 조정 근거이자 학습 재료. 기본 꺼짐.
POSE_LOG = os.environ.get("POSE_LOG", "0") == "1"
POSE_LOG_DIR = os.environ.get("POSE_LOG_DIR", "/home/jetson/pose_log")
POSE_LOG_EVERY = int(os.environ.get("POSE_LOG_EVERY", "1"))
POSE_LOG_MB = int(os.environ.get("POSE_LOG_MB", "200"))
# 런타임에 /config 로 바꿀 수 있는 값 — 루프가 매 회 읽는다 (재기동 불필요)
_cfg = {"infer_fps": float(os.environ.get("INFER_FPS", "12")),   # 추론 cadence
        "push_fps": float(os.environ.get("PUSH_FPS", "10"))}     # Cloud Run 푸시 목표율 (워커 합산)

# ★ 헤더 라벨은 엔진 파일명에서 뽑는다. 하드코딩하면 엔진만 바꿨을 때
#   관제웹에 옛 차수가 그대로 떠서 나중에 어느 모델이 돌았는지 알 수 없게 된다
#   (실제로 v5 엔진인데 헤더가 "yolo26 v4" 로 나갔다).
_mv = re.search(r"_(v\d+)_", os.path.basename(ENGINE))
ENGINE_TAG = _mv.group(1) if _mv else os.path.basename(ENGINE).replace(".engine", "")
OW, OH = 640, 360                                       # 표시용(푸시 JPEG) 크기 — 관제웹·대역폭 불변
# 표시 JPEG 품질 — /config?jpeg_q= 로 런타임 조정한다.
#   왜 fps 보다 이걸 먼저 내리는가 (2026-09-10): 끊김의 호소는 "부드럽지 않다"인데
#   fps 를 내리면 그 호소가 더 나빠진다. 품질은 부드러움을 지킨 채 바이트만 깎는다.
#   ★ MJPEG 은 연결마다 전체 스트림을 따로 보내므로, 한 장을 깎으면 시청자 수만큼 곱해서 준다.
JPEG_Q = int(os.environ.get("JPEG_Q", "72"))
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
_pose = None          # PoseFall 인스턴스 — POSE_FALL=1 일 때만 만든다
_lock = threading.Lock()
_state = {"jpg": b"", "raw": None, "stats": None, "ts": 0.0, "frames": 0, "infers": 0,
          "infer_ms": 0.0, "stream_fps": 0.0, "reconnects": 0, "pushed": 0}
_head_sizes = deque(maxlen=4000)      # 정규화 높이 누적 — 화각 조건 판정용
_font = _fs = None


# 박스 라벨 글자 크기. 크면 사람이 가려 화면 확인이 안 된다(09-09 사용자 지적으로 13 → 10).
# 헤더(15)는 읽어야 하므로 건드리지 않는다. /config?label_px= 로 재기동 없이 바꾼다.
LABEL_PX = int(os.environ.get("LABEL_PX", "10"))


def _fonts():
    global _font, _fs
    if _font is None:
        try:
            _font = ImageFont.truetype(FONT_PATH, 15)
            _fs = ImageFont.truetype(FONT_PATH, LABEL_PX)
        except Exception:
            _font = _fs = ImageFont.load_default()
    return _font, _fs


def _chip_h():
    """라벨 배경 높이 — 글자 크기를 따라가야 여백이 일정하다."""
    return LABEL_PX + 4


def _ensure_model():
    global _model
    if _model is None:
        from ultralytics import YOLO
        _model = YOLO(ENGINE, task="detect")
        print(f"[gopro] engine loaded: {ENGINE}", flush=True)
    return _model


def webcam_start(force=True):
    """웹캠 모드 재시작 — 스트림이 죽으면 이걸로 되살린다.
    force=False 면 이미 송출 중(status 2)일 때 건드리지 않는다. STOP/START 를 반복하면
    HERO9 웹캠이 굳어 USB 물리 재연결이 필요해진다(2026-09-07 실측 · 25분 4회에서 재현)."""
    if not force:
        try:
            st = json.loads(urllib.request.urlopen(
                f"http://{GOPRO_IP}/gp/gpWebcam/STATUS", timeout=3).read())
            if st.get("status") == 2:
                print("[gopro] 이미 송출 중 — 웹캠 무접촉", flush=True)
                return
        except Exception:
            pass
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
    r = m.predict(frame, imgsz=IMGSZ, conf=CONF, verbose=False)[0]
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
    # ★ 머리류 박스 정규화 높이 기록 — 학습 범위 대조용 (추론 입력 높이 기준)
    for name, (x1, y1, x2, y2), _c in dets:
        if name in ("head", "helmet"):
            _head_sizes.append((y2 - y1) / IH)
    return dets, stats, ms


# 촬영 구역 — 검증 촬영 때 어디에 설지 화면으로 지시하기 위한 안내선. 판정에 관여하지 않는다.
# 정규화 (x1, y1, x2, y2) · None 이면 안 그린다. /config?zone=... 로 재기동 없이 옮긴다.
_zone = {"box": None, "label": "촬영 구역"}


def _draw_zone(d, ow, oh, header_h, font=None):
    """구역을 점선 테두리 + 모서리 갈고리로 그린다. 사람 박스와 헷갈리지 않게 색과 모양을 달리한다."""
    z = _zone["box"]
    if not z:
        return
    x1, y1 = z[0] * ow, header_h + z[1] * (oh - header_h)
    x2, y2 = z[2] * ow, header_h + z[3] * (oh - header_h)
    col = (255, 210, 0)
    dash = 12
    for x in range(int(x1), int(x2), dash * 2):          # 점선 — 실선은 검출 박스와 혼동된다
        d.line((x, y1, min(x + dash, x2), y1), fill=col, width=3)
        d.line((x, y2, min(x + dash, x2), y2), fill=col, width=3)
    for y in range(int(y1), int(y2), dash * 2):
        d.line((x1, y, x1, min(y + dash, y2)), fill=col, width=3)
        d.line((x2, y, x2, min(y + dash, y2)), fill=col, width=3)
    g = min(28, (x2 - x1) / 3, (y2 - y1) / 3)            # 모서리 갈고리 — 구역임을 분명히
    for cx, cy, dx, dy in ((x1, y1, 1, 1), (x2, y1, -1, 1), (x1, y2, 1, -1), (x2, y2, -1, -1)):
        d.line((cx, cy, cx + g * dx, cy), fill=col, width=5)
        d.line((cx, cy, cx, cy + g * dy), fill=col, width=5)
    if font is not None:
        t = _zone["label"]
        tw = d.textlength(t, font=font)
        ty = max(header_h + 2, y1 - 20)
        d.rectangle((x1, ty, x1 + tw + 10, ty + 18), fill=col)
        d.text((x1 + 5, ty + 2), t, font=font, fill=(20, 20, 20))


def draw(frame, dets, ms, fps, people=()):
    """표시용 프레임(OW×OH)에 그린다. dets·people 은 추론 입력(IW×IH) 좌표라 축척을 맞춘다."""
    sx, sy = OW / IW, OH / IH
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(img)
    f, fs = _fonts()
    _draw_zone(d, OW, OH, HEADER_H, fs)  # 검출 박스보다 먼저 — 사람이 위에 오게
    d.rectangle((0, 0, OW, HEADER_H), fill=(0, 0, 0))
    # ★ 헤더는 실제로 로드된 것만 적는다. 안 도는 모델을 적으면 허위 표기다(2026-08-01 CAM-02 사고).
    ppe = f"PPE yolo26 {ENGINE_TAG}@{IMGSZ}"
    if _pose is None:
        right = f"{ms:.0f}ms {fps:.0f}fps {time.strftime('%H:%M:%S')}"
        cands = [f"CAM-03  GoPro (Jetson TensorRT)  {ppe}", f"CAM-03  GoPro  {ppe}", f"CAM-03  {ppe}"]
    else:
        pose = f"자세 {POSE_TAG.replace('yolo', '')}@{POSE_IMGSZ}"
        right = f"{ms:.0f}+{_pose.ms:.0f}ms {fps:.0f}fps {time.strftime('%H:%M:%S')}"
        cands = [f"CAM-03  GoPro (Jetson TensorRT)  {ppe} · {pose}",
                 f"CAM-03  GoPro  {ppe} · {pose}", f"CAM-03  {ppe} · {pose}"]
    rw = d.textlength(right, font=f)
    left = cands[-1]
    for c in cands:                         # 글자가 길어지면 겹치므로 폭을 재서 고른다
        if d.textlength(c, font=f) + rw + 18 <= OW:
            left = c
            break
    d.text((8, 3), left, font=f, fill=(240, 240, 240))
    d.text((OW - rw - 8, 3), right, font=f, fill=(230, 90, 90))
    for name, (x1, y1, x2, y2), conf in dets:
        if name not in SHOW:
            continue
        hn = (y2 - y1) / IH                     # 정규화 높이는 추론 좌표에서 계산
        x1, y1, x2, y2 = x1 * sx, y1 * sy, x2 * sx, y2 * sy
        col = COLOR.get(name, (200, 200, 200))
        d.rectangle((x1, y1, x2, y2), outline=col, width=2)
        label = f"{KO.get(name, name)} {conf*100:.0f}"
        if name in ("head", "helmet"):          # ★ 머리 크기를 라벨에 함께 표시
            label += f" h{hn:.3f}"
        lh = _chip_h()
        tw = d.textlength(label, font=fs)
        ty = y1 - lh
        if ty < HEADER_H + 1:
            ty = min(y1 + 2, OH - lh - 1)
        tx = min(max(0, x1), OW - tw - 9)
        d.rectangle((tx, ty, tx + tw + 8, ty + lh), fill=col)
        d.text((tx + 3, ty + 1), label, font=fs, fill=(255, 255, 255))
    if people:                              # 자세 — 골격 + 상태 칩. PPE 박스(직선)와 구별되게 선으로 그린다
        import pose_fall as _pf
        for p in people:
            px1, py1, px2, py2 = [v * (sx if i % 2 == 0 else sy) for i, v in enumerate(p["box"])]
            lab, col = _pf.label_of(p)
            kp = p.get("kp")
            if kp:                          # ★ 골격을 그려야 칩이 누구 것인지 보인다(박스만으로는 PPE 와 섞인다)
                pts = [(x * sx, y * sy, c) for x, y, c in kp]
                for a, b in _pf.SKELETON:
                    if pts[a][2] >= _pf.KP_DRAW and pts[b][2] >= _pf.KP_DRAW:
                        d.line((pts[a][0], pts[a][1], pts[b][0], pts[b][1]), fill=col, width=2)
                for x, y, c in pts:
                    if c >= _pf.KP_DRAW:
                        d.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(255, 255, 255))
            lh = _chip_h()
            tw = d.textlength(lab, font=fs)
            cy = min(py2 - lh, OH - lh - 1)
            cx = min(max(0, px1), OW - tw - 9)
            d.rectangle((cx, cy, cx + tw + 8, cy + lh), fill=col)
            d.text((cx + 3, cy + 1), lab, font=fs, fill=(255, 255, 255))
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR),
                           [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_Q])
    return buf.tobytes() if ok else b""


def _reader():
    """UDP 스트림을 읽어 추론·렌더. 매 프레임 grab()(소비만·FIFO 적체 방지)하고
    추론할 프레임만 retrieve()(디코드→numpy 변환)한다.
    ⚠ 캡처를 별도 스레드로 분리하면 안 된다 — cap.read()/grab() 이 GIL 을 쥔 채 블록해
    추론 스레드가 0.5fps 로 굶는다(2026-09-01 py-spy 실측). 한 스레드가 정답."""
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
            if not cap.grab():
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
            if now - last_infer < 1.0 / _cfg["infer_fps"]:   # /config 로 바뀌면 다음 프레임부터 반영
                continue
            ok, frame = cap.retrieve()
            if not ok or frame is None:
                continue
            last_infer = now
            inf_frame = cv2.resize(frame, (IW, IH))         # 추론 입력 — 원거리 머리가 학습 크기로 들어오게
            try:
                dets, stats, ms = infer(inf_frame)
            except Exception as e:
                print(f"[gopro] infer error ({e})", flush=True)
                continue
            with _lock:
                fps = _state["stream_fps"]
            people = []
            if _pose is not None:
                try:
                    people = _pose.update(inf_frame, now)
                except Exception as e:
                    print(f"[gopro] pose error ({e})", flush=True)
            disp = cv2.resize(inf_frame, (OW, OH)) if (IW, IH) != (OW, OH) else inf_frame
            jpg = draw(disp, dets, ms, fps, people)
            with _lock:
                _state.update(jpg=jpg, stats=stats, ts=now, infer_ms=ms,
                              raw=inf_frame)   # 주석 없는 추론 입력 — 미탐지 원인 진단용
                _state["infers"] += 1
                _state["pose"] = _pose.summary(people) if _pose is not None else None
                _state["pose_people"] = [
                    {k: p[k] for k in ("id", "posture", "state", "tier", "torso", "thigh",
                                       "thigh_len", "speed", "drop")}
                    for p in people[:12]] if _pose is not None else None
        cap.release()
        with _lock:
            _state["reconnects"] += 1
        webcam_start()
        time.sleep(2)


_push_last = 0.0      # 마지막으로 '선점된' 프레임 ts — 워커 간 같은 프레임 중복 전송 방지
_cctv = urllib.parse.urlsplit(CCTV_BASE) if CCTV_BASE else None


def _connect():
    """워커당 keep-alive 연결 1개. POST 마다 TLS 를 새로 맺던 종전(~150 ms/장)의 대체."""
    cls = http.client.HTTPSConnection if _cctv.scheme == "https" else http.client.HTTPConnection
    return cls(_cctv.hostname, _cctv.port, timeout=4)


def _push_worker(wid):
    """푸시 워커 — PUSH_WORKERS 개가 병렬로 돈다. 각자 보내는 시점의 최신 프레임을 선점해 전송.
    도착 순서가 뒤바뀔 수 있으나 둘 다 최신 프레임이라 체감 ≤1프레임 (2026-09-01 사용자 수용·A안)."""
    global _push_last
    path = f"{_cctv.path.rstrip('/')}/cctv/ingest3"
    conn, err_streak = None, 0
    time.sleep(wid / _cfg["push_fps"])          # 위상 어긋내기 — 균등 간격 송신
    while True:
        t0 = time.time()
        interval = PUSH_WORKERS / _cfg["push_fps"]   # 워커당 주기 — 합산하면 push_fps · /config 즉시 반영
        with _lock:
            jpg, s, ts = _state["jpg"], _state["stats"], _state["ts"]
            fresh = bool(jpg) and ts != _push_last
            if fresh:
                _push_last = ts                 # 전송 전에 선점 — 다른 워커가 같은 프레임을 못 집는다
        if fresh:
            q = urllib.parse.urlencode({
                "drawn": "1",
                "persons": (s or {}).get("person_count", 0),
                "violations": (s or {}).get("violation_count", 0),
                "compliance": (s or {}).get("compliance_rate", 100),
                "hardhat": (s or {}).get("hardhat_count", 0),
                "no_hardhat": (s or {}).get("no_hardhat_count", 0),
            })
            try:
                if conn is None:
                    conn = _connect()
                conn.request("POST", f"{path}?{q}", body=jpg, headers={"Content-Type": "image/jpeg"})
                resp = conn.getresponse()
                resp.read()                     # 본문을 비워야 같은 연결을 다음 요청에 쓸 수 있다
                if resp.status >= 300:
                    raise RuntimeError(f"HTTP {resp.status}")
                err_streak = 0
                with _lock:
                    _state["pushed"] += 1
                    n = _state["pushed"]
                if n % 100 == 0:
                    print(f"[gopro] pushed {n}", flush=True)
            except Exception as e:
                err_streak += 1
                if err_streak <= 3 or err_streak % 100 == 0:   # 403 4만 줄 같은 로그 폭주 방지
                    print(f"[gopro] push error ({e}) ×{err_streak}", flush=True)
                try:
                    conn.close()                # 끊긴 연결은 버리고 다음 장에서 새로 맺는다
                except Exception:
                    pass
                conn = None
                time.sleep(min(err_streak, 5))  # 연속 실패면 물러선다 — 서버가 죽었을 때 CPU·로그 낭비 방지
        time.sleep(max(interval - (time.time() - t0), 0.01))


def _pusher():
    if not CCTV_BASE:
        print("[gopro] CCTV_BASE 미설정 — 로컬 확인 전용", flush=True)
        return
    for i in range(PUSH_WORKERS):
        threading.Thread(target=_push_worker, args=(i,), daemon=True).start()


@app.get("/health")
def health():
    with _lock:
        s = dict(_state)
        sizes = list(_head_sizes)
    s.pop("jpg", None)
    s.pop("raw", None)          # 넘파이 배열이라 JSON 으로 못 나간다
    s["age"] = round(time.time() - s["ts"], 2) if s["ts"] else None
    s["engine"] = ENGINE.split("/")[-1]
    s["conf"] = CONF
    s["imgsz"] = IMGSZ
    s["infer_size"] = f"{IW}x{IH}"
    s["cfg"] = dict(_cfg, jpeg_q=JPEG_Q)
    s["gopro"] = {"ip": GOPRO_IP, "res": GOPRO_RES, "fov": GOPRO_FOV}
    s["pose_detail"] = _pose.health() if _pose is not None else None
    s["pose_log"] = _pose.log.health() if (_pose is not None and _pose.log is not None) else None
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
    """?raw=1 이면 박스를 그리기 전 추론 입력 그대로 — 재추론으로 미탐지를 따질 때 쓴다."""
    with _lock:
        jpg = _state["jpg"]
        raw = _state.get("raw")
    if request.args.get("raw") and raw is not None:
        ok, buf = cv2.imencode(".jpg", raw, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
        if ok:
            return Response(buf.tobytes(), mimetype="image/jpeg",
                            headers={"Cache-Control": "no-store"})
    if not jpg:
        return jsonify({"ok": False, "error": "no frame"}), 404
    return Response(jpg, mimetype="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/config")
def config():
    """fps 런타임 조정 — 재기동 없이 (GoPro 웹캠을 건드리지 않는다).
    예: /config?push_fps=10&infer_fps=15 · 인자 없이 부르면 현재값만 돌려준다."""
    for k in ("push_fps", "infer_fps"):
        v = request.args.get(k)
        if v is None:
            continue
        try:
            _cfg[k] = min(30.0, max(0.5, float(v)))
        except ValueError:
            return jsonify({"ok": False, "error": f"{k} 는 숫자여야 한다"}), 400
    px = request.args.get("label_px")
    if px is not None:
        global LABEL_PX, _font, _fs
        try:
            LABEL_PX = min(20, max(7, int(px)))
        except ValueError:
            return jsonify({"ok": False, "error": "label_px 는 7~20 정수"}), 400
        _font = _fs = None                  # 폰트 캐시를 비워 다음 프레임부터 새 크기로 그린다
    q = request.args.get("jpeg_q")
    if q is not None:
        global JPEG_Q
        try:
            JPEG_Q = min(95, max(30, int(q)))
        except ValueError:
            return jsonify({"ok": False, "error": "jpeg_q 는 30~95 정수"}), 400
    z = request.args.get("zone")
    if z is not None:
        if z in ("off", "none", ""):
            _zone["box"] = None
        else:
            try:
                v = [min(1.0, max(0.0, float(x))) for x in z.split(",")]
                if len(v) != 4 or v[0] >= v[2] or v[1] >= v[3]:
                    raise ValueError
                _zone["box"] = v
            except ValueError:
                return jsonify({"ok": False,
                                "error": "zone 은 x1,y1,x2,y2 (0~1, x1<x2, y1<y2) 또는 off"}), 400
    if request.args.get("zone_label"):
        _zone["label"] = request.args.get("zone_label")[:20]
    return jsonify({"ok": True, **_cfg, "push_workers": PUSH_WORKERS, "zone": _zone["box"],
                    "zone_label": _zone["label"], "label_px": LABEL_PX,
                    "jpeg_q": JPEG_Q})


# ── 네트워크 상태 ─────────────────────────────────────────────────────────────
# 왜 이걸 화면에 박는가 (2026-09-10)
#   영상이 끊겨 원인을 찾는 데 오래 걸렸다. 실제로는 유선이 빠져 무선(2.4GHz)으로 넘어간 것이었는데
#   화면 어디에도 그 사실이 없었다. 관제웹은 티켓을 계속 200 으로 내주고 있어 서버 로그로도 안 잡혔다.
#   ⟹ "지금 어느 길로 나가는가"와 "관제 이름이 나를 가리키는가"를 눈에 보이게 만든다.
_net_prev = {}                       # 인터페이스별 (시각, 카운터) — 초당 증가분 계산용
_net_dns = {"t": 0.0, "ip": None}    # DNS 조회는 30초 캐시(화면은 3초마다 물어본다)


def _sysnet(iface, key, default=""):
    try:
        with open(f"/sys/class/net/{iface}/{key}") as f:
            return f.read().strip()
    except OSError:
        return default


def _iface_ip(iface):
    """인터페이스의 IPv4 — ip 명령을 띄우지 않고 ioctl 로 직접 읽는다."""
    if not iface:
        return None
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        return socket.inet_ntoa(fcntl.ioctl(
            s.fileno(), 0x8915, struct.pack("256s", iface[:15].encode()))[20:24])
    except OSError:
        return None
    finally:
        s.close()


def _default_iface():
    """기본 경로가 나가는 인터페이스 = 지금 영상이 타고 있는 길."""
    try:
        with open("/proc/net/route") as f:
            for ln in f.read().splitlines()[1:]:
                c = ln.split()
                if len(c) > 2 and c[1] == "00000000":
                    return c[0]
    except OSError:
        pass
    return None


def _wifi_signal(iface):
    """무선 신호 세기(dBm) — iw 를 부르지 않고 /proc 에서 읽는다. 유선이면 None."""
    try:
        with open("/proc/net/wireless") as f:
            for ln in f:
                if ln.strip().startswith(iface + ":"):
                    return int(float(ln.split()[3].rstrip(".")))
    except (OSError, ValueError, IndexError):
        pass
    return None


def _net_rate(iface):
    """직전 호출 이후의 초당 증가분. 첫 호출과 오래 쉰 뒤는 None — 0 으로 속이지 않는다."""
    if not iface:
        return None
    now = time.time()
    cur = tuple(int(_sysnet(iface, "statistics/" + k, "0") or 0)
                for k in ("tx_bytes", "rx_packets", "rx_dropped"))
    t0, prev = _net_prev.get(iface, (0.0, None))
    _net_prev[iface] = (now, cur)
    dt = now - t0
    if prev is None or dt <= 0 or dt > 30:
        return None
    return {"tx_mbps": round((cur[0] - prev[0]) * 8 / dt / 1e6, 2),
            "rx_pps": round((cur[1] - prev[1]) / dt, 1),
            "drop_ps": round((cur[2] - prev[2]) / dt, 1)}


def _local_ips():
    """이 젯슨이 가진 모든 IPv4 — DNS 가 나를 가리키는지 대조할 때 쓴다."""
    out = set()
    try:
        for i in os.listdir("/sys/class/net"):
            ip = _iface_ip(i)
            if ip and not ip.startswith("127."):
                out.add(ip)
    except OSError:
        pass
    return out


@app.get("/netstat")
def netstat():
    """지금 나가는 길 + 관제 이름이 나를 가리키는지. 화면이 3초마다 부른다.
    /health(1초)와 나눈 것은 DNS 조회가 비싸서다."""
    # ★ 한 요청 안에서 같은 인터페이스의 증가율을 두 번 재면 안 된다 —
    #   두 번째 호출은 시간차가 0 에 가까워 0 Mbps 가 나온다(2026-09-10 실측: 유선 17.39 vs 기본경로 0.0).
    #   기본 경로가 곧 유선인 정상 상태에서 항상 걸리므로, 요청 단위로 한 번만 재고 나눠 쓴다.
    _rates = {}

    def rate_of(i):
        if i and i not in _rates:
            _rates[i] = _net_rate(i)
        return _rates.get(i)

    d = _default_iface()
    ip = _iface_ip(d)
    now = time.time()
    if now - _net_dns["t"] > 30:
        try:
            _net_dns["ip"] = socket.gethostbyname(NET_HOST)
        except OSError:
            _net_dns["ip"] = None
        _net_dns["t"] = now
    dns_ip = _net_dns["ip"]

    # 유선 — carrier 는 1 인데 수신 패킷이 0 이면 "꽂혔지만 그 너머에 아무도 없다"는 뜻이다.
    #   살아 있는 스위치 포트라면 브로드캐스트만으로도 몇 개는 들어온다(2026-09-10 실측: 5초에 0개).
    w = None
    if os.path.isdir(f"/sys/class/net/{WIRE_IFACE}"):
        w = {"iface": WIRE_IFACE, "carrier": _sysnet(WIRE_IFACE, "carrier") == "1",
             "speed": _sysnet(WIRE_IFACE, "speed"), "ip": _iface_ip(WIRE_IFACE),
             "rate": rate_of(WIRE_IFACE)}
    return jsonify({
        "host": NET_HOST, "iface": d, "ip": ip,
        "kind": ("무선" if _wifi_signal(d) is not None else "유선") if d else None,
        "signal_dbm": _wifi_signal(d) if d else None,
        "rate": rate_of(d),
        "dns_ip": dns_ip, "dns_match": bool(dns_ip and dns_ip in _local_ips()),
        "wire_iface": WIRE_IFACE, "wire": w,
    })


@app.get("/stream")
def stream():
    """로컬 확인용 MJPEG — cctv-ai 없이 브라우저에서 바로 본다(과금 0).
    송출 규칙은 서버(mjpeg_ppe)와 같다 — 같은 프레임은 다시 보내지 않고, 새 프레임이 없으면
    1초마다 마지막 것을 재송출해 브라우저 연결을 유지한다."""
    def gen():
        last_ts, last_sent = None, 0.0
        while True:
            with _lock:
                jpg, ts = _state["jpg"], _state["ts"]
            now = time.time()
            if jpg and (ts != last_ts or now - last_sent >= 1.0):
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpg + b"\r\n"
                last_ts, last_sent = ts, now
            time.sleep(0.01)
    return Response(gen(), mimetype="multipart/x-mixed-replace; boundary=frame",
                    headers={"Cache-Control": "no-store"})


@app.get("/")
def viewer():
    return Response(_VIEWER_HTML, mimetype="text/html")


@app.get("/mark")
def mark():
    """자세 로그에 사람이 붙이는 라벨. 연출 촬영에서 정답을 만드는 유일한 길이다.
    예: /mark?label=앉음  ·  /mark?label=넘어짐&note=매트  ·  /mark (인자 없이 = 라벨 해제)
    라벨은 해제할 때까지 이후 모든 기록에 붙는다."""
    if _pose is None or _pose.log is None:
        return jsonify({"ok": False, "error": "자세 로그가 꺼져 있다 (POSE_LOG=1 로 기동)"}), 409
    cur = _pose.log.set_label(request.args.get("label", ""), request.args.get("note", ""))
    print(f"[gopro] 자세 라벨 = {cur['label'] or '(해제)'} {cur['note']}", flush=True)
    return jsonify({"ok": True, **cur, **_pose.log.health()})


@app.post("/reset")
def reset():
    """거리별 측정 구간을 나눌 때 머리 크기 누적을 비운다."""
    with _lock:
        _head_sizes.clear()
    return jsonify({"ok": True, "cleared": True})


# 로컬 확인 페이지 — 영상 + 핵심 지표 + fps 조절. 클라우드를 켜지 않고 재생 상태를 보기 위한 것이다.
_VIEWER_HTML = """<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CAM-03 로컬 확인</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;background:#0d1114;color:#e6edea;font:14px/1.6 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
 .wrap{max-width:1180px;margin:0 auto;padding:20px 16px 40px}
 h1{font-size:16px;font-weight:600;margin:0 0 4px}
 .sub{color:#7d8f86;font-size:12.5px;margin:0 0 14px}
 .layout{display:grid;grid-template-columns:290px 1fr;gap:14px;align-items:start}
 @media (max-width:900px){.layout{grid-template-columns:1fr}}
 img{width:100%;border-radius:4px;background:#000;display:block}
 .k{font-size:11px;color:#7d8f86;letter-spacing:.04em}
 .v{font-size:19px;font-variant-numeric:tabular-nums;margin-top:2px}
 .v small{font-size:12px;color:#7d8f86}
 .warn{color:#e0a44e}
 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:1px;background:#222c27;
       border:1px solid #222c27;border-radius:4px;margin-top:12px;overflow:hidden}
 .cell{background:#141a17;padding:10px 12px}
 .row{margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
 button{background:#1b2420;color:#e6edea;border:1px solid #2c3833;border-radius:4px;
        padding:6px 13px;font:inherit;font-size:13px;cursor:pointer}
 button:hover{background:#243029} button:focus-visible{outline:2px solid #46ce8c}
 .lab{color:#7d8f86;font-size:12px}
 /* 좌측 실시간 자세 목록 */
 aside{border:1px solid #222c27;border-radius:4px;background:#141a17;overflow:hidden;
       position:sticky;top:12px}
 aside h2{font-size:13px;margin:0;padding:10px 12px;border-bottom:1px solid #222c27;
          display:flex;justify-content:space-between;align-items:baseline;gap:8px}
 aside h2 span{font-size:11px;color:#7d8f86;font-weight:400}
 .now{display:flex;flex-wrap:wrap;gap:5px;padding:10px 12px;border-bottom:1px solid #222c27}
 .chip{font-size:12px;padding:2px 8px;border-radius:3px;background:#1e2822;color:#cfe0d7;
       font-variant-numeric:tabular-nums;white-space:nowrap}
 ul{list-style:none;margin:0;padding:0;max-height:360px;overflow-y:auto}
 li{padding:8px 12px;border-bottom:1px solid #1b2420;display:grid;
    grid-template-columns:34px 1fr;gap:8px;align-items:start}
 li:last-child{border-bottom:none}
 .id{font-size:12px;color:#7d8f86;font-variant-numeric:tabular-nums;padding-top:2px}
 .pl{font-size:13px;font-weight:500}
 .pm{font-size:11.5px;color:#8b9c92;font-variant-numeric:tabular-nums;margin-top:1px}
 .none{padding:14px 12px;color:#7d8f86;font-size:12.5px}
 .foot{padding:10px 12px;border-top:1px solid #222c27}
 .bars{display:flex;flex-direction:column;gap:4px;margin-top:6px}
 .bar{display:grid;grid-template-columns:44px 1fr 38px;gap:7px;align-items:center;font-size:11.5px}
 .bar i{display:block;height:5px;background:#2a3630;border-radius:3px;overflow:hidden}
 .bar i>b{display:block;height:100%;background:#46ce8c}
 .bar em{font-style:normal;text-align:right;color:#9fb3a8;font-variant-numeric:tabular-nums}
 .tier{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
</style>
<div class="wrap">
 <h1>CAM-03 로컬 확인</h1>
 <p class="sub">젯슨이 직접 내보내는 화면이다. 관제 서버를 켜지 않으므로 과금이 없다.</p>
 <div class="layout">
  <aside id="posewrap">
   <h2>실시간 자세 <span id="pcov"></span></h2>
   <div class="now" id="pnow">-</div>
   <ul id="plist"><li class="none">대기 중</li></ul>
   <div class="foot">
    <div class="k">관절 관측률</div>
    <div class="bars" id="pjoint"></div>
    <div class="k" style="margin-top:10px">판정 근거 누계</div>
    <div class="tier" id="ptier"></div>
    <div class="k" style="margin-top:10px">낙상 판정</div>
    <div class="v" id="pfev" style="font-size:15px">-</div>
   </div>
  </aside>
  <main>
   <img src="/stream" alt="CAM-03 실시간">
   <div class="grid">
    <div class="cell"><div class="k">추론</div><div class="v" id="ms">-<small> ms</small></div></div>
    <div class="cell"><div class="k">수신 스트림</div><div class="v" id="sfps">-<small> fps</small></div></div>
    <div class="cell"><div class="k">추론 주기</div><div class="v" id="ifps">-<small> fps</small></div></div>
    <div class="cell"><div class="k">머리 크기 중앙값</div><div class="v" id="hm">-</div></div>
    <div class="cell"><div class="k">학습 범위 안</div><div class="v" id="hr">-<small> %</small></div></div>
    <div class="cell"><div class="k">작업자</div><div class="v" id="pc">-</div></div>
    <div class="cell"><div class="k">안전모 미착용</div><div class="v" id="nh">-</div></div>
    <div class="cell"><div class="k">서버 전송</div><div class="v" id="px">-</div></div>
   </div>
   <div class="k" style="margin-top:14px">네트워크</div>
   <div class="grid" style="margin-top:4px">
    <div class="cell"><div class="k">지금 나가는 길</div><div class="v" id="nrt">-</div></div>
    <div class="cell"><div class="k">송신</div><div class="v" id="ntx">-<small> Mbps</small></div></div>
    <div class="cell"><div class="k">무선 신호</div><div class="v" id="nsg">-</div></div>
    <div class="cell"><div class="k">관제 이름</div><div class="v" id="ndn">-</div></div>
   </div>
   <div class="lab" id="nwire" style="margin-top:7px">-</div>
   <div class="row">
    <span class="lab">추론 fps</span>
    <button data-f="5">5</button><button data-f="10">10</button>
    <button data-f="12">12</button><button data-f="15">15</button>
    <span class="lab" id="engine"></span>
   </div>
   <div class="row">
    <span class="lab">화질</span>
    <button data-q="45">45</button><button data-q="55">55</button>
    <button data-q="72">72</button><button data-q="85">85</button>
    <span class="lab" id="qnow"></span>
   </div>
  </main>
 </div>
</div>
<script>
 const $=i=>document.getElementById(i);
 const KO={walking:'\uc9c1\ub9bd',standing:'\uc11c\uc788\uc74c',seated:'\uc549\uc74c',
   unstable:'\ubd88\uc548\uc815',lying:'\ub204\uc6c0',
   fallen:'\ub0d9\uc0c1',unknown:'\ud310\uc815\ubd88\uac00'};
 const JN={shoulder:'\uc5b4\uae68',hip:'\uc5c9\ub369\uc774',knee:'\ubb34\ub985',ankle:'\ubc1c\ubaa9'};
 const TN={'A+':'A+','A':'A','B':'B','-':'\ubd88\uac00'};
 const num=v=>v==null?'\u2014':v;
 async function tick(){
  try{
   const h=await (await fetch('/health',{cache:'no-store'})).json();
   $('ms').innerHTML=(h.infer_ms??0).toFixed(1)+'<small> ms</small>';
   $('sfps').innerHTML=(h.stream_fps??0).toFixed(1)+'<small> fps</small>';
   $('ifps').innerHTML=(h.cfg?.infer_fps??0)+'<small> fps</small>';
   const hs=h.head_size||{};
   $('hm').textContent=hs.median!=null?hs.median.toFixed(3):'-';
   $('hr').innerHTML=(hs.in_train_range_pct??0)+'<small> %</small>';
   const st=h.stats||{};
   $('pc').textContent=st.person_count??'-';
   $('nh').innerHTML=(st.no_hardhat_count??0)>0
     ?'<span class="warn">'+st.no_hardhat_count+'</span>':(st.no_hardhat_count??'-');
   $('px').textContent=h.pushed?h.pushed.toLocaleString():'0 (\ub85c\uceec \uc804\uc6a9)';
   $('engine').textContent=(h.engine||'')+' @'+(h.infer_size||'');
   $('qnow').textContent='\ud604\uc7ac '+(h.cfg?.jpeg_q??h.jpeg_q??'-');

   const pd=h.pose_detail;
   if(!pd){ $('posewrap').hidden=true; return; }
   $('posewrap').hidden=false;
   const ppl=h.pose_people||[];
   $('pcov').textContent='\ud3ec\uc988 '+ppl.length+' / PPE '+(st.person_count??'-');
   const order=['seated','standing','walking','unstable','lying','fallen','unknown'];
   const ent=Object.entries(h.pose||{}).filter(([,v])=>v>0)
     .sort((a,b)=>order.indexOf(a[0])-order.indexOf(b[0]));
   $('pnow').innerHTML=ent.length?ent.map(([k,v])=>
     '<span class="chip">'+(KO[k]||k)+' '+v+'</span>').join(''):'<span class="chip">0</span>';
   $('plist').innerHTML=ppl.length?ppl.map(p=>{
     const k=['lying','fallen','unstable'].includes(p.state)?p.state:p.posture;
     return '<li><span class="id">#'+p.id+'</span><span><span class="pl">'+(KO[k]||k)+'</span>'
       +'<div class="pm">\uadfc\uac70 '+(TN[p.tier]||p.tier)
       +' \u00b7 \ubab8\ud1b5 '+num(p.torso)+'\u00b0 \u00b7 \ud5c8\ubc85\uc9c0 '+num(p.thigh)+'\u00b0'
       +(p.thigh_len!=null?' \u00b7 \uae38\uc774 '+p.thigh_len.toFixed(2):'')
       +'<br>\uc774\ub3d9 '+p.speed.toFixed(3)+' \u00b7 \ub099\ud558 '+p.drop.toFixed(3)
       +'</div></span></li>';
   }).join(''):'<li class="none">\uac80\ucd9c\ub41c \uc0ac\ub78c \uc5c6\uc74c</li>';
   $('pjoint').innerHTML=['shoulder','hip','knee','ankle'].map(k=>{
     const v=(pd.joint_pct||{})[k]??0;
     return '<div class="bar"><span>'+JN[k]+'</span><i><b style="width:'+v+'%"></b></i><em>'+v+'%</em></div>';
   }).join('');
   $('ptier').innerHTML=Object.entries(pd.tier||{}).filter(([,v])=>v>0)
     .map(([k,v])=>'<span class="chip">'+(TN[k]||k)+' '+v+'</span>').join('')||'\u2014';
   $('pfev').innerHTML=(pd.fallen_events>0?'<span class="warn">'+pd.fallen_events+'</span>':pd.fallen_events)
     +'<small> \ud68c \u00b7 '+(pd.ms??0).toFixed(1)+' ms</small>';
  }catch(e){}
 }
 document.querySelectorAll('button[data-f]').forEach(b=>b.onclick=async()=>{
   await fetch('/config?infer_fps='+b.dataset.f); tick();
 });
 document.querySelectorAll('button[data-q]').forEach(b=>b.onclick=async()=>{
   await fetch('/config?jpeg_q='+b.dataset.q); tick();
 });
 tick(); setInterval(tick,1000);

 const nwarn=(t,bad)=>bad?'<span class="warn">'+t+'</span>':t;
 async function ntick(){
  try{
   const n=await (await fetch('/netstat',{cache:'no-store'})).json();
   const r=n.rate||{};
   $('nrt').innerHTML=n.iface
     ?nwarn((n.kind||'')+'<small> '+(n.ip||'\uc8fc\uc18c \uc5c6\uc74c')+'</small>',n.kind==='\ubb34\uc120'||!n.ip)
     :nwarn('\uacbd\ub85c \uc5c6\uc74c',true);
   $('ntx').innerHTML=(r.tx_mbps==null?'-':r.tx_mbps.toFixed(2))+'<small> Mbps</small>'
     +((r.drop_ps>0)?' '+nwarn('\ub4dc\ub86d +'+r.drop_ps,true):'');
   $('nsg').innerHTML=n.signal_dbm!=null
     ?nwarn(n.signal_dbm+'<small> dBm</small>',n.signal_dbm<=-60)
     :'<small>\uc720\uc120 \u00b7 \ud574\ub2f9 \uc5c6\uc74c</small>';
   $('ndn').innerHTML=n.dns_ip
     ?nwarn(n.dns_match?'\uc77c\uce58':'\ubd88\uc77c\uce58<small> '+n.dns_ip+'</small>',!n.dns_match)
     :nwarn('\uc870\ud68c \uc2e4\ud328',true);
   const w=n.wire, wr=(w&&w.rate)||{};
   $('nwire').innerHTML=!w?nwarn('\uc720\uc120 '+n.wire_iface+' \u2014 \uc7a5\uce58 \uc5c6\uc74c',true)
     :!w.carrier?nwarn('\uc720\uc120 '+w.iface+' \u2014 \ucf00\uc774\ube14 \uc5c6\uc74c',true)
     :w.ip?'\uc720\uc120 '+w.iface+' \u2014 '+w.ip+' \u00b7 '+w.speed+' Mbps'
     :nwarn('\uc720\uc120 '+w.iface+' \u2014 \ub9c1\ud06c\ub9cc \uc788\uace0 \ub124\ud2b8\uc6cc\ud06c \uc5c6\uc74c ('+w.speed+' Mbps) \u00b7 \uc218\uc2e0 '
            +(wr.rx_pps==null?'-':wr.rx_pps)+'/s',true);
  }catch(e){}
 }
 ntick(); setInterval(ntick,3000);
</script>
</html>"""


if __name__ == "__main__":
    _ensure_model()

    if POSE_FALL:
        from pose_fall import PoseFall
        _log = None
        if POSE_LOG:
            from pose_fall import PoseLog
            _log = PoseLog(POSE_LOG_DIR, max_mb=POSE_LOG_MB, every=POSE_LOG_EVERY)
            print(f"[gopro] 자세 로그 → {_log.path}", flush=True)
        _pose = PoseFall(POSE_ENGINE, imgsz=POSE_IMGSZ, conf=POSE_CONF, log=_log)
        print(f"[gopro] 자세 판정 켜짐 — {POSE_ENGINE.split('/')[-1]} @{POSE_IMGSZ} (경보 없음·계수만)", flush=True)
    webcam_start(force=False)
    threading.Thread(target=_reader, daemon=True).start()
    threading.Thread(target=_pusher, daemon=True).start()
    print(f"[gopro] http://0.0.0.0:{PORT}/health · engine={ENGINE.split('/')[-1]} conf={CONF}", flush=True)
    app.run(host="0.0.0.0", port=PORT, threaded=True)
