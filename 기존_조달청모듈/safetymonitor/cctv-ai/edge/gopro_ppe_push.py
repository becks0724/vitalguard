# GoPro HERO9(USB-net UDP 8554) 프레임을 cctv-ai /cctv/ingest3 로 푸시하는 엣지 스크립트 (CAM-03 PPE·서버 Hexmon 추론)
# 사용: CCTV_BASE=https://cctv-ai-....run.app nohup python3 gopro_ppe_push.py >ppe_push.log 2>&1 </dev/null &
import os
import time
import urllib.request
import cv2

GOPRO_IP = os.environ.get("GOPRO_IP", "172.23.102.51")
CCTV_BASE = os.environ.get("CCTV_BASE", "").rstrip("/")
PUSH_FPS = float(os.environ.get("PUSH_FPS", "5"))
UDP_URL = "udp://0.0.0.0:8554?overrun_nonfatal=1&fifo_size=5000000"
W, H = 640, 360  # ingest3 계약 해상도(서버도 리사이즈하지만 전송량 절약)

if not CCTV_BASE:
    raise SystemExit("[ppe-push] CCTV_BASE 환경변수 필요 (예: https://cctv-ai-....run.app)")


def gopro_webcam_start() -> None:
    # 웹캠 모드 (재)기동 — 이미 스트리밍 중이어도 무해(status 2 반환)
    try:
        urllib.request.urlopen(f"http://{GOPRO_IP}/gp/gpWebcam/START?res=1080", timeout=5).read()
        print("[ppe-push] GoPro 웹캠 모드 START", flush=True)
    except Exception as e:
        print(f"[ppe-push] GoPro START 실패: {e}", flush=True)


def open_capture() -> cv2.VideoCapture:
    return cv2.VideoCapture(UDP_URL, cv2.CAP_FFMPEG)


def post_frame(jpg: bytes) -> bool:
    req = urllib.request.Request(
        CCTV_BASE + "/cctv/ingest3", data=jpg, headers={"Content-Type": "image/jpeg"}, method="POST"
    )
    try:
        urllib.request.urlopen(req, timeout=4).read()
        return True
    except Exception as e:
        print(f"[ppe-push] POST 실패: {e}", flush=True)
        return False


def main() -> None:
    gopro_webcam_start()
    cap = open_capture()
    interval = 1.0 / PUSH_FPS
    last_push = 0.0
    fail_reads = 0
    sent = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            fail_reads += 1
            if fail_reads >= 100:  # 스트림 두절 → 웹캠 재기동 + 캡처 재오픈
                print("[ppe-push] 스트림 두절 → 재연결", flush=True)
                cap.release()
                gopro_webcam_start()
                time.sleep(2)
                cap = open_capture()
                fail_reads = 0
            time.sleep(0.05)
            continue
        fail_reads = 0
        now = time.time()
        if now - last_push < interval:
            continue  # 디코드는 계속(버퍼 밀림 방지), 푸시만 스로틀
        last_push = now
        frame = cv2.resize(frame, (W, H))
        ok2, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok2:
            continue
        if post_frame(buf.tobytes()):
            sent += 1
            if sent % 100 == 1:
                print(f"[ppe-push] 전송 누적 {sent}", flush=True)


if __name__ == "__main__":
    main()
