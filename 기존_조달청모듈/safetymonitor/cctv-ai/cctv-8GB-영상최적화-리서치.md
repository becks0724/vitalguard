# 8GB 교체 후 영상 최적화 — 조사 리포트

**2026-09-07 · 대상 = CAM-03 라이브 경로(GoPro → 젯슨 → cctv-ai → 관제웹)**
전제 = [RUNBOOK-8GB모듈교체.md §11](edge/RUNBOOK-8GB모듈교체.md) 교체 완료 상태(SM 8 · 7,619 MB · QSPI 36.4.7).
종전 리서치 [cctv-최적설정-리서치.md](cctv-최적설정-리서치.md) §2 는 4GB 전제였다 — 그 절의 "메모리 때문에
못 한다" 항목이 이 문서의 출발점이다.

---

## 0. 결론 먼저

```
                                      기대 효과                    비용        8GB 덕?
① 푸셔 keep-alive + 런타임 /config    지연 −120 ms/장 · 12 fps · GoPro 무접촉   코드 ~40줄   아니오 (진작 했어야)
② ★ 추론 입력 640×360 → 1280×720     원거리 머리 검출 (학습 해상도와 일치)      엔진 재빌드   ★ 예 (4GB 가 막던 것)
③ NVDEC 하드웨어 디코드              CPU 0.42 → 0.13 코어 (실측 §2-3) · retrieve 5.6 → 1.4 ms  파이프라인 1줄  일부 (메모리 여유)
④ GPU 클럭 고정 영속화               추론 28 → 11 ms (DVFS 가 내리던 것)        systemd 1개   아니오
⑤ 2카메라 배치 추론                  카메라 추가 시 엔진 1개로 처리             엔진 batch=2  ★ 예
⑥ NVJPG 하드웨어 JPEG                CPU 소폭                                    ―           보류 (병목 아님)
⑦ 서버 MJPEG → WebRTC                지연 수백 ms ↓                              큰 변경      보류
```

**순서 = ① → ④ → ② → ③.** ①④ 는 하드웨어와 무관한 즉효약이고, ② 가 8GB 로 새로 열린 가장 큰
품질 레버다. ③ 은 ② 로 CPU 가 부족해질 때 넣는다.

---

## 1. 지금 파이프라인이 실제로 하는 일 (실측 · 09-07 14:12)

```
GoPro HERO9 ── USB-net UDP 8554 · H.264 1080p30 mpegts ──▶ 젯슨
  cv2.VideoCapture(CAP_FFMPEG)  매 프레임 grab() · 12fps 만 retrieve()   ← CPU 소프트웨어 디코드
  cv2.resize → 640×360                                                   ← ★ 추론 입력이 여기서 정해진다
  TensorRT yolo26s · imgsz 640 · FP16                                    ← 11 ms (클럭 고정) / 28 ms (DVFS)
  PIL 한글 라벨 렌더 → cv2.imencode JPEG q72 (640×360 · ~40 KB)
  urllib POST /cctv/ingest3?drawn=1   워커 4개 · POST 마다 새 TLS         ← ~150 ms/장 · 9.1 push/s
                                                          ──▶ cctv-ai (Cloud Run · 추론 0 · 저장만)
                                                              mjpeg_ppe  STREAM3_FPS=10 폴링 · 새 프레임만 송출
                                                          ──▶ 관제웹 <img src=stream3>   8.3 fps 실측
```

자원 사용(tegrastats · 푸셔 12 infer/s · GoPro 30 fps 수신).

```
CPU   6코어 합 ~70% (= 0.7 코어)   디코드가 대부분
GPU   GR3D 39%                      추론 + ultralytics 전처리
RAM   3.6 / 7.6 GB                  여유 4 GB
전력  10.2 W
```

하드웨어 코덱 엔진(젯슨 실측).

```
nvv4l2decoder  있음   ← NVDEC · H.264/H.265 하드웨어 디코드
nvjpegenc/dec  있음   ← NVJPG · 하드웨어 JPEG
nvv4l2h264enc  없음   ← Orin Nano 는 NVENC 이 없다 (인코드는 CPU)
OpenCV         GStreamer 1.20.3 · FFMPEG · CUDA 12.6 전부 빌드됨
```

---

## 2. 병목이 어디인가 — 측정으로 갈린 것

