# VitAlGuard CCTV AI 데모 서버

대시보드 **CCTV 관제**의 AI 타일 3종(CAM-01 객체감지·CAM-02 낙상감지·CAM-03 PPE 안전모)에
MJPEG 실시간 영상 + 감지 통계를 제공하는 서버. Cloud Run 배포용.

- **CAM-01 객체감지 = 실제 YOLOv8n 추론 + 차량 속도추정 + 한글 라벨**(CPU). 번들 샘플영상(`samples/cam01.mp4`,
  홍대 거리 라이브캠 **720p·75초**)을 루프 재생, 프레임마다 **imgsz 960·conf 0.25** 추론 → 보행자·자전거·차량·버스·
  트럭·오토바이 실박스 + 실통계. 출력 **1280x720**. imgsz 640→960 으로 원거리 군중 인식률 약 4배(사람 2.8→11/frame).
  **라벨은 한글**(`보행자`·`차량 30km/h` …) — cv2 는 한글 미지원이라 **PIL+NanumGothic** 로 렌더(폰트 없으면 영문 폴백).
  **ByteTrack** 으로 ID별 픽셀이동→**추정 km/h**(움직이는 차량만 표기, 5km/h 미만 생략). 카메라 실측보정 없는 단일평면
  근사(보정계수 `SPEED_KMH_PER_PXPS` 기본 0.33 = 720p 클립 차량 p95≈50km/h). env 조정.
- **CAM-02 낙상·CAM-03 PPE = 합성 시뮬레이션**(OpenCV). 통계는 한글 라벨 JSON 으로 대시보드 strip 에 전달.
- 모델(`yolov8n.pt`)·영상이 없거나 ultralytics 미설치면 CAM-01 도 **합성으로 자동 폴백**(배포 견고성).

## 엔드포인트 계약 (대시보드가 거는 것)

| 경로 | 형식 | 비고 |
|---|---|---|
| `GET /cctv/stream` `/cctv/stream2` `/cctv/stream3` | `multipart/x-mixed-replace` MJPEG | 객체/낙상/PPE |
| `GET /cctv/snapshot` `/cctv/snapshot2` `/cctv/snapshot3` | 단발 `image/jpeg` | 폴링용·MJPEG 대안(객체/낙상/PPE) |
| `GET /cctv/stats` | `{fps,total,byClass:[{label,count}],alertsLastMinute, vehicleCount,maxSpeedKmh,avgSpeedKmh}` | 객체+속도(뒤 3필드는 실모델 전용·대시보드는 미사용 시 무시) |
| `GET /cctv/stats2` | `{total,fallen,byStatus:[{status,label,count}]}` | 낙상 |
| `GET /cctv/stats3` | `{violation_count,compliance_rate,no_hardhat_count,no_vest_count,hardhat_count,vest_count,person_count}` | PPE |

## 번들 바이너리 (git 미추적 — 재취득 절차)

`yolov8n.pt`·`samples/cam01.mp4`·`NanumGothic-Regular.ttf` 는 용량 때문에 git 에 올리지 않는다(`.gitignore`).
단 `.gcloudignore` 가 있어 **Cloud Build 업로드 컨텍스트·도커 이미지에는 포함**된다(아래 배포 항목).
새 머신에서 재생성하려면.

```bash
pip install yt-dlp opencv-python-headless certifi ultralytics
export SSL_CERT_FILE="$(python -c 'import certifi; print(certifi.where())')"   # macOS CA 이슈 대비

# 1) 모델 가중치(~6MB)
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"   # cwd 에 yolov8n.pt 저장

# 2) 한글 라벨 폰트(NanumGothic, OFL ~2MB)
python -c "import urllib.request as u; u.urlretrieve('https://github.com/google/fonts/raw/main/ofl/nanumgothic/NanumGothic-Regular.ttf','NanumGothic-Regular.ttf')"

# 3) 샘플영상 — 홍대 라이브캠(format 300=1280x720) 75초를 cv2 로 떠서 굽기(ffmpeg 불필요)
URL="$(yt-dlp -f 300 -g 'https://www.youtube.com/watch?v=iM1JSU1rl84')"
python - "$URL" <<'PY'
import sys, cv2
cap = cv2.VideoCapture(sys.argv[1]); OW,OH,FPS,SEC,KEEP=1280,720,15,75,4  # 60fps 소스 → 매 4번째 = 15fps
wr = cv2.VideoWriter("samples/cam01.mp4", cv2.VideoWriter_fourcc(*"mp4v"), FPS, (OW,OH))
read=w=0
while w < SEC*FPS:
    ok,f=cap.read()
    if not ok: break
    read+=1
    if read%KEEP: continue
    wr.write(cv2.resize(f,(OW,OH))); w+=1
wr.release(); cap.release(); print("written", w)
PY
```

