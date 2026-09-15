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

import base64
import fcntl
import http.client
import hashlib
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

# ★ 09-12 직사각 엔진으로 교체. 960x540 을 정사각(960x960)으로 맞추면 회색 420px 이 붙어
#   착용자를 맨머리로 오인하는 쪽만 2.7배가 된다(CAM-03 사람확인 분할 실측 .128 → .048).
#   ⚠ ENGINE 과 IMGSZ 는 반드시 같이 바꾼다. 형상이 어긋나면 첫 추론에서 assert 로 죽는다.
# ★ 09-15 15:00 v5 → v7d 영속화. 사용자 승인으로 14:52 에 env 로 배포했는데, env 는
#   **재부팅 한 번이면 사라진다** — 라이브가 사람의 기억에 의존하는 상태였다(09-14 yolo11s 때와 같다).
#   근거 = 현장 helmet 0→74/100 · CAM-03 검출 428→434(b=6 c=0 p=.031) · helmet 1→115/168.
#   ⛔ 대가 = 현장 shoes 82→62(안전화 트랙 보류 중이라 감시 항목).
#   되돌리기 = PPE_ENGINE 에 아래 v5 경로를 주고 재시작. 즉시·무손실.
#     v5: /home/jetson/ppe_yolo26s_rect544x960_v5_nc.engine
ENGINE = os.environ.get("PPE_ENGINE", "/home/jetson/ppe_yolo26s_rect544x960_v7d_nc.engine")
# 엔진을 구운 imgsz 와 반드시 같게. 직사각 엔진은 "544,960"(h,w) 처럼 콤마로 준다 —
# 숫자 하나만 주면 정사각으로 letterbox 돼 고정형상 엔진이 죽는다(09-12 실제로 겪음).
_IMGSZ_RAW = os.environ.get("PPE_IMGSZ", "544,960")
IMGSZ = tuple(int(v) for v in _IMGSZ_RAW.split(",")) if "," in _IMGSZ_RAW else int(_IMGSZ_RAW)
IMGSZ_TAG = "x".join(map(str, IMGSZ)) if isinstance(IMGSZ, tuple) else str(IMGSZ)  # 헤더 표기용
IW, IH = map(int, os.environ.get("INFER_SIZE", "960x540").split("x"))  # 추론 입력 크기(원본 1080p 에서 리사이즈)
CCTV_BASE = os.environ.get("CCTV_BASE", "").rstrip("/")
GOPRO_IP = os.environ.get("GOPRO_IP", "172.23.102.51")
# 관제망 유선 NIC — duckdns_update.sh 의 DUCKDNS_IFACE 와 같은 기준을 쓴다(둘이 어긋나면 진단이 엇갈린다).
WIRE_IFACE = os.environ.get("WIRE_IFACE", "enP8p1s0")
NET_HOST = os.environ.get("NET_HOST", "cctv-gate.example.invalid")   # 관제웹이 젯슨을 찾아오는 이름
GOPRO_RES = os.environ.get("GOPRO_RES", "1080")
GOPRO_FOV = os.environ.get("GOPRO_FOV", "4")          # 0=Wide 4=Narrow 6=Linear
UDP_URL = os.environ.get("UDP_URL", "udp://0.0.0.0:8554?overrun_nonfatal=1&fifo_size=5000000")
# ★ 09-14 ffmpeg 저지연. 기본값은 스트림을 5~6초 읽어 분석한 뒤에야 첫 프레임을 내놓는다 —
#   실측으로 기동 시 빨아들이는 버퍼가 6.22초였고 이 옵션으로 0.01초가 됐다.
#   ⚠ 다만 사용자 체감 지연(2.68초)은 이것으로 안 줄었다. 그 2.4초는 GoPro 인코더 쪽이다.
#     이 옵션의 실효는 「기동이 빨라지고 전환 시 적체가 안 생긴다」까지다. 과장하지 말 것.
#   ⚠ probesize 32 는 스트림 분석을 거의 안 한다. 이 GoPro 에서는 재연결 0·디코드오류 증가 0 으로
#     통과했으나 다른 소스에서는 열기 실패할 수 있다 — env 로 되돌릴 수 있게 두었다.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS",
                      "fflags;nobuffer|flags;low_delay|probesize;32|analyzeduration;0|max_delay;0")
PUSH_WORKERS = int(os.environ.get("PUSH_WORKERS", "2"))  # 동시 푸시 워커 수 — keep-alive 로 장당 ~30ms 라 2개면 12fps 넘는다
PORT = int(os.environ.get("PORT", "8444"))
FONT_PATH = os.environ.get("FONT", "/home/jetson/NanumGothic-Regular.ttf")
CONF = float(os.environ.get("PPE_CONF", "0.30"))       # 5차 권장 운영 임계
# ★ head 전용 문턱 — 09-12 임시방편이었고 **원인이 고쳐져 걷었다(0.35 → 0.30)**.
#   ⛔ 종전 주석의 「원인 = ONNX 그래프 변환」은 **기각**됐다. 실제 원인은 letterbox 기하다.
#   같은 기하면 .pt 와 엔진이 소수점까지 같다(오경보 6/125 · 검출 461/464 양쪽 동일) — 기하 100% · 프레임워크 0%.
#   CAM-03 사람확인 분할 실측(conf 0.30) — 정사각 엔진 .128/.991 · 직사각 엔진 .048/.9935
#   ⚠ 0.30 초과로 되돌리지 말 것. 직사각+0.30 이 정사각+0.35(.104/.991) 보다 두 축 다 낫다.
#   ⚠ head 만 올린다. 전역 CONF 를 올리면 helmet·person·vest 가 같이 죽는다.
HEAD_CONF = float(os.environ.get("PPE_HEAD_CONF", "0.30"))
# 자세(낙상 1단계) — 기본 꺼짐. POSE_FALL=1 로 켠다. 켜도 경보는 내지 않고 표시·계수만 한다.
POSE_FALL = os.environ.get("POSE_FALL", "0") == "1"
# ★ 09-14 yolo11s 로 기본값 교체. 현장 실측 — 판정 불가 단 "-" 5.97% → 0.00%,
#   낙상 판정 가능 프레임 90.2% → 99.6%. 비용은 포즈 15.73ms(예산의 33.8%)로 여유.
#   ⚠ env 로만 걸면 재부팅에 사라진다 — 기본값 자체를 바꾼 이유다.
#   되돌리려면 POSE_ENGINE 에 yolo11n-pose.engine 을 준다(엔진 파일 둘 다 상주).
POSE_ENGINE = os.environ.get("POSE_ENGINE", "/home/jetson/ultralytics/ultralytics/yolo11s-pose.engine")
POSE_IMGSZ = int(os.environ.get("POSE_IMGSZ", "640"))   # 엔진을 구운 크기와 같아야 한다(정적 shape)
POSE_CONF = float(os.environ.get("POSE_CONF", "0.25"))  # PPE 보다 낮은 해상도라 임계를 낮춰 검출 인원을 맞춘다
# ★ 09-14 낙상/누움인 사람을 반투명으로 덮는다. 판정에는 관여하지 않고 화면 표시만 바꾼다.
#   덮는 상태를 고른 이유 — fallen(낙상)·lying(누움)은 「바닥에 있다」는 결론이고,
#   unstable(불안정)은 지나가는 중간 상태라 늘 켜지면 화면이 시끄러워진다(오늘 7,854 vs 17프레임).
POSE_FILL = os.environ.get("POSE_FILL", "fallen,lying")   # 빈 문자열이면 끈다
POSE_FILL_A = max(0, min(255, int(os.environ.get("POSE_FILL_ALPHA", "90"))))  # 0=투명 255=불투명

