# 7차 PPE 학습. 노트북이 아니라 스크립트인 이유는 **커밋 해시가 곧 실행 기록**이기 때문이다.
#
# 6차에서 겪은 것 — args.yaml 은 20:57 에 실행됐는데 노트북 파일은 22:36 에 수정됐다.
#   무엇으로 학습했는지 재구성이 불가능해졌고, FRACTION 으로 되짚은 수는 어느 클래스도 안 맞았다.
#   (helmet 재구성 ≈28,294 vs 실제 12,036 · safety_vest 3,156 vs 903)
#
# 그래서 이 스크립트는 셋을 한다.
#   ① 구성 계획을 상수로 **선언**한다        — 무엇을 넣기로 했는지가 코드에 남는다
#   ② 실제로 만들어진 라벨을 **센다**         — 계획이 아니라 결과를 센다
#   ③ 둘이 어긋나면 **학습 전에 멈춘다**      — 계획과 실제가 다른 채로 A100 1.6시간을 쓰지 않는다
#
# 쓰기:  colab run --gpu A100 train_v7.py
#        (colab run = new + exec + stop. 스크립트가 죽으면 종료 코드가 그대로 올라온다)

import hashlib
import json
import os
import shutil
import subprocess
import sys
from collections import Counter

# ── 클래스 정본 ────────────────────────────────────────────
# ★★ 2026-09-12 사용자 결정 — **507 제외**. 그러면 no_safety_shoes 의 유일한 출처가 사라진다.
#   그래서 7차는 **8클래스**다. no_safety_shoes 는 v6 의 마지막 인덱스(8)라 떼도 0~7 이 그대로다.
#   ⟹ 부수 효과 둘. ① 기준선 v5 와 클래스 수가 같아져 직접 비교가 된다(v5 도 8클래스였다).
#                   ② 엣지 NAMES(5개 파일 전부 이 8개)와 정확히 맞는다 — 종전의 str(8) 폴백이 사라진다.
#   ⚠ 안전화 미착용 판정은 7차에서 **보류**다(과업 제외가 아니다). 507 을 다시 넣을 때 9번째로 돌아온다.
NAMES = ["person", "head", "helmet", "safety_vest", "foot",
         "shoes", "hands", "gloves"]

# ── 기준선은 **v5** 다. v6 가 아니다 ─────────────────────────
# ⛔ 2026-09-11 확정 — 현장 젯슨에 올라가 있는 것이 v5 이고, 같은 133장 같은 설정으로 재니
#   v6 가 **오경보를 더 낸다**(착용자에 head 박스 0.323 vs 0.211).
#   그런데 집계 지표는 v6 가 전부 낫다.
#       P 0.5900→0.6000 · R 0.5622→0.5887 · mAP50 0.5185→0.5417 · mAP50-95 0.3085→0.3443
#   ★ 하이퍼파라미터는 v5·v6 가 완전히 같다(둘 다 epochs 30·batch 64·scale 0.8·mosaic 1.0).
#     차이는 **데이터뿐**이다. 6차는 지표를 올리면서 운용 오류를 53% 늘렸다.
#   ⟹ **mAP 로 7차를 판정하면 안 된다.** 아래 GOAL 을 본다.
SIXTH = {"person": 31334, "head": 12898, "helmet": 12036, "hands": 7150,
         "shoes": 2084, "gloves": 1325, "no_safety_shoes": 1123,
         "safety_vest": 903, "foot": 663}
# 5차 라벨 수 — Drive `runs/yolo26s_640_v5_nc/labels.jpg` 에서 읽었다(2026-09-12).
#   ⚠ head 는 그림에서 마지막 자리가 helmet 숫자에 가려 12,04? 다. 12040 으로 두고 ±9 는 expect 폭 안이다.
#   ★ helmet 이 5차·6차 똑같이 12,036 이다 — 6차가 더한 507 3,488장은 helmet 라벨을 **0개** 보탰다.
#     507 변환기 매핑이 WO-07→no_safety_shoes · WO-04→head 뿐이라서다. 무라벨 안전모는 배경으로 학습된다.
FIFTH = {"person": 29360, "head": 12040, "helmet": 12036, "hands": 7150,
         "shoes": 2084, "gloves": 1325, "safety_vest": 903, "foot": 663}

