# 실행 가이드 — PPE 학습·성능 테스트

**최종 갱신 2026-07-30 · 4차 게이트 통과 · 도메인 얽힘 발견 · 5차 노트북 준비 완료 → 학습 실행 대기**

**팀원과 교대로 돌린다면 [RUNBOOK-5차-협업.md](RUNBOOK-5차-협업.md) 를 먼저 읽을 것** — 동시 실행은 체크포인트를 조용히 망가뜨린다.

이 문서만 보고 진행할 수 있게 썼다. 배경·근거는 [README.md](README.md)·[context-notes.md](context-notes.md),
전체 경과는 [docs/ppe-ml-run-20260729.md](../../docs/ppe-ml-run-20260729.md), 진행 체크는 [checklist.md](checklist.md).

---

## ★ 지금 할 일

**4차는 판정 게이트를 통과했다**(`R 0.941 @ P 0.999` · `head P 0.800`).
젯슨 엔진 변환·라이브 반영도 끝났다. 남은 것은 하나다.

1. **★ 5차 학습 — 도메인 얽힘 해소**
   GoPro 로 학습 스케일을 맞춰도 `head` 0건이었다. 원인은 스케일이 아니라
   **클래스마다 학습 도메인이 갈린 것**이다(E63 장면 `person` 0 · 사무실 `head` 0).
   ```python
   SH17_HEAD_FILTER  = True   # helmet 과 겹치지 않는 head 만 (약 20% 잔존)
   E63_PERSON_PSEUDO = True   # E63 에 person 자동 라벨
   HHW_FRACTION      = 0.45   # helmet recall 복원
   scale             = 0.7
   ```
2. 현행 `vyra_ppe.pt` 대비 비교 — **5차 이후에**
3. 사진 30장 (도메인이 다른 시험지)

---

## 확정된 것 (다시 읽지 않아도 되게)

- **목표** — 현행 라이브 모델(CAM-03 Hexmon `vyra_ppe.pt`)을 **교체할 수 있는지** 숫자로 판정
- **클래스 8종** — `person head helmet safety_vest foot shoes hands gloves`
  미착용은 클래스로 두지 않고 `head`(맨머리) 검출로 코드 판정
- **★ 젯슨 배포 판정 = 완결** — 파이프라인 켠 상태 **70.7 fps**(최저 61.1) · RAM 여유 2.2GB
- **★ 3차 엔진이 젯슨에 상주** — `ppe_yolo26s_640_v3_nc.engine`. 4차는 `.pt` 만 올리면 된다
- **★ 관제웹 라이브 경로 완성** — 아이폰 → 젯슨(우리 모델 추론) → Cloud Run(표시만) → CAM-03.
  절차·한계는 [cctv-ai/README.md](../../cctv-ai/README.md), 소스는 `cctv-ai/edge/phone_ppe_relay.py`
- **비상업 데이터 포함** — 산출 가중치에 `_nc` 가 자동으로 붙는다. 상용 빌드 반입 금지
- **엔진 변환은 젯슨에서만** — 코랩에서 만든 `.engine` 은 못 쓴다

## 지금까지의 결론

| 차수 | 핵심 변경 | 결과 |
|---|---|---|
| 1차 | SH17 0.5 + CSS | mAP50 0.677 · **교차 홀드아웃 head P 0.181 → 실패** |
| 2차 | (미실행 — 3차로 통합) | — |
| 3차 | HHW + AI Hub E63 편입, `1:3.2 → 1:0.75` | **helmet R 0.633 → 0.821 (목표 달성)** · 홀드아웃 소진 |
| 4차 | SH17 head·helmet **전면 제거** + 시퀀스 홀드아웃 예약 | **게이트 통과**(`head P 0.800` · 알림 `R 0.941 @ P 0.999`)<br>⚠️ 단 E63 도메인 밖에서 `head` 0건 |
| 5차 | SH17 head **선별 부활** + E63 person 자동 라벨 + HHW 0.45 + scale 0.8 | 노트북 완성 · **학습 실행 대기** |

### 왜 4차인가 — 라벨 의미 충돌

3차에서 균형을 뒤집었는데도 인도메인 helmet 지표가 평가 대상에 따라 4배 차이 났다.

```
전체 val (1,906장)   helmet P 0.813
sh17+css (408장)     helmet P 0.219
```

조사 결과 **SH17만 `head` 와 `helmet` 을 같은 머리에 동시에 붙인다**(겹침 78.2%,
다른 셋은 0~0.7%). 박스 정의도 달라 서로를 오탐·미탐으로 만든다.