# ── 실행-증거 동기화 (09-14) ──
#   ⛔ 09-14 에 저장소 코드를 읽고 내린 결론이 젯슨 구동본에 대한 답이 아닐 뻔했다
#     (/snapshot 의 파라미터를 /capture 것으로 인용했다. 그때 젯슨 판본은 사후에 확인 불가였다).
#   코드 인용·API 관측·로그를 같은 build 로 묶지 않으면 정확한 분석도 다른 배포본의 답이 된다.
#   ⟹ 코드 지문은 젯슨이 스스로 계산하고, git commit 은 배포할 때 .build 에 심는다.
def _sha12(path):
    """파일 내용의 sha1 앞 12자. mtime 과 달리 복사·재배포에 흔들리지 않는다."""
    try:
        h = hashlib.sha1()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()[:12]
    except Exception:
        return None


def _build_info():
    here = os.path.dirname(os.path.abspath(__file__))
    info = {"code_sha": {n: _sha12(os.path.join(here, n))
                         for n in ("gopro_ppe_edge.py", "pose_fall.py")}}
    try:                                   # 배포 스크립트가 심어 둔 표식(없으면 None)
        with open(os.path.join(here, ".build"), encoding="utf-8") as f:
            info.update(json.load(f))
    except Exception:
        info["commit"] = None
    return info


BUILD = _build_info()

# ── 낙상 전후 원본 프레임을 메모리에 잡아 둔다 (09-14) ──
#   왜 놓치는지는 로그가 아니라 프레임을 봐야 안다 — 12:19 시연에서 넘어진 사람이 2.48초 사라졌는데
#   (같은 프레임의 다른 3~4명은 계속 잡혔다) 로그만으로는 NMS·가림·흐림을 못 갈랐다.
#   추론 입력 그대로라 문턱을 바꿔 오프라인 재추론할 수 있다. 디스크·추론 비용 없음.
CLIP_PRE = int(os.environ.get("POSE_CLIP_PRE", "30"))     # 사건 직전 보관 프레임 수
CLIP_POST = int(os.environ.get("POSE_CLIP_POST", "50"))   # 사건 이후 보관 프레임 수
_clip_ring = deque(maxlen=CLIP_PRE)
_clip = {"frames": [], "active": False, "at": None, "events": 0}

# ★ 09-15 촬영용 녹화. _clip 은 낙상 **판정이 떠야** 잡히므로 놓친 낙상의 원본이 안 남는다.
#   재현율은 놓친 것을 세는 일이라, 그 상태로 촬영하면 가장 중요한 자료가 사라진다.
#   여기서는 판정과 무관하게 프레임을 디스크에 남기고 파일명에 시각을 박아 t_onset 을 후판독한다.
REC_DIR = os.environ.get("POSE_REC_DIR", os.path.expanduser("~/fall_takes"))
REC_MAX = int(os.environ.get("POSE_REC_MAX", "1800"))   # 테이크당 상한 — 켜둔 채 잊어도 디스크가 안 찬다
REC_Q = int(os.environ.get("POSE_REC_Q", "90"))         # JPEG 품질
_rec = {"on": False, "dir": None, "n": 0, "t0": None, "label": "", "dropped": 0}
_fill_stat = {"frames": 0, "people": 0, "torso": 0, "box": 0}  # 실제로 그린 횟수
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
# ★ 09-15 `_(v\d+)_` 는 v7d 의 d 를 못 받아 매칭에 실패했고, 폴백으로 **전체 파일명**(30자)이
#   태그가 되어 헤더가 겹쳤다(v5 는 2자라 안 겹쳤다). 차수에 붙는 접미 문자를 받는다.
_mv = re.search(r"_(v\d+[a-z]*)_", os.path.basename(ENGINE))
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
# 조끼 학습 분포 — 아직 값이 없다(safety_vest 는 2026-07-30 과업 제외 · 재개 검토 중).
#   ★ 값이 없다고 계측을 미루지 않는다. 지금 관측 분포를 쌓아 두어야 나중에 대조할 것이 있다.
#   기준이 정해지면 /config?vest_ref=lo,med,hi,max 로 재기동 없이 꽂는다 — 학습 트랙이
#   상수를 소유하고 이 화면은 계측만 하므로, 상수 변경에 배포가 끼어들지 않게 한다.
#   ★ 기준값에는 반드시 근거(basis)를 함께 단다 — 어느 데이터셋의 분포인지 화면에 보이지 않으면
#     "학습 범위 안 74.8%" 가 무엇 대비 74.8% 인지 아무도 모른다(2026-09-10 [M/L] 지적).
# ⚠ 2026-09-10 철회 — SH17 로컬값(중앙 0.1248)을 잠정으로 넣었다가 걷어냈다. 6차 실제 학습 로그상
#   조끼는 903개이고 **유일 출처가 CSS** 다(E63·507 라벨엔 조끼 0개). SH17 조끼는 학습에 안 들어갔다.
#   틀린 기준선으로 "범위 밖"을 칠하는 것보다 기준 없이 분포만 쌓는 게 낫다.
#   CSS 확보 후 /config?vest_ref=lo,med,hi,max,근거 로 꽂는다.
_vest_ref = None

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
_state = {"jpg": b"", "raw": None, "stats": None, "dets": None, "ts": 0.0, "frames": 0, "infers": 0,
          "infer_ms": 0.0, "stream_fps": 0.0, "reconnects": 0, "pushed": 0}
