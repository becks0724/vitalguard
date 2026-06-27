# VitAlGuard CCTV AI 데모 서버 — 대시보드 CCTV 관제 3타일(객체/낙상/PPE)에 MJPEG 스트림 + 감지 통계 제공.
# 자체완결 시뮬레이션(YOLO/torch/GPU/영상자산 불필요 → Cloud Run 즉시 배포). 실모델 전환은 README 참조.
# 계약(대시보드 CctvQuadView): GET /cctv/stream[|2|3]=MJPEG, /cctv/stats=객체 /cctv/stats2=낙상 /cctv/stats3=PPE.
import asyncio
import time

import cv2
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

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


# ── 라우트 ─────────────────────────────────────────────────────────────────────────────
MJPEG_MT = "multipart/x-mixed-replace; boundary=frame"


@app.get("/")
def health():
    return {"ok": True, "service": "vitalguard-cctv-ai", "cams": ["object", "fall", "ppe"]}


@app.get("/cctv/stream")
def stream_object():
    return StreamingResponse(mjpeg("object"), media_type=MJPEG_MT)


@app.get("/cctv/stream2")
def stream_fall():
    return StreamingResponse(mjpeg("fall"), media_type=MJPEG_MT)


@app.get("/cctv/stream3")
def stream_ppe():
    return StreamingResponse(mjpeg("ppe"), media_type=MJPEG_MT)


@app.get("/cctv/stats")
def stats_object():
    return JSONResponse(object_stats(time.time()))


@app.get("/cctv/stats2")
def stats_fall():
    return JSONResponse(fall_stats(time.time()))


@app.get("/cctv/stats3")
def stats_ppe():
    return JSONResponse(ppe_stats(time.time()))
