# 갤럭시워치(Wear OS) 통합 가이드

애플워치판(통합가이드.md)과 동일한 계약의 Kotlin 포팅. **판정 로직·모델·임계 전부 동일**하고,
추론 런타임만 Core ML → **ONNX Runtime** 이다.

## 구성물

| 폴더 | 내용 | 앱에서의 위치 |
|---|---|---|
| `SourcesWearOS/` | 판정 코어 6파일 + FallShadowReporter(섀도 보고) (Kotlin, `package com.vitalguard.ml`) | `src/main/kotlin/com/vitalguard/ml/` |
| `ModelsWearOS/` | `work_veto.onnx` `impact.onnx` `recovery.onnx` + `thresholds.json` + `ml_selfcheck.json` | `src/main/assets/` |

모듈 업데이트 흐름(애플워치와 동일 계약): ML 담당이 새 버전 커밋 → 앱 담당은 **위 두 폴더 내용을 통째 교체** →
[ML 자가검증] ✅ 확인 → 끝. 통합 코드는 바뀌지 않는다.

## Gradle 의존성 (1개)

```kotlin
implementation("com.microsoft.onnxruntime:onnxruntime-android:1.20.0")
```

## 배선 4조각 (애플워치판과 동일 구조 — 참조 구현 = vitalguard_app/android/wear 의 CollectorService.kt)

1. **센서 → 단위 변환**: `TYPE_ACCELEROMETER`(50Hz = 20,000µs) 값은 m/s²·정지 시 +1g.
   학습 데이터 규약(애플워치: G 단위·정지 시 축값 -1g)으로 변환해 공급한다:
   `a_모듈 = -a_안드로이드 / 9.80665`. 자이로(`TYPE_GYROSCOPE`)는 양쪽 다 rad/s — 그대로.
2. **로거**: 변환된 6축 + totalG 를 `ImuWindowLogger.ingest(..., nowNs = event.timestamp)` 로 매 샘플 공급.
3. **판정**: `logger.onWindow = { w -> module.assess(w) }` → `Verdict.decision` 이 `DANGER` 면 카운트다운.
   `Verdict.trace` 는 신고 payload·로그에 그대로 실을 것 (README 추적성 계약 — `module_version` 포함).
4. **카운트다운**: `CountdownGuard.start()` 후 매 샘플 `feed(totalG)`. 버튼 → `cancelByUser()`.

## ONNX 모델 출처·검증 (2026-08-27)

- sklearn 원본(joblib, `모델산출물/`)에서 skl2onnx 1.20.0 으로 변환 (opset 17 / ai.onnx.ml 3 / IR 9).
- 변환 검증: 자가검증 정답지 6건 + recovery 206벡터에서 **sklearn 대비 확률오차 최대 9.6e-7**
  (수용 게이트 0.01 — Core ML 변환 때와 동일 기준).
- `.mlmodel` 과 `.onnx` 는 같은 joblib 에서 나온 형제 산출물 — 모델 교체 시 둘 다 재변환할 것.

## 실탑재 위치 (2026-08-27)

`기존_조달청모듈/safetymonitor/apps/vitalguard_app/android/wear/` — 코어 6파일은
`src/main/kotlin/com/vitalguard/ml/`, onnx·정답지는 `src/main/assets/`. 모듈 업데이트 시
이 두 위치를 통째 교체하면 된다. 판정의 서버 섀도 적재(fallTrace)는 모듈의
`FallShadowReporter`(v6.1.1부터 모듈 소속)가 담당 — 추적기의 생성과 전송이 한 경계 안에 있어
전송 계층 변조·오류도 모듈 무결성 검사로 추적된다. 앱 배선은 enqueue 콜백·onVerdict·feed 3점뿐.

## 검수 3단계 (애플워치판과 동일)

① `verify_module.sh`(파일 무결) ② 워치 [ML 자가검증] 6/6 ✅(기능 정상) ③ `Verdict.trace`·DB 재계산(판정 재현)

## 알려진 한계 (정직 기재)

- **모델은 애플워치 착용 데이터로 학습**됨. 갤럭시워치는 센서 특성·손목 축 방향(x/y 물리 배치)이 다를 수
  있어, 자가검증(수치 이식 확인)과 별개로 **실기기 시나리오 검증(낙상 4종·작업동작 오탐 라운드)이 필수**.
  결과가 나쁘면 갤럭시워치 수집분으로 증량 재학습이 답이다(삭제가 아니라 추가 — v4 교훈).
- recovery 는 정답지에 없어(애플워치판과 동일) 자가검증은 work_veto·impact 6건 기준이다.
- 애플판 섀도 보고는 `Sources/FallShadowReporter.swift` — 같은 계약, 릴레이 축약 키 차이만 있다.
