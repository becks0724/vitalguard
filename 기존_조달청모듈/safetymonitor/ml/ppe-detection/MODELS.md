# PPE 모델 — 가중치·학습 자료 안내

이 폴더에는 학습 노트북·스크립트·채점 도구·판단 기록만 있다. **가중치와 학습 자료는 저장소에 넣지 않는다.**
이 문서는 무엇이 어디에 있는지와 왜 저장소 밖에 두는지를 적는다. 보관 상태는 2026-10-07 에 드라이브를 직접 조회해 확인했다.

## 왜 저장소 밖인가

| 이유 | 내용 |
|---|---|
| 자료 라이선스 | AI Hub(E63·507)는 학습용 한정·제3자 재배포 금지. SH17 은 CC BY-NC-SA 4.0(비상업). HHW·GDUT 는 라이선스 미확인. CSS 만 CC BY 4.0 |
| 사람이 찍힌 사진 | 우리 카메라(CAM-01·CAM-03)와 현장 사진에 팀원·행인이 찍혀 있다 |
| 가중치도 같은 제약 | 이름의 `_nc` 는 비상업·학습용 한정 자료를 포함했다는 표시다(노트북이 자동으로 붙인다). 공개하면 그 자료의 산출물을 재배포하는 셈이다. 학습 도구 ultralytics 는 AGPL-3.0 이고 학습한 가중치도 그 파생물로 본다([checklist.md](checklist.md) 335행) |
| 크기·저장소 규칙 | 자료 묶음 약 2.9GB · 학습 산출 641MB. 루트 `.gitignore` 가 `*.pt`·`*.engine`·`weights/`·`runs/` 를 막는다 |

## 판본

| 판본 | 쓰임 | 학습 자료 | 파일 | 보관 |
|---|---|---|---|---|
| **PPE v7e** | CCTV 엣지의 마지막 라이브 판본(09-15 ~ 10-07 젯슨 반납) | GDUT · E63 · CSS · HHW (SH17 없음) | `ppe_yolo26s_640_v7e_nc.pt` | 드라이브 A·B |
| PPE v7d | v7e 직전 라이브 판본(09-15) | v7e 구성 + SH17 | `ppe_yolo26s_640_v7d_nc.pt` | 드라이브 A·B |
| 조끼 v2 | 조끼 전용 보조 모델(09-25 두 젯슨에서 가동 · 화면·통계에는 안 냄) | CSS + CAM-01 사진 30장 | `vest_yolo26s_640_v2.pt` | 드라이브 B · 담당자 맥 |
| 자세 | 낙상 판정용 관절 검출 | 학습하지 않음 — ultralytics 공개 `yolo11s-pose` 그대로 | — | — |

ONNX 는 젯슨에서 엔진을 굽기 전의 중간 산출물이다(입력 544×960). 같은 v7e 라도 두 기기에서 따로 내보내 내용이 다르다.
`.engine` 은 구운 기기 전용이라 남기지 않았다(젯슨 반납 때 함께 지웠다). 다시 쓰려면 대상 기기에서 `.pt` 로 굽고,
굽는 기기의 ultralytics 판본을 학습 환경과 맞춘다.

```
# sha256 · 바이트 — `shasum -a 256 -c` 형식
a4de6027ba8dac07c0293b8e7c6c00b07e5f86475c68e8d52559dd91d40c5bf1  ppe_yolo26s_640_v7e_nc.pt                       20,302,149
2ba80fae2f59ac37ad90d504f54509a614028ca43cf4cf4351eef35717d1328e  ppe_yolo26s_640_v7d_nc.pt                       20,302,149
30654112c414878d027611f1ccb8306ac7d3ae42154481020a050630fcfb57cd  vest_yolo26s_640_v2.pt                          20,350,831
581a0c58f9bb870b34df1a44e240ad585f84639eae966c2dc114c27389a84edb  onnx/yahboom-1/ppe_yolo26s_rect544x960_v7e_nc.onnx      38,213,120
b06113364c38c6cd2b298d53fed1e317487e440bcc73a33653b8b70a9533caf7  onnx/yahboom-1/ppe_yolo26s_rect544x960_v7d_nc.onnx      38,213,120
7ea94a354a63bca0a4e6aec91d0a12bc49b305da72f3ef7d9a7030d981003c40  onnx/yahboom-ipcctv/ppe_yolo26s_rect544x960_v7e_nc.onnx 38,188,221
```

