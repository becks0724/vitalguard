# CCTV 설정 변경 계획

> 관제 CCTV 영상의 **버벅임 해소**와 **엣지(Jetson) GPU 전환**을 위한 설정·모델·구조 변경 계획.
> 대상 코드 = `기존_조달청모듈/safetymonitor/cctv-ai/main.py`. 작성 2026-07-24.

---

## 0. 요약 (TL;DR)

| 축 | 현재 | 변경(목표) | 효과 |
|---|---|---|---|
| 표시(스트림) FPS | 12 (하드코딩·절반 중복) | **15** (env화) | 매끄러움·슬로모 해소 |
| 추론 cadence | 6 (표시와 결합) | **5fps·3프레임당 1회** (분리) | 부하↓·박스 신선도 유지 |
| 추론 imgsz | 800 | **640** | 프레임당 추론 ~0.64배 |
| 객체 모델 | YOLOv8n | **YOLO11n** | CPU ~30%↑·mAP +2.2 |
| (선택) 출력 해상도 | 1280×720 | 960×540 | 멀티창 대역폭·인코딩↓ |
| **엣지 전환(중장기)** | Cloud Run CPU | **Jetson Orin Nano GPU + RF-DETR(객체)** | NMS-free·다카메라 확장 |

핵심 처방은 숫자 상향이 아니라 **표시 루프와 추론 루프를 분리**하는 것이다. 이 패턴은 이미 CAM-03 라이브 경로에 구현돼 있다(`main.py:106` 주석·`_ppe_live`).

---

## 1. 배경·목표

- 관제 CCTV에 객체를 연결하면 영상이 버벅인다. 부드러운 재생이 목표.
- 향후 추론을 엣지(Jetson Orin Nano)로 옮길 계획 — GPU가 있으므로 DETR 계열 적용 가능성을 함께 검토.
- 제약 = Cloud Run은 CPU 단일 인스턴스(`--cpu 4 --memory 4Gi --min-instances 1 --max-instances 1`), 엣지는 Orin Nano 8GB 공유메모리(2026-09-07 교체).

---

## 2. 현 구조 진단 (왜 버벅이나)

CAM-01 파이프라인에 **FPS가 두 개** 있고 어긋나 있다.

| 구분 | 값 | 정의 | 위치 |
|---|---|---|---|
| 표시(스트림) FPS | 12 (하드코딩) | MJPEG가 브라우저로 미는 속도 | `FPS = 12` (main.py:33), `mjpeg_object` (:533) |
| 생산(추론) FPS | 6 (env) | 새 프레임이 만들어지는 속도 | `PLAYBACK_FPS=6` (:38), `_object_worker` (:214·281) |

- **생산 6 < 표시 12** → 스트림은 12로 밀지만 절반은 직전 프레임 재전송. 실제 움직임은 **6fps로 끊긴다.**
- 클립은 15fps 캡처인데 6fps 재생 → **0.4배 슬로모**까지 겹쳐 더 어색.
- 근본 병목 = **매 프레임 imgsz 800 CPU 추론**. 추론 시간이 생산 FPS 상한을 6 언저리로 누른다.

---

## 3. 단계 구성

- **Phase 1 (단기·Cloud Run CPU)** — 표시/추론 분리 + FPS·모델·해상도 조정으로 부드러움 확보. 코드 변경 좁음.
- **Phase 2 (중장기·Jetson 엣지 GPU)** — 객체 타일을 RF-DETR로 승격. 벤치 선행.

두 단계는 독립적이다. Phase 1만 먼저 배포해도 효과가 있다.

---

## 4. Phase 1 — Cloud Run CPU 서버 부드러움 개선

### 4.1 설계 — 표시/추론 분리

CAM-03 라이브(`_ppe_live`)와 동일한 "표시=매 프레임 캐시 박스, 탐지=throttle 백그라운드" 구조를 CAM-01 클립에 이식한다.

- **단일 클립 리더 스레드**가 클립을 **15fps로 읽고**, 매 프레임 **마지막 추론 박스 캐시를 덧그려** 인코딩 → `_obj["frame"]`.
- 같은 스레드에서 **3프레임당 1회(≈5fps)만 YOLO 추론**을 돌려 박스 캐시·트래커를 갱신.
- `ByteTrack(frame_rate=…)` 는 **탐지 cadence(5)** 에 맞춘다(표시 15 아님).
- (선택) 탐지 사이 프레임은 정지 박스 대신 Kalman 예측으로 보간하면 더 매끄럽다 — 1차엔 정지 박스로 충분.

### 4.2 구체 변경 지점

