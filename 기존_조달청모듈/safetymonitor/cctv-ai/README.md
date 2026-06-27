# VitAlGuard CCTV AI 데모 서버

대시보드 **CCTV 관제**의 AI 타일 3종(CAM-01 객체감지·CAM-02 낙상감지·CAM-03 PPE 안전모)에
MJPEG 실시간 영상 + 감지 통계를 제공하는 **자체완결 시뮬레이션 서버**. Cloud Run 배포용.

- torch/GPU/모델 가중치/영상 자산 **불필요** → 즉시 배포(작은 이미지, CPU).
- 영상은 OpenCV 로 합성(영문 라벨), 통계는 한글 라벨 JSON 으로 대시보드 strip 에 전달.

## 엔드포인트 계약 (대시보드가 거는 것)

| 경로 | 형식 | 비고 |
|---|---|---|
| `GET /cctv/stream` `/cctv/stream2` `/cctv/stream3` | `multipart/x-mixed-replace` MJPEG | 객체/낙상/PPE |
| `GET /cctv/stats` | `{fps,total,byClass:[{label,count}],alertsLastMinute}` | 객체 |
| `GET /cctv/stats2` | `{total,fallen,byStatus:[{status,label,count}]}` | 낙상 |
| `GET /cctv/stats3` | `{violation_count,compliance_rate,no_hardhat_count,no_vest_count,hardhat_count,vest_count,person_count}` | PPE |

## 로컬 실행

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# 확인: curl localhost:8000/cctv/stats ; 브라우저로 localhost:8000/cctv/stream
```

## Cloud Run 배포 (대시보드와 동일 프로젝트)

```bash
export PATH="~/Documents/google-cloud-sdk/bin:$PATH"
PROJECT=safetymonitor-498508 ; REGION=asia-northeast3
IMG=asia-northeast3-docker.pkg.dev/$PROJECT/vitalguard/cctv-ai:latest
gcloud builds submit --tag $IMG .
gcloud run deploy cctv-ai --image $IMG --region $REGION \
  --allow-unauthenticated --cpu 2 --memory 1Gi --timeout 3600 --min-instances 1
# → 서비스 URL(https://cctv-ai-xxxxx.run.app) 확보
```

`--min-instances 1` 로 콜드스타트(첫 연결 지연) 방지. MJPEG 는 장시간 연결이라 타임아웃 3600s.

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

## 실제 YOLOv8n 으로 교체하려면

`render()` 의 합성 프레임 생성을 실제 추론 루프로 교체:
1. `requirements.txt` 에 `ultralytics` 추가(이미지·콜드스타트 커짐, torch 포함).
2. 샘플 영상(`samples/site.mp4`)을 `cv2.VideoCapture` 로 읽어 프레임마다 `YOLO('yolov8n.pt')(frame)` 추론.
3. 결과 박스/클래스로 `*_state()` 와 `*_stats()` 를 채움(현재 시뮬레이션 함수 자리).
4. Cloud Run 엔 카메라가 없으므로 **번들 샘플 영상** 또는 인터넷 RTSP 만 가능(로컬 웹캠 불가).