_head_sizes = deque(maxlen=4000)      # 정규화 높이 누적 — 화각 조건 판정용
_vest_sizes = deque(maxlen=4000)      # 조끼 정규화 높이
# ★ 2026-09-10 결함 수정 — 종전엔 head 와 helmet 을 한 통(_head_sizes)에 담고 head 기준으로 쟀다.
#   E63 전수 실측에서 두 분포가 31% 어긋난다(head 중앙 0.0593 · helmet 0.0776 · [M/L] 측정).
#   섞어 담으면 안전모가 잡히기 시작하는 순간 그 수치가 무엇 대비인지 알 수 없게 된다.
#   지금 안전모 검출률이 0% 라 우연히 문제가 안 보였을 뿐이다 — 보이기 전에 가른다.
_helmet_sizes = deque(maxlen=4000)
# 종횡비(가로/세로) — 구부리거나 돌아서면 크기는 그대로인데 모양이 바뀐다.
#   크기만 재면 "자세를 다양하게 찍었는가"를 못 잰다(2026-09-10 사용자 지적).
_vest_aspects = deque(maxlen=4000)
# helmet 누적 감시 — 순간값(착용 0)만으로는 "현장에서 안전모를 잡기 시작했는가"를 못 잰다.
#   2026-09-10 [M/L] 실측: 현장 35장에서 131명 중 helmet **0개**(문턱·해상도를 풀어도 0).
#   배포 전후를 같은 자로 비교하려면 순간값이 아니라 누적이 필요하다.
_helmet_seen = deque(maxlen=4000)     # 추론 프레임마다 helmet 검출 여부 0/1
_helmet_last_ts = 0.0                 # 마지막으로 helmet 을 본 시각 (0 = 기동 후 한 번도 없음)
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
    if HEAD_CONF > CONF:                      # head 만 더 높은 문턱을 건다
        dets = [d for d in dets if d[0] != "head" or d[2] >= HEAD_CONF]
    cnt = Counter(d[0] for d in dets)
    bare, worn = cnt.get("head", 0), cnt.get("helmet", 0)
    tot = bare + worn
    stats = {"person_count": cnt.get("person", 0), "fall_count": 0,
             "violation_count": bare, "no_hardhat_count": bare, "hardhat_count": worn,
             "compliance_rate": int(round(100 * worn / tot)) if tot else 100,
             "no_vest_count": 0, "vest_count": cnt.get("safety_vest", 0),
             # ★ 09-15 실제로 로드한 PPE 엔진 태그. 관제웹이 하드코딩("YOLO26s v5") 대신 이걸 쓴다.
             #   경로 = 관제웹 → 젯슨 게이트 /cctv/stats3 → 푸셔 /health 의 stats.
             #   ⚠ 게이트가 화이트리스트로 키를 거르므로 cctv_gate.py 도 같이 고쳐야 흐른다.
             "engine": ENGINE_TAG}
    # ★ 머리류 박스 정규화 높이 기록 — 학습 범위 대조용 (추론 입력 높이 기준)
    for name, (x1, y1, x2, y2), _c in dets:
        if name == "head":
            _head_sizes.append((y2 - y1) / IH)
        elif name == "helmet":
            _helmet_sizes.append((y2 - y1) / IH)
        elif name == "safety_vest":
            h_ = y2 - y1
            _vest_sizes.append(h_ / IH)
            if h_ > 1:
                _vest_aspects.append((x2 - x1) / h_)
    global _helmet_last_ts
    hit = 1 if stats["hardhat_count"] > 0 else 0
    _helmet_seen.append(hit)
    if hit:
        _helmet_last_ts = time.time()
    return dets, stats, ms


# 촬영 구역 — 검증 촬영 때 어디에 설지 화면으로 지시하기 위한 안내선. 판정에 관여하지 않는다.
# 정규화 (x1, y1, x2, y2) · None 이면 안 그린다. /config?zone=... 로 재기동 없이 옮긴다.
_zone = {"box": None, "label": "촬영 구역"}


def _clip_capture(now, frame, people):
    """낙상이 뜨면 그 전후 원본 프레임을 메모리에 모은다. 사건 하나를 다 모으는 동안 새 사건은 무시한다."""
    _clip_ring.append((now, frame))
    if _clip["active"]:
        _clip["frames"].append((now, frame))
        if len(_clip["frames"]) >= CLIP_PRE + CLIP_POST:
            _clip["active"] = False
        return
    if any(p.get("state") in ("fallen", "lying") for p in people):
        _clip["frames"] = list(_clip_ring)      # 직전 구간을 통째로 — 링에 이미 쌓여 있다
        _clip["at"] = now
        _clip["events"] += 1
        _clip["active"] = True


