# 아이폰 카메라 프레임을 젯슨에서 TensorRT 추론·박스 렌더 후 cctv-ai 로 중계하는 엣지 릴레이
"""
iPhone(사파리) --HTTPS--> Jetson(이 스크립트) --HTTP--> cctv-ai(/cctv/ingest3?drawn=1) --> 관제웹 CAM-03

- 젯슨이 캡처 페이지를 직접 서빙한다(같은 오리진이라 CORS 불필요, Tailscale 인증서로 getUserMedia 동작).
- 추론은 젯슨 TensorRT(우리 yolo26 학습본). Cloud Run 은 표시만 한다(서버 추론 0).
- 도착은 불규칙해도 Cloud Run 으로는 고정 간격으로 밀어 지터를 흡수한다(젯슨이 버퍼 역할).

사용:
    CCTV_BASE=https://cctv-ai-....run.app python3 phone_ppe_relay.py
    → 아이폰 사파리에서 https://jetson-1.tailnet.invalid:8443/
"""

import os
import threading
import time
from collections import Counter, deque

import cv2
import numpy as np
from flask import Flask, Response, jsonify, request
from PIL import Image, ImageDraw, ImageFont

ENGINE = os.environ.get("PPE_ENGINE", "/home/jetson/ppe_yolo26s_640_v3_nc.engine")
CCTV_BASE = os.environ.get("CCTV_BASE", "").rstrip("/")   # 비면 푸시 없이 로컬 확인만
PUSH_FPS = float(os.environ.get("PUSH_FPS", "5"))          # Cloud Run 으로 내보내는 고정 cadence
PORT = int(os.environ.get("PORT", "8443"))
CERT = os.environ.get("TS_CERT", "/home/jetson/jetson-1.tailnet.invalid.crt")
KEY = os.environ.get("TS_KEY", "/home/jetson/jetson-1.tailnet.invalid.key")
FONT_PATH = os.environ.get("FONT", "/home/jetson/NanumGothic-Regular.ttf")
CONF = float(os.environ.get("PPE_CONF", "0.35"))
CAP_FPS = int(os.environ.get("CAP_FPS", "6"))          # 폰 캡처 목표 fps
#   ★ 실측 천장 약 4.8fps — iOS Safari 타이머 스로틀(≈208ms)이 한계다.
#     해상도·품질·슬롯을 바꿔도 안 오르는 것을 실험으로 확인했다(480x270·Q0.4 에서도 동일).
#     5fps 를 넘기려면 WebCodecs VideoEncoder 또는 RTMP 송출앱으로 방식을 바꿔야 한다.
CAP_INFLIGHT = int(os.environ.get("CAP_INFLIGHT", "4"))  # 동시 전송 슬롯(왕복 변동 흡수)
CAP_W = int(os.environ.get("CAP_W", "640"))            # 폰이 인코딩할 해상도(작을수록 인코딩 빠름)
CAP_H = int(os.environ.get("CAP_H", "360"))
CAP_Q = float(os.environ.get("CAP_Q", "0.5"))          # JPEG 품질
OW, OH = 640, 360

# 통합 8클래스 — 학습 노트북과 동일 순서
NAMES = ["person", "head", "helmet", "safety_vest", "foot", "shoes", "hands", "gloves"]
KO = {"person": "작업자", "head": "안전모 미착용", "helmet": "안전모", "safety_vest": "안전조끼",
      "foot": "발", "shoes": "안전화", "hands": "손", "gloves": "장갑"}
# 표시할 클래스만(작은 객체까지 다 그리면 화면이 지저분하다)
SHOW = {"person", "head", "helmet", "safety_vest"}
COLOR = {"head": (220, 40, 40), "helmet": (40, 190, 90), "person": (70, 140, 240),
         "safety_vest": (240, 170, 40)}

app = Flask(__name__)
_model = None
_model_lock = threading.Lock()
_state_lock = threading.Lock()
_state = {"jpg": b"", "stats": None, "ts": 0.0, "recv": 0, "infer_ms": 0.0}
_font = None
_font_small = None


def _fonts():
    global _font, _font_small
    if _font is None:
        try:
            _font = ImageFont.truetype(FONT_PATH, 15)
            _font_small = ImageFont.truetype(FONT_PATH, 13)
        except Exception:
            _font = ImageFont.load_default()
            _font_small = _font
    return _font, _font_small


def _ensure_model():
    global _model
    with _model_lock:
        if _model is None:
            from ultralytics import YOLO
            _model = YOLO(ENGINE, task="detect")
            print(f"[relay] engine loaded: {ENGINE}", flush=True)
    return _model