**1차 실패의 진짜 원인이 개수 불균형이 아니라 이것일 수 있다.**
→ 4차가 이걸 고쳐 `head P 0.181 → 0.800` 이 됐으니 **확정됐다.**

### 왜 5차인가 — 전면 제거가 도메인 다양성까지 버렸다

4차는 라벨 충돌을 없앴지만 SH17(근접 인물 사진 = 큰 머리·일반 환경)을 통째로 빼면서
**근거리·비-CCTV 환경의 머리 학습 데이터까지 함께 버렸다.** 그 결과

```
E63 실이미지   head 1 · person 0    (크기 0.049~0.073 = 학습 분포 안)
GoPro 사무실   head 0 · person 6~7
conf 0.01(무제한) 에서도 head 0    → 임계·스케일 문제가 아니다
```

클래스마다 학습 출처가 갈려 **클래스가 장면 유형에 묶였다**(도메인 얽힘).
`person` = SH17+CSS(일반 인물) / `head`·`helmet` = E63 주력(전기설비 공사현장 CCTV).
E63 엔 `person` 라벨이 아예 없어 그 장면에서 person 을 찾지도 않는다.

5차는 **전면 제거 대신 선별**로 되돌린다 — `helmet` 과 겹치지 않는 `head` 는 그 자체로
"안전모 안 쓴 머리" 라 라벨 충돌 없이 도메인 다양성만 가져온다. 여기에 E63·HHW
`train` 분할에 `person` 자동 라벨을 넣어 작업자별 판정을 복원한다.

---

## 5차 실행 절차

### 준비물

- Kaggle **API 토큰 문자열** (`kaggle.com/settings` → API → Create New Token, **한 번만** 표시)
- Roboflow API 키 (CSS·HHW 두 번 입력)
- Drive `vitalguard-ppe/datasets/e63_yolo.tar` (2.06GB, 이미 업로드됨)
- 코랩 GPU 런타임

### 순서

`ppe_yolo26_colab_v5.ipynb` 를 코랩에서 열고 **맨 위부터 순서대로** 실행한다.
**팀원 계정에서 돌린다면 노트북 0절(공유·바로가기·본인 API 키)을 먼저 처리한다.**

| 단계 | 셀 | 소요 |
|---|---|---|
| 1 | 런타임 확인 · `%pip install` | 2분 |
| 2 | 설정 (Drive 마운트 · GPU 자동 튜닝) | 1분 |
| 3 | SH17 (Kaggle) | 5~10분 |
| 4 | CSS · HHW (Roboflow) | 3~6분 |
| 5 | 리매핑 + E63 tar 해제 + **홀드아웃 예약** | 10~15분 |
| 6 | **학습** | GPU 따라 2~10시간 |
| 7 | 공정 평가 (`fair_eval`) | 5분 |
| 8 | 2층 착용 판정 (`bare_head_eval`) | 3분 |
| 9 | **예약 홀드아웃 평가 + 임계 스윕** | 10분 |
| 10 | 기준선 비교 · 내보내기 | 10분 |

### 학습 시간 — GPU가 지배한다

| GPU | batch/workers (자동) | 에포크당 | 30에포크 | 단위 |
|---|---|---|---|---|
| **A100** | 64 / 8 | 약 3.6분 | 약 1.8시간 | 20~40 |
| **T4** | 16 / 2 | 약 20.5분 | **약 10.3시간** | 약 11 |

**노트북이 GPU를 감지해 자동으로 맞춘다.** 손댈 곳이 없다.

⚠️ T4는 A100의 약 3배 느리다(3차 A100 1.882시간, 4차 T4 10.3시간이 실측).
급하지 않으면 T4로 밤새 돌리는 편이 단위 효율이 3배 좋다.

---

## 확인 포인트

### ① 설정 셀 — GPU 자동 튜닝

```
GPU  : NVIDIA A100-SXM4-40GB · CPU 12코어 → batch 64 · workers 8
```

`batch 16 · workers 2` 로 나오면 T4다(정상, 시간만 오래 걸림).

### ② 리매핑 직후 — 두 줄

```
   ★ SH17 필터 — 안전모 쓴 머리 제외 N · helmet 박스 제외 M
시퀀스 43개 중 12개를 홀드아웃으로 예약
★ helmet : head = 1 : 0.5~0.7
```

**비율이 0.5~0.7이면 정상**(4차 0.69 · HHW 복원과 SH17 head 선별이 함께 반영된 값).
`1:3` 대면 E63·HHW 편입이 안 된 것이니 멈추고 확인한다.