### 2-1. 전송이 지연·fps 의 주범이다 (하드웨어 무관)

푸셔가 `urllib.request.urlopen` 으로 한 장씩 보내며 **POST 마다 TLS 핸드셰이크**를 한다.
젯슨→Cloud Run 첫 바이트 150 ms(connect 는 10 ms — 나머지가 TLS + 서버). 워커 2개면 5.0/s,
4개면 9.1/s 가 천장이었다(09-07 실측). 그리고 fps 를 바꾸려고 푸셔를 재기동할 때마다 GoPro 웹캠
STOP/START 가 따라붙어 **11:51 GoPro 가 굳었고 USB 재연결까지 갔다.**

→ **① `http.client.HTTPSConnection` 재사용(워커당 1개) + `/config?push_fps=&infer_fps=` 엔드포인트.**
장당 비용 150 → ~30 ms 가 되면 워커 2개로 12/s 를 넘기고, fps 조정에 재기동이 없어진다.
서버 쪽은 이미 `STREAM3_FPS` env 라 재빌드 없이 따라간다.

### 2-2. ★ 추론이 원본의 1/9 화소만 본다 — 8GB 가 푸는 문제

푸셔는 1080p 를 **640×360 으로 줄인 뒤** 모델에 넣는다(`_reader` · `cv2.resize(frame,(OW,OH))`).
4GB 시절 메모리 때문에 정한 값이다. 학습 데이터와 맞춰 보면 문제가 드러난다.

```
E63 학습셋   640 으로 변환 · 머리 정규화 높이 중앙값 0.051 · 5~95% 0.033~0.086
             → 학습 시 머리 화소 높이 ≈ 0.051 × 640 ≈ 33 px  (letterbox 기준 20~55 px)
지금 추론    640×360 letterbox → 머리 ≈ 0.051 × 360 ≈ 18 px   ← 학습 분포 하단(0.033×640=21 px) 아래
1280×720    머리 ≈ 37 px                                        ← 학습 중앙값과 일치
```

즉 **부감 CCTV 화각에서 원거리 작업자의 머리가 학습 최소 크기보다 작게 들어간다.** GoPro 도메인
교차 검증(07-30)이 통과한 것은 근·중거리였고, 원거리 검출 단절점은 `head_size` 계측에서 계속
"학습 범위 밖" 으로 찍혔다(09-07 `in_train_range_pct 0.0` — 근접이라 반대 방향이지만 같은 축).

→ **② 추론 입력을 960×540(imgsz 960 엔진)으로.** 표시용 JPEG 는 640×360 그대로 둔다(대역폭·관제웹
무변경). 비용은 추론 지연 7.4 → 16.3 ms(§3 실측)뿐이고 8GB 라 메모리는 문제가 아니다. 머리 18 → 28 px 로
학습 범위(21~55) 안에 들어온다. 1280 은 필요해지면 다음 단계.

적용 지점 = `gopro_ppe_edge.py` 의 `OW, OH = 640, 360` 을 추론용/표시용으로 분리(추론 960×540 · 표시
640×360) + `PPE_ENGINE=ppe_yolo26s_960_v5_nc.engine` + `imgsz=960`. 엔진은 이미 젯슨에 있다.

### 2-3. 디코드가 CPU 를 쓴다 — 여유가 있어 아직 병목은 아니다

`CAP_FFMPEG` 소프트웨어 디코드가 CPU 0.5 코어쯤 쓴다. 6코어 중 여유가 충분해 지금은 문제가
아니지만, ② 로 전처리가 4배가 되고 카메라가 하나 더 붙으면 병목이 된다.

→ **③ GStreamer 파이프라인으로 NVDEC.** OpenCV 가 GStreamer 로 빌드돼 있어 한 줄이다.

```python
cv2.VideoCapture(
  "udpsrc port=8554 buffer-size=5000000 ! tsdemux ! h264parse ! nvv4l2decoder disable-dpb=true "
  "! nvvidconv ! video/x-raw,format=BGRx ! videoconvert ! video/x-raw,format=BGR ! appsink drop=true max-buffers=1",
  cv2.CAP_GSTREAMER)
```

