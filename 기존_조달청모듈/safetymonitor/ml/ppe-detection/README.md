# PPE 탐지(yolo26) 성능 테스트 — 상용화 전 단계

CCTV 엣지에서 안전모·안전조끼·안전화 착용 여부를 판정하기 위한 모델 학습·평가 트랙.
현행 라이브 모델(CAM-03 Hexmon `vyra_ppe.pt`)을 **교체할 수 있는지** 숫자로 판정하는 것이 목적이다.

- 계획·결정 근거 → [context-notes.md](context-notes.md)
- 진행 체크박스 → [checklist.md](checklist.md)
- 학습 노트북 → [ppe_yolo26_colab.ipynb](ppe_yolo26_colab.ipynb) (코랩)

## 통합 클래스

```
0 person   1 head   2 helmet   3 safety_vest
4 foot     5 shoes  6 hands    7 gloves
```

미착용(`NO-Hardhat` 등)을 별도 클래스로 두지 않는다. `head`(맨머리)를 탐지하고 person 박스와의
포함관계로 코드에서 판정한다 — 미착용은 시각적 객체가 아니라 부정이라 클래스로 두면 각도·가림에 따라
깜빡인다. 부수 효과로 CSS 데이터셋의 `NO-Hardhat` 라벨을 `head` 로 흡수해 데이터를 살린다.

## 데이터셋

| 데이터셋 | 규모 | 제공 클래스 | 라이선스 | 상용 반입 |
|---|---|---|---|---|
| SH17 | 8,099장 / 75,994 인스턴스 | 17종(안전화 `Shoes` 포함) | CC BY-NC-SA 4.0 | **불가** |
| Construction Site Safety | 수천 장 | 10종(Hardhat/NO-Hardhat/Vest/Person 등) | CC BY 4.0 | 가능 |
| AI Hub 건설현장 안전장비 | 국내 현장 | 안전모·안전화·안전대 중심 | 국내 승인 절차 | 확인 필요 |

**SH17 은 이 단계 한정**이다. 학습 산출 가중치에는 `-nc` 접미사가 자동으로 붙는다(`USE_SH17` 플래그).
상용화 시에는 데이터만 교체해 재학습하면 되도록 스크립트를 만들어 두었다.

안전화 주의 — SH17 의 `Shoes` 는 신발 일반이라 안전화/운동화를 구분하지 않는다. 이 단계 목표는
**원거리 화각에서 발·신발이 애초에 잡히는지** 확인해 국내 재라벨링 투자 가치를 판단하는 것까지다.

## 평가 — 3층 지표

프레임 단위 mAP만 보면 현장에서 배신당한다.

1. **검출** — 클래스별 mAP50-95, precision 0.9 고정 시 recall. 소형 객체(shoes·gloves) 별도 집계.
2. **착용 판정** — `judge_ppe()` 로 person↔helmet/vest 매칭 후 정확도. 검출이 좋아도 여기서 깨진다.
3. **이벤트** — 관제로 올라가는 건 프레임이 아니라 알림이다. "N프레임 연속 위반 시 1건" 게이트를
   먼저 정의하고 **시간당 오탐 건수**를 측정한다. 현장 영상 확보 후 가능.

## ⚠️ 배포 타깃 제약 — Jetson Orin Nano 4GB (실사용 3.5GB)

이 트랙의 결론을 좌우하는 것은 정확도가 아니라 **메모리**다.

### 하드웨어 사실

| 항목 | 값 | 함의 |
|---|---|---|
| 메모리 | 4GB LPDDR5 **CPU·GPU 공유** | 3.5GB 안에 OS·ROS2·카메라·추론이 전부 들어가야 한다 |
| 대역폭 | **34 GB/s** (8GB 모델은 68) | 공개 벤치마크 대비 체감 성능이 낮다 |
| GPU | 512 CUDA / 16 Tensor, 20 TOPS INT8 | |
| DLA | **없음**(추정 — 아래 명령으로 확정할 것) | GPU 오프로딩 불가 |
| 전력 모드 | 7W / 15W | |

공개된 "Jetson Orin Nano" YOLO 벤치마크는 거의 전부 **8GB(Super)** 기준이다. 4GB 는 대역폭이 절반이라
그 수치를 그대로 기대하면 안 된다.

DLA 확정(기기에서 한 줄) — 출력이 없으면 DLA 없음.

```bash
ls /dev/nvhost-nvdla* 2>/dev/null; sudo dmesg | grep -i nvdla
```

### 메모리 예산부터 재라

모델을 고르기 전에 **남는 메모리가 얼마인지** 먼저 측정한다. 이 젯슨은 ROS2 + Orbbec + 푸셔가 이미 돈다.

