# VitAlGuard CCTV AI 데모 서버 — 대시보드 CCTV 관제 3타일(객체/낙상/PPE)에 MJPEG 스트림 + 감지 통계 제공.
# CAM-01(객체)=YOLOv8n + Roboflow supervision(ByteTrack+원근보정 속도), CAM-03(PPE)=Hexmon vyra-yolo-ppe(YOLOv8m 14클래스), CAM-02(낙상)=합성.
# CAM-03 은 듀얼소스 — 기본은 번들 cam03.mp4 를 Hexmon 으로 추론(OFF), 폰이 /cctv/ingest3 로 프레임을 보내면 그 프레임을 추론해 덮어씀(ON·3초 무수신 시 클립 복귀).
# 모델·영상·의존성이 없으면 해당 카메라는 합성으로 자동 폴백(배포 견고성).
# 계약(대시보드 CctvQuadView): GET /cctv/stream[|2|3]=MJPEG, /cctv/snapshot[|2|3]=단발 JPEG, /cctv/stats=객체 /stats2=낙상 /stats3=PPE. POST /cctv/ingest3=폰/엣지 PPE 프레임(서버 추론), POST /cctv/ingest2=엣지 낙상 프레임(display-only·서버 추론 없음), GET /cam3/capture=폰 캡처 페이지.
import asyncio
import os
import threading
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from starlette.concurrency import run_in_threadpool

app = FastAPI(title="VitAlGuard CCTV AI (demo)")

# /cctv/stats* fetch 용 CORS(라이브 대시보드 + 로컬 dev). MJPEG <img> 는 CORS 불필요.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app",
        "http://localhost:3000",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

W, H = 640, 360
FPS = 12

# ── CAM-01 객체+속도 설정 ────────────────────────────────────────────────────────────────
MODEL_PATH = os.environ.get("YOLO_MODEL", "yolov8n.pt")
VIDEO_PATH = os.environ.get("CAM01_VIDEO", "samples/cam01.mp4")
PLAYBACK_FPS = int(os.environ.get("PLAYBACK_FPS", "6"))  # 워커 추론 cadence. 낮추면 추론 사이 sleep↑ → CPU 여유↑(요청 429 방지). 클립은 15fps 캡처라 6이면 0.4x 슬로모.
CONF = float(os.environ.get("YOLO_CONF", "0.25"))
IMGSZ = int(os.environ.get("YOLO_IMGSZ", "960"))    # 추론 해상도(640→960=원거리 군중 사람 4배). 라이브는 env 800.
OW, OH = 1280, 720  # CAM-01 출력 해상도(고해상도). 합성 CAM-02 은 W,H=640,360.
FONT_PATH = os.environ.get("LABEL_FONT", "NanumGothic-Regular.ttf")  # 한글 라벨용(cv2 한글 미지원 → PIL)

# COCO(en) → 대시보드 한글 라벨. 화이트리스트(사람·자전거·차량류)만 그린다.
COCO_KO = {
    "person": "보행자", "bicycle": "자전거", "car": "차량",
    "motorcycle": "오토바이", "bus": "버스", "truck": "트럭",
}
CLASS_COLOR = {
    "보행자": (80, 200, 255), "자전거": (255, 200, 80), "차량": (120, 220, 120),
    "오토바이": (200, 160, 255), "버스": (240, 200, 120), "트럭": (60, 160, 240),
}
VEHICLE_KO = {"차량", "버스", "트럭", "오토바이"}
SPEED_MAX_KMH = 120.0   # ID 스왑 텔레포트 클램프
SPEED_SHOW_MIN = 5      # 이 미만(km/h)은 숫자 생략 — 정지/서행 차량은 '차량'만

# 속도 원근 보정(Roboflow supervision ViewTransformer) — 이미지 도로 평면 4점 → 실세계 직사각형(m).
# 실측이 아닌 도로 기하 추정값(절대값은 근사·원근 일관성↑). env(SPEED_TARGET_W/H) 로 배율 조정.
CALIB_SOURCE = np.array([[300, 330], [960, 330], [1240, 640], [40, 640]], np.float32)  # 1280x720 부감 — 하단 지면 평면 근사(좌우 도로)
SPEED_TARGET_W = float(os.environ.get("SPEED_TARGET_W", "35"))  # m, 가로(진행방향)
SPEED_TARGET_H = float(os.environ.get("SPEED_TARGET_H", "25"))  # m, 깊이
CALIB_TARGET = np.array([[0, 0], [SPEED_TARGET_W, 0], [SPEED_TARGET_W, SPEED_TARGET_H], [0, SPEED_TARGET_H]], np.float32)

