# P0 — 라벨 정의서 (조작적 정의)

> 목적: 팀원 누가 라벨해도 같은 결과가 나오도록 "무엇을 보고 어떤 라벨을 붙이는지"를 문장으로 고정.
> 라벨 단위 = 충격 후보 이벤트 1건(`fall_candidate_id`). 원시 시계열이 아니라 이벤트당 1행.

## 1. 주 라벨 (층2 · 3-class)

| 라벨 값 | 한글 | 정의 (이것을 보면 이 라벨) | 대표 예시 |
|---|---|---|---|
| `work_impact` | 작업충격·일상(음성) | 몸통이 지면으로 넘어가지 않음. 충격이 손·팔에 국소적이거나 반복적. 동작 후 곧바로 원래 자세 복귀 | 망치질, 공구 내려놓기, 계단 내려디딤, 뛰기/점프, 팔 크게 휘두름, 문·물건 세게 다룸 |
| `trip_samelevel` | 넘어짐(동일평면) | 같은 바닥에서 미끄러지거나 걸려 몸통이 지면 쪽으로 회전. 종료 시 눕거나 주저앉은 자세 | 걸려 넘어짐, 미끄러짐, 헛디딤 |
| `fall_height` | 추락(높이) | 높이차(계단·발판·개구부)에서 떨어짐. 자유낙하 구간 선행 후 큰 충격 | 사다리·비계에서 떨어짐, 개구부 추락 |

### 경계 판정 규칙 (헷갈릴 때)
- **몸통 회전 여부**가 1차 기준: 손목만 움직였으면 `work_impact`, 몸이 넘어갔으면 `trip`/`fall`.
- `trip` vs `fall`: 높이차·자유낙하 있으면 `fall_height`, 같은 평면이면 `trip_samelevel`.
- 연기(각본) 수집은 **수행자가 무슨 동작을 했는지 이미 알고 있으므로** 라벨이 확정적. 자연 수집분만 영상·상황으로 판정 필요.

### 무충격 경로(실신) 라벨 — 03-syncope-layer.md 통합
충격이 약하거나 없는 쓰러짐은 위 3분류와 **다른 축**이다(고G 게이트 비종속). 함께 라벨한다:

| primary_label | 정의 | 결정 신호 |
|---|---|---|
| `presyncope` | 의식 있는 전조(어지럼·시야흐림·메스꺼움) | SOS 자기신고 / 사후 문진 |
| `no_impact_collapse` | 충격 없이 주저앉음·미끄러짐·기댐 후 무동작 | 저G + 장시간 무동작 + 자세변화 |
| `post_event_immobility` | 사건(충격/무충격) 후 지속 무동작 | motion_still_sec 지속 |
| `non_event_immobility` | 정상 무동작(휴식·앉은작업·기대기, 음성) | 취소됨 / 정상 맥락 |

신호품질 라벨(별도 축): `ppg_dropout`, `device_off_body` — PPG 끊김을 서맥으로 오해 금지.

## 2. 심각도 라벨 (층3 · 이진, trip/fall 에만)

| 라벨 값 | 한글 | 정의 |
|---|---|---|
| `recovered` | 회복 | 충격 후 스스로 기립·이동. `motion_still_sec` 짧음 |
| `collapsed` | 쓰러짐 | 충격 후 계속 정지(무회복). 실신·온열질환 의심. `motion_still_sec` 지속 |

- `work_impact` 은 심각도 라벨 없음(공백).
- 각본 수집 시 **양성의 약 1/3은 `collapsed` 연기**(넘어진 뒤 계속 누워 있기)로 층3 정답 확보.

## 3. 이벤트당 메타데이터 (라벨과 함께 기록)

| 필드 | 값 | 이유 |
|---|---|---|
| `fall_candidate_id` | UUID (DB 자동) | 수집된 특징 행과 연결 |
| `primary_label` | 위 3-class | 층2 정답 |
| `motion_subtype` | 음성이면 세부동작(hammer/tool_drop/stairs/jump/arm_swing/…) | 음성 다양성 커버 확인 |
| `severity_label` | recovered/collapsed/(공백) | 층3 정답 |
| `wrist` | left/right | 손목 좌우 회전 부호 차이 보정 |
| `subject_id` | EMP-… | subject-disjoint 분리 필수 |
| `collection` | scripted/natural | 라벨 신뢰도 구분 |
| `note` | 자유 | 특이사항 |

## 4. 라벨 저장 위치 (설계)

- 특징(feature)은 이미 `vital_samples`(DB)에 `fall_candidate_id` 로 존재.
- 라벨은 **별도 파일**로 관리(코드·DB 변경 없이 시작): `docs/fall-ml-relabel/labels.csv`
  - 헤더: `fall_candidate_id,primary_label,motion_subtype,severity_label,wrist,subject_id,collection,note`
  - EDA 스크립트가 이 CSV 와 DB 특징을 `fall_candidate_id` 로 조인.
- (선택·후순위) 규모가 커지면 `fall_labels` 테이블 신설. 지금은 CSV 가 가장 싼 시작.

## 5. 하지 말 것

- G값(세기)만으로 라벨 붙이지 말 것 — 망치질도 고G가 나온다. **동작(사건)** 으로 라벨.
- 자연 수집분 전수 라벨 금지 — 게이트 통과한 경계 샘플만.
- 합성상수(`peak_rotation_rad_s=7` 고정) 세션은 라벨 대상 제외 — `note` 에 `synthetic` 표기 후 학습 배제.
