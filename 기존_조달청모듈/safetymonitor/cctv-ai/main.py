# VitAlGuard CCTV AI 데모 서버 — 대시보드 CCTV 관제 3타일(객체/낙상/PPE)에 MJPEG 스트림 + 감지 통계 제공.
# CAM-01(객체)=실제 YOLOv8n 추론(번들 샘플영상 samples/cam01.mp4), CAM-02/03=합성 시뮬레이션.
# 모델·영상이 없거나 ultralytics 미설치면 CAM-01 도 합성으로 자동 폴백(배포 견고성).
# 계약(대시보드 CctvQuadView): GET /cctv/stream[|2|3]=MJPEG, /cctv/stats=객체 /cctv/stats2=낙상 /cctv/stats3=PPE.
import asyncio
import os
import threading
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

app = FastAPI(title="VitAlGuard CCTV AI (demo)")

# /cctv/stats* fetch 용 CORS(라이브 대시보드 + 로컬 dev). MJPEG <img> 는 CORS 불필요.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app",
        "http://localhost:3000",
    ],
    allow_methods=["GET"],
    allow_headers=["*"],
)

W, H = 640, 360
FPS = 12

# ── CAM-01 실제 YOLOv8n 추론 설정 ────────────────────────────────────────────────────────
MODEL_PATH = os.environ.get("YOLO_MODEL", "yolov8n.pt")
VIDEO_PATH = os.environ.get("CAM01_VIDEO", "samples/cam01.mp4")
PLAYBACK_FPS = 15  # 샘플영상 캡처 fps(실시간 속도 유지)
CONF = float(os.environ.get("YOLO_CONF", "0.25"))   # 군중 인식률 위해 0.35→0.25
IMGSZ = int(os.environ.get("YOLO_IMGSZ", "960"))    # 추론 해상도 — 원거리 군중(작은 객체) 검출에 결정적(640→960=사람 4배)
OW, OH = 1280, 720  # CAM-01 출력 해상도(고해상도). 합성 CAM-02/03 은 W,H=640,360 유지.
FONT_PATH = os.environ.get("LABEL_FONT", "NanumGothic-Regular.ttf")  # 한글 라벨용(cv2 한글 미지원 → PIL)

# COCO(en) → 대시보드 한글 라벨. 화이트리스트(사람·자전거·차량류)만 그린다(가방·신호등 등 노이즈 제외).
COCO_KO = {
    "person": "보행자", "bicycle": "자전거", "car": "차량",
    "motorcycle": "오토바이", "bus": "버스", "truck": "트럭",
}
CLASS_COLOR = {
    "보행자": (80, 200, 255), "자전거": (255, 200, 80), "차량": (120, 220, 120),
    "오토바이": (200, 160, 255), "버스": (240, 200, 120), "트럭": (60, 160, 240),
}
# 속도 추정 대상(차량류). 사람·자전거는 탐지만.
VEHICLE_KO = {"차량", "버스", "트럭", "오토바이"}
# 픽셀속도(px/s)→추정 km/h 보정계수. 카메라 실측보정이 없어 단일 평면 가정의 근사치.
# 0.33 = 720p(1280px) 신 클립 움직이는 차량 p95≈50km/h 가 되도록 백분위로 보정(주간 교차로=정지多·분포넓음). env 로 조정.
SPEED_KMH_PER_PXPS = float(os.environ.get("SPEED_KMH_PER_PXPS", "0.33"))
SPEED_MAX_KMH = 120.0   # ID 스왑 텔레포트 클램프
SPEED_SHOW_MIN = 5      # 이 미만(km/h)은 숫자 생략 — 정지/서행 차량은 '차량'만 표기(깔끔)

_obj_lock = threading.Lock()
_obj = {"frame": b"", "stats": None}
OBJECT_REAL = False  # startup 에서 모델·영상 로드 성공 시 True


