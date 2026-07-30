# VitAlGuard CCTV AI 데모 서버

대시보드 **CCTV 관제**의 AI 타일 3종(CAM-01 객체감지·CAM-02 낙상감지·CAM-03 PPE 안전모)에
MJPEG 실시간 영상 + 감지 통계를 제공하는 서버. Cloud Run 배포용.

- **CAM-01 객체감지 = YOLOv8n + 차량 속도추정 + 한글 라벨**(CPU). 번들 `samples/cam01.mp4`(로테르담 건설현장 부감 고정캠 720p·60초) 루프,
  프레임마다 imgsz(env 800·기본960)·conf 0.25 추론 → 보행자·자전거·차량·버스·트럭·오토바이 실박스(출력 **1280x720**).
  한글 라벨은 **PIL+NanumGothic**(cv2 한글 미지원). **속도 = Roboflow supervision**(ByteTrack + `ViewTransformer`
  **원근보정**) — 지면 평면 호모그래피로 **거리 무관 일관 km/h**(움직이는 차량만·5km/h 미만 생략). 실측 없는 추정(`SPEED_TARGET_W/H` env).
  부감캠은 주차 차량 위주라 속도는 거의 비표시(움직일 때만 rough 추정).
- **CAM-03 PPE = Hexmon vyra-yolo-ppe(YOLOv8m 14클래스) + 한글 라벨**(CPU). **듀얼소스** — 기본은 번들
  `samples/cam03.mp4` 를 추론(OFF), 폰이 `/cam3/capture` 로 카메라 프레임을 `/cctv/ingest3` 에 POST 하면 그 프레임을
  추론해 덮어씀(ON · 3초 무수신 시 클립 복귀). 안전모·안전조끼·작업자 + **NO-* 미착용(위반) 직접 탐지** → 준수율 통계. 출력 640x360.
- **CAM-02 낙상 = 합성 시뮬레이션**(OpenCV).
- 영상·모델·의존성이 없으면 해당 카메라는 **합성으로 자동 폴백**(배포 견고성).

## 엔드포인트 계약 (대시보드가 거는 것)

| 경로 | 형식 | 비고 |
|---|---|---|
| `GET /cctv/stream` `/cctv/stream2` `/cctv/stream3` | `multipart/x-mixed-replace` MJPEG | 객체/낙상/PPE |
| `GET /cctv/snapshot` `/cctv/snapshot2` `/cctv/snapshot3` | 단발 `image/jpeg` | 폴링용·MJPEG 대안(객체/낙상/PPE) |
| `GET /cctv/stats` | `{fps,total,byClass:[{label,count}],alertsLastMinute, vehicleCount,maxSpeedKmh,avgSpeedKmh}` | 객체+속도(뒤 3필드는 실모델 전용·대시보드는 미사용 시 무시) |
| `GET /cctv/stats2` | `{total,fallen,byStatus:[{status,label,count}]}` | 낙상 |
| `GET /cctv/stats3` | `{violation_count,compliance_rate,no_hardhat_count,no_vest_count,hardhat_count,vest_count,person_count,fall_count}` | PPE + 낙상(`fall_count`) |
| `POST /cctv/ingest3` | 폰/엣지 JPEG 프레임(raw body) 수신 → Hexmon 추론 → CAM-03 라이브 override(3초 TTL) | `{ok,persons,violations,compliance}` |
| `POST /cctv/ingest2` | 엣지가 낙상 박스를 그린 JPEG(raw body) 수신 → **서버 추론 없이** CAM-02 표시(display-only·3초 TTL). 쿼리 `?persons=&fall=` 로 stats2 동봉 | `{ok,persons,fall}` |
| `GET /cam3/capture` | 폰/노트북 카메라 캡처 페이지(getUserMedia→ingest3 POST·Start/Stop·Wake Lock) | `text/html` |

## 번들 바이너리 (git 미추적 — 재취득 절차)

`yolov8n.pt`·`vyra_ppe.pt`(CAM-03 Hexmon)·`samples/cam0{1,3}.mp4`·`NanumGothic-Regular.ttf` 는 용량 때문에
git 에 올리지 않는다(`.gitignore` `*.pt`). 단 `.gcloudignore` 가 빌드 컨텍스트 포함을 보장한다. 새 머신에서 재생성하려면.