# ── CAM-03 PPE(Hexmon vyra-yolo-ppe-detection · YOLOv8m 14클래스) 설정 ──────────────────
# 전용 finetune 모델(안전모/조끼/작업자 + NO-* 위반 클래스 직접 탐지). YOLO-World+CLIP 의존 제거.
PPE_VIDEO = os.environ.get("CAM03_VIDEO", "samples/cam03.mp4")  # OFF 기본 폴백 클립
PPE_MODEL = os.environ.get("PPE_MODEL", "vyra_ppe.pt")
PPE_CONF = float(os.environ.get("PPE_CONF", "0.25"))   # 전용모델 — 임계 정상값
PPE_IMGSZ = int(os.environ.get("PPE_IMGSZ", "640"))
PPE_LIVE_TTL = float(os.environ.get("PPE_LIVE_TTL", "3.0"))  # 폰 마지막 프레임 후 이 시간(초) 지나면 클립으로 복귀
# Hexmon 14클래스(en) → 한글. NO-* 는 미착용(위반).
PPE_KO = {
    "Hardhat": "안전모", "Safety Vest": "안전조끼", "Person": "작업자",
    "NO-Hardhat": "안전모 미착용", "NO-Safety Vest": "조끼 미착용",
    "Mask": "마스크", "NO-Mask": "마스크 미착용",
    "Gloves": "장갑", "NO-Gloves": "장갑 미착용",
    "Goggles": "보안경", "NO-Goggles": "보안경 미착용",
    "Fall-Detected": "낙상", "Ladder": "사다리", "Safety Cone": "안전콘",
}
PPE_VIOLATION_KO = {"안전모 미착용", "조끼 미착용", "마스크 미착용", "장갑 미착용", "보안경 미착용", "낙상"}
PPE_COMPLIANT_KO = {"안전모", "안전조끼", "마스크", "장갑", "보안경"}
GREEN, RED, BLUE, GRAY = (120, 220, 120), (60, 60, 239), (240, 200, 120), (170, 170, 170)  # BGR


def _ppe_color(ko: str):
    if ko in PPE_VIOLATION_KO:
        return RED
    if ko in PPE_COMPLIANT_KO:
        return GREEN
    if ko == "작업자":
        return BLUE
    return GRAY


OW3, OH3 = 640, 360  # CAM-03 출력 해상도

_obj_lock = threading.Lock()
_obj = {"frame": b"", "stats": None}
OBJECT_REAL = False  # CAM-01 실모델 가동 여부

_ppe_lock = threading.Lock()
_ppe = {"frame": b"", "stats": None}          # 클립(OFF 기본) 추론 결과
PPE_REAL = False     # CAM-03 실모델(Hexmon) 로드 여부

# 폰/엣지 라이브(ON override) — /cctv/ingest3 가 갱신. ts 기준 PPE_LIVE_TTL 내면 클립 대신 이걸 노출.
# 끊김 방지: 표시(매 프레임 캐시 박스 그리기)와 탐지(throttle Hexmon 백그라운드)를 분리한다. dets=캐시 박스, infering=추론 진행중.
_ppe_live_lock = threading.Lock()
_ppe_live = {"frame": b"", "dets": [], "stats": None, "ts": 0.0, "draw_ts": 0.0,
             "infer_ts": 0.0, "infering": False}  # draw_ts = 마지막으로 그린 프레임 시각(늦게 온 옛 프레임 폐기용)
PPE_LIVE_INFER_INTERVAL = float(os.environ.get("PPE_LIVE_INFER_INTERVAL", "0.3"))  # 라이브 탐지 cadence(초). 표시 fps와 무관(전체 품질 유지).

# Hexmon 모델 단일 인스턴스 — 클립 워커와 인제스트 핸들러가 공유(추론 직렬화).
_ppe_model = None
_ppe_model_lock = threading.Lock()


def _ppe_is_live() -> bool:
    return (time.time() - _ppe_live["ts"]) < PPE_LIVE_TTL


# CAM-02(낙상) 라이브 override — Jetson 이 낙상 박스를 그려 /cctv/ingest2 로 보낸 JPEG 를 그대로 표시(서버 추론 없음·display-only).
# 단일 Cloud Run 인스턴스 CPU 보호 — 서버 추론은 CAM-03 PPE(Hexmon) 하나만 유지(2추론 동시 429 회피).
CAM2_LIVE_TTL = float(os.environ.get("CAM2_LIVE_TTL", "3.0"))  # 마지막 프레임 후 이 시간(초) 지나면 합성으로 복귀
_cam2_live = {"frame": b"", "stats": None, "ts": 0.0}
_cam2_lock = threading.Lock()


def _cam2_is_live() -> bool:
    return (time.time() - _cam2_live["ts"]) < CAM2_LIVE_TTL


def _ensure_ppe_model():
    # Hexmon best.pt 지연 로드(최초 호출 시 수 초). 성공 시 PPE_REAL=True.
    global _ppe_model, PPE_REAL
    if _ppe_model is not None:
        return _ppe_model
    with _ppe_model_lock:
        if _ppe_model is None:
            from ultralytics import YOLO
            _ppe_model = YOLO(PPE_MODEL)
            PPE_REAL = True
            print(f"[cctv-ai] CAM-03 Hexmon model loaded ({PPE_MODEL}, {len(_ppe_model.names)} classes)")
    return _ppe_model


def _ppe_infer_dets(frame):
    # 한 프레임 → Hexmon 추론 → (dets, stats3). 그리기는 분리한다(라이브 표시/탐지 디커플용).
    model = _ensure_ppe_model()
    with _ppe_model_lock:
        res = model.predict(frame, imgsz=PPE_IMGSZ, conf=PPE_CONF, verbose=False)[0]
    cnt = {}
    dets = []
    for b in res.boxes:
        en = model.names[int(b.cls)]
        ko = PPE_KO.get(en, en)
        cnt[en] = cnt.get(en, 0) + 1
        x1, y1, x2, y2 = (int(v) for v in b.xyxy[0])
        dets.append((x1, y1, x2, y2, _ppe_color(ko), ko, en))
    # 준수율 — NO-* 위반 클래스를 직접 카운트(휴리스틱 아님).
    hard, no_hard = cnt.get("Hardhat", 0), cnt.get("NO-Hardhat", 0)
    vest, no_vest = cnt.get("Safety Vest", 0), cnt.get("NO-Safety Vest", 0)
    person = cnt.get("Person", 0)
    fall = cnt.get("Fall-Detected", 0)
    total_ppe = hard + no_hard + vest + no_vest
    rate = round(100 * (hard + vest) / total_ppe) if total_ppe else 100
    stats = {"violation_count": no_hard + no_vest, "compliance_rate": rate,
             "no_hardhat_count": no_hard, "no_vest_count": no_vest,
             "hardhat_count": hard, "vest_count": vest, "person_count": person,
             "fall_count": fall}
    return dets, stats