def _object_worker():
    # 백그라운드 스레드: 샘플영상 루프 → YOLOv8n 트래킹(ByteTrack) → 실박스 + 차량 속도추정 + 실통계 → 전역 갱신.
    global OBJECT_REAL
    try:
        from ultralytics import YOLO  # 지연 임포트(폴백 시 미설치여도 무방)
        model = YOLO(MODEL_PATH)
        cap = cv2.VideoCapture(VIDEO_PATH)
        if not cap.isOpened():
            raise RuntimeError(f"cannot open {VIDEO_PATH}")
        # 속도 시간기준 = 영상(클립) fps. 워커 처리속도와 무관하게 인접 프레임=1/clip_fps 초.
        clip_fps = cap.get(cv2.CAP_PROP_FPS) or float(PLAYBACK_FPS)
    except Exception as e:  # 로드 실패 → CAM-01 합성 폴백
        print(f"[cctv-ai] CAM-01 real worker init failed ({e}); falling back to synthetic")
        OBJECT_REAL = False
        return

    target_dt = 1.0 / PLAYBACK_FPS
    fps_ema = float(PLAYBACK_FPS)
    tracks = {}      # tid -> {"cx","cy","idx","kmh"} : ID 별 centroid 이력 + 평활 속도
    frame_idx = 0
    while True:
        t0 = time.time()
        try:
            ok, frame = cap.read()
            if not ok:  # 영상 끝 → 처음으로 루프(경계 텔레포트 속도 방지 위해 이력 초기화)
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                tracks.clear()
                continue
            if frame.shape[1] != OW or frame.shape[0] != OH:
                frame = cv2.resize(frame, (OW, OH))
            frame_idx += 1
            res = model.track(frame, imgsz=IMGSZ, persist=True, tracker="bytetrack.yaml",
                              verbose=False, conf=CONF)[0]
            boxes = res.boxes
            ids = boxes.id.int().tolist() if boxes.id is not None else [None] * len(boxes)

            header = "CAM-01  Hongdae St.  YOLOv8n@960 + speed"
            by = {}
            speeds = []  # 움직이는 차량 추정 km/h(통계용)
            dets = []
            for b, tid in zip(boxes, ids):
                en = model.names[int(b.cls)]
                ko = COCO_KO.get(en)
                if not ko:
                    continue
                x1, y1, x2, y2 = (int(v) for v in b.xyxy[0])
                by[ko] = by.get(ko, 0) + 1
                ko_label, en_label = ko, en
                # 차량류 + 트래킹 ID 있으면 속도 추정.
                if ko in VEHICLE_KO and tid is not None:
                    cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
                    prev = tracks.get(tid)
                    kmh = prev["kmh"] if prev else 0.0
                    if prev:
                        df = frame_idx - prev["idx"]
                        if df > 0:
                            dpx = ((cx - prev["cx"]) ** 2 + (cy - prev["cy"]) ** 2) ** 0.5 / df
                            inst = min(dpx * clip_fps * SPEED_KMH_PER_PXPS, SPEED_MAX_KMH)
                            kmh = 0.6 * prev["kmh"] + 0.4 * inst if prev["kmh"] > 0 else inst
                    tracks[tid] = {"cx": cx, "cy": cy, "idx": frame_idx, "kmh": kmh}
                    if kmh >= 1:
                        speeds.append(kmh)
                    if kmh >= SPEED_SHOW_MIN:  # 서행/정지는 숫자 생략
                        ko_label, en_label = f"{ko} {kmh:.0f}km/h", f"{en} {kmh:.0f}km/h"
                dets.append((x1, y1, x2, y2, CLASS_COLOR.get(ko, (80, 200, 255)), ko_label, en_label))
            img = draw_cam01(frame, dets, header)
            # 오래 안 보인 트랙 정리.
            for tid in [t for t, v in tracks.items() if frame_idx - v["idx"] > 30]:
                tracks.pop(tid, None)
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
        if rem > 0:
            time.sleep(rem)


# ── 장면 상태(시뮬레이션) — render 와 stats 가 같은 함수를 써서 영상·통계가 일치 ──────────────

def object_state(t: float):
    # 정문 출입구 — 보행자/차량/트럭이 화면을 가로지른다.
    tracks = [("보행자", "person", 22), ("보행자", "person", 30), ("차량", "car", 64), ("트럭", "truck", 44)]
    out = []
    for i, (ko, en, speed) in enumerate(tracks):
        x = int((40 + speed * t + i * 150) % (W + 120)) - 60
        y = 70 + (i * 64) % 230
        w, h = (38, 86) if en == "person" else (116, 58)
        out.append({"ko": ko, "en": en, "box": (x, y, w, h), "color": (80, 200, 255)})
    return out


def fall_state(t: float):
    # 지하 기계실 — 작업자 4명. 1명이 20초 주기로 5초간 낙상.
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
    # 현장 작업구역(GoPro) — 작업자 4명, 안전모/조끼 착용. 1명이 24초 주기로 8초간 추가 위반.
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


# ── 통계(JSON) — 대시보드 strip 형식 정확 일치 ──────────────────────────────────────────

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
            "hardhat_count": hard, "vest_count": vest, "person_count": person}


# ── 렌더(MJPEG 프레임) — OpenCV(영문 라벨; 한글은 stats JSON 으로 전달) ─────────────────────

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


# ── 한글 라벨(PIL) — cv2 는 한글 폰트 미지원이라 CAM-01 박스/라벨/헤더를 PIL 로 그린다 ──────────────
try:
    _FONT = ImageFont.truetype(FONT_PATH, 20)
    _FONT_SM = ImageFont.truetype(FONT_PATH, 17)