```bash
pip install yt-dlp opencv-python-headless certifi ultralytics
export SSL_CERT_FILE="$(python -c 'import certifi; print(certifi.where())')"   # macOS CA 이슈 대비

# 1) 모델 가중치(~6MB)
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"   # cwd 에 yolov8n.pt 저장

# 2) 한글 라벨 폰트(NanumGothic, OFL ~2MB)
python -c "import urllib.request as u; u.urlretrieve('https://github.com/google/fonts/raw/main/ofl/nanumgothic/NanumGothic-Regular.ttf','NanumGothic-Regular.ttf')"

# 3) 샘플영상 — 로테르담 건설현장 라이브캠(부감 고정·1280x720) 60초를 cv2 로 떠서 굽기(ffmpeg 불필요)
URL="$(yt-dlp -f 'best[height<=720]/best' -g 'https://www.youtube.com/watch?v=dmEq_ddk0kw')"
python - "$URL" <<'PY'
import sys, cv2
cap = cv2.VideoCapture(sys.argv[1]); OW,OH,FPS,SEC=1280,720,15,60
KEEP=max(1,round((cap.get(cv2.CAP_PROP_FPS) or 30)/FPS))  # 소스 fps → 15fps
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

# 4) CAM-03 PPE 모델 — Hexmon vyra-yolo-ppe-detection(YOLOv8m 14클래스, ~50MB)
curl -L -o vyra_ppe.pt "https://huggingface.co/Hexmon/vyra-yolo-ppe-detection/resolve/main/best.pt"

# 5) CAM-03 건설현장 PPE 클립(GFqz3KRo2bc 30초 → 640x360)
python - <<'PY'
import cv2, yt_dlp
with yt_dlp.YoutubeDL({"quiet": True, "format": "best[height<=720]/best"}) as y:
    url = y.extract_info("https://www.youtube.com/watch?v=GFqz3KRo2bc", download=False)["url"]
cap = cv2.VideoCapture(url); fps = cap.get(cv2.CAP_PROP_FPS) or 30; keep = max(1, round(fps / 15))
wr = cv2.VideoWriter("samples/cam03.mp4", cv2.VideoWriter_fourcc(*"mp4v"), 15, (640, 360))
r = w = 0
while True:
    ok, f = cap.read()
    if not ok: break
    r += 1
    if r % keep: continue
    wr.write(cv2.resize(f, (640, 360))); w += 1
wr.release(); cap.release(); print("cam03", w)
PY
```

## 로컬 실행

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install ultralytics "lap>=0.5.12" "supervision==0.29.1"   # CAM-01 속도(supervision ByteTrack) + CAM-03(Hexmon PPE)
uvicorn main:app --reload --port 8000
# 확인: curl localhost:8000/   → {"cam01":"yolo+bytetrack","cam03":"hexmon-ppe","cam03_source":"clip", ...}
#       curl localhost:8000/cctv/stats(속도) ; /cctv/stats3(PPE) ; 폰/노트북으로 https 접속 후 /cam3/capture 송출 시작
```

## Cloud Run 배포 (대시보드와 동일 프로젝트)

```bash
export PATH="~/Documents/google-cloud-sdk/bin:$PATH"
PROJECT=safetymonitor-498508 ; REGION=asia-northeast3
IMG=asia-northeast3-docker.pkg.dev/$PROJECT/vitalguard/cctv-ai:latest
gcloud builds submit --tag $IMG .
gcloud run deploy cctv-ai --image $IMG --region $REGION \
  --allow-unauthenticated --cpu 4 --memory 4Gi --timeout 3600 \
  --min-instances 1 --max-instances 1 --concurrency 200 --no-cpu-throttling \
  --update-env-vars YOLO_IMGSZ=800,PLAYBACK_FPS=6,OMP_NUM_THREADS=1,MKL_NUM_THREADS=1
