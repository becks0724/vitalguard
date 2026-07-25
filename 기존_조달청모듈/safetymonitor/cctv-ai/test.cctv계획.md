# CCTV 엣지 AI — 월요일 실행·테스트 계획 (MSI GP75 / RTX 2060)

> 재평가(§A)의 **추정 FPS를 실장비에서 검증**하고 모델·스트리밍을 확정하는 하루 런북.
> 배경 = [cctv-최적설정-리서치.md](cctv-최적설정-리서치.md) §A, 구현 = [cctv-설정변경-계획.md](cctv-설정변경-계획.md), 코드 = [main.py](main.py).
> **핵심 목표 — DETR FPS 추정치(T4×0.57)를 실측으로 대체하고, 객체 타일 모델을 A/B로 확정한다.**

---

## 0. 목표·성공기준

- **목표** — RTX 2060 Mobile에서 ① 세 타일 모델의 **실 파이프라인 FPS 실측**, ② 3모델 동시구동 시 VRAM·열·FPS, ③ CAM-01 객체 모델(RF-DETR vs RT-DETR vs YOLO11) **정확도 A/B** 확정.
- **성공기준(하루 끝에 확보)** — (a) 실측 FPS 표 채움(추정→측정), (b) 3모델 동시구동 안정성 확인, (c) 객체·낙상·PPE 모델 **결정**, (d) 스트리밍 방식(MJPEG 유지 vs NVENC+WebRTC) **결정**, (e) 24/7 완화책 적용 여부 판단.
- **비목표(오늘 안 함)** — 관제웹 배포·PPE 재학습·WebRTC 실서비스 구축(오늘은 결정과 실측까지).

## 1. 준비물·전제 (시작 전 확인)

- [ ] MSI GP75 9SE 실기 + 전원 어댑터(**상시 AC**) + 인터넷.
- [ ] 샘플 영상 — `samples/cam01.mp4`(객체·군중), `samples/cam03.mp4`(PPE). 낙상 테스트용 클립 1개(없으면 유튜브 낙상 클립 15fps로 준비).
- [ ] (있으면) 실제 카메라 1대(USB/RTSP) — 엔드투엔드 지연 확인용. 없으면 클립으로 대체.
- [ ] 결정 보류 항목 인지 — INT8 캘리브레이션 데이터·PPE 학습 데이터셋은 오늘 결정만.

---

## 2. 오전 — 환경·모델 준비

### 2.1 환경 구축 (검증 = `nvidia-smi` GPU 인식 + torch.cuda.is_available())
- [ ] 드라이버·CUDA·cuDNN·TensorRT 버전 확인(`nvidia-smi`, `nvcc --version`). TensorRT 미설치면 설치.
- [ ] Python venv + `ultralytics`, `torch`(CUDA 빌드), `onnx`, `onnxruntime-gpu`, `tensorrt`, `supervision`, `opencv-python`.
- [ ] **NVENC 세션 한도 확인** — 드라이버 릴리즈노트 또는 인코딩 테스트로 5/8 확인(다카메라 판단 근거).
- [ ] 전력·열 — 절전/최대절전 해제, `nvidia-smi -q -d POWER,TEMPERATURE` 모니터 띄워둠. (선택) GPU 전력제한.

### 2.2 모델 가중치 확보 (검증 = 각 .pt/.onnx 로드 성공)
- [ ] 객체 — `yolo11n.pt`, `yolo11s.pt`, **RF-DETR-L**, **RT-DETR-R50**(ultralytics `rtdetr-l` 또는 공식 가중치).
- [ ] 낙상 — `yolo11n-pose.pt`, `yolo11m-pose.pt`.
- [ ] PPE — 현 `vyra_ppe.pt`(Hexmon YOLOv8m) 그대로 + (선택) YOLO11 PPE 후보.

### 2.3 TensorRT 변환 (검증 = engine 빌드 성공 + 1프레임 추론)
- [ ] 각 모델 ONNX export → TensorRT engine 빌드(**FP16 우선**, YOLO는 INT8도).
- [ ] DETR 계열은 export 마찰 기록(deformable attention 플러그인·grid_sample 이슈 발생 여부).

---

## 3. 오후 — 벤치마크·A/B·통합