## 로컬 실행

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install ultralytics "lap>=0.5.12"        # CAM-01 실추론+ByteTrack 속도추정(미설치면 합성 폴백)
uvicorn main:app --reload --port 8000
# 확인: curl localhost:8000/        → {"cam01":"yolov8n"|"synthetic", ...}
#       curl localhost:8000/cctv/stats ; 브라우저로 localhost:8000/cctv/stream
```

## Cloud Run 배포 (대시보드와 동일 프로젝트)

```bash
export PATH="~/Documents/google-cloud-sdk/bin:$PATH"
PROJECT=safetymonitor-498508 ; REGION=asia-northeast3
IMG=asia-northeast3-docker.pkg.dev/$PROJECT/vitalguard/cctv-ai:latest
gcloud builds submit --tag $IMG .
gcloud run deploy cctv-ai --image $IMG --region $REGION \
  --allow-unauthenticated --cpu 2 --memory 2Gi --timeout 3600 \
  --min-instances 1 --max-instances 10 --concurrency 200 --no-cpu-throttling \
  --update-env-vars YOLO_IMGSZ=800
# → 서비스 URL(https://cctv-ai-xxxxx.run.app) 확보
```

`YOLO_IMGSZ=800` — 추론 해상도. 코드 기본 960(인식률 최대·CPU fps~4-5)이나 라이브는 **800**(인식률 거의 동일·fps~6-7)로 운영.
더 빠르게=값↓(640), 더 정밀=값↑(960). `--cpu 4` 로 올리면 960 도 ~8-10fps.

플래그(전부 필수 — 빠지면 동작/안정성 저하).
- `--memory 2Gi` — torch+YOLOv8n 상주 메모리(합성 전용이던 1Gi 에서 상향).
- `--no-cpu-throttling` — **요청 밖 백그라운드 추론 스레드에 CPU 상시 할당**(기본 스로틀링이면 워커가 굶어 stats 가 합성으로 폴백).
- `--min-instances 1` — 콜드스타트(첫 연결 지연·모델 로드) 방지. MJPEG 는 장시간 연결이라 타임아웃 3600s.
- `--max-instances 10 --concurrency 200` — **MJPEG 는 연결당 동시성 슬롯을 장시간 점유**. maxScale 가 낮으면(예: 3) 누적 연결+대시보드 재연결 폭주로 슬롯 고갈→`429 "no available instance"`→검은 화면. 여유 확보.

> MJPEG 장기연결의 근본 취약성. 더 견고하게 하려면 **단발 JPEG 스냅샷 폴링**(클라가 `/cctv/snapshot` 을 N ms 마다 짧게 요청 → 슬롯 즉시 반환)으로 전환(서버 `/cctv/snapshot` 추가 + 대시보드 `<img stream>`→폴링). 현재는 헤드룸 확보로 단일 발표 시나리오 대응.

## 대시보드 연결 (빌드타임 URL 주입)

대시보드는 `NEXT_PUBLIC_AI_CCTV_API` 를 빌드 시 인라인한다(`.env.*` 는 dockerignore 제외).
현재 `gcloud builds submit --tag` 는 build-arg 를 못 넘기므로 `cloudbuild.yaml` 로 전환:

```yaml
# 기존_조달청모듈/safetymonitor/cloudbuild.dashboard.yaml
steps:
  - name: gcr.io/cloud-builders/docker
    args: ['build','--build-arg','NEXT_PUBLIC_AI_CCTV_API=${_AI_URL}',
           '-t','asia-northeast3-docker.pkg.dev/safetymonitor-498508/vitalguard/dashboard:latest','.']
images: ['asia-northeast3-docker.pkg.dev/safetymonitor-498508/vitalguard/dashboard:latest']
```
```bash
gcloud builds submit --config cloudbuild.dashboard.yaml \
  --substitutions=_AI_URL=https://cctv-ai-xxxxx.run.app .
# 이어서 gcloud run deploy vitalguard-dashboard --image <digest> ...
```

## 실모델 적용 현황

- **CAM-01 = 실제 YOLOv8n + 차량 속도추정 적용 완료.** `_object_worker()`(백그라운드 스레드)가 `samples/cam01.mp4` 를
  루프 읽어 `model.track(persist=True, tracker='bytetrack.yaml')` → 화이트리스트(보행자·자전거·차량·오토바이·버스·트럭)
  실박스 + 통계. 차량류는 ID별 centroid 이동(클립 fps 기준)을 px/s→추정 km/h(EMA 평활·SPEED_MAX_KMH 클램프)로
  박스에 표기, stats 에 `vehicleCount/maxSpeedKmh/avgSpeedKmh` 추가. `/cctv/stream`·`/cctv/stats` 가 전역을 읽는다.
- **CAM-02·CAM-03 = 합성 유지.** 실모델 전환 시 같은 패턴으로 `*_state()`/`*_stats()` 를 추론 결과로 교체하고,
  낙상용 영상(또는 포즈 모델)·PPE 용 영상(또는 안전모/조끼 커스텀 가중치)을 번들하면 된다.
- Cloud Run 엔 카메라가 없으므로 **번들 샘플영상** 또는 인터넷 RTSP 만 가능(로컬 웹캠 불가).