def infer(frame):
    """TensorRT 추론 → [(cls_name, (x1,y1,x2,y2), conf)] + 통계."""
    m = _ensure_model()
    t0 = time.perf_counter()
    r = m.predict(frame, imgsz=640, conf=CONF, verbose=False)[0]
    ms = (time.perf_counter() - t0) * 1000
    dets = []
    for b, c, f in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist(), r.boxes.conf.tolist()):
        i = int(c)
        dets.append((NAMES[i] if i < len(NAMES) else str(i), tuple(map(float, b)), float(f)))
    cnt = Counter(d[0] for d in dets)
    persons = cnt.get("person", 0)
    bare = cnt.get("head", 0)          # 맨머리 = 안전모 미착용
    worn = cnt.get("helmet", 0)
    total_head = bare + worn
    stats = {
        "person_count": persons,
        "fall_count": 0,
        "violation_count": bare,
        "compliance_rate": int(round(100 * worn / total_head)) if total_head else 100,
        "no_hardhat_count": bare,
        "hardhat_count": worn,
        "no_vest_count": 0,
        "vest_count": cnt.get("safety_vest", 0),
    }
    return dets, stats, ms


HEADER_H = 22


def draw(frame, dets, ms):
    """헤더 → 박스 → 라벨 순. 헤더를 먼저 그려야 상단 박스의 라벨이 안 가린다."""
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(img)
    f, fs = _fonts()
    d.rectangle((0, 0, OW, HEADER_H), fill=(0, 0, 0))
    d.text((8, 3), "CAM-03  Live (Jetson TensorRT)  PPE (yolo26)", font=f, fill=(240, 240, 240))
    tstr = time.strftime("%H:%M:%S")
    d.text((OW - 132, 3), f"{ms:.0f}ms  {tstr}", font=f, fill=(230, 90, 90))
    for name, (x1, y1, x2, y2), conf in dets:
        if name not in SHOW:
            continue
        col = COLOR.get(name, (200, 200, 200))
        d.rectangle((x1, y1, x2, y2), outline=col, width=2)
        label = f"{KO.get(name, name)} {conf*100:.0f}"
        tw = d.textlength(label, font=fs)
        ty = y1 - 17
        if ty < HEADER_H + 1:            # 헤더와 겹치면 박스 안쪽 위에 붙인다(가려지지 않게)
            ty = min(y1 + 2, OH - 18)
        tx = min(x1, OW - tw - 9)        # 오른쪽 밖으로 나가지 않게
        d.rectangle((tx, ty, tx + tw + 8, ty + 17), fill=col)
        d.text((tx + 4, ty + 1), label, font=fs, fill=(255, 255, 255))
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR),
                           [int(cv2.IMWRITE_JPEG_QUALITY), 72])
    return buf.tobytes() if ok else b""


def _pusher():
    """고정 cadence 로 cctv-ai 에 push — 아이폰 도착 지터를 여기서 흡수한다."""
    import urllib.parse
    import urllib.request
    if not CCTV_BASE:
        print("[relay] CCTV_BASE 미설정 — 로컬 확인 전용(푸시 없음)", flush=True)
        return
    url_base = f"{CCTV_BASE}/cctv/ingest3"
    interval = 1.0 / PUSH_FPS
    sent = 0
    last_ts = 0.0
    while True:
        t0 = time.time()
        with _state_lock:
            jpg, s, ts = _state["jpg"], _state["stats"], _state["ts"]
        if jpg and ts != last_ts:          # 새 프레임이 있을 때만
            last_ts = ts
            q = urllib.parse.urlencode({
                "drawn": "1",
                "persons": (s or {}).get("person_count", 0),
                "violations": (s or {}).get("violation_count", 0),
                "compliance": (s or {}).get("compliance_rate", 100),
                "hardhat": (s or {}).get("hardhat_count", 0),
                "no_hardhat": (s or {}).get("no_hardhat_count", 0),
            })
            req = urllib.request.Request(f"{url_base}?{q}", data=jpg,
                                         headers={"Content-Type": "image/jpeg"})
            try:
                with urllib.request.urlopen(req, timeout=4):
                    sent += 1
                    if sent % 50 == 0:
                        print(f"[relay] pushed {sent}", flush=True)
            except Exception as e:
                print(f"[relay] push error ({e})", flush=True)
        time.sleep(max(interval - (time.time() - t0), 0.01))