### 3.1 단일 모델 벤치 (검증 = 표 채움, 추정 대비 오차 기록)
- [ ] `trtexec`로 순수 추론 처리량(FP16/INT8·640) 측정.
- [ ] **end-to-end 파이프라인 FPS**(디코드+추론+ByteTrack+드로잉) 측정 — 이게 진짜 숫자.
- [ ] 모델별 VRAM 점유(`nvidia-smi`) 기록.

| 모델 | 추정 FP16 | 실측 trtexec | **실측 E2E** | VRAM |
|---|---|---|---|---|
| YOLO11n(객체) | 305~340 |  |  |  |
| RT-DETR-R50 | 49~56 |  |  |  |
| RF-DETR-L | 67~76 |  |  |  |
| YOLO11m-pose(낙상) | ~ |  |  |  |
| vyra_ppe(YOLOv8m) | ~ |  |  |  |

> 확인 포인트 — E2E가 추정치보다 크게 낮아도(§A.3 함정) **표시 15fps·탐지 10~15Hz 충족되면 통과**.

### 3.2 CAM-01 객체 A/B (검증 = 육안 비교 + 결정 1개)
- [ ] 같은 `cam01.mp4`에 RF-DETR-L / RT-DETR-R50 / YOLO11s 각각 추론 → **군중·겹침·원거리** 검출 품질 육안 비교.
- [ ] 판정 — 정확도 이득이 뚜렷하면 DETR, 미미하면 YOLO11(단순·빠름). **객체 모델 확정.**

### 3.3 3모델 동시구동 스모크 (검증 = 붕괴 없이 안정 FPS)
- [ ] 객체(택1) + YOLO11m-pose + vyra_ppe **동시 구동** — 합산 FPS·VRAM(6GB 여유)·GPU/CPU·**온도** 기록.
- [ ] 표시/탐지 분리 확인 — 탐지 10~15Hz인데 표시 15fps 매끄러운지(ByteTrack Kalman 보간).
- [ ] VRAM 빡빡하면 완화(FP16 통일·컨텍스트 공유·m→n 조정) 후 재측정.

### 3.4 (선택) NVENC 인코딩 테스트 (검증 = HW 인코딩 CPU 부담↓)
- [ ] 주석 프레임을 NVENC H.264로 인코딩 vs CPU(x264) — CPU 사용률·FPS 비교.
- [ ] 다카메라 스트리밍이면 WebRTC 전환 근거 확보.

---

## 4. 하루 끝 — 결정·기록

- [ ] **모델 확정** — 객체(RF-DETR-L / RT-DETR-R50 / YOLO11) · 낙상(YOLO11n/m-pose) · PPE(vyra_ppe 유지/교체).
- [ ] **스트리밍 확정** — MJPEG 유지 vs NVENC+WebRTC(카메라 수 기준).
- [ ] **FPS/해상도 확정** — 표시 15fps·탐지 10~15Hz·타일 540p·팝업 720~1080p.
- [ ] **24/7 완화책** — 상시 AC·슬립해제·쿨링·온도 모니터+텔레그램 알림 적용 여부.
- [ ] 실측 표·결정을 [cctv-최적설정-리서치.md](cctv-최적설정-리서치.md) §A.3/§A.10과 `safetymonitor/CLAUDE.md` Status에 반영.

## 5. 리스크·블로커 (막히면 여기부터)

- **DETR TensorRT export 실패** — 플러그인/opset 이슈 → RT-DETR(ultralytics 경로)로 우회, 안 되면 객체는 YOLO11로 결정하고 DETR은 후속.
- **VRAM 초과(6GB)** — m/l 동시·FP32가 원인 → INT8/FP16·컨텍스트 공유·모델 축소.
- **열 스로틀** — 지속부하 온도 급상승 → 전력제한·쿨링패드, 24/7 부적합 근거로 기록.
- **실측이 추정보다 크게 낮음** — 후처리 병목(트래킹/드로잉) 프로파일 → 탐지 cadence·해상도 조정.
- **시간 부족** — 우선순위 = 3.1 실측 → 3.2 객체 A/B → 3.3 동시구동. 3.4 NVENC는 스트레치.

## 6. 다음(월요일 이후)

- 확정 모델로 엣지 파이프라인 구현(표시/탐지 분리·ByteTrack 보간).
- (필요 시) PPE 파인튠·INT8 캘리브레이션·WebRTC 다카메라.
- 관제웹 연동(현 `/cctv/ingest2·3`·MJPEG 계약 또는 WebRTC 신규).
- 24/7 장기 하드웨어 로드맵(산업용 미니PC / Orin NX·AGX) 판단.