def _ppe_infer(frame, header):
    # 한 프레임 → Hexmon 추론 + 그리기 → (jpeg bytes, stats3). 클립 워커·폴백 공용.
    dets, stats = _ppe_infer_dets(frame)
    img = draw_pil(frame, dets, header)
    okj, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 72])
    return (buf.tobytes() if okj else b""), stats


class _ViewTransformer:
    # 이미지 평면 → 실세계 평면 호모그래피(원근 보정).
    def __init__(self, source, target):
        self._m = cv2.getPerspectiveTransform(source, target)

    def transform(self, points):
        if points is None or len(points) == 0:
            return np.empty((0, 2), np.float32)
        p = points.reshape(-1, 1, 2).astype(np.float32)
        return cv2.perspectiveTransform(p, self._m).reshape(-1, 2)


def _object_worker():
    # CAM-01: YOLOv8n 검출 → supervision ByteTrack → ViewTransformer 원근보정 실세계 좌표로 속도 추정 → 전역 갱신.
    global OBJECT_REAL
    try:
        from collections import defaultdict, deque

        import supervision as sv
        from ultralytics import YOLO
        model = YOLO(MODEL_PATH)
        cap = cv2.VideoCapture(VIDEO_PATH)
        if not cap.isOpened():
            raise RuntimeError(f"cannot open {VIDEO_PATH}")
        clip_fps = cap.get(cv2.CAP_PROP_FPS) or float(PLAYBACK_FPS)
        tracker = sv.ByteTrack(frame_rate=max(1, int(round(clip_fps))))
        view = _ViewTransformer(CALIB_SOURCE, CALIB_TARGET)
    except Exception as e:
        print(f"[cctv-ai] CAM-01 real worker init failed ({e}); falling back to synthetic")
        OBJECT_REAL = False
        return

    win = max(2, int(round(clip_fps)))                 # 1초 윈도우(속도 평활)
    coords = defaultdict(lambda: deque(maxlen=win))    # tid -> 실세계 좌표(m) 이력
    target_dt = 1.0 / PLAYBACK_FPS
    fps_ema = float(PLAYBACK_FPS)
    while True:
        t0 = time.time()
        try:
            ok, frame = cap.read()
            if not ok:  # 영상 끝 → 루프(경계 텔레포트 방지 위해 이력 초기화)
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                coords.clear()
                continue
            if frame.shape[1] != OW or frame.shape[0] != OH:
                frame = cv2.resize(frame, (OW, OH))
            res = model(frame, imgsz=IMGSZ, conf=CONF, verbose=False)[0]
            det = sv.Detections.from_ultralytics(res)
            if len(det):
                keep = np.array([model.names[int(c)] in COCO_KO for c in det.class_id], bool)
                det = det[keep]
            det = tracker.update_with_detections(det)
            anchors = det.get_anchors_coordinates(sv.Position.BOTTOM_CENTER) if len(det) else np.empty((0, 2))
            world = view.transform(anchors)

            header = "CAM-01  Worksite (overhead)  YOLO + ByteTrack"
            by = {}
            speeds = []
            dets = []
            for i in range(len(det)):
                en = model.names[int(det.class_id[i])]
                ko = COCO_KO.get(en)
                if not ko:
                    continue
                x1, y1, x2, y2 = (int(v) for v in det.xyxy[i])
                tid = int(det.tracker_id[i]) if det.tracker_id is not None else None
                by[ko] = by.get(ko, 0) + 1
                ko_label, en_label = ko, en
                # 차량류 + ID 있으면 원근보정 속도(실세계 변위/시간).
                if ko in VEHICLE_KO and tid is not None:
                    coords[tid].append(world[i])
                    dq = coords[tid]
                    if len(dq) >= max(2, win // 2):
                        p0, p1 = dq[0], dq[-1]
                        dist = float(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))  # m
                        dts = (len(dq) - 1) / clip_fps
                        kmh = min(dist / dts * 3.6, SPEED_MAX_KMH) if dts > 0 else 0.0
                        if kmh >= 1:
                            speeds.append(kmh)
                        if kmh >= SPEED_SHOW_MIN:
                            ko_label, en_label = f"{ko} {kmh:.0f}km/h", f"{en} {kmh:.0f}km/h"
                dets.append((x1, y1, x2, y2, CLASS_COLOR.get(ko, (80, 200, 255)), ko_label, en_label))
            img = draw_pil(frame, dets, header)
            okj, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 72])

            dt = max(time.time() - t0, 1e-3)
            fps_ema = 0.8 * fps_ema + 0.2 * (1.0 / dt)
            stats = {"fps": round(fps_ema), "total": sum(by.values()),
                     "byClass": [{"label": k, "count": v} for k, v in by.items()],
                     "alertsLastMinute": 0,
                     "vehicleCount": sum(by.get(k, 0) for k in VEHICLE_KO),
                     "maxSpeedKmh": round(max(speeds)) if speeds else 0,
                     "avgSpeedKmh": round(sum(speeds) / len(speeds)) if speeds else 0}
            with _obj_lock:
                if okj:
                    _obj["frame"] = buf.tobytes()
                _obj["stats"] = stats
        except Exception as e:
            print(f"[cctv-ai] CAM-01 frame error ({e})")
            time.sleep(0.2)
            continue
        rem = target_dt - (time.time() - t0)
        time.sleep(max(rem, 0.02))  # 최소 20ms 양보 — 추론이 길어도 HTTP 요청 처리에 CPU 확보(429 방지)