# ── 7차 구성 계획 ──────────────────────────────────────────
# ⚠ 비워 둔 둘은 측정이 끝나야 채운다. 채우기 전에 돌리면 아래 검증에서 멈춘다.
#     VEST_FIELD   현장 35장 조끼 97개 — 6차 조끼 기저 903 의 10.7% 다. 넣는 값어치는 확정됐다
#     VEST_CROUCH  CAM-03 쪼그림 장수 — conf 0.02 스윕 결과로 갈린다
#                  ⚠ 그리고 홀드아웃 촬영이 먼저다. 쪼그림 55장이 전부라 다 넣으면 잴 자가 없다
PLAN = {
    "sources": {
        # 6차와 같게 두는 것 — 바꿀 이유가 없으면 안 바꾼다
        "e63":  {"fraction": 0.4,  "where": "DRIVE/datasets/e63_yolo.tar"},
        # ⛔ a507 은 **없다**. 2026-09-12 사용자 결정으로 7차에서 뺀다.
        #    6차는 이 3,488장을 helmet 라벨 0개로 넣었고(프레임 55% 가 무라벨 흰 안전모),
        #    홀드아웃 helmet R −0.110 · 착용자 head 오경보 +53% 가 뒤따랐다.
        #    다시 넣으려면 a507_mode 를 openvocab/mask 로 바꾸고 **여기에 항목을 되살린다**.
        "hhw":  {"fraction": 0.45, "where": "roboflow joseph-nelson/hard-hat-workers v13"},
        "css":  {"fraction": 1.0,  "where": "roboflow roboflow-universe-projects/construction-site-safety v27"},
        # ⛔⛔ 2026-09-14 — **여기가 7차-A 현장 안전모 0/100 의 원인이다.** 맥 파일럿 5회로 확정.
        #   `sh17_head_filter` 가 SH17 의 helmet 박스를 **전부 버린다**(노트북 cell12).
        #   버린 자리에 아무 박스도 안 남으므로 그 화소는 **배경**이 되고,
        #   모델은 「착용 안전모는 아무것도 아니다」를 배운다. a507 과 같은 기전인데 우리가 만들었다.
        #
        #   같은 자(현장35·중심포함·conf0.30·imgsz960)로 잰 파일럿 — 시작점 yolo26s.pt · 5ep · b16 · MPS
        #       GDUT 단독                    helmet 90/FP8
        #       + E63                        helmet 94/FP5    ← E63 은 무죄(오히려 +4)
        #       + SH17 (현행 필터)           helmet  2/FP0    ← 붕괴. 7차-A 0/FP0 을 재현
        #       + SH17, 안전모 사진 237장 제외 helmet 77/FP3   ← 회복. 원인 확정
        #       + SH17, 안전모 박스 살림      helmet 65/FP1    ← 회복하나 낮다(박스 정의 충돌)
        #   ⟹ 「못 쓰는 박스를 지우면 그 자리가 **없다**가 된다.」 못 쓰면 **사진째 빼야** 한다.
        #   ⚠ 아직 **어느 처방도 게이트(94/FP2)를 못 넘었다.** 남은 격차(-17~-29)의 후보는
        #     SH17 이 더한 맨머리 5,630개(helmet:head 2.02→1.17)이고 미확정이다.
        #   ⟹ **이 항목은 7차 재설계 전까지 그대로 쓰지 말 것.**
        "sh17": {"fraction": 0.5,  "where": "kaggle · head 만 채택(SH17_HEAD_FILTER)",
                 "⛔status": "09-14 원인 확정 · 09-15 수리안 확정 — SH17_DROP_HELMET_IMAGES=True (7차-D)",
                 "fix": "helmet 이 찍힌 사진을 통째로 제외. 박스만 버리면 그 자리가 배경이 된다",
                 "pilot": "GDUT 90 → +E63 94 → +SH17(버림) 2 → +SH17(사진제외) 77 → +SH17(박스살림) 65 → +SH17(머리제거) 30"},
        # 7차에 새로 들어가는 것
        # ★★ 09-12 — helmet 실명의 해법. 파일럿 3 으로 검증된 조합이다.
        #   GDUT 단독 미세조정은 helmet 을 0→.614 로 올리면서 **person 을 .973→.000 으로 죽인다**
        #   (GDUT 에 person·vest 라벨이 없어 그 화소가 전부 배경으로 학습된다 — A507 사고와 같은 구조).
        #   v5 로 person·safety_vest 를 의사라벨해 넣으면 붕괴가 사라지고 helmet 도 **더** 오른다.
        #       pilot  (GDUT 단독)   helmet .614 · person .000 · vest .000
        #       pilot3 (+의사라벨)   helmet .703 · person .960 · vest .680   ← 게이트 3/3
        #   ⚠ shoes 는 의사라벨하지 않는다 — v5 shoes P .484 라 절반이 헛박스다(오검출을 굳힌다).
        #     파일럿에서 shoes 가 .685→.000 이 된 것은 GDUT 단독이라서고, 본학습엔 SH17 이 있어 해소된다.
        "gdut": {"fraction": 1.0, "where": "DATASETS/GDUT-HWD (train 2,531 · 해시 분할 pilot_gdut_hash_split.csv)",
                 "pseudo": {"classes": ["person", "safety_vest"], "teacher": "v5", "conf": 0.5},
                 "adds":   {"helmet": 11274, "head": 3256, "person": 10055, "safety_vest": 339}},
        # ⛔⛔ 09-12 — 현장 35장과 ppe.sample 을 **학습에서 뺀다. 시험 전용이다.**
        #   종전 계획은 둘을 학습 출처로 뒀다. 그러면 **채점 수단이 사라진다**(3차 홀드아웃 소진 사고와 같은 구조).
        #   오늘 순환 점검에서 확인된 것 —
        #     · ppe.sample 의 **helmet 라벨은 pilot_gdut 산** · **vest 라벨은 v5 저신뢰 후보 산**이라 그 둘은 애초에 순환
        #     · ⟹ **비순환 자는 helmet·vest = 현장 35장 / person = ppe.sample 59장, 이 둘뿐이다**
        #   손익 — 학습에 넣어 얻는 것은 81장(전체의 약 0.5%)이고, 잃는 것은 **3종 전부의 유일한 자**다.
        #   ★ 현장 35장은 **한 번의 86초 촬영 = 1장면**이라 쪼갤 수도 없다. ppe.sample 도 15장면뿐이다.
        "field35":    {"role": "test-only", "where": "PHOTO-FIELD-20260910 · helmet·vest 정본 (손라벨 helmet 101 · vest 97)"},
        "ppe_sample": {"role": "test-only", "where": "recall-plan-20260912/ppe_sample_dataset · person 정본 (person 74)"},
        "cam03_crouch": {"n": None,      "where": "DRIVE/datasets/cam03_pose"},   # ← 비어 있음
    },
    # ⛔ 507 처리 — 사람이 정하기 전엔 None. None 이면 아래 검증에서 멈춘다(codex 1차 지적 · 주석만으론 안 막힌다).
    #   "exclude"   507 제외 (no_safety_shoes 보류) — 가장 단순 · 7차 첫 실행 권고
    #   "openvocab" 507 helmet 을 개방어휘 교사로 의사라벨 + 사람 검수 (RUNBOOK 대응 D · v5 는 13/110 이라 교사 부적합)
    #   "mask"      507 을 no_safety_shoes 전용으로 두고 head/helmet 손실 마스킹 — ultralytics 표준으론 안 됨 · 단위 시험 없이는 금지
    "a507_mode": "exclude",   # ★ 2026-09-12 사용자 결정. 아래 검증이 라벨 수로 실제 부재를 확인한다
    # ★ 09-12 — "A" = helmet 만(촬영 불필요 · 지금 가능) / "B" = 조끼 자세까지(쪼그림 촬영 뒤)
    "run": "A",
    # 만들어진 뒤 이 범위 밖이면 멈춘다. 「대충 맞으면 통과」가 아니라 「선언한 대로인가」를 본다.
    # ★ 09-12 — 기준을 6차에서 **5차로 옮겼다.** 507 을 빼면 6차가 507 으로 얻은 몫이 같이 빠진다
    #   (head +858 · person +1,974). 6차 수에 걸어 두면 507 없이 통과할 수 없는 하한이 된다.
    "expect": {
        # ⚠ 09-13 — 이 범위는 **train 분할** 라벨 수다(FIFTH 출처 = v5 runs/labels.jpg). val 까지 세면 상한을 넘긴다.
        # ★ 09-12 — GDUT 가 들어오면서 범위를 다시 잡았다. 실측 라벨 수로 되짚은 값이다(FRACTION 추정 아님).
        #   GDUT train 2,531장이 더하는 것 = helmet +11,274 · head +3,256 · person +10,055(의사) · vest +339(의사)
        # ★ 현장 35장을 학습에서 뺐으므로 그 몫(vest 97 · helmet 101 · head 9)도 기대치에서 뺀다
        "safety_vest": (903 + 339, None),                            # 하한만 — 쪼그림 장수 미정이라 상한을 못 쓴다
        "helmet":      (12036 + 11274 - 800, 12036 + 11274 + 800),
        "head":        (12040 + 3256 - 800, 12040 + 3256 + 800),
        "person":      (29360 + 10055 - 1500, None),
    },
}

