# VitAlGuard CCTV AI 데모 서버 컨테이너 — FastAPI MJPEG + 감지 통계. CAM-01=YOLOv8n, CAM-03=Hexmon PPE(둘 다 CPU 추론). Cloud Run 용.
FROM python:3.11-slim

# opencv(headless) 런타임 의존(libGL·glib). YOLO-World/CLIP 제거로 git 불필요.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# torch/torchvision 은 CPU 전용 휠로(기본 PyPI 는 CUDA 빌드 ~2GB+). 그 다음 ultralytics + lap + supervision.
# lap = ByteTrack 의존, supervision = CAM-01 ByteTrack+원근보정 속도(Roboflow). 명시 설치(런타임 자동설치·네트워크 회피).
# ultralytics·supervision 이 opencv-python(full)을 끌어오므로 제거 → headless 만 cv2 제공(이미지 경량·단일 cv2).
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir ultralytics==8.4.80 'lap>=0.5.12' 'supervision==0.29.1' \
 && pip uninstall -y opencv-python opencv-python-headless >/dev/null 2>&1 || true
RUN pip install --no-cache-dir opencv-python-headless==4.10.0.84

# 번들: yolov8n.pt(CAM-01)·vyra_ppe.pt(CAM-03 Hexmon PPE)·samples/cam0{1,3}.mp4·NanumGothic.
COPY . .

# Hexmon PPE 가중치 로드를 빌드타임에 검증(번들 누락 시 빌드 실패 — 런타임 폴백보다 빨리 잡음).
RUN python -c "from ultralytics import YOLO; m=YOLO('vyra_ppe.pt'); print('PPE classes:', len(m.names))"

# ultralytics 설정/캐시는 쓰기가능 경로로(런타임 외부 네트워크 호출 회피).
ENV YOLO_CONFIG_DIR=/tmp/Ultralytics
# Cloud Run 은 $PORT 로 들어옴(기본 8080).
ENV PORT=8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