except Exception as e:  # 폰트 없으면 영문 cv2 폴백
    print(f"[cctv-ai] 한글 폰트 로드 실패({e}) — CAM-01 영문 라벨 폴백")
    _FONT = _FONT_SM = None


def draw_cam01(frame, dets, header):
    # frame(BGR)에 박스 + 한글 라벨 + 헤더를 그려 BGR 반환. dets=[(x1,y1,x2,y2,color_bgr,ko,en)].
    if _FONT is None:  # 폰트 없을 때 cv2 영문 폴백
        cv2.rectangle(frame, (0, 0), (OW, 30), (18, 18, 20), -1)
        cv2.putText(frame, header, (8, 21), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (220, 220, 220), 1, cv2.LINE_AA)
        for x1, y1, x2, y2, color, ko, en in dets:
            draw_box(frame, (x1, y1, x2 - x1, y2 - y1), color, en)
        return frame
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, OW, 30), fill=(20, 18, 18))
    d.text((10, 5), header, font=_FONT, fill=(225, 225, 225))
    d.ellipse((OW - 116, 11, OW - 108, 19), fill=(239, 60, 60))
    d.text((OW - 100, 6), time.strftime("%H:%M:%S"), font=_FONT_SM, fill=(190, 190, 190))
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


async def mjpeg(cam: str):
    while True:
        frame = render(cam, time.time())
        if frame:
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        await asyncio.sleep(1.0 / FPS)


async def mjpeg_object():
    # CAM-01: 실추론 프레임(전역) 우선, 워밍업/폴백 시 합성 프레임.
    while True:
        frame = b""
        if OBJECT_REAL:
            with _obj_lock:
                frame = _obj["frame"]
        if not frame:
            frame = render("object", time.time())
        if frame:
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        await asyncio.sleep(1.0 / FPS)


# ── 라우트 ─────────────────────────────────────────────────────────────────────────────
MJPEG_MT = "multipart/x-mixed-replace; boundary=frame"


@app.on_event("startup")
def _startup():
    # 모델·영상 존재 + ultralytics 임포트 가능하면 CAM-01 실추론 워커 기동, 아니면 합성 유지.
    global OBJECT_REAL
    if not os.path.exists(VIDEO_PATH):
        print(f"[cctv-ai] CAM-01 video not found ({VIDEO_PATH}); CAM-01 synthetic")
        return
    try:
        import ultralytics  # noqa: F401
    except Exception as e:
        print(f"[cctv-ai] ultralytics unavailable ({e}); CAM-01 synthetic")
        return
    OBJECT_REAL = True
    threading.Thread(target=_object_worker, daemon=True).start()
    print("[cctv-ai] CAM-01 real YOLOv8n worker started")


@app.get("/")
def health():
    return {"ok": True, "service": "vitalguard-cctv-ai",
            "cam01": "yolov8n" if OBJECT_REAL else "synthetic",
            "cams": ["object", "fall", "ppe"]}


@app.get("/cctv/stream")
def stream_object():
    return StreamingResponse(mjpeg_object(), media_type=MJPEG_MT)


@app.get("/cctv/stream2")
def stream_fall():
    return StreamingResponse(mjpeg("fall"), media_type=MJPEG_MT)


@app.get("/cctv/stream3")
def stream_ppe():
    return StreamingResponse(mjpeg("ppe"), media_type=MJPEG_MT)


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
    return JSONResponse(fall_stats(time.time()))


@app.get("/cctv/stats3")
def stats_ppe():
    return JSONResponse(ppe_stats(time.time()))


# ── 단발 JPEG 스냅샷(폴링용·MJPEG 대안) — 슬롯 즉시 반환으로 동시성 점유 회피 ──────────────
SNAPSHOT_HEADERS = {"Cache-Control": "no-store"}


@app.get("/cctv/snapshot")
def snapshot_object():
    # CAM-01 객체: 실추론 프레임(전역) 우선, 없으면 합성. mjpeg_object 와 동일 패턴.
    frame = b""
    if OBJECT_REAL:
        with _obj_lock:
            frame = _obj["frame"]
    if not frame:
        frame = render("object", time.time())
    return Response(content=frame, media_type="image/jpeg", headers=SNAPSHOT_HEADERS)


@app.get("/cctv/snapshot2")
def snapshot_fall():
    return Response(content=render("fall", time.time()), media_type="image/jpeg", headers=SNAPSHOT_HEADERS)


@app.get("/cctv/snapshot3")
def snapshot_ppe():
    return Response(content=render("ppe", time.time()), media_type="image/jpeg", headers=SNAPSHOT_HEADERS)