# ── 7차 성공 기준 ──────────────────────────────────────────
# ⛔ mAP 가 오르는 것은 성공 조건이 아니다. 6차가 그 기준을 통과하면서 오경보를 53% 늘렸다.
#   반드시 **두 개를 같이** 본다 — 하나만 보면 6차를 반복한다.
# ★★ 2026-09-12 밤 개정 — helmet 을 기준에서 빼던 줄을 **되넣는다.**
#   CAM-03 착용자 132장에서 helmet 검출과 head 오경보가 **거의 완전한 배타**로 확인됐다([CCTV/ML] 실측).
#       helmet 검출 O 91장 → 오경보 0     (0.000)
#       helmet 검출 X 41장 → 오경보 40    (0.976)
#   ⟹ **helmet recall 이 곧 오경보 지렛대다.** 「helmet 은 차수 문제가 아니라 기준에서 뺀다」는 틀렸다.
#   ⚠ 다만 남은 41장은 GDUT 로 안 풀린다 — 파일럿이 새로 잡은 91장은 v5 가 원래 오경보를 안 내던 자리이고,
#     v5 가 오경보를 내던 41장을 파일럿도 그대로 놓쳤다. **두 모델이 같은 41장에서 막힌다.**
# ★★★ 2026-09-12 최종 — 종전 0.286 / 0.934 는 **분모가 오염된 값이었다.** 사용자 확인으로 셋 다 닫혔다.
#   ① 창 끝에서 벗음  ② vest0_sit_front 의 note 「안전모X」가 오기(실제 착용)  ③ 피사체 오배정 12장 = 판정불가
#   깨끗한 분할 — 착용 126 · 미착용 464 · 판정불가 12
#       v5 .pt      오경보  6/125 = .0480   맨머리 461/464 = .9935
#       v5 engine   오경보 16/125 = .1280   맨머리 460/464 = .9914      ← 게이트 정본
#   ⟹ 오경보는 절반 이하, 검출은 +0.057. **둘 다 좋아졌다.**
#   ⚠ 중간에 돌던 .087 / .983 은 잠정 분할 값이다 — 인용 금지.
GOAL = {
    # ⚠ 2026-09-12 — 기준선의 키가 **둘**이다. **(엔진 빌드 기하, head_conf)** 가 둘 다 같아야 비교가 성립한다.
    #   ① head_conf — 엣지 `/config?head_conf=` 로 런타임 전환. 확인 = `curl -s localhost:8444/health | jq .head_conf`
    #   ② 엔진 기하 — 아래 표는 **정사각 960x960 엔진** 기준이다.
    #      ★ 격차 .048(.pt) vs .128(engine) 은 전부 **letterbox 여백**이었다(ONNX·FP16 무죄 · 09-12 확정).
    #        엔진을 **직사각 imgsz=(544,960)** 으로 다시 구우면 여백이 420px→4px 로 줄어 .048 근처로 내려간다.
    #      ⛔ 그때는 **표 전체를 다시 재고**, `head_conf` 를 **0.30 으로 원복**한다 —
    #        안 그러면 사라진 문제의 대가로 맨머리 검출만 계속 낸다. **임시방편은 원인이 고쳐지면 걷는다.**
    "기준선표": {   # ★ 09-12 23:00 개정 — **직사각 544x960 엔진**(현 배포본) · head_conf 0.30
                    #   깨끗한 분할(착용 126 · 미착용 464 · 판정불가 12) · 자동필터 자
        0.30: (0.0480, 0.9935),   # (착용자 오경보, 맨머리 검출) = **6/125 · 461/464**  ← **현 게이트**. 정사각 시절 .1280/.9914 에서 내려왔다
                                  #   ⚠ 착용 126 중 유효 125(1장 판정 제외). 판정불가 12 는 분모 밖 — 476 으로 세면 틀린다
    },
    "⛔ 폐기된 기준선": "정사각 960x960 엔진 표(0.30 .1280/.9914 · 0.35 .1040 · 0.40 .0720 · 0.70 .0400)는 "
                      "**더 이상 쓰지 않는다**. 기하가 바뀌었다. 그보다 앞의 .286/.934 는 분모 오염값이라 이미 폐기됐다",
    # ★★ 09-12 신설 — 사용자가 인식의 중심을 **person · helmet · safety_vest** 3종으로 확정했다.
    #   셋의 상태가 극단적으로 다르고 **자도 클래스마다 다르다**. 짝을 지키지 않으면 순환이 된다.
    "★ 클래스 게이트": {
        # ★★★ 09-13 재개정 — **게이트는 비율이 아니라 박스 개수로 적는다.** 정본 라벨이 helmet 100 · vest 100 · person 113 이라
        #   한 박스가 .01 인데, 소수 셋째 자리 표시값은 그 격자 위에 없다. 종전 `.941`(=95/101 옛 자)·`P≥.99`·`P≥.90` 은
        #   **pilot3 재현을 세 곳에서 탈락시키는 값**이었다(정본에서 pilot3 = 94/100 · P .979 · ppe.sample P .899).
        #   기계가 읽는 정본은 아래 GATE_COUNTS 다. 이 문자열은 사람용 설명이다.
        # ★★ 09-13 개정 — IoU 0.5 는 이 질문에 맞는 자가 아니었다.
        #   GDUT·E63 의 helmet 박스는 「안전모 쓴 머리」(얼굴 포함 · w/h 0.79)이고
        #   우리 현장 손라벨은 「안전모 물체만」(w/h 1.10)이다. **정의가 다르다**(SH17 1차 사고와 같은 구조).
        #   같은 예측을 자만 바꿔 재면 — pilot3 IoU0.5 R .703/P .740  →  중심포함 R .941/P .990
        #   「오검출 25」 중 24 가 실은 정확한 검출이었다.
        #   ⟹ 배포 판정이 포함관계(person ⊃ helmet)라 묻는 것은 「머리에 안전모가 있나」다. 중심포함이 맞는 자다.
        #     (CAM-03 게이트가 이미 중심포함 자를 쓴다 — 같은 규칙으로 통일한다)
        #   ⚠ 근본 수선 = 현장 35장 101개를 「안전모 쓴 머리」 정의로 다시 그린다(35장이라 싸다)
        "helmet":      "현장 35장 **중심포함** TP ≥ 94/100 AND FP ≤ 2   — v5 0/0(예측 0개) · pilot3 94/100·FP2 가 출발선이다",
        # ★ 09-13 개정 — 현장 35장에 person 라벨 113개가 생겨(사용자 재라벨) 처음 쟀더니 **.973 이 아니라 .79~.85** 다.
        #   ppe.sample(장당 1.25명)은 희소 장면이고 현장(장당 3.2명 · 24% 가 높이 0.15 미만)은 붐빈다.
        #   v5 .788/.856 · pilot3 .850/.850 (IoU.5). 포함관계 판정에서 작업자 15~20% 가 판정을 못 받는 수준이라
        #   「지킬 것」이 아니라 **올릴 것**이다. 두 자를 같이 본다 — 하나만 보면 희소 장면에서만 통과한다.
        #   ⚠ 113개 박스의 포함 기준(부분 가림·원거리)은 미검증 · 첫 측정 · 잠정.
        "person":      "ppe.sample 59장 TP ≥ 71/74 AND FP ≤ 8   AND   현장 35장 TP ≥ 96/113 AND FP ≤ 17  — 둘 다 pilot3 값. v5 는 72/74·FP5 / 89/113·FP15",
        "safety_vest": "현장 35장 TP ≥ 69/100 AND FP ≤ 5       — v5 69/100·FP5 유지(pilot3 도 69·FP2). 종전 .680 은 옛 자 66/97. 자세 구멍은 촬영으로 따로 푼다",
        "⛔ 자를 섞지 말 것": "ppe.sample 의 **helmet 라벨은 pilot_gdut 산**이고 **vest 라벨은 v5 저신뢰 후보 산**이다. "
                           "GDUT 계열로 ppe.sample helmet 을 재거나 v5 계열로 ppe.sample vest 를 재면 **순환**이다. "
                           "⟹ helmet·vest 정본 = 현장 35장 / person 정본 = ppe.sample 59장",
        "⚠ shoes":     "3종 밖이지만 **회귀 감시**는 한다(v5 현장 82/118=.695 · 종전 .685 는 옛 자 74/108). 파일럿에서 .000 이 된 것은 GDUT 단독이어서다",
    },
    "착용자_오경보": "**같은 head_conf 의** v5 engine 값 아래로 내려가야 한다 — head 박스 = 위반 박스다 (자동필터 자)",
    "미착용_검출":   "**같은 head_conf 의** v5 engine 값 아래로 내려가면 안 된다 — 오경보를 줄이려고 문턱을 올린 게 아니어야 한다",
    "⛔ 문턱을 섞지 말 것": "7차를 0.30 에서 재고 0.35 기준선과 비교하면 **문턱 이득을 7차 성과로 오독**한다. "
                          "같은 문턱끼리만 비교한다 — 09-12 의 「같은 내보내기 경로끼리만」과 같은 규칙이다",
    "★ 모델 게이트":  "위 둘은 **배포** 게이트다. **모델** 질문은 `.pt` 로 답한다 — v5 `.pt` 는 오경보 .0480 · 검출 .9935. "
                     "7차 `.pt` 가 이 아래여야 모델이 나아진 것이다(질문마다 경로가 다르다 · 09-12)",
    "⛔ 재기준 조건":  "★ 09-12 정정 — 「ONNX 변환이 오경보를 만든다」는 **기각**됐다. 원인은 **letterbox 기하**다. "
                     "같은 기하면 .pt 와 엔진이 소수점까지 같다(둘 다 6/125 · 461/464). 설명력 = 기하 100% · 프레임워크 0%. "
                     "⟹ 09-12 23:00 배포본을 **직사각 544x960 엔진**으로 갈고 head_conf 를 0.30 으로 원복했다. "
                     "**아래 기준선표는 그 직사각 엔진 기준이다.** 엔진 기하나 head_conf 가 바뀌면 표 전체를 다시 잰다",
    "★ 착용자_helmet": "오경보와 배타이므로 **같은 것을 재는 두 번째 자**다. 오경보가 내려갔는데 helmet 이 안 올랐으면 "
                      "문턱이나 자를 의심한다(둘은 같이 움직여야 한다)",
    "⚠ 자":          "절대값은 **젯슨 엔진**에서 잰다. 맥 .pt 는 오경보를 낙관한다(.048 vs .128) — 대리 지표로 못 쓴다",
    "⚠ 자 섞지 말 것": "자동 필터 판(0.286)과 사람 subject_box 판(.3106)은 다른 자다. 기준은 **자동 필터 판**이다",
    "⛔ 막힌 41장":   "**해석 폐기.** 그 41장은 어려운 프레임이 아니라 29장이 미착용 전환 · 12장이 피사체 오배정이었다. "
                      "A3-0 는 깨끗한 분할에서 다시 세운다",
}