@app.post("/ingest")
def ingest():
    data = request.get_data()
    if not data or data[:2] != b"\xff\xd8":
        return jsonify({"ok": False, "error": "not a jpeg"}), 400
    arr = np.frombuffer(data, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        return jsonify({"ok": False, "error": "decode failed"}), 400
    if frame.shape[1] != OW or frame.shape[0] != OH:
        frame = cv2.resize(frame, (OW, OH))
    dets, stats, ms = infer(frame)
    jpg = draw(frame, dets, ms)
    with _state_lock:
        _state.update(jpg=jpg, stats=stats, ts=time.time(), infer_ms=ms)
        _state["recv"] += 1
    return jsonify({"ok": True, "persons": stats["person_count"], "fall": 0,
                    "violations": stats["violation_count"],
                    "compliance": stats["compliance_rate"], "infer_ms": round(ms, 1)})


@app.get("/snapshot")
def snapshot():
    with _state_lock:
        jpg = _state["jpg"]
    if not jpg:
        return jsonify({"ok": False, "error": "no frame"}), 404
    return Response(jpg, mimetype="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/health")
def health():
    with _state_lock:
        s = dict(_state)
    s.pop("jpg", None)
    s["age"] = round(time.time() - s["ts"], 2) if s["ts"] else None
    s["engine"] = ENGINE
    s["cctv_base"] = CCTV_BASE or "(미설정)"
    return jsonify(s)


CAPTURE = """<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<title>CAM-03 폰 송출 (젯슨 추론)</title>
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
  #stat { font-size:13px; color:#9aa0a6; min-height:46px; padding:0 16px 24px; line-height:1.5; }
  .big { font-size:15px; color:#e6e6e6; }
</style></head>
<body>
  <h1>VitAlGuard · CAM-03 송출 <span style="color:#4ade80">(젯슨 추론)</span></h1>
  <div class="sub">폰은 원본만 보냅니다. 추론은 젯슨 TensorRT(yolo26). (가로로 들면 화면비가 맞습니다)</div>
  <div id="wrap"><video id="v" autoplay muted playsinline></video></div>
  <button id="btn">▶ 송출 시작</button>
  <div id="stat">대기 중 — '송출 시작'을 누르세요.</div>
<script>
const FPS = __FPS__, QUALITY = __Q__, CW = __W__, CH = __H__, MAX_INFLIGHT = __INFLIGHT__, SEND_TIMEOUT_MS = 5000;
let encMs = 0;  // toBlob 소요 — 인코딩 병목 판별용
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
  const t0 = performance.now();
  canvas.toBlob(async (blob) => {
    encMs = performance.now() - t0;
    if (!blob) { inflight--; return; }
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), SEND_TIMEOUT_MS);
    try {
      const r = await fetch('/ingest', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob, signal: ac.signal });
      const j = await r.json();
      sent++;
      const secs = startedAt ? (Date.now() - startedAt) / 1000 : 0;
      const fps = secs > 1 ? (sent / secs).toFixed(1) : '--';
      if (j.ok) stat.innerHTML = '<span class="big">송출 중 · ' + sent + ' 프레임 · ' + fps + ' fps</span><br>작업자 ' + j.persons + ' · 미착용 ' + j.violations + ' · 준수율 ' + j.compliance + '%<br>추론 ' + j.infer_ms + 'ms · 인코딩 ' + encMs.toFixed(0) + 'ms · ' + Math.round(blob.size/1024) + 'KB';
      else stat.textContent = '서버 응답: ' + (j.error || '오류') + ' (재시도 중)';
    } catch (e) { stat.textContent = '전송 오류 — 네트워크 확인 (재시도 중)'; }
    clearTimeout(to);
    inflight--;
  }, 'image/jpeg', QUALITY);
}

async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
  } catch (e) { stat.textContent = '카메라 접근 실패 — 권한 허용 + HTTPS 확인 (' + e.name + ')'; return; }
  v.srcObject = stream; await v.play();
  await lockScreen();
  running = true; sent = 0; inflight = 0; startedAt = Date.now(); timer = setInterval(tick, Math.round(1000 / FPS));
  btn.textContent = '■ 송출 중지'; btn.classList.add('on'); stat.textContent = '카메라 시작 — 전송 준비 중...';
}
function stop() {
  running = false; if (timer) { clearInterval(timer); timer = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  unlockScreen();
  btn.textContent = '▶ 송출 시작'; btn.classList.remove('on');
  stat.textContent = '송출 중지 — 잠시 후 CAM-03 은 기본 클립으로 복귀합니다.';
}
btn.addEventListener('click', () => running ? stop() : start());
</script>
</body></html>"""


@app.get("/")
def index():
    html = (CAPTURE.replace("__FPS__", str(CAP_FPS)).replace("__INFLIGHT__", str(CAP_INFLIGHT))
                   .replace("__W__", str(CAP_W)).replace("__H__", str(CAP_H))
                   .replace("__Q__", str(CAP_Q)))
    return Response(html, mimetype="text/html", headers={"Cache-Control": "no-store"})


if __name__ == "__main__":
    _ensure_model()
    threading.Thread(target=_pusher, daemon=True).start()
    ssl_ctx = (CERT, KEY) if os.path.exists(CERT) and os.path.exists(KEY) else None
    print(f"[relay] https://{os.uname().nodename}.tailnet.invalid:{PORT}/  ssl={'on' if ssl_ctx else 'OFF'}", flush=True)
    app.run(host="0.0.0.0", port=PORT, ssl_context=ssl_ctx, threaded=True)