def _rec_write(now, frame):
    """녹화 중이면 원본 한 장을 디스크에 남긴다. 파일명 = 순번_시각.jpg (시각이 곧 t_onset 의 자다)."""
    if not _rec["on"]:
        return
    if _rec["n"] >= REC_MAX:                      # 상한 — 자동 종료
        _rec["on"] = False
        print(f"[rec] 상한 {REC_MAX} 도달 — 자동 종료 ({_rec['dir']})", flush=True)
        return
    try:
        ok, enc = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), REC_Q])
        if not ok:
            _rec["dropped"] += 1
            return
        with open(os.path.join(_rec["dir"], f"{_rec['n']:05d}_{now:.3f}.jpg"), "wb") as fp:
            fp.write(enc.tobytes())
        _rec["n"] += 1
    except Exception as e:                        # 디스크가 차도 판정 루프는 멈추지 않는다
        _rec["dropped"] += 1
        if _rec["dropped"] in (1, 10, 100):
            print(f"[rec] 쓰기 실패 {_rec['dropped']}회 ({e})", flush=True)


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
    ppe = f"PPE yolo26 {ENGINE_TAG}@{IMGSZ_TAG}"
    if _pose is None:
        right = f"{ms:.0f}ms {fps:.0f}fps {time.strftime('%H:%M:%S')}"
        cands = [f"CAM-03  GoPro (Jetson TensorRT)  {ppe}", f"CAM-03  GoPro  {ppe}", f"CAM-03  {ppe}"]
    else:
        pose = f"자세 {POSE_TAG.replace('yolo', '')}@{POSE_IMGSZ}"
        right = f"{ms:.0f}+{_pose.ms:.0f}ms {fps:.0f}fps {time.strftime('%H:%M:%S')}"
        cands = [f"CAM-03  GoPro (Jetson TensorRT)  {ppe} · {pose}",
                 f"CAM-03  GoPro  {ppe} · {pose}", f"CAM-03  {ppe} · {pose}",
                 # ★ 09-15 사다리 맨 아래를 더 낮춘다 — 종전엔 가장 짧은 후보도 화면을 넘어
                 #   폴백이 폴백 노릇을 못 했다. 라벨을 떼도 어느 엔진인지는 식별된다.
                 f"CAM-03  {ENGINE_TAG}@{IMGSZ_TAG} · {POSE_TAG.replace('yolo', '')}@{POSE_IMGSZ}"]
    rw = d.textlength(right, font=f)
    left = cands[-1]
    for c in cands:                         # 글자가 길어지면 겹치므로 폭을 재서 고른다
        if d.textlength(c, font=f) + rw + 18 <= OW:
            left = c
            break
    # ★ 09-15 그래도 넘치면 잘라낸다. 후보만 늘리면 **다음에 더 긴 이름이 올 때** 같은 일이 난다 —
    #   겹침은 「이번 이름」의 문제가 아니라 「폭 보장이 없다」의 문제다.
    while d.textlength(left, font=f) + rw + 18 > OW and len(left) > 12:
        left = left[:-2] + "…"
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
        # ★ 반투명 채우기. 누운 사람이 없으면 합성 자체를 건너뛴다 — 평소 비용 0 이다.
        _fill_on = {x for x in POSE_FILL.split(",") if x}
        _down = [q for q in people if q.get("state") in _fill_on] if _fill_on else []
        if _down:
            _fill_stat["frames"] += 1
            _fill_stat["people"] += len(_down)
            _ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
            _od = ImageDraw.Draw(_ov)
            for q in _down:
                qc = _pf.COLOR.get(q["state"], (230, 50, 50)) + (POSE_FILL_A,)
                qx1, qy1, qx2, qy2 = [v * (sx if i % 2 == 0 else sy) for i, v in enumerate(q["box"])]
                qkp = q.get("kp")
                if qkp:
                    qp = [(x * sx, y * sy, c) for x, y, c in qkp]
                    # 몸통은 어깨(5,6)·엉덩이(12,11) 순서로 돌아야 사각형이 꼬이지 않는다
                    quad = [qp[i] for i in (5, 6, 12, 11)]
                    if all(v[2] >= _pf.KP_DRAW for v in quad):
                        _od.polygon([(v[0], v[1]) for v in quad], fill=qc)
                        _fill_stat["torso"] += 1
                    # 사지 굵기는 사람 크기에 맞춘다 — 고정폭이면 먼 사람이 덩어리가 된다
                    lw = max(3, int((qy2 - qy1) * 0.07))
                    for a, b in _pf.SKELETON:
                        if qp[a][2] >= _pf.KP_DRAW and qp[b][2] >= _pf.KP_DRAW:
                            _od.line((qp[a][0], qp[a][1], qp[b][0], qp[b][1]), fill=qc, width=lw)
                else:                       # 관절이 없으면 박스라도 덮는다(부재 ≠ 표시 안 함)
                    _od.rectangle((qx1, qy1, qx2, qy2), fill=qc)
                    _fill_stat["box"] += 1
            img = Image.alpha_composite(img.convert("RGBA"), _ov).convert("RGB")
            d = ImageDraw.Draw(img)         # 합성이 새 이미지를 만들었으니 그리기 손잡이를 다시 잡는다
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
        # ★ 09-14 입력 지연 자가측정. 스트림의 PTS 는 「촬영 시각」이고 벽시계는 「지금」이라,
        #   둘이 벌어진 만큼이 디코더·FIFO 에 쌓인 양이다. 스톱워치 없이 지연을 본다.
        pts0 = wall0 = None
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
            _pts = cap.get(cv2.CAP_PROP_POS_MSEC)
            if _pts and _pts > 0:
                if pts0 is None:
                    pts0, wall0 = _pts, now
                else:
                    # 벽시계가 간 시간 - PTS 가 간 시간 = 그동안 쌓인(또는 풀린) 지연
                    _lag = (now - wall0) - (_pts - pts0) / 1000.0
                    with _lock:
                        _state["input_lag_s"] = round(_lag, 3)
                        _state["pts_s"] = round(_pts / 1000.0, 2)
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
            _clip_capture(now, inf_frame, people)   # 그리기 전 원본을 잡는다
            _rec_write(now, inf_frame)             # 촬영 녹화 — 판정과 무관하게 남긴다
            disp = cv2.resize(inf_frame, (OW, OH)) if (IW, IH) != (OW, OH) else inf_frame
            jpg = draw(disp, dets, ms, fps, people)
            with _lock:
                _state.update(jpg=jpg, stats=stats, ts=now, infer_ms=ms,
                              raw=inf_frame,   # 주석 없는 추론 입력 — 미탐지 원인 진단용
                              dets=dets)       # /capture 가 프레임과 같은 락에서 함께 낸다
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
                # ★ 09-15 화면이 어느 모델인지 스스로 말하게 한다. 종전엔 관제웹이
                #   "YOLO26s v5" 를 하드코딩해 엔진을 바꿔도 안 따라왔다(v7d 로 바꾸자 한 화면에서
                #   엣지 오버레이와 모순이 됐다). 서버가 이 키를 모르면 그냥 무시하므로 하위 호환된다.
                "engine": ENGINE_TAG,
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


# ⚠ 이 기준은 **E63 한 셋**의 분포다. 6차는 E63·507·SH17 을 섞어 학습했으므로
#   여기에 대한 "범위 안 %" 는 모델 전체 학습 분포 대비가 아니다(507 head 중앙 0.0617·max 0.4941).
#   합산 분포가 확정되면 /config?head_ref= 로 갈아끼운다 — 상수를 코드에 굳히지 않는다.
#   근거 문구가 「E63 단독」이 아니라 「E63 학습 분할」인 이유 — E63_FRACTION 0.4 + 홀드아웃
#   시퀀스 30% 제외를 거친 뒤의 분포다. E63 전수(중앙 0.0593)보다 이쪽이 학습 실제에 가깝다.
_head_ref = {"median": TRAIN_MED, "lo": TRAIN_LO, "hi": TRAIN_HI, "max": TRAIN_MAX,
             "basis": "E63 학습 분할"}
# helmet 은 대응하는 분할값이 없어 전수값을 쓴다 — 자가 다르다는 것을 근거 문구가 말하게 둔다.
#   helmet 중앙(0.0776)이 head(0.0593)보다 31% 커야 정상이다. 둘이 비슷해지면 오검출 신호다.
_helmet_ref = {"lo": 0.0309, "median": 0.0776, "hi": 0.1184, "max": 0.2011,
               "basis": "E63 전수(train) n=15698"}


