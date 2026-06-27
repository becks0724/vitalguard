# VitAlGuard CCTV AI 데모 서버 컨테이너 — FastAPI MJPEG + 감지 통계. CAM-01=실제 YOLOv8n(CPU 추론). Cloud Run 용.
FROM python:3.11-slim

# opencv(headless) 런타임 의존(libGL·glib). 빌드 캐시 위해 requirements 먼저.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# torch/torchvision 은 CPU 전용 휠로(기본 PyPI 는 CUDA 빌드 ~2GB+). 그 다음 ultralytics + lap.
# lap = ByteTrack 트래킹(차량 속도추정용) 의존 — 명시 설치(없으면 런타임 자동설치 시도 → 네트워크 의존·취약).
# ultralytics 가 opencv-python(full)을 끌어오므로 제거 → headless 만 cv2 제공(이미지 경량).
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir ultralytics==8.4.80 'lap>=0.5.12' \
 && pip uninstall -y opencv-python opencv-python-headless >/dev/null 2>&1 || true
# ↑ ultralytics 가 양쪽을 흔들 수 있어 모두 제거 후 headless 만 재설치(단일 cv2 보장).
RUN pip install --no-cache-dir opencv-python-headless==4.10.0.84

# 모델 weights(yolov8n.pt)·샘플영상(samples/cam01.mp4)·코드 번들(빌드타임 다운로드 불필요 → 재현가능).
COPY . .

# ultralytics 설정/캐시는 쓰기가능 경로로(런타임 외부 네트워크 호출 회피).
ENV YOLO_CONFIG_DIR=/tmp/Ultralytics
# Cloud Run 은 $PORT 로 들어옴(기본 8080).
ENV PORT=8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