`★ SH17 필터` 줄이 **안 보이면 SH17 head 선별이 동작하지 않은 것**이다
(`SH17_HEAD_FILTER` 확인). 제외 건수가 0 이면 매핑이 빠진 것이니 멈춘다.

이어서 자동 라벨 셀이 이렇게 찍는다.

```
person 자동 라벨 대상 N장 (train 분할·person 라벨 없는 것만 · conf 0.5)
★ person 라벨 M개 추가 · 이미지 K장
=== 5차 최종 클래스별 인스턴스 (train+val · 자동 라벨 포함) ===
```

**`person` 총량이 4차보다 크게 늘어야 한다.** 안 늘면 대상이 0장이었다는 뜻이다.

### ③ 홀드아웃 구성 — 누수 검사

```
홀드아웃 시퀀스 12개 → 2,166장 (학습 미노출)
  누수 검사: 통과 (학습셋과 교집합 0)
```

`assert` 로 강제하므로 통과하지 못하면 자동으로 멈춘다.

### ④ 학습 중

- **화면의 ETA(`n:nn<n:nn`)는 무시할 것.** 순간 속도라 실제보다 빠르게 나온다
- 표기 단위를 확인한다 — **`1.3s/it`(반복당 초)와 `1.3it/s`(초당 반복)는 4배 차이**다
- 완료된 에포크의 실제 소요로만 판단한다
- 모자이크는 마지막 10에포크에서 꺼진다(`close_mosaic=10`). **이 구간에서 지표가 가장 많이 오른다**

### ⑤ 공정 평가 — 5차 성공 조건

```
helmet R ≥ 0.70   ← 4차 0.433 의 복원이 핵심
head P·R 유지     ← 4차 0.754 / 0.677 에서 회귀하면 실패
foot·shoes 는 여전히 데이터 부족(참고만)
```

`fair_eval` 이 클래스마다 **그 클래스를 라벨링한 출처에서만** 평가한다.

### ⑥ 예약 홀드아웃 — ★ 최종 판정

| head P | 판정 |
|---|---|
| **0.70 이상** | 통과 — 젯슨 변환 진행 |
| 0.4 ~ 0.7 | 방향은 맞음 — 추가 학습 |
| 0.3 이하 | 원인 재분석 필요 |

이어서 **2층 게이트**를 본다.

```
안전모 미착용 알림  recall >= 0.90 @ precision >= 0.85
```

임계 스윕 셀이 운영에 쓸 `conf` 값을 골라준다.

---

## 막혔을 때

| 증상 | 대응 |
|---|---|
| `You must authenticate ... NameError: exit` | kaggle 인증. **v4·v5는 고쳐져 있다**. 옛 노트북이면 자격증명을 먼저 만들 것 |
| `ModuleNotFoundError` | 셀 순서를 건너뜀. 맨 위 `%pip install` 실행 |
| `NameError: 'rf' is not defined` | **런타임이 회수됨.** 아래 재개 절차 |
| `E63 아카이브 없음` | Drive 동기화 미완. `e63_yolo.tar` 2.06GB 확인 |
| `UnicodeDecodeError 0xa3` | 맥 AppleDouble(`._*`). **v4·v5는 자동 제거한다** |
| `tar: LIBARCHIVE.xattr` 3만 줄 | 무해. **v4·v5는 걸러낸다** |
| `★ SH17 필터` 줄이 안 보임 | `SH17_HEAD_FILTER=False` 이거나 SH17_MAP 에 head 가 없다 |
| `person 자동 라벨 대상 0장` | 리매핑에서 `e63_*`·`hhw_*` 가 train 분할에 없다. ② 출력 확인 |
| 자동 라벨을 다시 돌리고 싶다 | `DATA/.person_pseudo_done` 삭제 후 재실행(이중 추가 방지 마커) |
| `홀드아웃 누수 N장` | 예약 로직 문제. `E63_HOLDOUT_SEQ_RATIO` 확인 |
| `CUDA out of memory` | 설정 셀에서 `BATCH` 를 절반으로. 그래도 나면 `IMGSZ` 640 → 512 |
| 리매핑 후 클래스 0건 | 클래스 이름 불일치. 구조 확인 셀의 `names` 대조 |
| Kaggle 403 | 데이터셋 페이지를 열고 Download 를 눌러 규정 동의 |
| Kaggle 401 | 토큰은 **한 번만** 표시된다. Expire Token 후 재발급 |
| A100을 못 받음 | 자주 있다. T4로 진행하면 노트북이 알아서 맞춘다 |

### 런타임이 죽었을 때 — 재개

**학습 중에는 회수되지 않는다.** 학습이 끝난 뒤 90분 유휴면 회수된다.