def _size_summary(sizes, ref):
    """정규화 높이 분포 요약. ★ 머리와 조끼가 **같은 함수**를 쓰게 해서 두 수치를 그대로 비교한다
    (2026-09-08 · 양쪽 계산식이 다른 채로 개선폭을 말한 사고를 되풀이하지 않는다).
    ref 가 None 이면 학습 분포가 아직 없다는 뜻 — 범위 비율을 0 으로 꾸미지 않고 None 으로 낸다."""
    if not sizes:
        return None
    v = sorted(sizes)
    q = lambda p: v[min(len(v) - 1, int(len(v) * p))]
    out = {"n": len(v), "median": round(statistics.median(v), 4),
           "p5": round(q(.05), 4), "p95": round(q(.95), 4),
           "min": round(v[0], 4), "max": round(v[-1], 4),
           "in_train_range_pct": None, "train_ref": ref}
    if ref:
        inrange = sum(1 for x in v if ref["lo"] <= x <= ref["hi"])
        out["in_train_range_pct"] = round(100 * inrange / len(v), 1)
    return out


@app.get("/health")
def health():
    with _lock:
        s = dict(_state)
        sizes = list(_head_sizes)
        hmsizes = list(_helmet_sizes)
        vsizes = list(_vest_sizes)
    s.pop("jpg", None)
    s.pop("raw", None)          # 넘파이 배열이라 JSON 으로 못 나간다
    s["age"] = round(time.time() - s["ts"], 2) if s["ts"] else None
    s["engine"] = ENGINE.split("/")[-1]
    s["conf"] = CONF
    s["head_conf"] = HEAD_CONF
    s["fill"] = {"on": POSE_FILL, "alpha": POSE_FILL_A, **_fill_stat}
    s["imgsz"] = IMGSZ
    s["infer_size"] = f"{IW}x{IH}"
    s["cfg"] = dict(_cfg, jpeg_q=JPEG_Q)
    s["gopro"] = {"ip": GOPRO_IP, "res": GOPRO_RES, "fov": GOPRO_FOV}
    s["build"] = BUILD           # ★ 이 관측이 어느 코드에서 나왔나
    s["pose_detail"] = _pose.health() if _pose is not None else None
    s["pose_log"] = _pose.log.health() if (_pose is not None and _pose.log is not None) else None
    s["head_size"] = _size_summary(sizes, _head_ref)
    s["helmet_size"] = _size_summary(hmsizes, _helmet_ref)
    s["vest_size"] = _size_summary(vsizes, _vest_ref)
    s["vest_aspect"] = _size_summary(list(_vest_aspects), None)
    hv = list(_helmet_seen)
    s["helmet_watch"] = {
        "frames": len(hv), "seen_frames": sum(hv),
        "seen_pct": round(100 * sum(hv) / len(hv), 2) if hv else None,
        "last_seen_ago_s": round(time.time() - _helmet_last_ts, 1) if _helmet_last_ts else None,
    } if hv else None
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


COLLECT_DIR = os.environ.get(
    "COLLECT_DIR", os.path.expanduser("~/Documents/조달청-공모전 관련자료/CAM03-COLLECT"))
# 촬영 전 기준선 — 2026-09-10 12:07 실측(한 사람·한 벌·한 자리, n=1592).
#   이 폭이 넓어지는지가 "자세를 다양하게 찍었는가" 의 답이다. 넓어지지 않으면 프레임만 는 것이다.
COLLECT_BASE = {"size": 7.1, "aspect": 14.8}
_collect_cache = {"size": -1, "data": None}


@app.get("/collect")
def collect():
    """수집 현황 — 수집기가 남긴 manifest.jsonl 을 읽어 라벨별로 센다.
    파일 크기가 그대로면 다시 파싱하지 않는다(화면이 3초마다 부른다)."""
    mf = os.path.join(COLLECT_DIR, "manifest.jsonl")
    running = False
    try:
        for d in os.listdir("/proc"):
            if not d.isdigit():
                continue
            try:
                with open(f"/proc/{d}/cmdline", "rb") as f:
                    cl = f.read().replace(b"\0", b" ").decode("utf-8", "replace")
            except OSError:
                continue
            if "cam03_collect" in cl and cl.startswith("python3"):
                running = True
                break
    except OSError:
        pass

    try:
        sz = os.path.getsize(mf)
    except OSError:
        return jsonify({"ok": True, "running": running, "dir": COLLECT_DIR,
                        "total": 0, "labels": [], "last": None, "base": COLLECT_BASE})
    if sz != _collect_cache["size"]:
        by, last = {}, None
        try:
            with open(mf, encoding="utf-8") as f:
                for ln in f:
                    try:
                        r = json.loads(ln)
                    except ValueError:
                        continue
                    by[r.get("label") or "?"] = by.get(r.get("label") or "?", 0) + 1
                    last = r.get("saved_at") or last
        except OSError:
            pass
        _collect_cache["size"] = sz
        _collect_cache["data"] = {"by": by, "last": last}
    d = _collect_cache["data"] or {"by": {}, "last": None}
    by = d["by"]
    return jsonify({
        "ok": True, "running": running, "dir": COLLECT_DIR,
        "total": sum(by.values()), "last": d["last"], "base": COLLECT_BASE,
        # ★ vest0(미착용) 창이 없으면 그 데이터셋은 학습에 못 쓴다 — 한 사람이 늘 착용이면
        #   모델이 "그 사람인가?" 로 100% 맞출 수 있다. 화면이 그 사실을 말하게 한다.
        "has_negative": any(k.startswith("vest0") for k in by),
        "labels": sorted(by.items(), key=lambda kv: -kv[1]),
    })