# ── ★★ 클래스 우선순위 — 사용자 지시 2026-09-15 ────────────────────
#   「PPE 객체인식의 주력은 **안전모·안전조끼**다. 안전화·장갑 등은 부수 항목이다.」
#
#   ⟹ 판정할 때 **두 지표를 같이** 본다. 하나만 보고 통과를 선언하지 않는다.
#      helmet 만 보고 판정할 뻔한 자리가 실제로 있었다 — 09-15 7차-E 착수 직전.
#
#     1순위   helmet · safety_vest      둘 다 경성 게이트. **둘 다** 넘어야 통과다
#     2순위   person                    1순위 판정의 전제(사람별 착용 판정에 필요)
#     부수    shoes · foot · hands · gloves   감시만. 0 이어도 착수를 막지 않는다
#
#   이 우선순위가 바꾸는 것.
#     · 7차-E 가 shoes 를 0 으로 만드는 것은 **대가가 아니라 범위 밖**이다
#     · pilot10 의 vest 59(5ep)는 「넘어갈 수 있는 수」가 아니다 — 30ep 결과를 vest 로도 채점한다
#     · 조끼를 먹이는 것은 SH17 이 아니라 CSS 다(SH17 기여 약 70/1,038 = 7%).
#       그 관계는 USE_SH17=False 에서도 유지된다
#
#   ⚠ 「1순위합」 같은 합산 지표를 만들지 말 것. 둘은 따로 걸린 게이트이고,
#     합치면 한쪽의 실패를 다른 쪽의 초과가 가린다(오늘 게이트에서 배운 것과 같은 병).
CLASS_PRIORITY = {
    "1순위": ("helmet", "safety_vest"),      # 둘 다 통과해야 한다 (AND)
    "2순위": ("person",),                    # 1순위 판정의 전제
    "부수":  ("shoes", "foot", "hands", "gloves"),
    "근거":  "사용자 지시 2026-09-15 · 안전모·조끼가 주력, 나머지는 부수",
}