| 순서 | 할 것 |
|---|---|
| 1 | `다시 연결` → 런타임 유형이 **원래 고른 것과 같은지** 확인 |
| 2 | `%pip install` 셀 |
| 3 | 설정 셀 — **`RESUME = True` 로만** 변경 (다른 값은 절대 건드리지 말 것) |
| 4 | 데이터 다운로드 셀 (재다운로드 필요) |
| 5 | 리매핑 셀 (해시 기반이라 **동일 재현**) |
| 6 | 학습 셀 → `Resuming training from ... last.pt` 확인 |

완료된 에포크는 Drive 에 남는다. 마지막 미완료 에포크만 손실된다.

**중단하고 결과만 쓸 때는** 평가 전에 이 줄을 실행한다.

```python
best = RUNS / RUN_NAME / 'weights' / 'best.pt'
```

### 이동·절전

- 학습은 구글 서버에서 돈다. **맥이 자도 계산은 계속된다**
- 뚜껑을 닫으면 맥은 잔다. **90분 안에 열면** 된다
- 자리에 있을 때는 `caffeinate -disu -t 72000` (AC 전원 필수)
- **대기 중에는 런타임을 끊는다** — 계산을 안 해도 연결만 되어 있으면 단위가 나간다

---

## 젯슨 작업

젯슨은 **Tailscale 로 원격 접속**된다. 들고 다닐 필요 없다.

```bash
ssh jetson@yahboom-1
```

### 현재 상태 (2026-07-29 확인)

```
ultralytics 8.4.107 · torch 2.5.0a0(NVIDIA) CUDA True · TensorRT 10.7.0
Orin · MAXN_SUPER · 헤드리스(multi-user.target) · 디스크 56GB 여유
ppe_yolo26s_640_v3_nc.{pt,onnx,engine}   ← 3차 배포 산출물 상주
```

**추가 셋업은 필요 없다.** 새 가중치를 올려 변환만 하면 된다.

### 엔진 변환 — 검증된 절차

```bash
# 맥에서
scp <가중치>.pt jetson@yahboom-1:~/

# 젯슨에서
ssh jetson@yahboom-1
sudo jetson_clocks
python3 -c "from ultralytics import YOLO; \
  YOLO('/home/jetson/<가중치>.pt').export(format='engine', half=True, imgsz=640, workspace=2)"
```

약 8분. `Peak memory ... GPU 100 MiB` 처럼 경고 0건이면 정상이다.

⚠️ **GUI 를 켠 채 빌드하면 GPU 가용이 107MB 로 떨어져 최적 커널 931개를 건너뛴다**(가짜 저성능).
현재 기본 타깃이 `multi-user.target`(헤드리스)이라 자동으로 안전하다. GUI 를 켰다면
`sudo systemctl isolate multi-user.target` 후 빌드한다.

### 성능 실측 — 3차 기준

| 조건 | 평균 | 최저 | RAM 여유 |
|---|---|---|---|
| 유휴 | 73.7 fps | 72.1 | 2,533 MB |
| **파이프라인 켬** | **70.7 fps** | **61.1** | **2,179 MB** |

파이프라인 부하 시험은 **로컬 더미 수신부**(`127.0.0.1:8099`)로 돌린다. 클라우드 과금 0이다.

```bash
# 1) 더미 수신부  2) ros2 launch astra_camera astro_pro_plus.launch.xml (ROS_DOMAIN_ID=77)
# 3) CCTV_BASE=http://127.0.0.1:8099 PUSH_FPS=5 RUN_SEC=200 python3 orbbec_cctv_push.py
# 4) 60초 지속 추론  5) 전부 종료
```

푸셔는 `/home/jetson/vg_edge_poc/orbbec_cctv_push.py` 에 있다.

### ⚠️ ultralytics 재설치 시

```bash
pip install -U --no-deps ultralytics    # 올바름
pip install -U ultralytics              # PyPI torch 가 NVIDIA 빌드를 덮어써 CUDA 사망
```

---

## 관제웹 라이브 재기동 (폰 → 젯슨 → CAM-03)

```bash
# ① Cloud Run 켜기 (사용자 직접 실행 — 분류기 차단)
gcloud run services update cctv-ai --region asia-northeast3 \
  --ingress all --min-instances 1 --max-instances 1

# ② 젯슨 릴레이
ssh jetson@yahboom-1
CCTV_BASE=https://cctv-ai-569797426568.asia-northeast3.run.app \
  nohup python3 phone_ppe_relay.py > relay.log 2>&1 &

# ③ 아이폰 사파리 (Tailscale 앱 연결 상태)
#    jetson-1.tailnet.invalid:8443
```