`disable-dpb=true` 와 `appsink drop=true max-buffers=1` 이 지연을 줄이는 핵심이다(FIFO 적체 대신
최신 프레임만). ⚠ 검증은 CCTV OFF 때 한다 — 8554 포트를 푸셔가 잡고 있어 병행 테스트가 안 된다.
⚠ 인코드 쪽은 NVENC 이 없으므로 기대하지 말 것(JPEG 는 NVJPG 로 가능하나 병목 아님 → ⑥ 보류).

**실측 (09-07 15:47 · CCTV OFF · GoPro 1080p30 · `edge/nvdec_probe.py` · 경로당 30 초 · 매 프레임 grab · 12 fps retrieve).**

```
경로                          수신 fps   retrieve p50/p95    프로세스 CPU   시스템 CPU 합
ffmpeg (지금 푸셔)             36.2       5.6 / 5.9 ms        42.0 %         42.6 %
gst nvv4l2decoder → BGR        30.2       0.7 / 0.7 ms        21.3 %         25.5 %   videoconvert 가 30 fps 전부 변환
gst nvv4l2decoder → BGRx       30.0       1.4 / 1.7 ms        13.1 %         17.0 %   ★ retrieve 한 12 장만 cvtColor
ffmpeg (재측정)                36.2       5.6 / 5.8 ms        41.5 %         42.2 %
```

- **CPU 0.42 → 0.13 코어**(−0.29 코어). 예상 0.5 보다 작지만 디코드 자체는 0 이 됐다 — 남은 13% 는
  appsink 복사 + 12 fps cvtColor 다. 30 fps 손실 0(grab 실패 0).
- 채택하면 **BGRx 경로**다. `videoconvert` 를 파이프라인에 넣으면 CPU 가 30 fps 전부를 변환해 절감의
  절반을 돌려준다(21%). 적용은 푸셔 `_reader()` 의 `cv2.VideoCapture(UDP_URL, cv2.CAP_FFMPEG)` 한 줄을
  GStreamer 문자열 + `CAP_GSTREAMER` 로 바꾸고 retrieve 뒤 `cvtColor(BGRA2BGR)` 한 줄. **아직 미적용.**
- 절대 지연(카메라→numpy)은 화면 시계 없이는 못 잰다. 잰 것은 retrieve 지연뿐(5.6 → 1.4 ms).
- ffmpeg 가 36 fps 로 세는 것은 30 fps 원본에서 나올 수 없는 값이다 — 재동기 잔여(`non-existing PPS`)를
  grab 성공으로 세는 듯. 미규명. 푸셔 `/health` 의 `stream_fps` 도 같은 경로라 같은 값을 보고한다.
- 이 L4T 의 tegrastats 는 NVDEC 항목을 안 찍는다. 하드웨어 사용 증거는 `NvMMLiteOpen BlockType=261`
  로그와 CPU 감소다.

### 2-4. GPU 클럭이 놀면 내려간다

DVFS 가 추론 사이 유휴를 보고 GPU 를 306 MHz 로 내려 추론이 28 ms 였다. `sudo jetson_clocks` 로
1020 MHz 고정 후 11 ms. 재부팅하면 풀린다.

→ **④ `jetson_clocks` 를 systemd oneshot 으로 영속화**(또는 `nvpmodel` 커스텀 모드로 GPU min freq
상향). 발열 +2~3 °C(52 °C 대) · 전력 +1 W 수준 — 문제 없음.

### 2-5. 서버·브라우저 쪽

- cctv-ai 는 추론 0 · 저장/재송출만이라 CPU 여유가 크다. `STREAM3_FPS` 는 상한일 뿐 실제는 푸시율.
- MJPEG 는 프레임당 HTTP 청크라 지연 ~100 ms 수준이고 브라우저 버퍼가 없다. 더 줄이려면 WebRTC(⑦)
  인데 관제웹·cctv-ai 양쪽 큰 변경이라 지금 대상이 아니다.
- 관제웹이 `/cctv/connection*` 를 폴링해 404 — cctv-ai 가 대시보드보다 구버전. 영상과 무관.

---

## 3. 실측 — 추론 해상도 vs 지연 (8GB · jetson_clocks 고정 · 푸셔 12 infer/s 병행 가동 중)

`bench_engine.py <engine> <imgsz> <WxH>` (09-07 파라미터화 · v5 가중치 동일).