def _ppe_worker():
    # CAM-03 클립 워커(OFF 기본): Hexmon 으로 cam03.mp4 를 추론 → 전역 갱신. 폰 override 중이면 추론을 건너뛰어 CPU 양보.
    global PPE_REAL
    try:
        _ensure_ppe_model()  # 모델 로드(인제스트도 이걸 공유) — 실패 시 합성 폴백
    except Exception as e:
        print(f"[cctv-ai] CAM-03 Hexmon load failed ({e}); falling back to synthetic")
        PPE_REAL = False
        return
    if not os.path.exists(PPE_VIDEO):
        print(f"[cctv-ai] CAM-03 fallback clip not found ({PPE_VIDEO}); 폰 인제스트만 활성")
        return  # 모델은 떴으니 /cctv/ingest3 는 동작, 클립 폴백만 없음
    cap = cv2.VideoCapture(PPE_VIDEO)
    if not cap.isOpened():
        print(f"[cctv-ai] CAM-03 cannot open {PPE_VIDEO}; 폰 인제스트만 활성")
        return

    target_dt = 1.0 / PLAYBACK_FPS
    while True:
        t0 = time.time()
        try:
            if _ppe_is_live():       # 폰 라이브 중 — 클립 추론 스킵(폰에 CPU 양보)
                time.sleep(0.2)
                continue
            ok, frame = cap.read()
            if not ok:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
            if frame.shape[1] != OW3 or frame.shape[0] != OH3:
                frame = cv2.resize(frame, (OW3, OH3))
            jpg, stats = _ppe_infer(frame, "CAM-03  Worksite  PPE (Hexmon)")
            with _ppe_lock:
                if jpg:
                    _ppe["frame"] = jpg
                _ppe["stats"] = stats
        except Exception as e:
            print(f"[cctv-ai] CAM-03 frame error ({e})")
            time.sleep(0.2)
            continue
        rem = target_dt - (time.time() - t0)
        time.sleep(max(rem, 0.02))  # 최소 20ms 양보 — 추론이 길어도 HTTP 요청 처리에 CPU 확보(429 방지)


# ── 장면 상태(시뮬레이션) — 합성 폴백(CAM-02 낙상 상시, CAM-01/03 모델 실패 시) ─────────────────

def object_state(t: float):
    tracks = [("보행자", "person", 22), ("보행자", "person", 30), ("차량", "car", 64), ("트럭", "truck", 44)]
    out = []
    for i, (ko, en, speed) in enumerate(tracks):
        x = int((40 + speed * t + i * 150) % (W + 120)) - 60
        y = 70 + (i * 64) % 230
        w, h = (38, 86) if en == "person" else (116, 58)
        out.append({"ko": ko, "en": en, "box": (x, y, w, h), "color": (80, 200, 255)})
    return out


def fall_state(t: float):
    base = [("정상", 90), ("정상", 250), ("정상", 420), ("불안정", 540)]
    fallen = (int(t) % 20) < 5
    out = []
    for i, (status, x) in enumerate(base):
        st = "낙상" if (i == 2 and fallen) else status
        y = 150 + (i % 2) * 36
        if st == "낙상":
            box, color, en = (x - 12, y + 44, 96, 40), (60, 60, 239), "FALL"
        elif st == "정상":
            box, color, en = (x, y, 46, 96), (120, 220, 120), "OK"
        else:
            box, color, en = (x, y, 46, 96), (80, 200, 240), "UNSTABLE"
        out.append({"status": st, "box": box, "color": color, "en": en})
    return out


def ppe_state(t: float):
    workers = [(70, True, True), (210, True, True), (350, False, True), (500, True, False)]
    extra = (int(t) % 24) < 8
    out = []
    for i, (x, hard, vest) in enumerate(workers):
        h = False if (i == 1 and extra) else hard
        v = vest
        ok = h and v
        en = "OK" if ok else ("NO-HELMET" if not h else "NO-VEST")
        color = (120, 220, 120) if ok else (60, 60, 239)
        out.append({"box": (x, 130 + (i % 2) * 28, 48, 104), "color": color, "en": en, "hard": h, "vest": v})
    return out


# ── 통계(JSON) 합성 폴백 ─────────────────────────────────────────────────────────────────

def object_stats(t):
    a = object_state(t)
    by = {}
    for x in a:
        by[x["ko"]] = by.get(x["ko"], 0) + 1
    return {"fps": FPS, "total": len(a),
            "byClass": [{"label": k, "count": v} for k, v in by.items()],
            "alertsLastMinute": 0}