```bash
# 평상시(카메라 파이프라인 가동 중) 여유 메모리
free -h
tegrastats --interval 1000 | head -20   # RAM x/3956MB 항목
```

### 권장 — yolo26m 은 상한 측정용, 배포 후보는 s 부터

| 모델 | 학습 | 젯슨 4GB 배포 | 비고 |
|---|---|---|---|
| yolo26n | ○ | 여유 | 640~960 모두 무난 |
| **yolo26s** | ○ | **현실적 후보** | 960 도 단독이면 가능성 있음 |
| yolo26m | ○ (코랩은 문제없음) | **위험** | 960 24/7 은 비권장. 640 이라도 실측 필수 |

노트북 기본값은 `yolo26s` 로 두었다. 요청하신 `yolo26m` 은 **정확도 상한을 재는 용도**로 함께 학습해
"m 이 s 보다 얼마나 나은가"를 확인하고, 그 차이가 메모리 리스크를 감수할 만한지 데이터로 결정한다.
코랩 학습 자체는 m 도 전혀 문제없다 — 제약은 배포 쪽에만 있다.

### 2단계 파이프라인은 여기서 재검토

앞서 원거리 CCTV에 person 크롭 2단계를 권했지만, **4GB 에서는 엔진 두 개가 동시에 상주**해
메모리 관점에서 불리해질 수 있다. 1단계 단일 모델과 실측 비교해 정하는 것이 맞다.

### 엔진 변환이 추론보다 메모리를 더 먹는다

TensorRT 엔진 빌드는 추론보다 훨씬 메모리를 쓴다. 4GB에서 스왑 없이 빌드하면 OOM 으로 죽을 가능성이 높다.

```bash
# 1) 스왑 확보 (엔진 빌드 전 1회)
sudo systemctl disable nvzramconfig || true
sudo fallocate -l 16G /var/swapfile && sudo chmod 600 /var/swapfile
sudo mkswap /var/swapfile && sudo swapon /var/swapfile

# 2) 데스크톱 GUI 끄기 — 약 0.8GB 확보
sudo systemctl set-default multi-user.target && sudo reboot

# 3) 다른 워크로드 내리고 변환
pkill -f orbbec_cctv_push.py; pkill -f dash_push.py
sudo nvpmodel -m 0 && sudo jetson_clocks
python3 -c "from ultralytics import YOLO; \
  YOLO('ppe_yolo26s_960_nc.pt').export(format='engine', half=True, imgsz=960, workspace=2)"
```

엔진은 **그 기기 그 TensorRT 버전 전용**이라 다른 기기로 복사할 수 없다. 코랩에서 만든 엔진도 못 쓴다.

### 안 들어가면 — 서버 추론 유지가 정답일 수 있다

현재 아키텍처는 이미 **젯슨이 raw 프레임을 푸시하고 Cloud Run 이 PPE 추론**을 한다
(`cctv-ai` CAM-03). 젯슨 4GB에 yolo26m 이 안 들어간다면 그건 실패가 아니라
**현행 분담이 이미 옳았다**는 뜻이다. 다만 Cloud Run 단일 인스턴스는 서버 추론 1개가 한계라
(2개면 429) 낙상까지 서버로 올릴 수는 없다.

판단 갈래는 이렇다.

- 젯슨에 들어간다 → 엣지 추론으로 옮겨 Cloud Run CPU·과금을 던다.
- 안 들어간다 → 서버 추론 유지, 젯슨은 푸셔 역할. 대신 **모델 경량화(n/s + INT8)** 로 재도전.

## 실행

```
코랩에서 ppe_yolo26_colab.ipynb 열기 → 런타임을 GPU 로 변경 → 위에서부터 순서대로
```

필요한 계정 — Kaggle(SH17), Roboflow(CSS). 둘 중 하나만 있어도 파이프라인은 돈다.

**4번 셀 출력(디렉터리 구조·클래스 순서)을 반드시 눈으로 확인할 것.** 데이터셋 배포본은 버전마다
레이아웃이 달라서, 리매핑은 인덱스가 아니라 이름으로 하되 원본 `names` 를 그때그때 읽어 해석한다.

## 검증됨

리매핑·수집·착용판정 로직은 합성 데이터로 43건 단위검증을 통과했다(클래스명 표기 변형 흡수,
매핑 외 클래스 제외, 빈 라벨 이미지 제외, 분할 결정성, 헬멧 귀속·오귀속 배제, 위반 집계).

## 다음

- 학습 완료 → 현행 `vyra_ppe.pt` 와 같은 홀드아웃에서 비교
- 젯슨 실측(메모리·정상상태 FPS) → 배포 가능 모델 확정
- **shadow 모드** — 현행·신규 동시 추론 로깅 비교 후 교체(낙상 트랙과 동일 원칙, 단독 배포 금지)