```
엔진 · 입력            전처리     ★ 추론 (p95)         후처리    벽시계          머리 px (0.051 기준)
640 · 640×360          1.81 ms    7.41 ms (12.39)      0.99 ms   10.72 ms · 93 fps    18 px  ← 학습 최소 21 아래
960 · 960×540          3.11 ms   16.25 ms (23.47)      1.12 ms   21.04 ms · 48 fps    28 px  ← 학습 범위 안
960 · 1280×720 입력    9.62 ms   16.30 ms (23.33)      1.11 ms   27.60 ms · 36 fps    28 px  (엔진이 960 으로 줄임)
```

읽는 법.

- **960 은 640 의 2.2배**(화소비 2.25 와 일치) — 12 fps 추론 cadence 면 GPU 점유 ~20%, 예산 83 ms 의 1/4.
  **채택 가능하다.** 1280 엔진(예상 ~30 ms · 머리 37 px)은 필요해지면 다음에 잰다.
- **입력은 푸셔에서 960×540 으로 줄여 넣는 게 맞다.** 1280×720 을 그대로 넣으면 엔진이 어차피 960 으로
  줄이면서 전처리만 +6.5 ms 손해다(같은 화소를 두 번 리사이즈).
- 960 엔진 빌드 525 s · 21.4 MB — 640 과 같다.

⚠ **아침 "지연 −5.5%" 비교는 DVFS 가 풀린 상태였다.** 같은 640 엔진이 클럭 고정 뒤 **7.41 ms**(고정 전
14.47 · 4GB 15.32) 로 나온다. 4GB 의 클럭 고정값은 재지 않았으므로 **하드웨어 이득이 얼마인지는 여전히
미확정**이고, 확실한 것은 "고정 안 하면 DVFS 가 절반을 먹는다"(④) 뿐이다.
⚠ 병행 가동 중(푸셔 12 infer/s) 측정이라 절대값은 ~10% 보수적이다. → 아래 무부하 재측정으로 확인했다.

**CCTV OFF 재측정 (15:49 · 푸셔 없음 · 1020 MHz · tj 52 °C · 같은 `bench_engine.py`).**

```
엔진 · 입력            전처리     ★ 추론 (p95)         후처리    벽시계             병행 대비
640 · 640×360          1.63 ms    6.71 ms ( 6.97)      0.74 ms    9.53 ms · 105 fps   추론 −9% · p95 −44%
960 · 960×540          3.20 ms   14.03 ms (14.10)      0.86 ms   18.61 ms ·  54 fps   추론 −14% · p95 −40%
960 · 1280×720 입력    9.43 ms   14.20 ms (14.38)      0.88 ms   25.05 ms ·  40 fps   추론 −13%
```

병행 부하가 평균을 10~14%, **p95 를 40% 이상** 먹고 있었다(같은 GPU 를 푸셔 추론과 나눠 쓴 결과).
결론은 그대로다 — 960 은 640 의 2.1배, 12 fps cadence 면 GPU 예산의 1/6.

---

## 4. 8GB 로 새로 가능해진 것 (4GB 에서 막혔던 목록 대조)

```
                          4GB (종전 리서치 §2)            8GB (지금)
추론 입력 1280×720        메모리 여유 없어 640×360        ★ 가능 — §2-2
엔진 2개 상주(2단계)      "메모리 관점에서 불리"           가능 — 지연으로만 판단
yolo26m                   "s 로 내리면 된다"               후보 복귀 — .pt 없음(학습 필요)
2카메라                   불가                             batch=2 엔진 1개 · 또는 스트림 2개
수집기 + 추론 동시        빠듯                             여유 4 GB
trtexec                   LLVM OOM                         여전히 OOM — 메모리 무관 확정
```

---

## 5. 하지 말 것 · 함정

- **fps 바꾸려고 푸셔 재기동 금지** (GoPro 굳음 · 09-07 11:51). ① 의 `/config` 가 답이다.
- **엔진 파일명** — `export()` 는 `.pt` 이름 그대로 `.engine` 을 쓴다. imgsz 만 바꿔 같은 `.pt` 로
  내보내면 **프로덕션 640 엔진을 덮어쓴다.** `.pt` 를 복사해 이름을 바꾼 뒤 내보낼 것
  (`ppe_yolo26s_960_v5_nc.pt` 방식).