def priority_verdict(scores):
    """1순위 두 지표를 **같이** 판정한다. scores = {클래스: (tp, fp)}.

    통과면 None, 실패면 이유 문자열. 한쪽만 넘은 것은 통과가 아니다.
    """
    bad = []
    for cls in CLASS_PRIORITY["1순위"]:
        key = next((k for k in GATE_COUNTS if k.startswith(cls + "@현장35")), None)
        if key is None:
            bad.append(f"{cls}: 게이트 키를 못 찾았다")
            continue
        if cls not in scores:
            bad.append(f"{cls}: 채점되지 않았다 — 1순위는 빠뜨릴 수 없다")
            continue
        why = gate_check(key, *scores[cls])
        if why:
            bad.append(f"{cls}: {why}")
    return None if not bad else " · ".join(bad)


# ── 7차 게이트 정본 (박스 개수) ───────────────────────────
# ★ 09-13 — 노트북·채점 스크립트는 이 dict 를 읽는다. GOAL 의 문자열은 설명이고 이것이 판정이다.
#   (TP 하한, FP 상한, 정답 수). 자·conf·imgsz 가 다르면 이 수는 무효다 — 키에 자를 적어 둔 이유다.
#   근거 = [CCTV/ML] 09-13 정본 자 재채점(현장 35장 09-13 재라벨 · conf 0.30 · imgsz 960).
# ★ 09-13 — 결과를 인용할 때는 **학습 조건을 수치 옆에 붙인다**.
#   ★ 09-14 정정 — 위의 "7차-A 는 T4 batch 32" 는 계획 시점 값이었다. **실행은 A100 batch 64** 로
#   끝냈다(args.yaml 실측 · 30ep · 1.585시간). v5·v6 과 완전히 같은 조건이라 BN 교란은 없다.
#   ⟹ 7차-A 실패는 학습 조건 탓으로 돌릴 수 없다. 자료 또는 시작 가중치의 문제다.
#   ⛔ **이것은 의도된 고정이 아니라 이탈이다.** 설계 조건은 「하이퍼는 v6 그대로」=batch 64 였고,
#     A100 권한이 없어 못 지킨 것이다(09-13 · 배정됐다 70분 만에 회수 · 재시험에서 A100·L4 거부).
#     「영향이 작다」와 「조건을 지켰다」는 다른 말이다 — 기록에는 전자로만 적는다.
#   ★ 이 기록이 실제로 일하는 시점 = **결과가 애매할 때뿐**이다([WATCH.APP]).
#       helmet 94/100 근처  → b32↔b64 가 0→94 를 만들 수 없다. 이탈은 각주로 남고 결론은 안 흔들린다.
#       helmet 40/100 근처  → ★ 이탈이 **살아 있는 대안 설명**이 된다. 「v5 를 못 넘었다」와 「조건이 달랐다」가 안 갈린다.
#         ⟹ 그때는 결론을 내지 말고 **A100 batch 64 로 한 번 더 돌려** 조건을 맞춘 뒤 판정한다.
#   ⟹ 표기 예: `helmet 94/100 @ T4 b32(실효64)`. 자를 적는 규칙([[measure-both-sides-same-way]])의 학습 조건판이다.
GATE_COUNTS = {
    # ★ 09-14 — 키에 conf·imgsz 를 **실제로** 적는다. 위 주석은 "키에 자를 적어 둔 이유다" 라고
    #   하는데 정작 키엔 자만 있고 conf·imgsz 가 없었다. 그 빈칸 때문에 09-14 채점이 imgsz 640 으로
    #   돌아 person·vest 가 「통과」로 나왔다가 960 에서 뒤집혔다(person 97→95 · vest 83→85·FP6).
    #   ⟹ 빠뜨릴 수 없게 키에 박는다. 다른 conf·imgsz 로 잰 수는 이 게이트와 비교 불가다.
    "helmet@현장35·중심포함·conf0.30·imgsz960":     {"tp_min": 94, "fp_max": 2,  "gt": 100},   # pilot3 94·FP2 · v5 0 · v7a 0
    "person@현장35·IoU0.5·conf0.30·imgsz960":      {"tp_min": 96, "fp_max": 17, "gt": 113},   # pilot3 96·FP17 · v5 89·FP15 · v7a 95·FP10
    "person@ppe.sample59·IoU0.5·conf0.30·imgsz960": {"tp_min": 71, "fp_max": 8,  "gt": 74},    # pilot3 71·FP8 · v5 72·FP5
                                                                                              # ⚠ 09-14 gt 74 를 만드는 라벨 집합 위치 미확인 — 채점 보류
    "safety_vest@현장35·IoU0.5·conf0.30·imgsz960":  {"tp_min": 69, "fp_max": 5,  "gt": 100},   # v5 69·FP5 유지 (pilot3 69·FP2) · v7a 85·FP6
                                                                                              # ★ 09-15 우선순위 반영 — 조끼는 **1순위**다(CLASS_PRIORITY). 따라서 TP 는 높을수록 좋고
                                                                                              #   "v5 69 유지"는 **하한이지 목표가 아니다**. 7차-A 의 85 는 퇴보가 아니라 개선이다.
                                                                                              # ⚠ 남은 물음 = **FP 상한 5**. TP+16 에 FP+1 을 실패로 적을 것인가는 아직 답을 못 받았다.
                                                                                              #   우선순위 지시는 "인식률을 높여라"였고 오경보 허용치는 말하지 않았다 — 추측하지 않는다.
    "shoes@현장35·IoU0.5·conf0.30·imgsz960":       {"tp_min": None, "fp_max": None, "gt": 118, "watch": "v5 82/118 — 회귀 감시만 · v7a 78 · pilot3 0(설계된 비용)"},
    "배포@CAM-03·직사각544x960·head_conf0.30": {"오경보_max": 6, "착용_유효": 125, "검출_min": 461, "미착용": 464},

    # ★★ 09-15 신설 — **음성 지표에는 짝이 되는 양성 지표를 같이 건다.**
    #   위 배포 게이트는 오경보 상한만 걸어 두었다. 그 게이트는 **아무것도 검출하지 않는
    #   모델에 만점을 준다.** 실제로 그렇게 됐다 — 배포본 v5 가 CAM-03 착용 168장에서
    #   helmet 을 못 본 166장 중 **113장에서 head 도 못 봐서** 오경보가 낮았다.
    #   「잘 봐서 조용한 것」과 「못 봐서 조용한 것」이 같은 점수를 받고 있었다.
    #
    #     (helmet 검출 O/X) × (오경보 O/X) 교차표 · CAM-03 착용 168장 · conf 0.30 · 중심포함
    #       v5   검출 O   1장    │ 오경보율 .319 ← 이 낮은 값이 게이트를 통과시켰다
    #            검출 X 166장    │
    #       v7d  검출 O 115장    │ 오경보율 .009
    #            검출 X  52장    │
    #
    #   ⟹ 오경보 상한 옆에 **helmet 검출 하한**을 세운다. 하나만 걸면 반대쪽으로 빠져나간다.
    #   하한 근거 = v5(.006=1/168)와 v7d(.685=115/168) 사이. v5 의 실명은 확실히 막고
    #   v7d 수준을 요구하지는 않는 자리에 둔다. 0.30 = 168장 중 50장.
    "배포@CAM-03·helmet검출하한·직사각544x960·conf0.30": {
        "착용_전체": 168,
        "helmet검출_min": 50,          # 0.298 — v5 는 1/168 로 즉시 실패, v7d 는 115/168 로 통과
        "근거": "v5 .006 vs v7d .685 · 실명 배포를 막는 최소선",
    },
}