## 성능 — 현장 35장 (판정 정본)

| | helmet | person | safety_vest | shoes |
|---|---|---|---|---|
| v5 (07-30 ~ 09-15 라이브) | 0/100 · FP 0 | 89/113 · FP 15 | 69/100 · FP 5 | 82/118 |
| v7d | 74/100 · FP 0 | 98/113 · FP 11 | 78/100 · FP 4 | 62/118 |
| **v7e** | **96/100 · FP 1** | **99/113 · FP 7** | **77/100 · FP 2** | 0/118 |
| 배포 게이트 | 94 · FP ≤ 2 | 96 · FP ≤ 17 | 69 · FP ≤ 5 | 감시만 |

출처 — v7d 는 [deploy-v7d-20260915.md](deploy-v7d-20260915.md), v7e 는 `tmp-507e` 가지의 `v7e-result-20260915.md`. 회차별 학습 이력·그래프는 [ML 학습·평가 기록](../../../../포트폴리오/ML/).

알려진 한계.
- 안전화(shoes)는 v7e 에서 0 이다. 안전화는 과업 범위 밖으로 보류했다.
- v7e 는 등 돌리거나 쪼그린 사람의 조끼를 잘 못 본다. 그래서 조끼 v2 를 따로 붙였다.
- 조끼 v2 도 쪼그린 정면 조끼는 못 잡는다. 착용 200장 중 거짓 미착용 22장이고 그중 20장이 쪼그린 정면이다
  ([../../cctv-ai/edge/jetson-etc/checklist.md](../../cctv-ai/edge/jetson-etc/checklist.md) 939행).

## 보관 위치

두 드라이브 모두 담당자(@becks0724) 개인 Google 드라이브다. 필요하면 담당자에게 열람을 요청한다. 저장소에는 계정 주소를 적지 않는다.

```
드라이브 A — Colab 학습 작업 폴더 vitalguard-ppe/
  datasets/   e63_yolo.tar 1.97GB · gdut_yolo.tar 680MB · a507_yolo.tar 170MB · kdhc_yolo.tar 59MB · cam03_vest_yolo.tar 40MB
  weights/    ppe_yolo26s_640_{v5,v6,v7a,v7d,v7e}_nc.pt
  runs/       1차 ~ 7차-E 학습 산출(best·last 가중치와 학습 기록) 641MB
  results/    v5 · v6 · v7a · v7d 평가 결과
  *.ipynb     Colab 이 연 학습 노트북

드라이브 B — 백업 vitalguard-ppe/
  weights/    v7d · v7e .pt (드라이브 A 와 같은 파일 · sha256 일치) · 조끼 v2 .pt (10-07 백업)
  onnx/       yahboom-1/ v7d·v7e · yahboom-ipcctv/ v7e
```

CSS·HHW·SH17 은 드라이브에 없다. 노트북이 실행할 때 원 출처에서 받는다.

```
CSS    Roboflow  roboflow-universe-projects/construction-site-safety  v27
HHW    Roboflow  joseph-nelson/hard-hat-workers  v13 (v14 는 helmet·head 가 한 클래스라 못 쓴다)
SH17   Kaggle    mugheesahmad/sh17-dataset-for-ppe-detection   (v7e 는 쓰지 않음)
```

## 재현

v7e 는 [ppe_yolo26_colab_v7e_260915.ipynb](ppe_yolo26_colab_v7e_260915.ipynb) 를 Colab 에서 드라이브 A 를 붙여 실행한다.
Roboflow 키는 실행 중에 입력한다(노트북에 적지 않는다). 기록된 조건은 A100 · batch 64 · 30 epoch · imgsz 640 · `yolo26s.pt` 출발 · 32분이다.