⚠️ **카카오톡 인앱 브라우저는 카메라를 못 쓴다.** 사파리 주소창에 직접 입력할 것.
⚠️ Cloud Run 은 `--min-instances 1 --no-cpu-throttling` 이라 **상시 과금**. 끝나면 반드시 OFF.

```bash
gcloud run services update cctv-ai --region asia-northeast3 \
  --ingress internal --min-instances 0
```

**4차 가중치 반영** — `.pt` 를 젯슨에 올려 엔진 변환 후 `PPE_ENGINE=<새 엔진>` 으로 릴레이를 띄우면
라이브에 즉시 반영된다.

전송은 **약 4.8 fps 가 천장**이다(iOS Safari 타이머 스로틀). PPE 판정에 필요한 3~5회/초에는 충분하다.

---

## GoPro 를 CCTV 대체로 쓰기 (2026-07-30 검증)

아이폰의 두 병목(iOS Safari 타이머 스로틀 4.8fps · 근거리 화각)이 GoPro 로 둘 다 해소된다.

```bash
# ① GoPro HERO9 를 젯슨에 USB-C 로 연결 (배터리 0% 라 USB 가 곧 전원)
#    lsusb 에 2672:0052 · cdc_ether 로 enx... 인터페이스(172.23.102.53/24) 생성 확인
# ② cctv-ai 켜기 (사용자 직접)
# ③ 젯슨 엣지 스크립트
ssh jetson@yahboom-1
cd ~/vg_edge_poc
CCTV_BASE=https://cctv-ai-569797426568.asia-northeast3.run.app \
  GOPRO_FOV=4 INFER_FPS=12 PUSH_FPS=6 \
  nohup python3 gopro_ppe_edge.py > gopro_edge.log 2>&1 &
# ④ 확인
curl -s localhost:8444/health | python3 -m json.tool     # head_size 로 화각 조건 확인
curl -s localhost:8444/snapshot -o /tmp/s.jpg
# ⑤ 종료 — 웹캠 모드도 꺼서 전력 절약
pkill -f gopro_ppe_edge.py
curl -s "http://172.23.102.51/gp/gpWebcam/STOP"
```

실측 = **스트림 30.1 fps · 추론 14.8ms · 재연결 0회**.
스트림은 `/dev/video` 가 아니라 **UDP**(`udp://0.0.0.0:8554`) — cv2 + `CAP_FFMPEG`, open 약 6.6초.
화각은 `GOPRO_FOV` 로 지정(0=Wide 4=Narrow 6=Linear). 광각일수록 사람이 작게 찍힌다.

`/health` 의 **`head_size`** 가 이 테스트의 핵심 계측이다 — 검출된 머리 박스의 정규화 높이가
학습 범위(0.033~0.086)에 드는지 실시간으로 보여준다. 거리를 조정하며 이 숫자를 맞춘다.

⚠️ 단 **스케일이 맞아도 도메인이 다르면 검출되지 않는다**(2026-07-30 확인).
사무실에서 13,038프레임을 돌렸으나 `head` 0건이었다. 5차 전에는 E63 유사 환경에서만 의미가 있다.

---

## 병행 과제

### 사진 촬영 — 이제 필수다

공개 데이터셋이 전부 소진돼(HHW·CSS는 학습에 편입, Roboflow 후보는 부적합)
**직접 촬영한 30장이 유일한 독립 시험지**가 됐다.

```
안전모 착용    20장    ← 이걸 head 로 예측하면 1차와 같은 실패
안전모 미착용  10장
거리 3m · 6m · 10m
각도 정면 · 측면 · 뒤통수
카메라를 눈높이보다 위로 (CCTV 각도)
★ 안전모를 손에 든 사진 — head/helmet 혼동 확인용
```

**라벨링도 필요 없다.** 20장을 모델에 넣어 `helmet` 으로 나오는지 세면 된다.
1차·3차·4차 가중치를 나란히 돌리면 개선 여부가 즉시 보인다.
촬영 30분 + 판정 10분.

---

## 남은 미결

**실 현장 연속 영상.** 3층 지표(시간당 오탐 건수)는 이것 없이는 못 만든다.
유튜브 대체를 검토했으나 검증한 두 영상 모두 부적합했다(공사 감시 카메라는 사람이 25~40px,
기업 홍보 영상은 CCTV 가 아님). 현장 접근 시점의 과제로 남긴다.

**현행 `vyra_ppe.pt` 대비 비교.** 같은 홀드아웃에 태워야 교체 판단이 선다. 아직 미실행.