# → 서비스 URL(https://cctv-ai-xxxxx.run.app) 확보
# --cpu 4 --memory 4Gi : CAM-01(YOLOv8n) + CAM-03(Hexmon PPE) 두 실모델 동시 추론 경합 대응.
```

`YOLO_IMGSZ=800` — 추론 해상도. 코드 기본 960(인식률 최대·CPU fps~4-5)이나 라이브는 **800**(인식률 거의 동일·fps~6-7)로 운영.
더 빠르게=값↓(640), 더 정밀=값↑(960). `--cpu 4` 로 올리면 960 도 ~8-10fps.

플래그(전부 필수 — 빠지면 동작/안정성 저하).
- `--memory 2Gi` — torch+YOLOv8n 상주 메모리(합성 전용이던 1Gi 에서 상향).
- `--no-cpu-throttling` — **요청 밖 백그라운드 추론 스레드에 CPU 상시 할당**(기본 스로틀링이면 워커가 굶어 stats 가 합성으로 폴백).
- `--min-instances 1` — 콜드스타트(첫 연결 지연·모델 로드) 방지. MJPEG 는 장시간 연결이라 타임아웃 3600s.
- **`OMP_NUM_THREADS=1` `MKL_NUM_THREADS=1` — ★ 429 핵심 해결**. CAM-01+CAM-03 두 모델이 각자 모든 코어로 추론하면 4코어가 통째로 점유돼 **uvicorn 이벤트 루프(HTTP)가 굶어 429/타임아웃**(검은 화면). torch 스레드를 op당 1개로 묶으면 **추론 2코어(워커 2×1) + HTTP 2코어 보장** → 단일 인스턴스가 대시보드 MJPEG 3종을 안정 서빙. 추론은 느려지나(슬로모) PLAYBACK_FPS=6 과 맞아 데모엔 충분.
- `PLAYBACK_FPS=6` — 워커 추론 cadence(낮춰 사이 sleep 확보 + 워커 루프 최소 20ms yield). 스레드 제한과 함께 CPU 여유 이중 확보.
- `--max-instances 1 --concurrency 200` — **단일 인스턴스**. 스레드 제한으로 1대가 대시보드+폰을 다 처리하므로 다중 인스턴스 불필요. **이게 핵심** — max 1 이면 CAM-03 폰 라이브 override 상태(`_ppe_live`)가 한 인스턴스 메모리에 모여 **MJPEG 대시보드와 폰 override 가 동시에** 된다(다중 인스턴스면 폰 POST·대시보드 조회가 갈려 클립만 보임).

> (이전 시행착오) 스레드 무제한 + max-instances↑ 는 **각 인스턴스가 CPU 포화 + 콜드스타트 처닝**으로 더 불안정했다(000/429). 근본은 인스턴스 수가 아니라 **스레드 제한으로 HTTP 에 코어를 보장**하는 것. 더 견고히 하려면 대시보드를 스냅샷 폴링(`/cctv/snapshot*`)으로 — 단발 요청이라 장기연결 부담 자체가 사라짐(선택).

## 정지/재개 (OFF / ON) — 삭제 없이 과금 토글

`--min-instances 1 --no-cpu-throttling` 은 **상시 과금**(4코어 24시간). 발표·테스트가 아닐 땐 **서비스를 지우지 않고** OFF 로 내려 과금을 0 으로 만든다(이미지·구성 보존 → 즉시 재개).

```bash
# OFF (하드 — 외부 접근까지 차단. 브라우저가 못 닿아 안 깨고 과금 0)
gcloud run services update cctv-ai --region asia-northeast3 \
  --min-instances 0 --ingress internal

# ON (재개 — 외부 접근 복구 + 상시 1대)
gcloud run services update cctv-ai --region asia-northeast3 \
  --min-instances 1 --ingress all