def gate_check(name, tp, fp):
    """개수 게이트 판정. 통과면 None, 실패면 이유 문자열. 감시 항목(None)은 항상 통과."""
    g = GATE_COUNTS[name]
    if g.get("tp_min") is None:
        return None
    bad = []
    if tp < g["tp_min"]:
        bad.append(f"TP {tp} < {g['tp_min']}/{g['gt']}")
    if fp > g["fp_max"]:
        bad.append(f"FP {fp} > {g['fp_max']}")
    return " · ".join(bad) or None


# ── 학습 하이퍼파라미터 ────────────────────────────────────
# ⚠ scale·imgsz 를 건드리지 않는다. 4차에서 증강 배율을 만졌다가 helmet recall 이 0.821 → 0.433 으로
#   무너졌다. 그리고 현장 실패는 크기 문제가 아니라 도메인 문제임이 직접 실험으로 확인됐다
#   (같은 가중치를 HHW/CSS test 에 돌리면 90% / 76% 가 나온다). 확대로는 안 풀린다.
HYP = {
    "model":   "yolo26s.pt",
    "imgsz":   640,
    "epochs":  30,       # ★ 09-12 정정 — v5·v6 가 30 이었다. 20 이면 자료 효과와 학습 조건 효과가 안 갈린다(codex 1차 지적)
    "batch":   64,       # ★ 같은 이유. v5·v6 실행 batch 64(A100 자동). 다른 GPU 면 여기서 멈추고 사람이 정한다
                         #   ★ 09-13 사용자 결정 — 이 계정은 A100 권한이 없다(배정됐다가 70분 만에 회수).
                         #     T4 에서는 **32**. accumulate 2 로 실효 배치 64 가 유지되고 weight_decay·lr 일정이 같다.
                         #     남는 차이는 BatchNorm 통계(32장 vs 64장) 하나 — 결과 해석에 이 조건을 같이 적는다.
    "device":  0,
    "project": None,     # ← 런타임에 DRIVE/runs 로 채운다
    "name":    "yolo26s_640_v7a_nc",   # ★ run A. run B 는 v7b — 같은 자리를 덮지 않게
}
TORCH_PIN = "2.11.0+cu128"      # Colab A100 에서 확인된 판


