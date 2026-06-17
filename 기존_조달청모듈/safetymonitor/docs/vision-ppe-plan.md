# 비전 PoC 계획 — GoPro + supervision 안전모 검출 · 낙상 보강

> **⏸ 상태 = 보류 (2026-06-08)** — **GoPro 장비 미보유**. 장비(HERO9 + USB-C 케이블 + microSD) 준비되면 착수 예정. 본 문서는 *청사진·전제만 확정*하고 **코드·의존성 설치는 미착수**. 장비 확보 시 §6 체크리스트부터 진행.

> 작성 2026-06-08(세션27). 결정 = **발표(2026-07-07) 데모에 PoC 포함** · 입력 = **GoPro HERO9 웹캠(USB)** · 구동 = **발표 PC(macOS) 로컬 CPU 실시간**.
> (★ Colab 미사용 — 클라우드 런타임은 로컬 USB 웹캠에 직접 접근 불가. 안전모는 가벼운 모델이라 로컬 CPU 실시간으로 충분. Colab GPU 는 자체 모델 학습 시 발표 후 활용.)
> 목적 = ① 작업자 안전모 착용 여부 검출 ② 워치 낙상 오탐 감소(영상 융합/라벨링) ③ 추가 안전 기능.
> 본 문서는 *무엇을 어떻게* 만들지의 청사진. *왜* 의 결정 근거는 [context-notes.md](./context-notes.md), 진척은 [progress.md](./progress.md).

---

## 0. 핵심 사실 (조사 확인)

- **supervision 0.28.0**(2026-04-30, Python ≥ 3.9, MIT)은 **검출 모델이 아니라 후처리 라이브러리**다. 객체검출은 별도 모델(YOLO/Roboflow Inference)이 하고, supervision은 그 출력을 **annotate·track(ByteTrack)·zone·line·keypoint** 로 다룬다. → 실제 스택 = **검출 모델 + supervision**.
- **GoPro 웹캠 모드(USB-C) 지연 ~0.5초** — CV 입력 중 최선(RTMP 무선은 2~13초). **HERO9 지원**(GoPro Webcam 유틸 macOS 10.14+ 필요, 유선 전용).
- **★ macOS 캡처 주의** — GoPro Webcam 유틸의 가상 카메라를 OpenCV 가 직접 잡는 건 불안정(High 프리셋 블랙·Device ID 연결마다 리셋). 안정 경로 = **GoPro Webcam → OBS Studio → OBS Virtual Camera → OpenCV**. 폴백 = **녹화 파일 분석**(파일 입력은 100% 안정).
- **정책 변경** — CLAUDE.md "의도적 비범위"의 *영상(CCTV) 통합 = 2차* + *ML = 2차* 를 본 PoC에 한해 발표 범위로 승격(사용자 결정 2026-06-08). 비범위 항목 갱신 필요.

## 1. 범위

### 발표 데모 (07-07) — IN
- GoPro 웹캠 1대 실시간 입력 → 안전모 **착용/미착용** 검출 → 미착용 시 대시보드 알림.
- 검출 박스·라벨 시각화(supervision annotator) 화면.
- 기존 **통합 안전 신호등**(세션19)에 "PPE(보호구)" 램프 1개 추가로 흡수.

### 발표 데모 — OUT(로드맵 언급만)
- 낙상 영상 실시간 융합(PoC는 **오프라인 라벨링**으로 시작 — §4).
- 다수 카메라·고정 IP캠·zone/인원 집계(추가 기능 §5).
- 자체 모델 학습(PoC는 **사전학습 모델** 사용 — 학습 0).

## 2. 아키텍처

```
GoPro (USB-C 웹캠, ~0.5s)
  → [Python 비전 서비스]  apps/vision-ppe/  (신규, 기존 TS/Flutter 스택과 분리)
       OpenCV 웹캠 캡처 → YOLO(사전학습 hardhat 모델) 추론 → supervision 후처리
       (박스·라벨·미착용 카운트, ByteTrack 로 작업자 추적해 중복 알림 억제)
  → 검출 이벤트 POST  →  dashboard-web  /api/vision-event  (신규)
       { type: "ppe_violation", cls: "no-hardhat", count, ts, camera }
  → store + alerts 테이블(세션20) + 통합 안전 신호등 PPE 램프(세션19)
```

- **기존 스택 무영향** — Python 서비스는 독립 디렉터리. 대시보드는 신규 엔드포인트 1개만 추가(폰/워치 무변경).
- **이벤트 모델 재사용** — 헬멧 미착용을 `/api/mock/vital` 의 SOS/낙상과 동일한 alerts/신호등 경로로 흘려 추가 UI 최소화.

## 3. 안전모 검출 (발표 핵심)

- **모델** — Roboflow Universe 의 `hard hat`/PPE 사전학습 YOLO 모델 다운로드 → **로컬 추론(ultralytics)**. 인터넷/쿼터 의존 0, 비용 0. (대안 = Roboflow Hosted Inference API — 쿼터·지연 있어 PoC 비권장.)
- **클래스** — `hardhat` / `no-hardhat`(+`person`). 미착용 = `no-hardhat` 박스 존재.
- **supervision 역할** — `BoxAnnotator`/`LabelAnnotator` 시각화 · `ByteTrack` 로 같은 작업자 추적(미착용 1회만 알림) · (선택) `PolygonZone` 으로 작업구역 안 미착용만 집계.
- **알림 게이팅** — N프레임 연속 미착용 시에만 이벤트(단일 프레임 오검출 억제). 동일 트랙 5분 dedup(기존 알림 정책과 일치).
- **추론** — ultralytics 로 사전학습 YOLO-nano(`yolov8n`/`yolo11n` 급) 로컬 CPU 실행. 안전모는 즉시성 낮아 CPU 수~십 fps + 웹캠 0.5초 지연으로 데모 충분(GPU 불필요).