- **`pgrep -f "^python3 gopro_ppe_edge"` 앵커** — 브래킷 트릭은 같은 줄에 기동 명령이 있으면 자기매칭.
- NVENC 없음 — "하드웨어 인코딩으로 H.264 송출" 계획은 Orin Nano 에서 성립하지 않는다.
- 측정 fps ≠ 배포 fps(종전 리서치 §2.3) — 카메라 파이프라인 가동 상태에서 잰 값만 믿는다.

---

## 6. 체크리스트

```
[x] ① 푸셔 keep-alive(http.client) + /config 엔드포인트 — 09-07 14:30 젯슨 배포 · 로컬 더미 검증(§7)
[x] ④ jetson_clocks systemd 영속화 — jetson-clocks.service enabled·active · 09-07 15:51 재부팅 후 33초 만에 1020 MHz 확인 (§8)
[x] ② 960 엔진 지연 실측(§3 · 09-07 14:22) → 960×540 채택 권고
[x] ② gopro_ppe_edge 추론/표시 해상도 분리 · 960 엔진 기본값 — 스냅샷 육안 확인(박스 축척 정상 · 헤더 @960)
[x] ③ NVDEC GStreamer 파이프라인 실측 — 09-07 15:47 CPU 0.42→0.13 코어 · 30 fps 손실 0 (§2-3) · 푸셔 적용은 미결
[x] ② 원거리 머리 육안 판정 — 09-08 09:33 **로컬 뷰어로 확인**(클라우드 불필요). 사무실 다인원 프레임에서
    h0.050·h0.053 머리가 잡힌다 = 640×360 이면 18 px 로 학습 범위 밖이던 크기다. 960 입력 채택 근거 확정
[x] CCTV OFF 상태에서 §3 재측정 — 15:49 추론 −9~14% · p95 −40% · 결론 불변 (§3)
[ ] ① 실서버(TLS) 상대 푸시율 실측 — 더미는 평문 localhost 라 TLS 절감분은 아직 미측정
[x] 로컬 확인 경로 확보 — 푸셔에 `/stream`(MJPEG)·`/`(뷰어) 추가 · CCTV_BASE 없이 띄우면 과금 0 (§9)
```

---

## 7. 적용 기록 — 2026-09-07 14:26~14:31 (①④② · CCTV OFF 상태에서 로컬 검증)

CCTV 는 사용자 지시로 종료 상태(cctv-ai `00081-mjt` internal·min 0 · 팀원이 IAM allUsers 도 제거).
그래서 클라우드 대신 **젯슨 로컬 더미 수신부**(`/home/jetson/dummy_ingest.py` · 127.0.0.1:8099 · 연결 수와
요청 수를 따로 셈)를 상대로 검증했다. 과금 0.

```
health     engine ppe_yolo26s_960_v5_nc · imgsz 960 · infer_size 960x540 · infer 19.8 ms · 스트림 30 fps
push_fps   10 → 9.6/s        (워커 2개 · 종전 4개로 9.1/s)
/config    push_fps=5 → 5.0/s · push_fps=12 → 8.0/s   재기동 없이 즉시 반영 · GoPro 무접촉
keep-alive 더미 집계 conns 3 / reqs 414   ← 워커 2 + 조회 curl 1 = 연결 3개로 414 요청
스냅샷     박스 축척 정상(작업자·안전모 미착용 h0.351) · 헤더 "PPE (yolo26 v5 @960)" · 23 ms
```

- push_fps=12 에서 8.0/s 에 그친 것은 추론 cadence(infer_fps 15 · 실제 ~20 ms + 렌더)가 상한이라서다.
  푸시는 새 프레임만 보내므로 추론율을 넘지 못한다. 12 fps 가 필요하면 infer_fps 도 같이 올린다.
- 더미는 평문 HTTP 라 **TLS 절감분(장당 ~120 ms)은 실서버에서 재야 확정**된다. 연결 재사용 자체는 증명됐다.
- 젯슨 배치 = `~/vg_edge_poc/gopro_ppe_edge.py`(md5 981aa237) · 구본 `gopro_ppe_edge.py.bak-0901`.
  새 기본값 = 960 엔진 · 960×540 · PUSH_FPS 10 · PUSH_WORKERS 2. 640 으로 되돌리려면
  `PPE_ENGINE=…640_v5_nc.engine PPE_IMGSZ=640 INFER_SIZE=640x360`.