@app.get("/capture")
def capture():
    """학습 수집용 — 프레임과 그때의 검출·라벨을 **한 락 안에서** 함께 돌려준다.
    ★ /snapshot 과 /health 를 따로 부르면 그 사이 프레임이 바뀌어 박스가 어긋난다.
      라벨 오염은 에러를 안 내고 조용히 학습을 망치므로 원자성이 필요하다.
    ?draw=1 이면 표시본(박스 그려진 것), 기본은 추론 입력 그대로."""
    want_draw = request.args.get("draw") == "1"
    with _lock:
        raw = _state.get("raw")
        jpg = _state["jpg"]
        dets = _state.get("dets")
        stats = _state.get("stats")
        ts = _state["ts"]
    if want_draw or raw is None:
        buf = jpg
    else:
        ok, enc = cv2.imencode(".jpg", raw, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
        buf = enc.tobytes() if ok else jpg
    if not buf:
        return jsonify({"ok": False, "error": "no frame"}), 404
    pl = _pose.log.health() if (_pose is not None and _pose.log is not None) else {}
    return jsonify({
        "ok": True, "ts": ts, "age": round(time.time() - ts, 3) if ts else None,
        "wh": [IW, IH] if not want_draw else [OW, OH],
        "label": pl.get("label"), "note": pl.get("note"),
        "dets": [{"cls": n, "box": [round(v, 1) for v in b], "conf": round(c, 3)}
                 for n, b, c in (dets or [])],
        "stats": stats,
        "jpg_b64": base64.b64encode(buf).decode(),
    })


@app.get("/clip")
def clip():
    """낙상 전후 원본 프레임을 꺼낸다. 인자 없으면 메타, ?i=N 이면 N 번째 JPEG.
    ★ /snapshot 과 달리 **낙상 순간을 놓치지 않는다** — 폴링으로는 직전 프레임을 못 잡는다."""
    fr = list(_clip["frames"])
    i = request.args.get("i")
    if i is None:
        return jsonify({
            "ok": True, "n": len(fr), "active": _clip["active"], "events": _clip["events"],
            "at": _clip["at"], "wh": [IW, IH], "pre": CLIP_PRE, "post": CLIP_POST,
            "ts": [round(t, 3) for t, _ in fr]})
    try:
        k = int(i)
    except ValueError:
        return jsonify({"ok": False, "error": "i 는 정수"}), 400
    if not (0 <= k < len(fr)):
        return jsonify({"ok": False, "error": f"범위 밖 (0~{len(fr) - 1})"}), 404
    ok, enc = cv2.imencode(".jpg", fr[k][1], [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    if not ok:
        return jsonify({"ok": False, "error": "인코딩 실패"}), 500
    return Response(enc.tobytes(), mimetype="image/jpeg")


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
    # fps 를 바꿨으면 포즈 로그에도 새 _meta 줄을 남긴다 — 안 남기면 헤더가 거짓이 된다.
    if request.args.get("infer_fps") is not None and _pose is not None \
            and getattr(_pose, "log", None) is not None:
        _pose.log.note_meta(infer_fps_cfg=_cfg["infer_fps"])
    # ★ 포즈 로그 부표본 간격 — 낙상 임계를 재려면 1 이어야 한다(09-11).
    #   3 이면 판정 10fps 대 로그 3.3fps 라 「연속이었나」를 못 잰다.
    ev = request.args.get("pose_log_every")
    if ev is not None:
        try:
            n = min(10, max(1, int(ev)))
        except ValueError:
            return jsonify({"ok": False, "error": "pose_log_every 는 1~10 정수"}), 400
        if _pose is None or getattr(_pose, "log", None) is None:
            return jsonify({"ok": False, "error": "포즈 로그가 꺼져 있다"}), 400
        _pose.log.every = n
        _pose.log.note_meta()

    # ★ head 전용 문턱 — 라이브에서 0.30/0.35/0.40 을 비교하려고 런타임 손잡이로 둔다.
    # ★ 09-14 낙상 문턱을 재시작 없이 조절한다. 값은 pose_fall 의 전역이고 _classify 가
    #   호출 시점에 읽으므로 대입만으로 즉시 반영된다. 바꾼 값은 포즈 로그 _meta 에도 남긴다 —
    #   안 남기면 나중에 그 로그가 어떤 문턱으로 판정된 것인지 알 수 없다(09-11 교훈).
    _pf_knobs = {"torso_down": ("TORSO_DOWN", 20.0, 89.0),
                 "drop_rate":  ("DROP_RATE",  0.005, 1.0),
                 "fall_hold":  ("FALL_HOLD",  0.1, 5.0),
                 "fall_window":("FALL_WINDOW", 0.5, 15.0)}
    _pf_changed = {}
    for _arg, (_name, _lo, _hi) in _pf_knobs.items():
        _v = request.args.get(_arg)
        if _v is None:
            continue
        try:
            _f = float(_v)
        except ValueError:
            return jsonify({"ok": False, "error": f"{_arg} 는 숫자여야 한다"}), 400
        if not (_lo <= _f <= _hi):
            return jsonify({"ok": False, "error": f"{_arg} 는 {_lo}~{_hi} 범위"}), 400
        import pose_fall as _pfm
        setattr(_pfm, _name, _f)
        _pf_changed[_arg] = _f
    if _pf_changed and _pose is not None and getattr(_pose, "log", None) is not None:
        _pose.log.note_meta(**_pf_changed)

    hc = request.args.get("head_conf")
    if hc is not None:
        global HEAD_CONF
        try:
            HEAD_CONF = min(0.95, max(0.0, float(hc)))
        except ValueError:
            return jsonify({"ok": False, "error": "head_conf 는 0~0.95 실수"}), 400

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
    for key, arg in (("_vest_ref", "vest_ref"), ("_head_ref", "head_ref"),
                     ("_helmet_ref", "helmet_ref")):
        raw = request.args.get(arg)
        if raw is None:
            continue
        if raw in ("off", "none", ""):
            globals()[key] = None
            continue
        try:
            parts = raw.split(",")
            lo, med, hi, mx = (float(x) for x in parts[:4])
            if not 0 < lo <= med <= hi <= mx <= 1:
                raise ValueError
            basis = parts[4] if len(parts) > 4 else "런타임 지정"
            globals()[key] = {"lo": lo, "median": med, "hi": hi, "max": mx, "basis": basis}
        except (ValueError, IndexError):
            return jsonify({"ok": False, "error":
                            f"{arg} 는 lo,med,hi,max[,근거] (0<lo<=med<=hi<=max<=1) 또는 off"}), 400
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
    import pose_fall as _pfm2
    _pf_now = {"torso_down": _pfm2.TORSO_DOWN, "drop_rate": _pfm2.DROP_RATE,
               "fall_hold": _pfm2.FALL_HOLD, "fall_window": _pfm2.FALL_WINDOW}
    return jsonify({"ok": True, **_cfg, "fall": _pf_now, "push_workers": PUSH_WORKERS, "zone": _zone["box"],
                    "zone_label": _zone["label"], "label_px": LABEL_PX,
                    "jpeg_q": JPEG_Q, "vest_ref": _vest_ref, "head_ref": _head_ref,
                    "helmet_ref": _helmet_ref})


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


@app.get("/record")
def record():
    """촬영용 녹화. 판정과 무관하게 원본을 디스크에 남긴다 — 놓친 낙상의 자료가 사라지지 않게.

    시작: /record?label=T-1        (로그 라벨도 같이 걸어 영상과 로그가 한 이름으로 묶인다)
    종료: /record                  (경로·프레임수·시작/끝 시각을 준다)
    상태: /record?peek=1
    ⚠ t_onset 은 저장된 프레임을 넘겨보며 정하고, 그 **파일명의 시각**을 그대로 쓴다.
    """
    if request.args.get("peek"):
        return jsonify({"ok": True, **{k: _rec[k] for k in ("on", "dir", "n", "t0", "label", "dropped")},
                        "max": REC_MAX})
    label = (request.args.get("label") or "").strip()
    if label:                                          # ── 시작
        if _rec["on"]:
            return jsonify({"ok": False, "error": f"이미 녹화 중 ({_rec['label']})"}), 409
        safe = re.sub(r"[^0-9A-Za-z가-힣_.-]", "_", label)[:40]
        d = os.path.join(REC_DIR, f"{time.strftime('%Y%m%d-%H%M%S')}_{safe}")
        try:
            os.makedirs(d, exist_ok=True)
        except Exception as e:
            return jsonify({"ok": False, "error": f"폴더 생성 실패 {e}"}), 500
        _rec.update(on=True, dir=d, n=0, t0=time.time(), label=label, dropped=0)
        if _pose is not None:
            _pose.log.set_label(label, "rec")        # 로그에도 같은 라벨 — 나중에 짝짓기가 공짜가 된다
        print(f"[rec] 시작 {d}", flush=True)
        return jsonify({"ok": True, "started": True, "dir": d, "t0": round(_rec["t0"], 3), "label": label})
    # ── 종료
    if not _rec["on"] and _rec["n"] == 0:
        return jsonify({"ok": False, "error": "녹화 중이 아니다. 시작은 /record?label=이름"}), 400
    _rec["on"] = False
    if _pose is not None:
        _pose.log.set_label("", "")
    out = {"ok": True, "stopped": True, "dir": _rec["dir"], "n": _rec["n"],
           "t0": round(_rec["t0"], 3) if _rec["t0"] else None, "t1": round(time.time(), 3),
           "label": _rec["label"], "dropped": _rec["dropped"]}
    print(f"[rec] 종료 {_rec['dir']} · {_rec['n']}장 · 실패 {_rec['dropped']}", flush=True)
    return jsonify(out)


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
        _helmet_sizes.clear()
        _vest_sizes.clear()
        _vest_aspects.clear()
        _helmet_seen.clear()
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
 .layout{display:grid;grid-template-columns:290px 1fr 250px;gap:14px;align-items:start}
 @media (max-width:1240px){.layout{grid-template-columns:290px 1fr}}
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
 .lab{color:#7d8f86;font-size:12px}\n /* 하단 제어줄 — 한 줄에 넣는다. 긴 참조 문구만 줄어들고(meta),\n    라벨+버튼 묶음(grp)과 네트워크 표시(fixed)는 안 줄어든다. */\n .ctl{margin-top:10px;padding-top:9px;border-top:1px solid #222c27;gap:7px}\n .ctl .grp{display:inline-flex;align-items:center;gap:5px;flex:none}\n .ctl button{padding:4px 9px;font-size:12px}\n .ctl button.on{background:#20402f;border-color:#46ce8c;color:#c9f4dd}\n .ctl .sep{width:1px;height:15px;background:#2c3833;flex:none}\n .ctl .fixed{flex:none;white-space:nowrap}\n .ctl .meta{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
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
    <div class="cell"><div class="k">안전모 크기 중앙값</div><div class="v" id="hmm">-</div></div>
    <div class="cell"><div class="k">조끼 크기 중앙값</div><div class="v" id="vm">-</div></div>
    <div class="cell"><div class="k">안전모 검출률</div><div class="v" id="hw">-</div></div>
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
   <div class="row ctl">
    <span class="lab fixed" id="nwire">-</span><span class="sep"></span>
    <span class="grp"><span class="lab">추론</span
     ><button data-f="5">5</button><button data-f="10">10</button
     ><button data-f="12">12</button><button data-f="15">15</button></span
    ><span class="sep"></span>
    <span class="grp"><span class="lab">화질</span
     ><button data-q="45">45</button><button data-q="55">55</button
     ><button data-q="72">72</button><button data-q="85">85</button></span
    ><span class="sep"></span>
    <span class="lab meta" id="hbasis">-</span>
   </div>
  </main>
  <aside id="colwrap">
   <h2>수집 <span id="cst">-</span></h2>
   <div class="now" id="cnow">-</div>
   <div class="foot">
    <div class="k">저장</div>
    <div class="v" id="ctot">-<small> 장</small></div>
    <div class="k" style="margin-top:10px">라벨별</div>
    <ul id="clist" style="max-height:200px"><li class="none">아직 없음</li></ul>
    <div id="cwarn"></div>
    <div class="k" style="margin-top:10px">분포 폭 (촬영 전 대비)</div>
    <div class="bars" id="cdist"></div>
   </div>
  </aside>
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
   const vs=h.vest_size;
   $('vm').innerHTML=!vs?'<small>\uad00\uce21 \uc5c6\uc74c</small>'
     :vs.median.toFixed(3)+'<small> n'+vs.n+(vs.in_train_range_pct==null
       ?' \u00b7 \uae30\uc900 \ubbf8\uc815':' \u00b7 '+vs.in_train_range_pct+'%')+'</small>';
   const hm=h.helmet_size;
   $('hmm').innerHTML=!hm?'<small>\uad00\uce21 \uc5c6\uc74c</small>'
     :hm.median.toFixed(3)+'<small> n'+hm.n+' \u00b7 '+(hm.in_train_range_pct==null?'-':hm.in_train_range_pct+'%%')+'</small>';
   const hw=h.helmet_watch;
   $('hw').innerHTML=!hw?'<small>\uad00\uce21 \uc5c6\uc74c</small>'
     :(hw.seen_pct>0?'':'<span class="warn">')+hw.seen_pct+'<small> % \u00b7 '+hw.frames+'\ud504\ub808\uc784</small>'+(hw.seen_pct>0?'':'</span>');
   window._basis='\uba38\ub9ac '+((hs.train_ref||{}).basis||'-')+' \u00b7 \uc548\uc804\ubaa8 '+((hm&&hm.train_ref||{}).basis||'-')+' \u00b7 \uc870\ub07c '+((vs&&vs.train_ref||{}).basis||'\uae30\uc900 \ubbf8\uc815');
   const st=h.stats||{};
   $('pc').textContent=st.person_count??'-';
   $('nh').innerHTML=(st.no_hardhat_count??0)>0
     ?'<span class="warn">'+st.no_hardhat_count+'</span>':(st.no_hardhat_count??'-');
   $('px').textContent=h.pushed?h.pushed.toLocaleString():'0 (\ub85c\uceec \uc804\uc6a9)';
   // \uc81c\uc5b4\uc904 \u2014 \ud604\uc7ac\uac12\uc740 \ubc84\ud2bc \uac15\uc870\ub85c \ubcf4\uc774\ubbc0\ub85c \ubcc4\ub3c4 \ud45c\uae30\ub97c \uc5c6\uc568\ub2e4.
   const _q=h.cfg?.jpeg_q??h.jpeg_q, _f=h.cfg?.infer_fps;
   document.querySelectorAll('button[data-q]').forEach(b=>b.classList.toggle('on',+b.dataset.q===+_q));
   document.querySelectorAll('button[data-f]').forEach(b=>b.classList.toggle('on',+b.dataset.f===+_f));
   const _m=(h.engine||'')+' @'+(h.infer_size||'')+' \u00b7 '+(window._basis||'');
   $('hbasis').textContent=_m; $('hbasis').title=_m;

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
     :w.ip?'\uc720\uc120 '+w.ip+' \u00b7 '+w.speed+'M'
     :nwarn('\uc720\uc120 '+w.iface+' \u2014 \ub9c1\ud06c\ub9cc \uc788\uace0 \ub124\ud2b8\uc6cc\ud06c \uc5c6\uc74c ('+w.speed+' Mbps) \u00b7 \uc218\uc2e0 '
            +(wr.rx_pps==null?'-':wr.rx_pps)+'/s',true);
  }catch(e){}
 }
 async function ctick(){
  try{
   const c=await (await fetch('/collect',{cache:'no-store'})).json();
   const h=await (await fetch('/health',{cache:'no-store'})).json();
   $('cst').innerHTML=c.running?'<span style="color:#46ce8c">\u25cf \uc2e4\ud589\uc911</span>'
     :'<span class="warn">\u25cb \uaebc\uc9d0</span>';
   const lab=(h.pose_log||{}).label;
   $('cnow').innerHTML=lab?'<span class="chip">'+lab+'</span>'
     +((h.pose_log||{}).note?'<span class="chip">'+h.pose_log.note+'</span>':'')
     :'<span class="chip warn">\uc120\uc5b8 \uc5c6\uc74c \u2014 \uc800\uc7a5 \uc548 \ub428</span>';
   $('ctot').innerHTML=(c.total||0)+'<small> \uc7a5</small>';
   $('clist').innerHTML=(c.labels&&c.labels.length)
     ?c.labels.map(function(kv){return '<li><span class="id">'+kv[1]+'</span><span class="pl" style="font-size:12px">'+kv[0]+'</span></li>';}).join('')
     :'<li class="none">\uc544\uc9c1 \uc5c6\uc74c</li>';
   $('cwarn').innerHTML=(c.total>0&&!c.has_negative)
     ?'<div class="warn" style="font-size:11.5px;margin-top:8px;line-height:1.5">\u2605 vest0(\uc870\ub07c \ubc97\uc740) \ucc3d\uc774 \uc5c6\uc2b5\ub2c8\ub2e4. \ud55c \uc0ac\ub78c\uc774 \ub298 \ucc29\uc6a9\uc774\uba74 \ubaa8\ub378\uc774 \uc0ac\ub78c\uc744 \uc678\uc6c1\ub2c8\ub2e4 \u2014 \ubc18\ub4dc\uc2dc \ucc0d\uc73c\uc2ed\uc2dc\uc624.</div>':'';
   const B=c.base||{size:0,aspect:0}, out=[];
   [['vest_size','\ud06c\uae30','size'],['vest_aspect','\uc885\ud6a1\ube44','aspect']].forEach(function(t){
     const d=h[t[0]];
     if(!d||!d.median){out.push('<div class="bar"><span>'+t[1]+'</span><i></i><em>-</em></div>');return;}
     const w=100*(d.p95-d.p5)/d.median, b=B[t[2]]||1, r=Math.min(100,w/b*50);
     out.push('<div class="bar"><span>'+t[1]+'</span><i><b style="width:'+r+'%;background:'
       +(w>b?'#46ce8c':'#e0a44e')+'"></b></i><em>'+w.toFixed(1)+'%</em></div>'
       +'<div class="pm" style="margin:0 0 4px 51px">\ucd2c\uc601 \uc804 '+b.toFixed(1)+'%</div>');
   });
   $('cdist').innerHTML=out.join('');
  }catch(e){}
 }
 ctick(); setInterval(ctick,3000);
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
            # ★ infer_fps 를 헤더에 남긴다 — every 만 있으면 분모뿐이라 배율을 못 푼다(09-11).
            #   상한이지 실측이 아니므로 이름에 _cfg 를 붙인다.
            _log = PoseLog(POSE_LOG_DIR, max_mb=POSE_LOG_MB, every=POSE_LOG_EVERY,
                           # ★ 09-14 build 를 로그 첫 줄에 박는다 — 이 로그가 어느 코드에서
                           #   나왔는지 사후에 못 밝히면 그 관측으로 아무것도 확정할 수 없다.
                           meta={"infer_fps_cfg": _cfg["infer_fps"], "build": BUILD})
            print(f"[gopro] 자세 로그 → {_log.path}", flush=True)
        _pose = PoseFall(POSE_ENGINE, imgsz=POSE_IMGSZ, conf=POSE_CONF, log=_log)
        print(f"[gopro] 자세 판정 켜짐 — {POSE_ENGINE.split('/')[-1]} @{POSE_IMGSZ} (경보 없음·계수만)", flush=True)
    webcam_start(force=False)
    threading.Thread(target=_reader, daemon=True).start()
    threading.Thread(target=_pusher, daemon=True).start()
    print(f"[gopro] http://0.0.0.0:{PORT}/health · engine={ENGINE.split('/')[-1]} conf={CONF}", flush=True)
    print(f"[gopro] build commit={BUILD.get('commit')} code={BUILD.get('code_sha')}", flush=True)
    app.run(host="0.0.0.0", port=PORT, threaded=True)