def sh(cmd):
    print(f"$ {cmd}", flush=True)
    subprocess.run(cmd, shell=True, check=True)


def resolve_drive():
    """vitalguard-ppe 폴더를 **이름이 아니라 내용물**로 찾는다.
    ★ 팀원 드라이브에 같은 이름이 있으면 Google 이 `vitalguard-ppe (1)` 로 붙인다.
      5차에서 실제로 겪었다 — **이름은 식별자가 아니다.**"""
    root = "/content/drive/MyDrive"
    cands = [os.path.join(root, d) for d in os.listdir(root) if d.startswith("vitalguard-ppe")]
    hit = [c for c in cands if os.path.exists(os.path.join(c, "datasets", "e63_yolo.tar"))]
    if len(hit) != 1:
        sys.exit(f"[중단] vitalguard-ppe 를 내용물로 특정 못 했다. 후보 {cands} · 적중 {hit}")
    return hit[0]


def count_labels(root):
    """만들어진 데이터셋의 train 라벨을 **실제로 센다.** FRACTION 으로 되짚지 않는다."""
    c = Counter()
    d = os.path.join(root, "train", "labels")
    for f in os.listdir(d):
        if not f.endswith(".txt"):
            continue
        for ln in open(os.path.join(d, f)):
            p = ln.split()
            if len(p) == 5:
                i = int(p[0])
                # ★ 09-12 — 범위 밖을 **버리지 않고 센다.** 8클래스로 줄였으므로 507 이 섞여 들어오면
                #   인덱스 8(no_safety_shoes)이 나온다. 종전 코드는 그것을 조용히 버려
                #   「507 이 없다」와 「507 이 있는데 안 셌다」가 같은 출력이 됐다.
                c[NAMES[i] if 0 <= i < len(NAMES) else f"__범위밖_{i}"] += 1
    return c


def verify(actual):
    """선언한 계획과 실제를 대조한다. 어긋나면 **학습 전에** 멈춘다."""
    bad = []
    for cls, (lo, hi) in PLAN["expect"].items():
        n = actual.get(cls, 0)
        if lo is not None and n < lo:
            bad.append(f"{cls} {n} < 하한 {lo}")
        if hi is not None and n > hi:
            bad.append(f"{cls} {n} > 상한 {hi}")
    # ★ 범위 밖 인덱스가 하나라도 있으면 멈춘다 — 507 이 섞였거나 변환이 9클래스로 남은 것이다
    for k, n in sorted(actual.items()):
        if k.startswith("__범위밖_"):
            bad.append(f"{k} {n}개 — 8클래스 밖의 라벨이다. 507 혼입이나 9클래스 변환을 의심한다")
    print("\n── 5차(기준선) · 6차 대비 ──")
    print(f"{'클래스':16s} {'5차':>8s} {'6차':>8s} {'7차':>8s} {'5차대비':>9s}")
    for k in NAMES:
        f5, f6, b = FIFTH.get(k, 0), SIXTH.get(k, 0), actual.get(k, 0)
        print(f"{k:16s} {f5:8,d} {f6:8,d} {b:8,d} {b - f5:+9,d}")
    print(f"{'no_safety_shoes':16s} {0:8,d} {SIXTH['no_safety_shoes']:8,d} "
          f"{'-':>8s}   ← 507 제외로 7차에 없다(보류)")
    if bad:
        sys.exit("[중단] 계획과 실제가 다르다 —\n  " + "\n  ".join(bad))
    print("\n계획 대조 통과")


def manifest(root, actual, drive):
    """무엇으로 학습했는지를 **산출물 옆에** 남긴다. 다음 차수가 고고학을 하지 않도록."""
    head = subprocess.run("git rev-parse HEAD", shell=True, capture_output=True,
                          text=True).stdout.strip() or "unknown"
    m = {"commit": head, "plan": PLAN, "hyp": HYP, "torch_pin": TORCH_PIN,
         "actual_labels": dict(actual), "sixth_labels": SIXTH,
         "script_sha256": hashlib.sha256(open(__file__, "rb").read()).hexdigest()}
    out = os.path.join(drive, "runs", HYP["name"])
    os.makedirs(out, exist_ok=True)
    json.dump(m, open(os.path.join(out, "manifest.json"), "w"), ensure_ascii=False, indent=1)
    shutil.copy(__file__, os.path.join(out, "train_v7.py"))   # ★ 돌린 그 판을 그대로 박제한다
    print(f"기록 → {out}/manifest.json · train_v7.py")
    return out