- `jetson-clocks.service`(oneshot · After=nvpmodel) enabled — 재부팅 후에도 1020 MHz.
- 검증 후 푸셔·더미 정지 · GoPro STOP(status 1) → CCTV OFF 상태 유지.

**다음 ON 절차** = ⓐ 사용자 `gcloud run services update cctv-ai … --min-instances 1 --ingress all`
+ **IAM `allUsers → run.invoker` 재부여**(팀원이 지웠으므로 ingress 만 열면 403) ⓑ 에이전트 푸셔 기동
`CCTV_BASE=https://cctv-ai-569797426568.asia-northeast3.run.app nohup python3 gopro_ppe_edge.py …`
ⓒ `cam03_source: phone-live` · stream3 fps · **원거리 머리 박스 육안**.

---

## 8. CCTV OFF 검증 기록 — 2026-09-07 15:45~15:52 (③ 실측 · §3 재측정 · ④ 재부팅 검증)

CCTV 는 종료 상태(cctv-ai `00083-qq7` internal·min 0 · IAM allUsers 없음)라 8554 가 비어 있었다. 과금 0.

```
③ NVDEC    edge/nvdec_probe.py · GoPro START→STOP 1사이클 · 4경로 × 30초      → §2-3 표 (CPU 0.42 → 0.13 코어)
§3 재측정   bench_engine.py 3조합 · 푸셔 없음                                  → §3 표 (추론 −9~14% · p95 −40%)
④ 재부팅    15:50:42 reboot → 15:51:33 jetson-clocks.service 완료(부팅 33초)  → cur_freq 1020000000 · nvpmodel 2
                                                                                 · GoPro status 1 · USB-net 172.23.102.52 복귀
```

- ④ 확정 — 재부팅 뒤 사람 손 없이 1020 MHz. §6 의 "다음 재부팅 때" 조건이 닫혔다.
- ③ 은 측정만 했고 푸셔에는 넣지 않았다. 넣을 때 확인할 것 = 단일 스레드 규칙(GStreamer 도 grab 이 블록하므로
  그대로), 재연결 경로(`cap.isOpened()` 실패 → `webcam_start`)가 GStreamer 에서도 같은 신호를 주는지,
  `stream_fps` 가 36 → 30 으로 바뀌는 것(정상 · §2-3).
- 끝난 상태 = 푸셔 정지 · GoPro STOP(status 1) · CCTV OFF 유지.

---

## 9. 로컬 확인 경로 — 클라우드를 켜지 않고 본다 (2026-09-08)

재생 상태를 볼 때마다 cctv-ai 를 켜는 것은 **과금(min-instances 1 · CPU 상시 할당)과 팀원 IAM 재부여**를 매번
치르는 일이었다. 푸셔에 로컬 송출을 붙여 그 왕복을 없앴다.

```
젯슨에서  cd ~/vg_edge_poc && nohup python3 gopro_ppe_edge.py > gopro_edge.log 2>&1 &   ← CCTV_BASE 를 뺀다
브라우저  http://yahboom-1:8444/        영상 + 지표 + 추론 fps 버튼이 한 화면에
          http://yahboom-1:8444/stream  MJPEG 단독
정지      pkill -f "^python3 gopro_ppe_edge"  ·  curl -s http://172.23.102.51/gp/gpWebcam/STOP
```

- `CCTV_BASE` 가 없으면 `_pusher()` 가 워커를 아예 안 띄운다 — **클라우드로 나가는 패킷이 0**이고 `pushed` 도 0 이다.
- `/stream` 송출 규칙은 서버 `mjpeg_ppe` 와 같다(같은 프레임 재송출 안 함 · 1초 keepalive).
- 맥에서 실측 = `/health` 200 · `/` 200 · `/stream` 3초에 1,436 KB(≈12 fps × 40 KB). LAN·Tailscale 둘 다 도달.
- **관제웹 화면 자체**(4분할·통계 패널)를 봐야 할 때만 클라우드가 필요하다. 영상·검출 확인은 이 경로로 끝난다.
- ⚠ 이 페이지를 열려고 푸셔를 재시작하지 말 것 — 재시작은 GoPro STOP/START 를 부른다(웨지 원인). fps 는 버튼으로.