def fall_stats(t):
    a = fall_state(t)
    ko2en = {"정상": "normal", "불안정": "unstable", "누움": "lying", "낙상": "fallen"}
    cnt = {}
    for x in a:
        cnt[x["status"]] = cnt.get(x["status"], 0) + 1
    return {"total": len(a), "fallen": cnt.get("낙상", 0),
            "byStatus": [{"status": ko2en[k], "label": k, "count": v} for k, v in cnt.items()]}


def ppe_stats(t):
    a = ppe_state(t)
    person = len(a)
    hard = sum(1 for x in a if x["hard"])
    vest = sum(1 for x in a if x["vest"])
    violations = sum(1 for x in a if not (x["hard"] and x["vest"]))
    rate = round(100 * (person - violations) / person) if person else 100
    return {"violation_count": violations, "compliance_rate": rate,
            "no_hardhat_count": person - hard, "no_vest_count": person - vest,
            "hardhat_count": hard, "vest_count": vest, "person_count": person,
            "fall_count": 0}


# ── 렌더(합성 프레임) + 그리기 헬퍼 ──────────────────────────────────────────────────────

def base_frame(cam_label: str):
    img = np.full((H, W, 3), 26, np.uint8)
    for x in range(0, W, 40):
        cv2.line(img, (x, 0), (x, H), (38, 38, 42), 1)
    for y in range(0, H, 40):
        cv2.line(img, (0, y), (W, y), (38, 38, 42), 1)
    cv2.rectangle(img, (0, 0), (W, 26), (18, 18, 20), -1)
    cv2.putText(img, cam_label, (8, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (220, 220, 220), 1, cv2.LINE_AA)
    cv2.circle(img, (W - 112, 13), 4, (60, 60, 239), -1)
    cv2.putText(img, time.strftime("%H:%M:%S"), (W - 98, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1, cv2.LINE_AA)
    cv2.putText(img, "YOLOv8 demo", (8, H - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (96, 96, 102), 1, cv2.LINE_AA)
    return img


def draw_box(img, box, color, label):
    x, y, w, h = box
    cv2.rectangle(img, (x, y), (x + w, y + h), color, 2)
    cv2.rectangle(img, (x, max(0, y - 16)), (x + max(34, len(label) * 9), y), color, -1)
    cv2.putText(img, label, (x + 3, max(11, y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (20, 20, 20), 1, cv2.LINE_AA)


# 한글 라벨(PIL) — cv2 는 한글 미지원이라 CAM-01/03 박스·라벨·헤더를 PIL 로 그린다. 폰트 없으면 영문 cv2 폴백.
try:
    _FONT = ImageFont.truetype(FONT_PATH, 20)
    _FONT_SM = ImageFont.truetype(FONT_PATH, 17)
except Exception as e:
    print(f"[cctv-ai] 한글 폰트 로드 실패({e}) — 영문 라벨 폴백")
    _FONT = _FONT_SM = None


def draw_pil(frame, dets, header):
    # frame(BGR)에 박스 + 한글 라벨 + 헤더. dets=[(x1,y1,x2,y2,color_bgr,ko,en)]. 너비는 frame 에서 추론.
    w = frame.shape[1]
    if _FONT is None:  # 폰트 없을 때 cv2 영문 폴백
        cv2.rectangle(frame, (0, 0), (w, 30), (18, 18, 20), -1)
        cv2.putText(frame, header, (8, 21), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (220, 220, 220), 1, cv2.LINE_AA)
        for x1, y1, x2, y2, color, ko, en in dets:
            draw_box(frame, (x1, y1, x2 - x1, y2 - y1), color, en)
        return frame
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, w, 30), fill=(20, 18, 18))
    d.text((10, 5), header, font=_FONT, fill=(225, 225, 225))
    d.ellipse((w - 116, 11, w - 108, 19), fill=(239, 60, 60))
    d.text((w - 100, 6), time.strftime("%H:%M:%S"), font=_FONT_SM, fill=(190, 190, 190))
    for x1, y1, x2, y2, color, ko, en in dets:
        rgb = (color[2], color[1], color[0])  # BGR→RGB
        d.rectangle((x1, y1, x2, y2), outline=rgb, width=2)
        tb = d.textbbox((0, 0), ko, font=_FONT_SM)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        ly = max(31, y1 - th - 7)
        d.rectangle((x1, ly, x1 + tw + 8, ly + th + 7), fill=rgb)
        d.text((x1 + 4, ly + 1), ko, font=_FONT_SM, fill=(20, 20, 20))
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def render(cam: str, t: float):
    if cam == "object":
        img = base_frame("CAM-01  Front Gate")
        for a in object_state(t):
            draw_box(img, a["box"], a["color"], a["en"])
    elif cam == "fall":
        img = base_frame("CAM-02  Machine Room")
        for a in fall_state(t):
            draw_box(img, a["box"], a["color"], a["en"])
    else:
        img = base_frame("CAM-03  Worksite (GoPro)")
        for a in ppe_state(t):
            draw_box(img, a["box"], a["color"], a["en"])
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 72])
    return buf.tobytes() if ok else b""


def _live_frame(real, store, lock, cam):
    # 실모델 가동 시 전역 프레임, 아니면(워밍업·폴백) 합성 render.
    frame = b""
    if real:
        with lock:
            frame = store["frame"]
    return frame or render(cam, time.time())


def _ppe_current_frame():
    # 폰 라이브(최근 PPE_LIVE_TTL) > 클립 추론 > 합성 폴백.
    if _ppe_is_live():
        with _ppe_live_lock:
            f = _ppe_live["frame"]
        if f:
            return f
    if PPE_REAL:
        with _ppe_lock:
            f = _ppe["frame"]
        if f:
            return f
    return render("ppe", time.time())


def _ppe_current_stats():
    if _ppe_is_live():
        with _ppe_live_lock:
            s = _ppe_live["stats"]
        if s:
            return s
    if PPE_REAL:
        with _ppe_lock:
            s = _ppe["stats"]
        if s:
            return s
    return ppe_stats(time.time())


async def mjpeg(cam: str):
    while True:
        frame = render(cam, time.time())
        if frame:
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        await asyncio.sleep(1.0 / FPS)


async def mjpeg_object():
    while True:
        frame = _live_frame(OBJECT_REAL, _obj, _obj_lock, "object")
        if frame:
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        await asyncio.sleep(1.0 / FPS)


async def mjpeg_ppe():
    while True:
        frame = _ppe_current_frame()
        if frame:
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        await asyncio.sleep(1.0 / FPS)


def _cam2_current_frame():
    # 엣지 라이브(최근 CAM2_LIVE_TTL) > 합성 낙상 폴백.
    if _cam2_is_live():
        with _cam2_lock:
            f = _cam2_live["frame"]
        if f:
            return f
    return render("fall", time.time())


def _cam2_current_stats():
    if _cam2_is_live():
        with _cam2_lock:
            s = _cam2_live["stats"]
        if s:
            return s
    return fall_stats(time.time())


async def mjpeg_cam2_live():
    while True:
        frame = _cam2_current_frame()
        if frame:
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        await asyncio.sleep(1.0 / FPS)


# ── 라우트 ─────────────────────────────────────────────────────────────────────────────
MJPEG_MT = "multipart/x-mixed-replace; boundary=frame"
SNAPSHOT_HEADERS = {"Cache-Control": "no-store"}

# 폰/노트북 카메라 캡처 페이지 — getUserMedia 프레임을 /cctv/ingest3 로 ~5fps POST. Start/Stop·Wake Lock.
CAPTURE_HTML = """<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<title>CAM-03 폰 카메라 송출</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0d0f12; color:#e6e6e6; font-family:-apple-system,system-ui,sans-serif; text-align:center; }
  h1 { font-size:16px; font-weight:600; padding:12px 0 4px; margin:0; }
  .sub { font-size:12px; color:#8a8f98; margin-bottom:10px; }
  #wrap { position:relative; width:100%; max-width:480px; margin:0 auto; }
  video { width:100%; background:#000; border-radius:10px; display:block; }
  #btn { width:90%; max-width:440px; margin:14px auto; padding:16px; font-size:18px; font-weight:700;
         border:0; border-radius:12px; color:#fff; background:#2563eb; }
  #btn.on { background:#dc2626; }
  #stat { font-size:13px; color:#9aa0a6; min-height:40px; padding:0 16px 24px; line-height:1.5; }
  .big { font-size:15px; color:#e6e6e6; }
</style></head>
<body>
  <h1>VitAlGuard · CAM-03 PPE 송출</h1>
  <div class="sub">이 폰 카메라가 관제 CAM-03 타일로 실시간 전송됩니다. (가로로 들면 화면비가 맞습니다)</div>
  <div id="wrap"><video id="v" autoplay muted playsinline></video></div>
  <button id="btn">▶ 송출 시작</button>
  <div id="stat">대기 중 — '송출 시작'을 누르세요.</div>
<script>
// ① 파이프라이닝 — 전송을 직렬화하지 않고 최대 MAX_INFLIGHT 개를 동시에 띄운다.
//    직렬이면 실효 fps = 1/왕복 이라, 왕복 250ms 에서 tick(200ms) 이 통째로 스킵돼 2.5fps 까지 떨어졌다.
const FPS = 5, QUALITY = 0.5, CW = 640, CH = 360, MAX_INFLIGHT = 3, SEND_TIMEOUT_MS = 5000;
const v = document.getElementById('v'), btn = document.getElementById('btn'), stat = document.getElementById('stat');
const canvas = document.createElement('canvas'); canvas.width = CW; canvas.height = CH;
const ctx = canvas.getContext('2d');
let stream = null, timer = null, running = false, inflight = 0, sent = 0, startedAt = 0, wakeLock = null;

async function lockScreen() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
}
function unlockScreen() { try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (running && document.visibilityState === 'visible') lockScreen(); });

function tick() {
  if (!running || inflight >= MAX_INFLIGHT || !v.videoWidth) return;
  const scale = Math.max(CW / v.videoWidth, CH / v.videoHeight);
  const dw = v.videoWidth * scale, dh = v.videoHeight * scale;
  ctx.drawImage(v, (CW - dw) / 2, (CH - dh) / 2, dw, dh);
  inflight++;
  canvas.toBlob(async (blob) => {
    if (!blob) { inflight--; return; }
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), SEND_TIMEOUT_MS);  // 멈춘 요청이 슬롯을 영구 점유하지 않게
    try {
      const r = await fetch('/cctv/ingest3', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob, signal: ac.signal });
      const j = await r.json();
      sent++;
      const secs = startedAt ? (Date.now() - startedAt) / 1000 : 0;
      const fps = secs > 1 ? (sent / secs).toFixed(1) : '--';
      if (j.ok) stat.innerHTML = '<span class="big">송출 중 · ' + sent + ' 프레임 · ' + fps + ' fps</span><br>작업자 ' + j.persons + ' · 위반 ' + j.violations + ' · 낙상 ' + j.fall + ' · 준수율 ' + j.compliance + '%';
      else stat.textContent = '서버 응답: ' + (j.error || '오류') + ' (재시도 중)';
    } catch (e) { stat.textContent = '전송 오류 — 네트워크 확인 (재시도 중)'; }
    clearTimeout(to);
    inflight--;
  }, 'image/jpeg', QUALITY);
}

async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
  } catch (e) { stat.textContent = '카메라 접근 실패 — 권한을 허용하고 HTTPS 인지 확인하세요. (' + e.name + ')'; return; }
  v.srcObject = stream; await v.play();
  await lockScreen();
  running = true; sent = 0; inflight = 0; startedAt = Date.now(); timer = setInterval(tick, Math.round(1000 / FPS));
  btn.textContent = '■ 송출 중지'; btn.classList.add('on'); stat.textContent = '카메라 시작 — 전송 준비 중...';
}
function stop() {
  running = false; if (timer) { clearInterval(timer); timer = null; }
  unlockScreen();
  btn.textContent = '▶ 송출 시작'; btn.classList.remove('on');
  stat.textContent = '송출 중지 — 3초 뒤 CAM-03 은 기본 클립으로 복귀합니다.';
}
btn.addEventListener('click', () => running ? stop() : start());
</script>
</body></html>"""


@app.on_event("startup")
def _startup():
    # 영상 존재 + 의존성 임포트 가능하면 실모델 워커 기동, 아니면 합성 유지(각 카메라 독립).
    global OBJECT_REAL, PPE_REAL
    if os.path.exists(VIDEO_PATH):
        try:
            import supervision  # noqa: F401
            import ultralytics  # noqa: F401
            OBJECT_REAL = True
            threading.Thread(target=_object_worker, daemon=True).start()
            print("[cctv-ai] CAM-01 real worker started (YOLO + supervision ByteTrack)")
        except Exception as e:
            print(f"[cctv-ai] CAM-01 deps unavailable ({e}); synthetic")
    else:
        print(f"[cctv-ai] CAM-01 video not found ({VIDEO_PATH}); synthetic")
    # CAM-03: Hexmon 모델 로드 + 클립 폴백 워커(폰 인제스트는 모델만 뜨면 동작).
    if os.path.exists(PPE_MODEL):
        try:
            import ultralytics  # noqa: F401
            threading.Thread(target=_ppe_worker, daemon=True).start()
            print("[cctv-ai] CAM-03 worker starting (Hexmon PPE, clip fallback + phone ingest)")
        except Exception as e:
            print(f"[cctv-ai] CAM-03 deps unavailable ({e}); synthetic")
    else:
        print(f"[cctv-ai] CAM-03 model not found ({PPE_MODEL}); synthetic")


@app.get("/")
def health():
    return {"ok": True, "service": "vitalguard-cctv-ai",
            "cam01": "yolo+bytetrack" if OBJECT_REAL else "synthetic",
            "cam03": ("hexmon-ppe" if PPE_REAL else "synthetic"),
            "cam03_source": ("phone-live" if _ppe_is_live() else "clip"),
            "cam02_source": ("edge-live" if _cam2_is_live() else "synthetic"),
            "cams": ["object", "fall", "ppe"]}


@app.get("/cctv/stream")
def stream_object():
    return StreamingResponse(mjpeg_object(), media_type=MJPEG_MT)


@app.get("/cctv/stream2")
def stream_fall():
    return StreamingResponse(mjpeg_cam2_live(), media_type=MJPEG_MT)


@app.get("/cctv/stream3")
def stream_ppe():
    return StreamingResponse(mjpeg_ppe(), media_type=MJPEG_MT)


@app.get("/cctv/stats")
def stats_object():
    if OBJECT_REAL:
        with _obj_lock:
            s = _obj["stats"]
        if s:
            return JSONResponse(s)
    return JSONResponse(object_stats(time.time()))


@app.get("/cctv/stats2")
def stats_fall():
    return JSONResponse(_cam2_current_stats())


@app.get("/cctv/stats3")
def stats_ppe():
    return JSONResponse(_ppe_current_stats())


@app.get("/cctv/snapshot")
def snapshot_object():
    return Response(content=_live_frame(OBJECT_REAL, _obj, _obj_lock, "object"),
                    media_type="image/jpeg", headers=SNAPSHOT_HEADERS)


@app.get("/cctv/snapshot2")
def snapshot_fall():
    return Response(content=_cam2_current_frame(), media_type="image/jpeg", headers=SNAPSHOT_HEADERS)


@app.get("/cctv/snapshot3")
def snapshot_ppe():
    return Response(content=_ppe_current_frame(), media_type="image/jpeg", headers=SNAPSHOT_HEADERS)


def _draw_live(frame, dets):
    # 캐시된 박스만 그려 JPEG(추론 없음 = 빠름). 매 프레임 표시용 → 끊김 없음.
    img = draw_pil(frame, dets, "CAM-03  Live (Edge)  PPE (Hexmon)")
    okj, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 72])
    return buf.tobytes() if okj else b""