| # | 파일·위치 | 현재 | 변경 |
|---|---|---|---|
| 1 | `main.py:33` `FPS = 12` | 하드코딩 표시 FPS | `DISPLAY_FPS` env화 → **15** |
| 2 | `main.py:38` `PLAYBACK_FPS=6` | 표시·추론 결합 | **탐지 cadence 전용 `DETECT_FPS=5`** 로 의미 분리 |
| 3 | `main.py:192` `_object_worker` | 매 프레임 추론+그리기 | 표시(15fps·캐시 박스) / 탐지(5fps throttle) **분리 재작성** |
| 4 | `main.py:36` `YOLO_MODEL` 기본값 | `yolov8n.pt` | **`yolo11n.pt`** (가중치 재취득 필요) |
| 5 | `main.py:40` `YOLO_IMGSZ` | 800(라이브) | **640** |
| 6 | (선택) `main.py:41` `OW,OH` | 1280×720 | 960×540 (전체화면 팝업만 원본 재요청) |
| 7 | Cloud Run 배포 env | `YOLO_IMGSZ=800,PLAYBACK_FPS=6` | `YOLO_MODEL=yolo11n.pt,YOLO_IMGSZ=640,DISPLAY_FPS=15,DETECT_FPS=5` (OMP/MKL=1 **유지**) |

> `OMP_NUM_THREADS=1`·`MKL_NUM_THREADS=1` 는 429 방지의 핵심이므로 **건드리지 않는다.**

### 4.3 체크리스트

- [ ] YOLO11n 가중치 재취득 — `python -c "from ultralytics import YOLO; YOLO('yolo11n.pt')"` → `yolo11n.pt`
- [ ] `_object_worker` 를 표시/탐지 분리 구조로 재작성(CAM-03 `_ppe_live` 패턴 참조)
- [ ] `FPS`→`DISPLAY_FPS`(15), `PLAYBACK_FPS`→`DETECT_FPS`(5) env 정리
- [ ] `YOLO_MODEL` 기본값 `yolo11n.pt`, `YOLO_IMGSZ` 기본값 640
- [ ] 로컬 벤치 — 실제 표시 fps·탐지 fps·CPU 사용률·`/cctv/stats` fps 확인
- [ ] (선택) 출력 960×540 적용 시 대시보드 타일·팝업 확인
- [ ] `/verify` (typecheck·lint·test) — 대시보드 계약(`/cctv/stream`·`/cctv/stats`) 불변 확인
- [ ] `/deploy` — 라이브 200 + MJPEG 프레임 갱신 육안 확인

### 4.4 검증 기준 (성공 조건)

- 스트림이 **15fps로 새 프레임**을 밀고(중복 아님), 움직임이 6fps 대비 매끄럽다.
- `/cctv/stats` 의 `fps` 가 탐지 cadence(~5) 근처로 안정.
- 대시보드 MJPEG + 폰 override 동시 구동 시 **429 없음**(CPU 여유 유지).
- `/cctv/stream`·`/cctv/stats` 응답 계약 불변(대시보드 무수정).

### 4.5 CPU 예산 확인

640×5fps 는 800×6fps 대비 추론 부하 **약 0.53배**(해상도 0.64 × 빈도 0.83). 표시를 15fps로 올려도(표시 루프는 디코드+캐시 그리기+인코딩으로 추론 대비 저렴) 단일 인스턴스 예산 안. YOLO11n 전환으로 여유 추가.

---

## 5. Phase 2 — Jetson Orin Nano 엣지 GPU (DETR 검토)

### 5.1 핵심 판정

GPU가 있으면 DETR이 **가능은 하다.** 단 세 단서.
1. **순정 DETR(DETR-R50)은 부적합** — Orin Nano는 엔트리 tier(1024 CUDA·8GB 공유·40~67 TOPS). 순정은 ~3~6fps + TensorRT 변환 난이도(deformable attention 플러그인).
2. **실시간 DETR(RT-DETR / RF-DETR / D-FINE)** 이면 단일 카메라 실시간 가능.
3. **DETR은 박스 검출기라 낙상(pose)엔 못 쓴다.** DETR 유효 범위 = CAM-01(객체)·CAM-03(PPE)뿐.

### 5.2 타일별 모델 권고

| 타일 | 권고 | 이유 |
|---|---|---|
| **CAM-01 객체** | **RF-DETR-small 또는 RT-DETR-R18** | Nano 실시간·NMS-free 군중 강점·**Roboflow supervision 이미 의존**(정합) |
| **CAM-03 PPE** | 당분간 **YOLO(11 업그레이드)** 유지 | DETR 전환 시 PPE 데이터 **재학습** 필요(기성 DETR PPE 모델 없음) |
| **CAM-02 낙상** | **YOLO11n-pose 유지** | DETR은 keypoint 미지원 — 대체 불가 |

