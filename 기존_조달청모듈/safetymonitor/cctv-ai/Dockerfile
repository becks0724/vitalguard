# VitAlGuard CCTV AI 데모 서버 컨테이너 — FastAPI MJPEG 스트림 + 감지 통계(시뮬레이션). Cloud Run 용.
FROM python:3.11-slim

# opencv(headless) 런타임 의존(libGL·glib). 빌드 캐시 위해 requirements 먼저.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Cloud Run 은 $PORT 로 들어옴(기본 8080).
ENV PORT=8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
