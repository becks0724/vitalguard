# VitAlGuard CCTV AI 데모 서버

대시보드 **CCTV 관제**의 AI 타일 3종(CAM-01 객체감지·CAM-02 낙상감지·CAM-03 PPE 안전모)에
MJPEG 실시간 영상 + 감지 통계를 제공하는 서버. Cloud Run 배포용.

- **CAM-01 객체감지 = 실제 YOLOv8n 추론 + 차량 속도추정**(CPU). 번들 샘플영상(`samples/cam01.mp4`, 홍대 거리
  라이브캠 40초)을 루프 재생하며 프레임마다 추론 → 보행자·자전거·차량·버스·트럭·오토바이 실박스 + 실통계.
  **ByteTrack 트래킹**으로 ID별 픽셀이동을 클립 fps 기준 px/s→**추정 km/h**(차량류 박스에 표기). 카메라 실측보정이
  없어 단일평면 근사치(보정계수 `SPEED_KMH_PER_PXPS`, 기본 0.15 = 본 클립 차량 median≈24km/h). env 로 조정.
- **CAM-02 낙상·CAM-03 PPE = 합성 시뮬레이션**(OpenCV). 통계는 한글 라벨 JSON 으로 대시보드 strip 에 전달.
- 모델(`yolov8n.pt`)·영상이 없거나 ultralytics 미설치면 CAM-01 도 **합성으로 자동 폴백**(배포 견고성).

## 엔드포인트 계약 (대시보드가 거는 것)

| 경로 | 형식 | 비고 |
|---|---|---|
| `GET /cctv/stream` `/cctv/stream2` `/cctv/stream3` | `multipart/x-mixed-replace` MJPEG | 객체/낙상/PPE |
| `GET /cctv/stats` | `{fps,total,byClass:[{label,count}],alertsLastMinute, vehicleCount,maxSpeedKmh,avgSpeedKmh}` | 객체+속도(뒤 3필드는 실모델 전용·대시보드는 미사용 시 무시) |
| `GET /cctv/stats2` | `{total,fallen,byStatus:[{status,label,count}]}` | 낙상 |
| `GET /cctv/stats3` | `{violation_count,compliance_rate,no_hardhat_count,no_vest_count,hardhat_count,vest_count,person_count}` | PPE |

## 번들 바이너리 (git 미추적 — 재취득 절차)

`yolov8n.pt`·`samples/cam01.mp4` 는 용량 때문에 git 에 올리지 않는다(`.gitignore`).
단 `.gcloudignore` 가 있어 **Cloud Build 업로드 컨텍스트·도커 이미지에는 포함**된다(아래 배포 항목).
새 머신에서 재생성하려면.

```bash
# 1) 모델 가중치(ultralytics 자동 다운로드 ~6MB)
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"   # cwd 에 yolov8n.pt 저장

# 2) 샘플영상 — 홍대 라이브캠(format 93=640x360) 40초를 cv2 로 떠서 굽기(ffmpeg 불필요)
pip install yt-dlp opencv-python-headless certifi
export SSL_CERT_FILE="$(python -c 'import certifi; print(certifi.where())')"   # macOS CA 이슈 대비
URL93="$(yt-dlp -f 93 -g 'https://www.youtube.com/watch?v=iM1JSU1rl84')"
python - "$URL93" <<'PY'
import sys, cv2
cap = cv2.VideoCapture(sys.argv[1]); W,H,FPS,SEC,KEEP=640,360,15,40,2
wr = cv2.VideoWriter("samples/cam01.mp4", cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W,H))
read=w=0
while w < SEC*FPS:
    ok,f=cap.read()
    if not ok: break
    read+=1
    if read%KEEP: continue
    wr.write(cv2.resize(f,(W,H))); w+=1
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
  --allow-unauthenticated --cpu 2 --memory 2Gi --timeout 3600 --min-instances 1
# → 서비스 URL(https://cctv-ai-xxxxx.run.app) 확보
```

`--memory 2Gi` — torch+YOLOv8n 상주 메모리(합성 전용이던 1Gi 에서 상향).
`--min-instances 1` 로 콜드스타트(첫 연결 지연·모델 로드) 방지. MJPEG 는 장시간 연결이라 타임아웃 3600s.

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