즉 "전부 DETR"이 아니라 **객체 타일 하나만 RF-DETR로 승격**이 실익 최대.

### 5.3 Orin Nano 실현 가능성 (TensorRT FP16·640·단일 스트림·근사치)

| 모델 | 계열 | 대략 FPS | COCO mAP | 판정 |
|---|---|---|---|---|
| YOLO11n(낙상용) | CNN | ~120–200 | 39.5 | 여유 |
| RF-DETR-small | 실시간 DETR | ~20–40 | ~48 | ✅ |
| RT-DETR-R18 | 실시간 DETR | ~20–35 | 46.5 | ✅ |
| D-FINE-S | 실시간 DETR | ~20–30 | ~48 | ✅ |
| RT-DETR-R50 | 실시간 DETR | ~8–14 | 53.1 | △ |
| DETR-R50(순정) | Transformer | ~3–6 | 42.0 | ❌ |

수치는 T4 공개 벤치를 Nano GPU 비율(≈T4의 1/5~1/6)로 스케일한 **근사치** — 기기 `trtexec` 실측 필수. JetPack 6.1+ "Super" 모드(40→67 TOPS)면 ~1.5~1.7배 상향.

### 5.4 Jetson 실전 함정

- **8GB 공유메모리 동시 모델 경합** — 낙상(pose) + PPE + 객체(DETR) 를 한 Nano에서 동시 구동 시 GPU·메모리 경합. **실질 상한은 FPS가 아니라 동시 모델 수.**
- **INT8 금물, FP16 권장** — Transformer는 INT8 양자화에 민감(YOLO는 INT8 무난).
- **PPE DETR = 재학습 비용** — Hexmon PPE 는 YOLOv8m 파인튠. DETR 전환은 PPE 데이터 학습 필요.
- **순정/Deformable DETR TensorRT 플러그인** — RT-DETR/RF-DETR/D-FINE 은 ONNX→TensorRT 경로 정비돼 이 마찰 없음.

### 5.5 체크리스트 (벤치 중심)

- [ ] Orin Nano 메모리(**4GB/8GB**)·JetPack("Super" 여부) 확인
- [ ] RF-DETR-small·RT-DETR-R18 을 ONNX→TensorRT FP16 export
- [ ] `trtexec` 단일 스트림 FPS 측정(640)
- [ ] 낙상 pose와 **동시 구동** 시 메모리·FPS 저하 측정
- [ ] 엣지 추론 결과를 기존 push 계약(`/cctv/ingest2·3`)에 맞춰 전송 확인
- [ ] (객체 DETR 채택 시) COCO 사전학습 → 현장 도메인 파인튠 여부 결정

---

## 6. 리스크·주의

- Phase 1 `_object_worker` 재작성은 **대시보드 계약을 깨지 않아야** 한다(`/cctv/stream`·`/cctv/stats` 형식 불변).
- 출력 해상도 하향(960×540)은 멀티창엔 이득이나 전체화면 팝업 화질 저하 — 팝업만 원본 재요청 분기 필요.
- Phase 2 수치는 전부 근사치 — **실측 전 확정 금지**(harness L-08 정신·메모리·처리량은 실측으로).
- 엣지 전환은 발표자료 로드맵 항목(`발표자료:432` GPU 추론)과 정합 — 낙상 엣지 추론은 이미 가동 중이므로 동시 모델 예산을 우선 확인.

---

## 7. 열린 질문 (결정 필요)

1. DETR 적용 대상이 **CAM-01 객체 타일**인가, **PPE까지** 포함인가.
2. Orin Nano가 **4GB인가 8GB인가**(동시 모델 상한이 갈림).
3. Phase 1(부드러움)을 **먼저 배포**하고 Phase 2(엣지)를 별도로 갈 것인가, 엣지 전환에 통합할 것인가.

---

## 8. 근거 파일

- `main.py:33`(FPS)·`:38`(PLAYBACK_FPS)·`:40`(IMGSZ)·`:41`(출력해상도)·`:192-282`(`_object_worker`)·`:106-109`(`_ppe_live` 분리 패턴)·`:528-541`(mjpeg 스트림)
- `README.md` — CAM-01/02/03 구성·엔드포인트 계약·배포 절차
- `발표자료/VitAlGuard-기술스택-발표자료.md:370·432` — Jetson Orin Nano 엣지·GPU 추론 로드맵