### macOS 입력 경로 (확정)

```
GoPro HERO9 (USB) → GoPro Webcam 유틸(가상 카메라)
  → OBS Studio 소스로 추가 → OBS Virtual Camera 출력
  → OpenCV cv2.VideoCapture(가상캠 인덱스)
폴백: GoPro 녹화 .mp4 → cv2.VideoCapture(파일 경로)  ← 캡처 불안정 시 발표는 녹화로
```

- 스캐폴드는 **입력 소스를 추상화**(웹캠 인덱스 / OBS 가상캠 / 파일 경로 모두 인자) → 셋업 불확실성 흡수.
- OBS 프리셋은 High 회피(블랙스크린), Device ID 리셋이라 연결 때마다 OBS 소스 재선택 필요.

## 4. 낙상 오차율 감소 (융합/라벨링)

- **PoC(발표) = 오프라인 라벨링** — GoPro 녹화 영상으로 세션22 [fall-ml-plan.md](./fall-ml-plan.md) 의 워치 낙상 후보(양성/음성)를 "실제 낙상 vs 오탐"으로 사람이 정확 라벨 → 라벨 품질↑ → 트랙A 임계 최적화 정확도↑. **오차율 감소에 가장 직접적**.
- **상용화(발표 후) = 실시간 융합** — YOLO-pose 자세(누움/급변) + 워치 가속도 **둘 다 양성일 때만 낙상 확정** → 오탐↓. supervision 은 keypoint 시각화 담당. 카메라 사각지대는 워치 단독 폴백.

## 5. 추가 기능 (supervision 으로 확장, 발표 후)

- **위험구역 침입/체류** — `PolygonZone` + dwell time(크레인 반경·추락위험 개구부).
- **출입 인원 집계** — `LineZone`(출입구 통과 카운트).
- **인원 대비 착용률** — ByteTrack 인원 추적 + 미착용 비율.
- **기타 PPE** — 안전화·안전벨트·보안경(데이터셋/모델 따라).
- **동선 heatmap** — 체류 분석.

## 6. 체크리스트

- [ ] **(선행·블로커) GoPro 장비 확보** — HERO9 + USB-C 케이블 + microSD. **현재 미보유 → 이후 단계 보류**
- [x] 전제 확정 — HERO9 / 발표 PC macOS·로컬 CPU(GPU 없음·Colab 미사용) / Python 3.9+ OK / 사전학습 모델이라 학습용 Roboflow 계정 불요
- [ ] 의존성 사전 합의 — `ultralytics`(YOLO) · `supervision` · `opencv-python`(신규 Python deps, 기존 pnpm/Flutter 와 분리)
- [ ] `apps/vision-ppe/` 스캐폴드 — 웹캠 캡처 → 추론 → supervision annotate(화면 표시) 오프라인 동작
- [ ] hardhat 사전학습 모델 선정·로컬 추론 검증(샘플 영상/웹캠으로 착용·미착용 검출 확인)
- [ ] 알림 게이팅(N프레임 연속 + 트랙 dedup) 구현
- [ ] dashboard `/api/vision-event` + 통합 신호등 PPE 램프 + alerts 연동
- [ ] GoPro 웹캠 USB 실시간 end-to-end(검출 → 대시보드 알림) 데모 검증
- [ ] 낙상 — GoPro 녹화로 세션22 fall 후보 라벨링 1회(트랙A 데이터 보강)
- [ ] CLAUDE.md 비범위 정책 갱신(영상/ML PoC 발표 범위 승격) + 발표 슬라이드 로드맵 항목

## 7. 전제·리스크 (확인 필요 = 추정)

- **GPU(확정)** — 발표 = **로컬 CPU 실시간**(GPU 없음). YOLO-nano + 필요 시 프레임 다운샘플로 데모. Colab GPU 는 자체 학습 시 발표 후.
- **GoPro 모델(확정)** — **HERO9** 웹캠 모드 OK. macOS 캡처는 OBS Virtual Camera 경유(§3), 불안정 시 녹화 파일 폴백.
- **★ macOS 캡처 검증이 1번 블로커** — GoPro Webcam→OBS→가상캠→OpenCV 체인이 발표 PC에서 실제로 프레임을 주는지 가장 먼저 확인. 안 되면 즉시 녹화 파일 데모로 전환.
- **지연** — 웹캠 0.5초 + 추론 시간. 안전모는 즉시성 요구 낮아 무방. 낙상 실시간 융합은 지연 민감 → 발표 후.
- **일정** — 새 Python 서비스 + 통합은 비자명 작업. 07-07 까지 **안전모 단일 기능**에 집중, 낙상 융합·추가기능은 로드맵.
- **모델 정확도** — 사전학습 hardhat 모델은 현장 조명/각도/한국 안전모 색상에 오검출 가능. 데모 환경 사전 튜닝 필요(임계·각도).
- **비용** — 로컬 추론이면 0. Roboflow Hosted 쓰면 쿼터/요금 확인.
- **개인정보** — 영상은 생체보다 민감. 발표는 동의된 시연자 한정, 저장·전송 정책은 상용화 시 별도 설계(CLAUDE.md 개인정보 원칙 연장).