def stage(drive):
    """원본을 /content 에 펼쳐 병합 데이터셋을 만든다.

    ⚠ 아직 안 채운 부분이 있다. 지어내지 않고 멈춘다 —
      · css·hhw  Roboflow API 키가 필요하다. 키는 파일에서 읽고 **절대 출력하지 않는다**
      · gdut     ★ 09-12 신규. 맥에 있고 파일럿이 이미 스테이징해 뒀다 —
                 이미지 `runs/pilot_gdut_data/images/train`(2,531 · 해시 분할)
                 라벨   `runs/pilot3_data/labels/train`(GDUT GT + v5 person·vest 의사라벨) ← **그대로 쓴다**
      · cam03    젯슨/[CCTV/ML] 쪽. 장수 미정 — **7차-B 에서만 필요하다**
      · a507     ★ 09-12 결정으로 **스테이징하지 않는다.** 받지도 풀지도 않는다
      · field35 / ppe_sample  ⛔ **스테이징하지 않는다. 시험 전용이다**(위 sources 주석 참조)

    ★ 09-12 확인 — 종전에 적힌 블로커 둘은 **이미 해소돼 있다.**
      · Roboflow 키  ~/.config/roboflow/api_key (권한 600) **존재**
      · SH17 원본    맥 `~/Documents/조달청-공모전 관련자료/SH17/` 에 **존재**(zip 14.1GB · 라벨 8,099)
                     ⟹ 「Drive 에도 맥에도 없다」는 낡은 기록이었다
    """
    raise NotImplementedError(
        "원본 스테이징 미구현 — 남은 것은 배치뿐이다(취득 블로커는 해소됐다).\n"
        "  ① css·hhw 를 Roboflow 에서 내려받아 Drive/datasets 로\n"
        "  ② SH17 zip 을 풀어 Drive/datasets 로(맥에 있다)\n"
        "  ③ e63 는 Drive 에 이미 있다(datasets/e63_yolo.tar)\n"
        "  ④ gdut 은 파일럿 산출물을 그대로 올린다(runs/pilot3_data)\n"
        "  ⛔ field35·ppe_sample 은 올리지 않는다 — 시험 전용")


def main():
    if PLAN["a507_mode"] not in ("exclude", "openvocab", "mask"):   # 결정됨 = "exclude"(09-12)
        # 2026-09-12 — 주석만으론 안 막힌다(codex 1차 지적). 6차는 507 을 helmet 라벨 0개로 넣어
        #   E63 홀드아웃 helmet R −0.110 · 착용자 head 오경보 +53% 를 만들었다. 사람이 정하기 전엔 돌지 않는다.
        sys.exit("[중단] PLAN['a507_mode'] 미정. exclude / openvocab / mask 중 하나를 사람이 정한다.\n"
                 "       권고 = 첫 실행은 exclude (RUNBOOK-7차 계획 v2 A2).")
    # ★★ 09-12 — 7차를 둘로 쪼갠다. 섞으면 helmet 이 촬영 일정에 묶인다.
    #   7차-A (helmet)  GDUT+의사라벨 · 촬영 **불필요** · 지금 돌릴 수 있다
    #   7차-B (vest 자세) 쪼그림 홀드아웃 촬영 뒤
    #   아래 가드는 **7차-B 에만** 건다. RUN 을 "A" 로 두면 cam03 없이 진행한다.
    if PLAN.get("run", "B") != "A" and PLAN["sources"]["cam03_crouch"]["n"] is None:
        # 2026-09-11 저녁 — 막는 이유가 바뀌었다.
        #   종전: 기전이 불확실해서 넣을지 모름
        #   지금: 기전은 섰다(넣는다). **홀드아웃이 아직 안 찍혀서 몇 장을 남길지 모른다**
        sys.exit("[중단] 쪼그림 장수 미정. **방향은 확정(넣는다)이고 수량만 남았다.**\n"
                 "       근거 — 조끼 conf 가 서기 0.67~0.69 에서 쪼그림 0.036~0.082 로 8~19배 떨어진다.\n"
                 "              서기 기준점은 두 자료에서 독립 확인됐다(CAM-03 0.671~0.685 · 현장 0.686).\n"
                 "              그리고 쪼그림 정면(25.0px)이 뒷면(23.0px)보다 **크면서 더 나쁘다**\n"
                 "              (0.000 vs 0.207) — 거리로 설명이 안 된다.\n"
                 "       ★ 남은 것은 홀드아웃 촬영뿐이다. 쪼그림 55장이 전부라 쪼갤 수 없고,\n"
                 "         몇 장을 넣을지는 몇 장을 남길지가 정해져야 정해진다.")

    sh(f"pip -q install 'torch=={TORCH_PIN}' ultralytics")
    from google.colab import drive as gdrive           # noqa: 코랩 전용
    gdrive.mount("/content/drive")
    drive = resolve_drive()
    HYP["project"] = os.path.join(drive, "runs")

    root = stage(drive)
    actual = count_labels(root)
    verify(actual)
    out = manifest(root, actual, drive)

    from ultralytics import YOLO
    YOLO(HYP["model"]).train(data=os.path.join(root, "data.yaml"),
                             imgsz=HYP["imgsz"], epochs=HYP["epochs"],
                             batch=HYP["batch"], device=HYP["device"],
                             project=HYP["project"], name=HYP["name"])
    print(f"끝. labels.jpg 와 data.yaml 이 {out} 에 남는다")


if __name__ == "__main__":
    main()