async def _ppe_live_infer(frame, ts):
    # 백그라운드 전체 Hexmon 추론 → 캐시 박스/통계 갱신(표시를 막지 않음 = 탐지 품질 그대로 유지).
    try:
        dets, stats = await run_in_threadpool(_ppe_infer_dets, frame)
        with _ppe_live_lock:
            _ppe_live["dets"] = dets
            _ppe_live["stats"] = stats
            _ppe_live["infer_ts"] = ts
    except Exception as e:
        print(f"[cctv-ai] live infer error ({e})")
    finally:
        with _ppe_live_lock:
            _ppe_live["infering"] = False


def _decode_frame(data: bytes):
    # ③ 디코드를 스레드풀에서 — 이벤트 루프를 막지 않는다(요청이 겹쳐도 HTTP 응답이 밀리지 않음).
    arr = np.frombuffer(data, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        return None
    if frame.shape[1] != OW3 or frame.shape[0] != OH3:
        frame = cv2.resize(frame, (OW3, OH3))
    return frame


async def _ppe_live_process(data: bytes, ts: float):
    # ② 응답 경로 밖에서 디코드 → 그리기 → (throttle)추론.
    #    파이프라이닝으로 프레임이 겹쳐 들어오므로, 늦게 끝난 옛 프레임은 draw_ts 비교로 버린다.
    need = False
    try:
        frame = await run_in_threadpool(_decode_frame, data)
        if frame is None:
            print("[cctv-ai] live decode failed (non-jpeg or corrupt)")
            return
        with _ppe_live_lock:
            if ts < _ppe_live["draw_ts"]:
                return  # 이미 더 새 프레임이 그려졌다 — 폐기
            dets = _ppe_live["dets"]
            need = (ts - _ppe_live["infer_ts"] >= PPE_LIVE_INFER_INTERVAL) and not _ppe_live["infering"]
            if need:
                _ppe_live["infering"] = True
        jpg = await run_in_threadpool(_draw_live, frame, dets)
        with _ppe_live_lock:
            if jpg and ts >= _ppe_live["draw_ts"]:
                _ppe_live["frame"] = jpg
                _ppe_live["draw_ts"] = ts
        if need:
            need = False  # 이후 infering 해제는 _ppe_live_infer 의 finally 가 담당
            await _ppe_live_infer(frame, ts)
    except Exception as e:
        print(f"[cctv-ai] live process error ({e})")
    finally:
        if need:  # 추론에 못 넘기고 빠져나온 경우만 여기서 해제
            with _ppe_live_lock:
                _ppe_live["infering"] = False


@app.post("/cctv/ingest3")
async def ingest_ppe(request: Request):
    # 엣지/폰이 JPEG 프레임(raw body)을 POST.
    # ★ 응답을 먼저 준다 — 디코드·그리기·추론은 전부 백그라운드로 넘긴다.
    #   폰의 왕복 시간에서 서버 처리시간(디코드+그리기 10~30ms)이 빠지고,
    #   캡처 페이지의 in-flight 파이프라이닝과 합쳐 실효 fps 가 오른다(끊김 완화).
    data = await request.body()
    if not data:
        return JSONResponse({"ok": False, "error": "empty body"}, status_code=400)
    if len(data) < 4 or data[:2] != b"\xff\xd8":  # JPEG SOI — 디코드 없이 싸게 거른다
        return JSONResponse({"ok": False, "error": "not a jpeg"}, status_code=400)
    now = time.time()
    with _ppe_live_lock:
        _ppe_live["ts"] = now  # 즉시 라이브로 표시 → 클립 워커가 CPU 를 양보한다
        stats = _ppe_live["stats"]
    asyncio.create_task(_ppe_live_process(data, now))
    s = stats or {"person_count": 0, "fall_count": 0, "violation_count": 0, "compliance_rate": 100}
    return JSONResponse({"ok": True, "persons": s["person_count"], "fall": s["fall_count"],
                        "violations": s["violation_count"], "compliance": s["compliance_rate"]})


@app.post("/cctv/ingest2")
async def ingest_fall_live(request: Request):
    # Jetson 이 낙상 박스를 그린 JPEG 프레임(raw body)을 POST → 서버 추론 없이 그대로 CAM-02 표시(display-only).
    # 통계는 쿼리(persons, fall)로 동봉(없으면 0). 단일 인스턴스 CPU 보호 — CAM-03 PPE 만 서버 추론.
    data = await request.body()
    if not data:
        return JSONResponse({"ok": False, "error": "empty body"}, status_code=400)
    arr = np.frombuffer(data, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        return JSONResponse({"ok": False, "error": "decode failed"}, status_code=400)
    if frame.shape[1] != W or frame.shape[0] != H:
        frame = cv2.resize(frame, (W, H))
    okj, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 72])
    qp = request.query_params
    try:
        persons = int(qp.get("persons", "0"))
        fall = int(qp.get("fall", "0"))
    except ValueError:
        persons, fall = 0, 0
    stats = {"total": persons, "fallen": fall,
             "byStatus": [{"status": "normal", "label": "정상", "count": max(persons - fall, 0)},
                          {"status": "fallen", "label": "낙상", "count": fall}]}
    with _cam2_lock:
        if okj:
            _cam2_live["frame"] = buf.tobytes()
        _cam2_live["stats"] = stats
        _cam2_live["ts"] = time.time()
    return JSONResponse({"ok": True, "persons": persons, "fall": fall})


@app.get("/cam3/capture", response_class=HTMLResponse)
def cam3_capture():
    # 폰(또는 노트북 웹캠)으로 여는 캡처 페이지 — 카메라 프레임을 /cctv/ingest3 로 ~5fps POST. Start/Stop + Wake Lock.
    return HTMLResponse(CAPTURE_HTML)
