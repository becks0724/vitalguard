# CCTV 관제 최적 설정 — 리서치 리포트

> 관제웹 CCTV의 **최적 영상 구현 + 엣지(Jetson Orin Nano) AI + 낙상/PPE 모델 선택 + FPS/해상도**를 최신 근거로 정리하고,
> 이 프로젝트에 맞는 **종합 최적 조합**을 제시한다. 작성 2026-07-25. 근거 = 4축 웹 리서치(2024~2026 소스) + 레포 맥락.
> 구현 절차는 [cctv-설정변경-계획.md](cctv-설정변경-계획.md), 코드는 [main.py](main.py) 참조.
>
> **★ 2026-07-25 갱신 — 엣지 장비가 Jetson Orin Nano → MSI GP75 Leopard 9SE(RTX 2060 Mobile)로 변경.** 아래 §0·§2~§5는 **Orin Nano 전제**이며, 현재 장비 기준 최신 결론은 **[§A 장비 변경 재평가](#a--장비-변경-재평가--msi-gp75-leopard-9se-rtx-2060-mobile-2026-07-25)** 를 따른다(충돌 시 §A 우선).

---

## 0. 종합 결론 (최적 조합) — *Orin Nano 전제 (§A로 갱신됨)*

**한 줄 결론.** 세 타일 모두 **YOLO 계열(YOLO11 기반)** 이 Orin Nano에서 지금 가장 합리적이다. 부드러움은 모델 성능이 아니라 **표시/탐지 분리 + 15fps 표시**로 얻고, RT-DETR/RF-DETR은 "객체 타일 정확도 업그레이드 후보"로만 남긴다(엣지 실측 FPS·INT8 안정성·PPE 사전학습 부재 때문).

| 계층 | 구성 요소 | 최적 선택 | 근거 요약 |
|---|---|---|---|
| **엣지 모델 — 낙상** | CAM-02 | **YOLO11n-pose + 무동작/시간 게이트** | pose 실시간·저메모리·오경보 억제가 값싼 후처리. DETR은 pose 불가. 이미 `bd6fc2a`와 일치 |
| **엣지 모델 — PPE** | CAM-03 | **YOLO(YOLOv8m/YOLO11) PPE 파인튠 + NO-* 위반클래스** | YOLO가 정확도 동률·속도 우위·기성 가중치 존재. RT-DETR PPE 사전학습 없음 |
| **엣지 모델 — 객체** | CAM-01 | **YOLO11n/s (INT8)** | Orin Nano **실측 FPS 존재**·INT8 안정. RF-DETR은 실측 Nano FPS 없음(업그레이드 후보) |
| **엣지 인코딩** | Orin Nano | **NVJPEG(HW JPEG) → MJPEG/JPEG push** | Orin Nano엔 **NVENC 없음**·NVJPEG 있음 → 현 JPEG 경로가 HW 정합 |
| **표시 파이프라인** | 엣지·서버 공통 | **표시/탐지 분리 + ByteTrack Kalman 보간** | 표시 15fps·탐지 5~10Hz. 부드러움의 핵심 |
| **FPS·해상도** | 관제웹 | **표시 15fps·타일 540p·팝업 720~1080p** | CCTV 표준(12~15fps)·서브스트림 관례 |
| **다카메라 확장** | 향후 | **Orin NX/AGX + NVENC + WebRTC** | Nano는 HW 인코더 부재로 다카메라 인코딩 한계 |

---

## A. ★ 장비 변경 재평가 — MSI GP75 Leopard 9SE (RTX 2060 Mobile) [2026-07-25]

엣지 장비가 **임베디드(Orin Nano) → 데스크톱급 게이밍 노트북**으로 바뀌면서 §0/§2~§5의 세 전제가 뒤집힌다.

### A.0 무엇이 바뀌나 (한눈에)

1. **DETR 계열이 실시간으로 부활** — Orin Nano에선 "실측 FPS 없음·부적합"이었으나, RTX 2060에선 **RT-DETR-R50·RF-DETR-L·D-FINE-L 모두 30fps 여유로 초과**. R18로 내려갈 필요 없음.
2. **NVENC 해금** — Orin Nano엔 없던 하드웨어 영상 인코더가 RTX 2060엔 있음 → **H.264/H.265 + WebRTC 다카메라 스트리밍**이 저CPU로 가능. MJPEG 강제 해소.
3. **동시구동 여유** — 6GB 전용 VRAM + 별도 NVENC + 6코어 CPU. Orin Nano 8GB 공유·열 스로틀 제약에서 벗어남.
4. **새 리스크** — 게이밍 노트북의 **24/7 산업 신뢰성**(열·먼지·팬·IP등급 없음).

### A.1 하드웨어 (확인됨)

i7-9750H(6C/12T·45W) + **RTX 2060 Mobile**(Turing TU106·1920 CUDA·240 Tensor·**6GB GDDR6**·80~90W TGP·Max-Q 아님) + 16GB DDR4. "9SE" = RTX 2060 확정.

### A.2 연산 비교

| 지표 | RTX 2060 Mobile | Tesla T4 | Orin Nano(orig/Super) |
|---|---|---|---|
| FP16 Tensor TFLOPS | ~37 (추정) | 65 | 10(dense) |
| INT8 TOPS | ~74 (추정) | 130 | 40 / 67(sparse 표기) |
| T4 대비 | **~0.55~0.6×** | 1× | 0.15~0.5× |

→ **T4 공개 벤치를 ~0.57배 하면 RTX 2060 Mobile 근사치**(모바일은 데스크톱 대비 −10~20% 추가).

### A.3 재벤치 — 추론 FPS (640·TensorRT)

| 모델 | FP16 | INT8 | 근거 |
|---|---|---|---|
| YOLOv8n | **662~800** | **775~962** | 측정(Ultralytics·RTX2060 6GB) |
| YOLO11 n/s/m | ~305~340 / ~185~205 / ~97~109 | ~380~425 / ~230~255 / ~120~135 | 추정(T4 실측 ×0.57) |
| **RT-DETR-R18** | **~99~112** | ~125~140 | 추정(T4 217fps) |
| **RT-DETR-R50** | **~49~56** | ~62~70 | 추정(T4 108fps) |
| **RF-DETR-L** | **~67~76** | ~85~95 | 추정(T4 147fps) |
| **D-FINE-L** | **~57~64** | ~72~80 | 추정(T4 124fps) |
| D-FINE-X | ~36~40 | ~45~50 | 추정(T4 78fps) |
| 순정 DETR-R50 | ~10~15 | ~13~15 | 추정·저신뢰 |

> §2.3의 함정 **그대로 적용** — 이 FPS는 추론 단독값이고, 트래킹·디코드·드로잉 포함 **실 파이프라인은 이보다 크게 낮다**(최대 ~8배). 다만 절대 여유가 커서 **표시 15fps + 탐지 10~15Hz는 세 모델 동시라도 충분**하다.

### A.4 DETR 실시간 판정 (뒤집힘)

- **RT-DETR-R50(~50fps)·RF-DETR-L(~70fps)·D-FINE-L(~60fps) 전부 실시간 여유.** 정확도 상한(COCO mAP 53~55)을 실시간으로 쓸 수 있게 됨.
- 순정 DETR-R50은 여전히 부적합(~10~15fps·global attention은 TensorRT 가속 못 받음) → RT-DETR/RF-DETR/D-FINE 사용.
- YOLO는 수백 fps로 과잉 → 동시구동 여유 담당.

### A.5 타일별 권고 갱신

| 타일 | Orin Nano 결론 | **RTX 2060 갱신** | 비고 |
|---|---|---|---|
| **CAM-01 객체** | YOLO11n/s | **RF-DETR-L 또는 RT-DETR-R50** | 정확도 mAP53~55 + NMS-free 군중 + 실시간 여유. 단순성 우선이면 YOLO11도 유효 |
| **CAM-02 낙상** | YOLO11n-pose | **YOLO11m-pose(+선택 ST-GCN 시간모델) + 게이트** | 연산 여유로 recall↑ 옵션 개방(Nano에선 불가했던 2단계). 게이트는 `bd6fc2a` 유지 |
| **CAM-03 PPE** | YOLO PPE | **YOLO PPE 유지**(기성 가중치) | DETR-PPE도 이제 하드웨어상 실시간 — 단 직접 학습 필요라 기본은 YOLO |

### A.6 스트리밍 아키텍처 갱신 (NVENC 해금)

- **Turing NVENC**(H.264+H.265·AV1 없음·품질 ≈ x264 medium). 동시 세션 **5~8**(드라이버 의존·nvidia-patch로 무제한). 실용 1080p **5~8 스트림** 인코딩 가능.
- **추론(CUDA) + 인코딩(NVENC)이 별도 실리콘** → 동시 구동, CPU 부담 낮음.
- → **MJPEG 강제 해소.** 다카메라는 **H.264/H.265 → WebRTC**(저지연 ~300ms·저대역폭)로. 소수 카메라·단순함 우선이면 MJPEG 유지도 여전히 가능.

### A.7 6GB VRAM 동시구동

- 3× n/s급 FP16 엔진 ≈ **2.5~3.5GB**(6GB 내 여유). TensorRT 컨텍스트당 ~500MB 오버헤드.
- 빡빡해지는 경우 — m/l급 다수 동시·FP32·RT-DETR-R50(큰 백본) 3개 동시. 완화 = INT8/FP16 통일·컨텍스트 공유·m/l 동시 회피.

### A.8 배포 리스크 (새로 부각 — 가장 중요)

게이밍 노트북 24/7 산업 운용은 성능이 아니라 **신뢰성**이 문제다.

| 용도 | 판정 |
|---|---|
| PoC·데모·**관제실(상주·공조) 서버** | ✅ 적합 |
| 가혹 현장·**무인 24/7** | ❌ 부적합(IP등급 없음·먼지·팬 마모·스로틀·부품수급 12~18개월) |

완화책(그래도 쓸 경우) — GPU 전력제한/언더볼트·상시 AC·슬립/최대절전 해제·쿨링패드·주기적 먼지청소·UPS·**외부 온도/가동 모니터링+알림(기존 텔레그램 인프라 연계)**·공조된 실내. 지속부하 소비전력 ~150~200W. **장기 현장은 산업용 미니PC(GPU) 또는 Orin NX/AGX(NVENC 있음) 재검토.**

### A.9 새 최적 조합 (RTX 2060 기준)

```
[현장 카메라] USB/RTSP
      ▼
[MSI GP75 · RTX 2060 6GB + i7-9750H]   ── 관제실 상주 서버(공조·상시 AC·전력제한)
   ├─ CAM-01 객체 : RF-DETR-L / RT-DETR-R50 (INT8/FP16)   탐지 10~15Hz
   ├─ CAM-02 낙상 : YOLO11m-pose (+선택 ST-GCN) + 무동작/시간 게이트  ← bd6fc2a
   └─ CAM-03 PPE  : YOLO PPE 파인튠 (INT8) + NO-* 위반
      │  표시/탐지 분리 · ByteTrack Kalman 보간 → 15fps
      │  NVENC H.264/H.265 인코딩  ← Orin Nano엔 없던 것
      ▼  다카메라 = WebRTC(저지연) / 소수 = MJPEG 유지 가능
[관제웹]  타일 540p·15fps / 팝업 720~1080p
```

- **핵심 변화** — 객체 타일을 **DETR로 승격**(정확도↑, 이제 실시간 가능)·**하드웨어 인코딩+WebRTC 다카메라**·낙상 recall 업그레이드 여지. 부드러움 처방(표시/탐지 분리·15fps)은 장비 무관 그대로.
- **전송** — 관제실 로컬이면 이 노트북이 관제웹을 직접 서빙하거나 LAN 스트리밍 가능(클라우드 왕복 불필요·지연↓). 원격 관제면 기존 클라우드 push 유지.

### A.10 다음 스텝 (재벤치 반영)

- [ ] 실장비에서 `trtexec` + **end-to-end 파이프라인** FPS 실측(추정치 검증)·전력제한/열 모니터.
- [ ] CAM-01 = RF-DETR-L vs RT-DETR-R50 vs YOLO11 **자체 데이터 A/B**(정확도·군중·속도).
- [ ] 낙상 recall이 게이트 후에도 부족하면 **ST-GCN 시간모델 2단계** 시도(이제 연산 여유 있음).
- [ ] 스트리밍 = MJPEG 유지 vs **NVENC+WebRTC 전환** 결정(카메라 수 기준).
- [ ] 24/7 신뢰성 완화책 적용 + **장기 산업용 하드웨어 로드맵** 판단.

---

## 1. 관제웹 CCTV 최적 영상 구현

**부드러움은 fps 숫자가 아니라 파이프라인 구조에서 나온다.** 무거운 추론을 매 프레임 돌리면 표시가 추론 속도에 묶여 끊긴다. 표준 해법은 **탐지/표시 분리**.

- **탐지** — N프레임당 1회(예 5~10Hz)만 무거운 검출을 돌린다.
- **표시** — 원본 영상을 **표시 fps(15) 그대로** 내보내고, 탐지 사이 프레임은 **ByteTrack의 Kalman 예측**으로 박스를 보간한다. 추론이 느려도 화면은 매끄럽다. (DeepStream 권장 패턴·Ultralytics tracker-interpolation)
- 이 패턴은 **이미 이 레포 CAM-03 라이브(`_ppe_live`, main.py:106)에 구현**돼 있고, CAM-01 클립(`_object_worker`)에만 미적용이다 → 이식이 곧 부드러움.

코덱·전송(웹 대시보드 기준).

| 방식 | 지연 | 대역폭 | 브라우저 | 비고 |
|---|---|---|---|---|
| **MJPEG (현재)** | 낮음 | **10~20배 큼** | 네이티브 | 프레임 독립·디코드 단순. 소수 타일·LAN엔 적합. **Orin Nano NVJPEG와 정합** |
| H.264 | 낮음 | MJPEG의 ~1/5 | HW 디코드 | 다카메라 유리. **Orin Nano는 SW 인코딩(CPU 2~3코어/1080p30)** |
| H.265 | 낮음 | H.264의 ~1/2 | HW 디코드 | 최저 대역폭. Orin Nano SW 인코딩 부담 동일 |
| **WebRTC** | ~300ms | 낮음(H.264/5) | 네이티브 | **다카메라 라이브 최적**·스케일엔 SFU 필요 |
| HLS/LL-HLS | 2~12s | 낮음 | 네이티브 | 라이브 관제엔 지연 과다 |

> 판정 — **소수 카메라·현 아키텍처는 MJPEG 유지**가 합리적(단순·Nano HW JPEG 정합). **다카메라로 확장하면 WebRTC/H.264**로 가야 하고, 그건 **NVENC 있는 Orin NX/AGX**가 전제(§2).

---

## 2. 엣지 AI 방식 (Jetson Orin Nano)

### 2.1 Orin Nano 하드웨어 현실 (설계를 바꾸는 사실)

- **NVENC(하드웨어 영상 인코더) 없음** — Orin Nano는 NVDEC(디코드)·NVJPEG(JPEG)만 있고 H.264/H.265 **인코더가 없다**. SW 인코딩(x264) = 1080p30 한 스트림에 CPU 2~3코어. → **엣지에서 다중 카메라를 H.264/H.265로 인코딩해 WebRTC/RTSP 송출하는 구성은 Nano에서 카메라 수가 크게 제약**된다. 다카메라 HW 인코딩은 **Orin NX/AGX** 필요.
- **NVJPEG(하드웨어 JPEG) 있음** — 그래서 **현재의 "엣지가 JPEG 프레임을 클라우드로 push(ingest2/3) → 클라우드 MJPEG 서빙" 경로가 Nano 하드웨어에 오히려 잘 맞는다.** 지금 아키텍처를 유지할 실질 근거.
- **연산량** — Ampere 1024 CUDA·8GB 공유 LPDDR5·40 TOPS(JetPack 6.1 "**Super**" 시 67 TOPS·×1.7). Super 모드 활성 여부 확인 권장.

### 2.2 8GB에서 3모델 동시구동 (실질 상한)

- 낙상(pose)+PPE+객체 3모델을 한 Nano에서 돌린다 → **실질 상한은 FPS가 아니라 메모리·열·스케줄링**.
- 근거 데이터 — 검출+pose **2모델을 프레임 파이프라인**으로 돌리면 저하 ~5%(양호). 그러나 **나이브 멀티프로세스는 붕괴**(YOLOv8n 210→10 img/s/proc @8프로세스, CPU 스케줄링). 3스트림 RF-DETR은 RAM 85%+스왑 43%+열 68~70℃ throttle.
- 처방 — **DeepStream `nvstreammux` 배칭 + 한 모델 DLA 오프로드 + 프로세스보다 배치 + 열/메모리 예산**. 프로세스 난립 금지.

### 2.3 측정 FPS의 함정 (반드시 인지)

- **`trtexec` 추론 단독 처리량은 실제 end-to-end 파이프라인 FPS를 최대 ~8배 과대평가**한다(후처리·트래킹·디코드·드로잉이 지배). 실측 예 — YOLO11+트래킹 프로젝트가 목표 35fps 대비 **실제 16~17fps**.
- 즉 아래 "YOLO11n 221fps"는 추론 단독값이고, **트래킹·표시까지 포함한 카메라당 실 파이프라인은 대략 15~30fps** 로 봐야 한다. 다행히 **표시 목표 15fps엔 충분**하지만, 숫자를 그대로 믿고 카메라 수를 늘리면 안 된다.

---

## 3. 객체 인식 모델 — 낙상·PPE·객체 (YOLO vs RT-DETR)

### 3.1 낙상 (CAM-02)

| 접근 | 정확도(문헌) | Orin Nano | 복잡도 |
|---|---|---|---|
| **pose+휴리스틱** (YOLO11n-pose 키포인트 → 종횡비·몸통각·낙하속도) | 정확도 89~97% | **실시간 >15~20fps**(TensorRT) | **낮음** |
| bbox+시간 | mAP50 ~94%·recall ~92% | ~13~32fps | 낮음~중 |
| skeleton+LSTM/ST-GCN | ST-GCN 90~97%+ (소규모 staged) | **Nano 실시간 실증 없음**·2단계 | 중~높음 |
| 3D-CNN | ~95%(소규모·과적합 의심) | **엣지 부적합**(GPU급만) | 높음 |

- **recall 관점** — ST-GCN 등 시간모델이 "침대에 누운 자세=오탐"을 움직임 맥락으로 걸러 recall이 소폭 높지만, **Nano 실시간 실증이 없고 커스텀 2단계 학습 부담**.
- **오경보 억제(이 프로젝트 핵심)** — 시간 확인창+투표·**무동작 게이팅**·지속시간 임계. 전부 **모델 교체가 아닌 값싼 후처리**.
- **권고 — YOLO11n-pose + 휴리스틱 + 시간확인/무동작 게이트.** 이는 **어제 커밋 `bd6fc2a`(무동작 게이트+무충격 붕괴 감지)와 정확히 일치**. gated pose가 튜닝 후에도 under-recall일 때만 ST-GCN 검토.
- 정직한 한계 — 문헌 정확도 다수가 UR Fall/Le2i 등 **소규모 실험실 데이터**라 실제 CCTV는 더 낮다.

### 3.2 PPE (CAM-03)

- **데이터셋** — **Roboflow "Construction Site Safety" 10클래스**가 표준(NO-Hardhat·NO-Safety Vest 위반 라벨 포함). CHV(헬멧 색 강건성)·SH17(대규모지만 presence-only) 보강.
- **정확도** — YOLOv8x@CHV **mAP50 92.9%**(최고)·엣지형 n/s는 ~85~88%. **DETR vs YOLOv11n = mAP50-95 0.770 동률**이나 YOLO가 속도 압도(6~7ms).
- **결정적 — RT-DETR/RF-DETR용 사전학습 PPE 가중치가 없다.** Roboflow 자체 가이드도 RF-DETR PPE는 직접 파인튠하라 명시. 반면 YOLO는 기성 체크포인트 성숙(현 **Hexmon vyra-yolo-ppe YOLOv8m**·keremberke·Tanishjain9(Jetson 타깃)).
- **엣지 FPS** — YOLOv8n/11n PPE 파인튠 ≈ Nano FP16 640 **30~60fps(추정)**. RT-DETR(ResNet50 ~32M+)는 Nano 실시간 실증 없음.
- **권고 — YOLOv8n/s 또는 YOLO11n을 Roboflow 10클래스+CHV로 파인튠 → TensorRT FP16.** 현 Hexmon 유지도 유효. **PPE를 DETR로 앞세우지 말 것.**

### 3.3 객체 일반 (CAM-01)

COCO 스펙(정확도/크기)과 Orin Nano 실측 FPS.

| 모델 | COCO mAP50-95 | Params(M) | GFLOPs | Orin Nano FPS(640·TensorRT) |
|---|---|---|---|---|
| YOLO11 n/s/m | 39.5 / 47.0 / 51.5 | 2.6 / 9.4 / 20.1 | 6.5 / 21.5 / 68 | **FP16 221/144/74 · INT8 270/197/110** (측정·Super) |
| YOLOv8n | 37.3 | 3.2 | 8.7 | **FP16 225 · INT8 286** (측정) |
| YOLOv12 n/s/m | 40.6 / 48.0 / 52.5 | 2.6 / 9.3 / 20.2 | 6.5 / 21.4 / 67.5 | 미측정(YOLO11 근사) |
| RT-DETR R18/R50 | 46.5 / 53.1 | 20 / 42 | 60 / 136 | ~33(추정·저신뢰) |
| RF-DETR N/S/M | 48.4 / 53.0 / 54.7 | 30.5 / 32.1 / 33.7 | ~32 / 60 / 79 | **Nano 실측 없음**(NX16GB=166img/s@384) |
| D-FINE N/S/M | 42.8 / 48.5 / 52.3 | 4 / 10 / 19 | 7 / 25 / 57 | ~30(추정·Xavier AGX 근사) |

> **주의** — YOLO 공식 지연은 NMS 제외값·소스 간 최대 1.8배 불일치·RF-DETR은 384~576 저해상도라 속도/정확도가 부풀려짐. **한 소스 안에서만 비교**하고 절대비교 금지. §2.3 파이프라인 함정도 함께 적용.

### 3.4 YOLO vs RT-DETR 종합 판정

- **정확도(COCO)만 보면 DETR 계열 우위**(RT-DETR/RF-DETR 46~54 vs YOLO11 39~51). NMS-free라 겹침·군중에 유리하다는 주장 — **그럴듯하나 벤치마크로 입증되진 않음**(RT-DETR 논문에 crowd 벤치 없음, 반례로 DETR이 밀집보행자서 FP 더 냄).
- **그러나 이 프로젝트 3용도 전부 YOLO가 실용 우위.** 낙상=DETR 불가(pose)·PPE=DETR 사전학습 없음+동률+느림·객체=Nano 실측 FPS 없음+INT8 민감+실파이프라인 FPS 미검증.
- **INT8** — 트랜스포머는 INT8 양자화 손실 큼(NVIDIA "RT-DETR 인코더/디코더 특히 민감", D-FINE도 FP16 권장). YOLO INT8은 Nano에서 안정(측정 이득 확인). 엣지 효율의 INT8 지렛대를 YOLO만 온전히 쓴다.
- **TensorRT export** — RT-DETR/D-FINE/RF-DETR이 순정 DETR보다 깔끔하나 "plugin-free ≠ frictionless"(RT-DETRv1 grid_sample·RF-DETR seg export 정확도 저하 이슈).
- **결론 — 지금은 3타일 YOLO11 통일. RF-DETR은 "객체 타일 정확도 상한이 부족하고, Nano 실 FPS를 자체 검증한 뒤"에만 CAM-01 한정 업그레이드**(Roboflow supervision 이미 의존이라 정합). 참고로 2026년 Ultralytics YOLO26·YOLO12 신모델은 온디바이스 벤치 후 채택 판단(현재 실측 데이터는 YOLO11이 가장 확실).

---

## 4. FPS·해상도 추천 (끊김 없는 구현)

| 용도 | FPS | 해상도 | 코덱/전송 | 비고 |
|---|---|---|---|---|
| **관제 타일(다분할)** | **12~15** | **480~540p 서브스트림** | 소수=MJPEG·다수=H.264/WebRTC | 사람 지각 매끄러움 임계 ~12fps |
| **단일 전체화면/사건검토** | 25~30 | 1080p | H.264/H.265 WebRTC | 빠른 움직임·얼굴/번호판 |
| **AI 오버레이(박스)** | 표시 fps에 일치 | 동일 | 동일 | **탐지는 3~10Hz 독립** — 추가 대역폭 0(오버레이는 클라이언트측) |

- **표시 15fps** = CCTV 표준·클립 캡처(15)와 일치(현 6fps 슬로모 해소). 30fps는 대역폭 2배 대비 관제 체감이득 적음.
- **탐지 5~10Hz 분리** — ByteTrack Kalman 보간으로 표시 15fps 매끄러움 유지.
- **해상도** — 타일은 서브스트림(540p), 전체화면만 원본(720~1080p) 재요청. 현 출력 CAM-01 1280×720/CAM-03 640×360 → 타일용 540p 서브 추가 권장(멀티창 대역폭·인코딩↓).
- **대역폭 참고** — 1080p H.264@30 ≈ 2~4Mbps·H.265@15 ≈ 2Mbps·MJPEG은 10~20배.

---

## 5. 종합 최적 조합 (타깃 아키텍처)

```
[현장 카메라] GoPro(USB)·Aqara(RTSP)
      │  캡처
      ▼
[엣지 · Jetson Orin Nano 8GB]  ── DeepStream nvstreammux 배칭 + 1모델 DLA 오프로드
   ├─ CAM-01 객체 : YOLO11n/s  (TensorRT INT8)      탐지 5~10Hz
   ├─ CAM-02 낙상 : YOLO11n-pose (FP16) + 무동작/시간 게이트  ← bd6fc2a
   └─ CAM-03 PPE  : YOLO PPE 파인튠 (INT8) + NO-* 위반
      │  표시/탐지 분리 · ByteTrack Kalman 보간 → 15fps
      │  NVJPEG(HW JPEG) 인코딩  ← Nano엔 NVENC 없음
      ▼  JPEG 프레임 push (현 /cctv/ingest2·3 계약 유지)
[클라우드 · cctv-ai]  MJPEG 서빙 · stats 집계
      ▼
[관제웹]  타일 540p·15fps / 팝업 720~1080p / 최대 4창
```

- **모델** — 3타일 YOLO11 통일(낙상 pose·PPE INT8·객체 INT8). RF-DETR은 CAM-01 정확도 업그레이드 후보(Nano FPS 자체검증 후).
- **부드러움** — 표시/탐지 분리 + 15fps + Kalman 보간(모델 무관 최대 효과).
- **인코딩/전송** — Nano는 NVJPEG+MJPEG 유지. **다카메라 확장 시에만** Orin NX/AGX + NVENC + WebRTC로 전환.
- **동시구동** — DeepStream 배칭·DLA 오프로드·열/메모리 예산(프로세스 난립 금지).

### 마이그레이션 단계

1. **Phase 1 (즉시·Cloud Run CPU 유지)** — [cctv-설정변경-계획.md](cctv-설정변경-계획.md) 그대로 — 표시/탐지 분리·15fps·YOLO11n·imgsz640. 엣지 완성 전 부드러움 확보.
2. **Phase 2 (엣지 이관)** — Orin Nano에서 3모델 TensorRT(INT8/FP16 pose)·DeepStream 배칭·동시구동 벤치(`trtexec` + 실파이프라인 FPS·메모리·열).
3. **Phase 3 (선택·정확도)** — CAM-01 RF-DETR 자체 벤치(Nano FPS·mAP) 후 채택 판단.
4. **Phase 4 (선택·다카메라)** — 카메라 증설 시 Orin NX/AGX + NVENC + WebRTC.

---

## 6. 정직한 한계·리스크

- **측정 vs 추정** — YOLO11/YOLOv8 Nano FPS는 측정값(Super), **RF-DETR·D-FINE는 Nano 실측 부재**(NX/Xavier에서 축소추정). trtexec값은 실파이프라인의 최대 ~8배 과대(§2.3).
- **정확도 인플레** — 낙상·PPE 문헌 다수가 소규모/staged 데이터 → 현장 CCTV는 더 낮음. 자체 데이터 검증 필수.
- **NMS-free 군중 우위** — 마케팅·정성 주장이며 crowd 벤치 미입증.
- **RF-DETR** — 대부분 Roboflow 자기보고·독립 재현 부족·엣지 story가 Nano 아닌 NX 16GB 기준.
- **동시구동** — 8GB 열/스왑/스케줄링이 실제 병목. 나이브 배치는 붕괴.

---

## 7. 다음 스텝

- [ ] Phase 1(부드러움) 먼저 구현·배포 — 계획서대로.
- [ ] Orin Nano Super 모드·JetPack 버전·메모리(4/8GB) 확인.
- [ ] 3모델 TensorRT export(YOLO11 객체 INT8·pose FP16·PPE INT8) 후 **실파이프라인 FPS·메모리·열** 실측(trtexec 아닌 end-to-end).
- [ ] PPE 파인튠 데이터셋 결정(Roboflow 10클래스+CHV) 또는 Hexmon 유지.
- [ ] (선택) CAM-01 RF-DETR Nano 벤치로 업그레이드 여부 판정.
- [ ] 다카메라 로드맵이면 Orin NX/AGX(NVENC) 검토.

---

## 8. 근거·출처

**CCTV 스트리밍·FPS/해상도·코덱·엣지 인코딩**
- reolink.com/blog/security-camera-frame-rate/ · ipvm.com/reports/frame-rate-surveillance-guide · mammothsecurity.com/blog/fps-for-security-cameras · cctvwiki.com/en/frame-rate-guide-for-video-surveillance/
- reolink.com/blog/ip-camera-bandwidth-calculation/ · dacast.com/blog/rtmp-vs-hls-vs-webrtc/ · videoexpertsgroup.com/glossary/h264-vs-mjpeg · antmedia.io/streaming-protocols/
- y-t-g.github.io/tutorials/yolo-tracker-interpolate/ (탐지/표시 분리·Kalman 보간)
- **Orin Nano 인코딩 부재** — stereolabs.com/blog/h-264-h-265-video-encoding-support-matrix-for-nvidia-jetson · ridgerun.com/post/jetson-orin-nano-how-to-achieve-real-time-performance-for-video-encoding · docs.nvidia.com/jetson/.../SoftwareEncodeInOrinNano.html

**낙상 감지**
- sciencedirect.com/.../S1746809425014533 (FallNet) · ctujs.ctu.edu.vn/.../1364 (YOLOv8n-pose 임베디드) · hackster.io/pattshibang/fall-detection-on-jetson-nano-customizing-yolov8 · ieeexplore.ieee.org/document/11435892 (YOLOv11 pose 낙상)
- nature.com/articles/s41598-025-97634-8 (앙상블 YOLO/RetinaNet/DETR) · link.springer.com/article/10.1007/s11554-023-01377-6 (BlazePose+ST-GCN) · mdpi.com/2073-431X/15/2/74 (Orin NX YOLOv8 벤치) · arxiv.org/pdf/2503.07371 (HGO-YOLO Orin Nano)

**PPE 감지**
- arxiv.org/abs/2407.04590 (SH17) · arxiv.org/pdf/2410.20699 (CIB-SE-YOLOv8) · tandfonline.com/doi/full/10.1080/23311916.2024.2333209 (YOLOv8 PPE 비교) · researchgate.net/.../399222183 (YOLO/Faster R-CNN/DETR PPE 비교)
- github.com/snehilsanyal/Construction-Site-Safety-PPE-Detection (10클래스 위반 데이터셋) · blog.roboflow.com/ppe-detection/ (RF-DETR PPE=직접학습) · huggingface.co/Hexmon/vyra-yolo-ppe-detection · huggingface.co/Tanishjain9/yolov8n-ppe-detection-6classes (Jetson)

**RT-DETR/RF-DETR/D-FINE vs YOLO · Orin Nano FPS · 동시구동**
- docs.ultralytics.com/models/{yolov8,yolo11,rtdetr} · docs.ultralytics.com/guides/nvidia-jetson · arxiv.org/abs/2502.12524 (YOLOv12)
- github.com/lyuwenyu/RT-DETR · arxiv.org/abs/2304.08069 (RT-DETR) · arxiv.org/abs/2407.17140 (RT-DETRv2) · github.com/Peterande/D-FINE · arxiv.org/abs/2410.13842 (D-FINE)
- github.com/roboflow/rf-detr · arxiv.org/abs/2511.09554 · blog.roboflow.com/rf-detr/ · blog.roboflow.com/rf-detr-nvidia-deepstream/
- developer.nvidia.com/blog/nvidia-jetson-orin-nano-developer-kit-gets-a-super-boost/ (Super) · github.com/hokwangchoi/jetson-orin-nano-benchmarks · forums.developer.nvidia.com (YOLOv8/RT-DETR INT8·2모델 병렬) · arxiv.org/abs/2508.08430 (동시 프로파일링)

**§A 장비 변경 재평가 — MSI GP75 / RTX 2060 Mobile (2026-07-25)**
- bhphotovideo.com/.../msi_gp75_leopard_9se_888 (GP75 9SE=i7-9750H·RTX2060·16GB 확인) · notebookcheck.net/NVIDIA-GeForce-RTX-2060-Laptop-Graphics-Card.384946.0.html · gpu-monkey.com/en/gpu-nvidia_geforce_rtx_2060_mobile
- docs.ultralytics.com/integrations/tensorrt (RTX2060 6GB 측정) · docs.ultralytics.com/models/yolo11 (T4 속도표) · arxiv.org/abs/2304.08069 (RT-DETR T4) · blog.roboflow.com/rf-detr/ · datature.io/blog/real-time-object-detection-d-fine
- github.com/NVIDIA/TensorRT/issues/1701 (컨텍스트 ~500MB) · docs.nvidia.com/tao/.../deformable_detr (x86 vs Jetson)
- **NVENC** — developer.nvidia.com/blog/turing-h264-video-encoding-speed-and-quality/ · en.wikipedia.org/wiki/Nvidia_NVENC · videocardz.com/newz/nvdia-geforce-gpus-now-support-up-to-8-concurrent-nvenc-encoding-sessions · github.com/keylase/nvidia-patch (세션 제한 해제)
- **노트북 24/7 적합성** — blog.silverpc.hu (RTX2060 전력) · breakingac.com/.../fanless-industrial-panel-pcs (산업용 대안)
