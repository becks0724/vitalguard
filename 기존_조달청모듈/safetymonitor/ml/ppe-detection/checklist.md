# PPE 탐지(yolo26m) 성능 테스트 — 체크리스트

상용화 전 성능 테스트 단계. 진행하며 체크한다. 결정 근거는 [context-notes.md](context-notes.md).

## 0. 준비

- [ ] Kaggle 계정 → Settings → API → Create New Token → **토큰 문자열 복사** (한 번만 표시됨)
- [ ] Roboflow 계정 → API 키 발급 (Construction Site Safety 다운로드용)
- [ ] 코랩 런타임 GPU 확인 (T4 최소, L4/A100 권장)
- [ ] Google Drive 여유 공간 10GB 이상 (체크포인트 영속용)

## 1. 데이터

- [ ] SH17 다운로드 → 실제 디렉터리 구조·`data.yaml` 클래스 순서 **육안 확인**
- [ ] CSS(Construction Site Safety) 다운로드 → 동일 확인
- [ ] 통합 8클래스로 리매핑 실행 → **클래스별 인스턴스 수 출력 확인**
- [ ] `shoes`·`gloves` 인스턴스 수가 학습 가능한 규모인지 판단 (수백 건 미만이면 경고)
- [ ] train/val 분할이 같은 이미지로 새지 않는지 확인

## 2. 기준선 (baseline) — ★ 먼저 할 것

- [ ] 현행 `vyra_ppe.pt`(Hexmon YOLOv8m) 를 코랩에 올려 **같은 val 셋으로 평가**
- [ ] 현행 모델의 클래스별 recall / precision 기록 → 이게 넘어야 할 선
- [ ] 클래스 이름이 달라 직접 비교가 안 되면 매핑표 작성 (Hardhat↔helmet 등)

## 3. 학습

- [ ] yolo26m 기준선 학습 (imgsz=960, epochs≈150)
- [ ] Drive 체크포인트 저장 확인 → 세션 끊김 후 `resume=True` 재개 검증
- [ ] 학습 곡선 확인 (과적합·발산 없는지)
- [ ] imgsz 640 / 960 비교 학습 → **안전화·장갑 recall 차이** 측정

## 4. 평가 — 3층 지표

**1층 검출**
- [ ] 클래스별 mAP50-95
- [ ] precision 0.9 고정 시 클래스별 recall
- [ ] 소형 객체(shoes·gloves) 별도 집계

**2층 착용 판정**
- [ ] `judge_ppe()` 로 person↔helmet / person↔vest 매칭
- [ ] 착용 판정 정확도 (검출 mAP 와 별개로 측정)
- [ ] 포함비율 임계(`CONTAIN_MIN`·`HEAD_ZONE`) 튜닝

**★ 교차 데이터셋 홀드아웃** — 실 현장 영상 대체 근거
- [ ] Hard Hat Workers(학습 미사용)로 평가
- [ ] `head`·`helmet` recall 하락률 산출 → 30% 초과면 도메인 데이터 필수
- [ ] CSS `test` 분할로 `safety_vest` 별도 확인

**3층 이벤트** — 연속 영상 확보 후
- [ ] N프레임 연속 위반 게이트 정의 (N 튜닝)
- [ ] 사람 없는 구간의 위반 알림 = 명백한 오탐 (라벨 불필요)
- [ ] 현행 `vyra_ppe.pt` 대비 알림 발생 횟수 상대 비교
- [ ] 시간당 오탐 건수 측정 (실 현장 접근 시)

## 5. Jetson 성능

- [ ] `best.pt` → 젯슨(`yahboom-1`)으로 전송
- [ ] 젯슨에서 TensorRT FP16 엔진 변환 (**코랩 엔진은 사용 불가**)
- [ ] `sudo nvpmodel -m 0 && sudo jetson_clocks` 후 측정
- [ ] **정상상태 FPS** 측정 (스로틀링 후 — 초기 30초 값은 무의미)
- [ ] 2단계 파이프라인(person 크롭 → PPE) 대비 1단계 비교
- [ ] `jtop` 으로 전력·온도 기록

## 6. 판정 게이트

- [ ] 안전모 미착용 판정 recall ≥ 0.90 @ precision ≥ 0.85
- [ ] 안전조끼 미착용 판정 recall ≥ 0.85
- [ ] 젯슨 정상상태 ≥ 10 FPS (1채널)
- [ ] 현행 `vyra_ppe.pt` 대비 개선 확인
- [ ] 안전화는 **탐지 가능성 확인까지만** (상용 지표는 국내 재라벨링 후)

## 7. 마무리

- [ ] 데이터셋별 라이선스·상용 반입 가능 여부 표 작성
- [ ] SH17 학습 가중치에 `-nc` 접미사 확인 (상용 파이프라인 반입 차단)
- [ ] 결과를 `docs/progress.md` 에 기록
- [ ] shadow 모드 계획 수립 (현행·신규 동시 추론 비교)