```

- `--min-instances 0` = 유휴 시 0대(과금 0). `--ingress internal` = 외부(브라우저/대시보드) 404 차단 → **깨어날 일 자체가 없음**(확실한 OFF). 검증: 외부에서 `/`·`/cctv/*` 가 404 면 OFF 성공.
- soft-off 만 원하면 `--min-instances 0` 만(유휴 0대지만 누가 열면 잠깐 깸). 완전 차단은 `--ingress internal` 까지.
- **삭제(`gcloud run services delete cctv-ai`) 아님** — 서비스 정의·트래픽·검증된 리비전 유지. ON 한 줄로 복귀(재빌드 불필요). 코드/이미지만 갱신하려면 OFF 플래그 그대로 `deploy` 하면 OFF 유지.

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

## 라이브 송출 끊김 완화 (2026-07-29)

폰 송출 테스트에서 영상이 심하게 끊겼다. 서버 구성(cpu4·`cpu-throttling=false`·`OMP/MKL_NUM_THREADS=1`·
`maxScale 1`)은 정상이었고, 클립 워커도 폰 라이브 중에는 이미 추론을 스킵하고 있었다.

**원인 = 왕복 직렬화.** 캡처 페이지가 `sending` 가드로 한 번에 한 장만 보내는데,
왕복(인코딩 10~30ms + 업로드 + 서버 디코드·그리기 10~30ms + 응답)이 `setInterval` 주기 200ms 를
넘으면 다음 tick 이 통째로 스킵된다. 왕복 250ms → 실효 2.5fps → 관제웹도 그대로 2.5fps.

| 수정 | 위치 | 효과 |
|---|---|---|
| **① 파이프라이닝** | `CAPTURE_HTML` — `sending` → `inflight`(최대 3) + 5초 abort | 왕복이 길어도 5fps 유지 |
| **② 즉시 응답** | `ingest_ppe` — 프레임만 받고 200 반환, 처리는 `_ppe_live_process` 백그라운드 | 왕복에서 서버 처리시간 제거 |
| **③ 디코드 스레드풀** | `_decode_frame` | `cv2.imdecode` 의 이벤트 루프 블로킹 제거 |

파이프라이닝은 프레임이 겹쳐 도착하므로 **`draw_ts` 비교로 늦게 끝난 옛 프레임을 폐기**한다
(안 하면 오래된 화면이 최신을 덮는다). JPEG SOI(`\xff\xd8`) 로 싸게 걸러 디코드 없이 400 을 낸다.
캡처 페이지에 **실측 fps** 를 표시하므로 다음 테스트에서 개선폭을 바로 볼 수 있다.

**남는 한계** — 매 프레임 개별 HTTP POST 방식의 천장은 5~8fps 다. 그 이상은 WebRTC/RTMP 가 필요하고,
끊김 0 을 원하면 엣지에서 박스를 그려 보내는 display-only 방식(CAM-02 패턴)이 정답이다.
PPE 착용 판정은 초당 3~5회면 충분하다.

## 폰 → 젯슨 추론 → 관제웹 (2026-07-29)

`edge/phone_ppe_relay.py` — 아이폰 카메라를 **젯슨에서 우리 학습 모델로 추론**한 뒤 이 서버로 중계한다.
Cloud Run 은 표시만 하므로(`/cctv/ingest3?drawn=1`) 서버 추론 부하가 0 이고 카메라를 늘릴 여지가 생긴다.

```
iPhone(사파리·Tailscale)
  │ https://yahboom-1.<tailnet>.ts.net:8443/    ← 젯슨이 캡처 페이지를 직접 서빙
  ▼
Jetson  yolo26 TensorRT 14.7ms · 박스·한글 라벨 · 고정 cadence 로 push(지터 흡수)
  │ POST /cctv/ingest3?drawn=1&persons=&violations=&compliance=
  ▼
Cloud Run  추론 없이 그대로 표시(display-only)  →  관제웹 CAM-03
```

### 왜 Tailscale HTTPS 인가

브라우저 `getUserMedia` 는 **보안 컨텍스트에서만** 동작한다. 평문 HTTP·자체서명으로는 사파리가 카메라를 안 준다.
`sudo tailscale cert <name>.ts.net` 으로 **유효한 Let's Encrypt 인증서**를 받아 젯슨이 직접 HTTPS 로 서빙한다.
발급 후 `chown jetson:jetson` 필요(root 소유면 Flask 가 못 읽는다).

### 기동

```bash
CCTV_BASE=https://cctv-ai-....run.app python3 phone_ppe_relay.py
# 튜닝: CAP_FPS · CAP_INFLIGHT · CAP_W · CAP_H · CAP_Q · PUSH_FPS · PPE_ENGINE · PPE_CONF
```

### ★ 실측 한계 — 약 4.8 fps 는 아이폰 쪽 천장이다

| 설정 | 결과 |
|---|---|
| 640×360 · Q0.5 · 목표 5 | 4.80 fps |
| 640×360 · Q0.5 · 목표 8 · 슬롯 4 | 4.80 fps |
| 480×270 · Q0.4 · 목표 8 | 4.75~5.20 fps |

**해상도를 44% 줄여도, 목표·슬롯을 올려도 오르지 않는다.** 네트워크·인코딩·젯슨(추론 14.7ms·CPU 6%)이
전부 배제되고 남는 것은 **iOS Safari 의 타이머 스로틀(≈208ms)** 이다. 페이지 JS 로는 우회할 수 없다.

5fps 를 넘기려면 방식을 바꿔야 한다 — **WebCodecs `VideoEncoder`**(Safari 17+·H.264 하드웨어) 또는
**RTMP 송출앱 + 젯슨 `mediamtx`**(개발 0·30fps). WebSocket 은 전송이 병목이 아니므로 효과가 없다.

PPE 착용 판정에 필요한 갱신율은 초당 3~5회라 **현재 4.8fps 로 목적에는 충분하다.**

## ⚠️ 429 stuck — 켠 직후 전 엔드포인트 "Rate exceeded" (2026-07-30 재발)

`--min-instances 1` 로 켠 직후 모든 엔드포인트가 **HTTP 429 `Rate exceeded`** 를 냈다.
컨테이너 로그는 `INFO: Uvicorn running` 으로 정상이었고(크래시 아님),
요청 로그에 **`The request was aborted because there was no available instance`** 가 찍혔다.
단일 인스턴스가 요청을 받지 못하는 stuck 상태다.

```bash
gcloud run services update cctv-ai --region asia-northeast3 \
  --update-env-vars RESTART=$(date +%s)     # 새 리비전 강제 → 즉시 복구
```

**켠 직후 429 가 보이면 진단하지 말고 바로 RESTART 를 걸 것.** 07-06·07-08 에 이어 세 번째다.
`--max-instances 1` 은 절대 올리지 않는다(폰 override 상태가 인스턴스별로 갈린다).

## 4차 모델 반영 (2026-07-30)

젯슨 릴레이의 엔진만 바꾸면 라이브에 즉시 반영된다.

```bash
PPE_ENGINE=/home/jetson/ppe_yolo26s_640_v4_nc.engine \
CCTV_BASE=https://cctv-ai-569797426568.asia-northeast3.run.app \
  nohup python3 phone_ppe_relay.py > relay.log 2>&1 &
```

실측 = 추론 **14.5~14.9ms** · 아이폰 전송 **5.09 fps** · 푸시 오류 0 · 관제웹 헤더 `PPE (yolo26)`.

⚠️ **4차 모델은 CCTV 부감 화각 전용이다.** 학습 데이터의 머리 크기가 정규화 높이
중앙값 0.051(최대 0.141)이라, 근거리 인물(0.19~0.31)의 머리는 검출되지 않는다.
`person` 은 잡히지만 `head`·`helmet` 이 안 잡혀 착용 판정이 서지 않는다.
바디캠 용도로 쓰려면 근거리 데이터 또는 `scale` 증강 상향이 필요하다.

## 실모델 적용 현황

- **CAM-01 = 실제 YOLOv8n + 차량 속도추정 적용 완료.** `_object_worker()`(백그라운드 스레드)가 `samples/cam01.mp4` 를
  루프 읽어 `model.track(persist=True, tracker='bytetrack.yaml')` → 화이트리스트(보행자·자전거·차량·오토바이·버스·트럭)
  실박스 + 통계. 차량류는 ID별 centroid 이동(클립 fps 기준)을 px/s→추정 km/h(EMA 평활·SPEED_MAX_KMH 클램프)로
  박스에 표기, stats 에 `vehicleCount/maxSpeedKmh/avgSpeedKmh` 추가. `/cctv/stream`·`/cctv/stats` 가 전역을 읽는다.
- **CAM-03 = Hexmon PPE 실모델 적용 완료(듀얼소스).** `_ppe_worker()` 가 클립(OFF)을 추론, `/cctv/ingest3` 가 폰
  프레임(ON)을 추론해 override(3초 TTL 후 클립 복귀). `NO-Hardhat`·`NO-Safety Vest` 위반 클래스를 직접 카운트(휴리스틱 아님).
- **CAM-02 = 합성 + 엣지 라이브 override(`/cctv/ingest2`).** 기본은 합성 낙상, 엣지(Jetson)가 낙상 박스를 그려 보내면 그 프레임을 **display-only**로 표시(3초 TTL 후 합성 복귀). **서버 추론 없음** — 낙상 추론은 엣지가 수행(단일 인스턴스 CPU 보호). 상세는 아래 "관제웹 듀얼-캠 라이브 연결".
- Cloud Run 엔 카메라가 없으므로 **번들 샘플영상**·**폰 인제스트(`/cam3/capture`)**·**엣지 푸시(`/cctv/ingest2|3`)**·인터넷 RTSP 가능(로컬 웹캠 직접연결 불가).

## 관제웹 듀얼-캠 라이브 연결 (CAM-02 GoPro · CAM-03 G100) — 2026-06-30

현장 엣지(Jetson Orin Nano `yahboom`)의 두 카메라를 관제웹 CCTV 타일에 동시 라이브로 띄운 구성. 엣지가 프레임을 cctv-ai 로 ~5fps POST → 대시보드가 cctv-ai MJPEG/snapshot 을 표시. 엣지 상세는 메모리 `jetson-edge-poc`.

**구조 (왜 이렇게)** — 단일 Cloud Run 인스턴스에 **서버 추론 2개(PPE+낙상) 동시는 429 위험**(검증된 제약). 그래서 **서버 추론은 CAM-03 PPE 하나만** 두고, CAM-02 낙상은 **엣지가 박스를 그려 display-only 로 푸시**(`ingest2`). 보이는 결과(낙상 박스)는 동일하면서 첫 배포 성공률·안정성↑·과금↓.

### CAM-02 = GoPro HERO9 (낙상 · 엣지 추론)
- GoPro USB 웹캠(USB 2.0서도 480/720p clean) → 엣지가 **YOLOv11n-pose 낙상 추론 + 박스**(녹색=정상/빨강=낙상) 그려 `POST /cctv/ingest2?persons=N&fall=M` (~5fps).
- cctv-ai 는 받은 JPEG 를 그대로 CAM-02 에 표시(`stream2`/`snapshot2`), `stats2` 는 쿼리값. **서버 추론 0.**
- 검증: `snapshot2` = GoPro 영상 + "CAM-02 GoPro EDGE pose" 라벨 + 낙상 박스, health `cam02_source: edge-live`.

### CAM-03 = Aqara G100 IP캠 (PPE · 서버 추론)
- G100 RTSP(LAN) raw 프레임 640×360 → `POST /cctv/ingest3` (~5fps, 박스 없이 raw).
- cctv-ai 가 **Hexmon PPE(YOLOv8m) 서버 추론** → CAM-03 라이브 override(`stream3`/`snapshot3`/`stats3`).
- 검증: `snapshot3` = G100 영상 + "PPE (Hexmon)" + 「마스크 미착용」 등 위반 박스, health `cam03_source: phone-live`.
- ★ **G100 IP 는 DHCP 라 재연결 시 변동**(예 `.107→.169`). "No route" 면 격리 아니라 IP 변경 의심 → 서브넷 8554 포트 스캔/Aqara MAC `54:ef:44:84:22:cf` 로 재탐색 → 엣지 `~/vg_edge_poc/g100_url.txt` 갱신 후 푸셔 재시작.

### 엣지 푸셔 — `~/vg_edge_poc/dash_push.py` (Jetson, git 미추적·로컬)
단일 프로세스·pose 모델 1개로 GoPro(낙상→ingest2) + G100(raw→ingest3) 둘 다 푸시. `detector.py`(자체 콘솔 :8090)와 **GoPro UDP 8554 충돌**이라 둘 중 하나만.
```bash
pkill -f detector.py     # 자체 콘솔 중지(UDP 충돌 해소)
cd ~/vg_edge_poc
CCTV_BASE=https://cctv-ai-7r2vb5q5qa-du.a.run.app GOPRO_RES=7 PUSH_FPS=5 \
  setsid nohup python3 dash_push.py > dash.log 2>&1 < /dev/null &
```

### 서버 배포 (★ 사용자 직접 실행 — 분류기 차단)
위 "Cloud Run 배포" 절차에 **CAM-01 추론 OFF**(CPU 확보)만 추가:
```bash
gcloud run deploy cctv-ai --image $IMG --region $REGION \
  --allow-unauthenticated --cpu 4 --memory 4Gi --timeout 3600 \
  --ingress all --min-instances 1 --max-instances 1 --concurrency 200 --no-cpu-throttling \
  --update-env-vars CAM01_VIDEO=/none.mp4,PLAYBACK_FPS=2,OMP_NUM_THREADS=1,MKL_NUM_THREADS=1
```

### 종료 (데모 후 · 과금 0)
```bash
pkill -f dash_push.py    # 젯슨
gcloud run services update cctv-ai --region asia-northeast3 --min-instances 0 --ingress internal
```

### 캐치
- `pkill`(SIGTERM)은 `atexit` 미실행 → GoPro 웹캠 streaming 잔존 가능(새 grabber 의 stop→start 로 회복). 강제 종료 시 수동 `curl …/gopro/webcam/stop`.
- `ingest2`/`ingest3` 무인증(공개 ingress) — 노출 주의. 무푸시 3초 후 각 타일은 합성/클립으로 복귀.
