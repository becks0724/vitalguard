# 문헌 대조 — 우리 판정·알고리즘은 어디까지 근거가 있나 (2026-08-15)

목적 = 오늘까지 문서·프로세스·알고리즘으로 굳힌 것들을 **검증하고 비판**한다.
"우리가 문헌에서 가져왔다" 고 적은 것이 실제로 그렇게 쓰이는지, 한계가 무엇인지.

> **결론 먼저 — 네 건이 심각하다.**
> ① 체감온도를 법정 판정 축으로 쓰는 것은 **직업보건 문헌과 정반대**다
> ② 심부체온 추정 모델은 **하필 우리 알림 임계 구간(37.75~38.5℃)에서 가장 부정확**하다
> ③ PSI 는 **개인 수준 판정에 부적합**하다는 반박 논문이 있는데 우리는 작업자별로 띄운다
> ④ 무동작 기반 착용 판별은 **손목에서 특히 약하고**, 표준 알고리즘은 90**분**을 쓴다(우리 후보는 90**초**)

---

## 판정별 대조표

| 우리 주장 | 문헌 | 판정 |
|---|---|---|
| PSI 임계 6 / 7.5 는 문헌값 | Moran 1998 · 0~10 척도 · **≥7.5 = high risk** | ✅ **지지** |
| PSI 로 작업자별 부담을 표시 | 2021 EJAP — *"PSI 는 열 내성 한계에 도달할 개인을 신뢰성 있게 식별하지 못한다"* · 지수들이 **집단 평균 기반이라 개인 수준 측정에 부적절** | ⚠️ **반박** |
| Buller 심부체온 추정 RMSE 0.21~0.30℃ | Buller 2013 · 검증 **0.249 ± 0.0955℃** | ✅ **지지** |
| 그 추정으로 37.8/38.0℃ 알림 단계를 만든다 | 같은 계열 연구 — **37.75~38.5℃ 시작 구간에서 큰 과소추정**, 급변에 느리게 반응, **회복 국면이 활동 국면보다 부정확**(HR–심부체온 관계의 히스테리시스), 초기값 의존(~30분) | ❌ **정면 반박** |
| WBGT 를 Liljegren(2008) 로 구현 | **"gold standard"** · 가장 정확한 근사로 널리 인정 | ✅ **지지** |
| OSHA 계산기와 ±0.03℃ 일치 = 검증됨 | Liljegren 자체 정확도 **약 1℃** · 기상대 입력 기반은 실측 대비 평균 **+0.2℃** | ⚠️ **범위 오인** — 모델과의 일치이지 **실측과의 일치가 아니다** |
| **체감온도가 법정 판정 축, WBGT 는 참고** | WBGT 가 **직업 열스트레스의 gold standard**. Heat index 는 **그늘·안정 상태 기준**이고 일사·풍속·작업강도를 반영 못 해 *"WBGT 를 대체하지 않는 스크리닝 도구"*(OSHA) | ❌ **정면 반박(법 vs 과학)** |
| 저활동·고심박 = 열 축적·탈수 신호 | 방향은 지지 — 탈수 → 혈장량 감소 → 심박 상승, 열 노출이 심혈관 부담 가중. HRV 가 탈수·고체온 상태를 판별 | ⚠️ **방향만 지지 · 임계 근거 없음** |
| 무동작 90초 = 실신 후보 | 표준 non-wear 알고리즘(Choi 2011)은 **90분** 0 counts 를 쓴다. 손목 착용 일치도 **0.78**(엉덩이 0.92) | ⚠️ **자릿수 차이 · 손목이 특히 약함** |
| 확인 프롬프트 후 무응답 시 danger 격상 | Nature 2025 소비자 워치 loss-of-pulse — **57초 감지 + 20초 응답 대기 후 응급 호출** | ✅ **구조 동일** |
| 심박 없음으로 심정지를 의심 | 같은 논문 — **on-wrist 확인이 된 경우에만** loss-of-pulse 분류를 낸다. 가속도로 움직임을 분석해 확인·기각 | ⚠️ **전제 결손** — 우리는 착용 감지가 없다 |

---

## 1. ❌ 체감온도 vs WBGT — 법과 과학이 갈린다

우리 구조는 **체감온도 = 법정 판정(31/33/35℃)**, **WBGT = 참고 지표(판정 미주입)** 다.
근거는 *"법령이 '기상청이 측정한 체감온도' 를 지정했다"* 이고 **그 자체로는 옳다.**

**그런데 직업보건 문헌은 정확히 반대로 말한다.**
- WBGT 는 기온·습도·**복사열·풍속** 네 축을 전부 반영하는 직업 열스트레스의 gold standard.
- Heat index(체감온도 계열)는 **그늘에서·안정 상태로** 정의되며 **일사·풍속·작업부하를 반영하지 않는다.**
- OSHA — heat index 는 *"더 정확한 WBGT 기반 위험성 평가를 대체하지 않는 스크리닝 도구"*.
- WBGT↔Heat index 상관이 불완전해 **노출기준을 직접 환산할 수 없다**는 연구 결과.

**건설 옥외 작업은 이 격차가 가장 큰 조건이다** — 직사광선 아래 중작업이 정확히 heat index 가
과소평가하는 상황이다.

**⟹ 우리 문서의 결함은 "체감온도를 쓴 것" 이 아니라 "왜 그것이 과학적으로 열등한지를 적지 않은 것"이다.**
법령 준수는 유지하되 **WBGT 가 더 정확한 지표이며 체감온도만 보면 옥외 중작업에서 과소평가된다**는
사실을 문서와 화면 고지에 넣어야 한다. 지금 WBGT 모달 고지는 *"실외 기준이라 실내엔 과대"* 만 적고
**반대 방향(체감온도가 옥외 작업을 과소평가)** 은 적지 않았다.

## 2. ❌ 심부체온 추정 — 우리 임계가 모델의 최악 구간에 놓였다

우리 알림 단계 = **주의 37.8℃ · 경고 38.0℃**.
문헌이 지목한 취약 구간 = **37.75~38.5℃ 에서 큰 과소추정**(추정 시작 부근).

**우리가 고른 두 숫자가 그 구간의 시작점에 정확히 들어간다.** 과소추정이면 **알림이 늦거나 안 뜬다** —
안전 방향이 아니다. 게다가

- **회복 국면이 더 부정확**하다(히스테리시스). 온열 ②·③ 이 잡으려는 상황이 바로 *"쉬는데(=회복 국면)
  심박이 안 내려옴"* 이라 **하필 모델이 약한 국면**이다.
- **초기값 의존이 약 30분** 간다. 우리는 `CT0 = 37.1℃` 고정이고, 워커가 이미 더운 상태에서 출근하면
  첫 30분이 과소추정된다.
- 급변에 느리게 반응한다.

⚠ 이것은 "추정을 쓰지 말라" 가 아니다. 우리는 이미 **판정 미주입**(표시 전용)으로 두었고 그 결정은
옳았다. 문제는 **온열 ③ 알림 단계가 그 추정 위에 세워졌다**는 것이다.

## 3. ⚠️ PSI — 개인 수준 판정에 부적합하다는 반박

임계 6/7.5 는 원 논문과 일치한다. 그러나 2021 년 EJAP 논문 제목 자체가
**"PSI 는 열 내성 한계에 도달할 개인을 신뢰성 있게 식별하지 못한다"** 이고,
비판의 요지는 **이 지수들이 집단 평균 반응 기반이라 개인 수준의 위험 판정에 쓰기 어렵다**는 것이다.

우리는 PSI 를 **작업자별 카드에** 띄운다 — 정확히 그 비판이 겨냥하는 사용법이다.
다만 우리도 **판정·경보에는 미주입**(표시 전용)이라 피해는 제한적이다.
**화면 고지에 "개인 판정용이 아니다" 를 넣는 것이 정직하다.**

## 4. ⚠️ 무동작 기반 판별 — 손목이 가장 어려운 부위다

- 표준 non-wear 알고리즘(**Choi 2011**) = **90분** 연속 0 counts + 2분 허용 + 앞뒤 30분 창.
- 자유생활 검증에서 **손목 착용 일치도 0.78**, 엉덩이 0.92 — **손목이 더 어렵다.**
- 우리 `collapse` 임계는 **90초**다. 목적이 다르지만(실시간 응급 vs 역학 집계) **자릿수 3개 차이**이고,
  90초로 "미착용" 을 판정하면 오탐이 압도적일 것이라는 방향은 분명하다.

**⟹ 오늘 추가한 `motionStillSec` 는 "미착용 판별" 에 단독으로 쓸 수 없다.**
실신·심정지 판별의 **보조 축**으로만 쓰고, 착용 여부는 다른 근거가 필요하다.

## 5. ✅ 심정지 감지 구조는 문헌과 같다 — 다만 전제가 빠졌다

Nature 2025 소비자 워치 loss-of-pulse 알고리즘:
```
민감도   무동작·무맥박 72%  ·  모의 붕괴 53%
특이도   99.99%  (오경보 = 사용자 21.67년당 1회)
동작     57초 내 맥박 소실 감지 → 20초 응답 대기 → 응급 호출
가속도   움직임 분석으로 확인·기각
```
**우리 설계(무동작 + 심박 소실 → 확인 프롬프트 → 무응답 시 격상)와 구조가 같다.** 좋은 검증이다.

⚠ **다만 그 논문은 on-wrist 확인이 된 경우에만 분류를 낸다.** 우리는 착용 감지가 없고,
오늘 실증한 대로 상시 워크아웃이 손목 감지를 우회한다. **전제가 빠진 채 결론 구조만 같다.**

그리고 특이도 목표가 **99.99%** 라는 것에 주목해야 한다 — 이 종류의 경보는 **오탐이 조금만 있어도
쓸 수 없다.** [vital-absence-triage](../vital-absence-triage/checklist.md) 에 *"오탐 쪽으로 기운다"*
고 적었는데, 문헌 기준으로는 **그 방향이 곧 기능 폐기**다. 재검토가 필요하다.

## 6. ⚠️ 저활동·고심박 = 열 축적 — 방향은 맞고 임계는 우리 것

지지 근거는 있다 — 탈수가 혈장량을 줄여 심박을 올리고, 열 노출이 심혈관 부담을 가중하며,
HRV 가 탈수·고체온 상태를 판별한다는 연구들.

**그러나 "창 15분 · 심박 ≥100bpm · 저활동" 이라는 조합과 숫자는 우리가 만든 것이고
문헌에서 대응물을 찾지 못했다.** 우리 코드 주석도 *"임계는 참고값이지 의학 기준이 아님"* 이라
적고 있어 서술은 정직하다. 다만 **온열 ③ 경고 단계가 이 휴리스틱 위에 서 있다**는 점은
문서에 더 분명히 드러나야 한다.

---

## 조치 — A·C·D·F 반영 완료 · B·E 결론 도출(실행은 결정 대기)

| | 조치 | 근거 | 상태 |
|---|---|---|---|
| **A** | WBGT 모달·문서에 **"체감온도는 옥외 중작업을 과소평가한다"** 고지 추가 | §1 | ✅ 배포 `00283-mwz` |
| **B** | 온열 ③ 알림 임계(37.8/38.0℃)를 **추정 모델의 취약 구간**이라는 사실과 함께 재검토 | §2 | ✅ 아래 결론 |
| **C** | PSI 화면 고지에 **"집단 기반 지수 · 개인 판정용 아님"** 추가 | §3 | ✅ 배포 `00283-mwz` |
| **D** | `motionStillSec` 을 **착용 판별 단독 근거로 쓰지 않는다**고 문서에 못 박기 | §4 | ✅ `1f2fb9d` |
| **E** | 미수신 판별의 "오탐 쪽으로 기운다" 원칙 **재검토** — 문헌 특이도 목표는 99.99% | §5 | ✅ 아래 결론 |
| **F** | WBGT 검증 문구를 **"OSHA 계산기와 일치"** → **"모델 구현이 정확 · 모델 자체 오차 약 1℃"** 로 정정 | §1 | ✅ 배포 `00283-mwz` |

### 조치 B 결론 (2026-08-16) — 임계보다 **경고 단계가 죽어 있는 것**이 먼저다

라이브 실측으로 세 가지가 확인됐다.

```
heat-alert.ts        라이브 알림 경로에 물려 있다 (store.ts → 텔레그램)
env_alert_state      heat:EMP-6861 = normal  ← 유일한 행
alerts 테이블        온열 0건  (fall 2,211 · vital 213 · geofence 35 · sos 8)
⟹ 배포 이래 발동 이력 0건
```

**① 경고(38.0℃) 단계는 구조적으로 발동 불가다.** 조건이 *"38.0℃ 10분 지속 **+ 저활동·고심박 동시**"*
인데 저활동 조건이 태생적으로 거짓이다(실측 하한 분당 2.40 > 임계 1.5). **상위 등급으로 격상되는
경로 자체가 없다.** 이것은 임계값 논쟁 이전의 문제다.

**② 주의(37.8℃)는 살아 있으나 하필 모델이 가장 약한 자리다.** §2 의 취약 구간(37.75~38.5℃)
시작점이고, 과소추정이면 **늦거나 안 뜬다**. 게다가 회복 국면이 더 부정확한데 이 알림이
잡으려는 상황이 바로 회복 국면이다.

**③ 지금이 가장 나쁜 상태다.** 알림이 존재하니 "온열은 감시되고 있다" 로 읽히고,
한 번도 안 떴으니 **작동하지 않는다는 사실을 아무도 모른다.**

**권고 (사용자 결정 필요)**

| | 조치 | 판단 |
|---|---|---|
| **B-1** | 경고 조건에서 **저활동·고심박 동반을 제거** | **이견 없이 해야 한다.** 죽은 조건이다 |
| **B-2** | 임계 37.8/38.0 **유지** | 올리면 더 늦고, 내리면 오탐. 근거 없이 옮기지 않는다 |
| **B-3** | 알림 문구·화면에 **"추정 기반 · 늦을 수 있음"** 명시 | 값을 절대적으로 믿게 두지 않는다 |
| **B-4** | (선택) 화면에 **발동 이력 0건**을 드러낼지 | "감시되고 있다" 는 오독을 막는다. 경보 피로와 맞바꾼다 |

⚠ **임계를 바꾸는 것이 이 문제의 답이 아니다.** §2 가 지적한 것은 숫자가 아니라
**추정 심부체온 위에 알림을 세운 구조**다. 대체 축(PSI)도 §3 에서 반박당했으므로
지금 있는 재료로는 더 나은 축이 없다 — **한계를 드러내고 쓰는 것**이 현재 최선이다.

### 조치 E 결론 (2026-08-16) — 원칙을 **경로별로 쪼갠다**

*"오탐 쪽으로 기운다"* 와 문헌의 99.99% 는 **둘 다 옳고, 충돌은 경로를 안 나눈 데서 온다.**
논문이 재는 것은 **자동 응급 호출**(오탐 = 구급차)이고 우리가 하려는 것은 **화면 표시**다.

```
표시 경로   판별 불가 · 확인 요청   →  민감도 우선.  원칙 유지
알림 경로   텔레그램 · 자동 격상    →  특이도 우선.  문헌 기준 적용
```
⚠ **착용 감지가 없는 한 알림 경로의 조건을 만들 수 없다**(논문도 on-wrist 확인 전제).
**⟹ 알림 경로는 당분간 열지 않는다.** 상세 =
[vital-absence-triage](../vital-absence-triage/checklist.md) §4.

## 출처

- [Moran DS et al. (1998) A physiological strain index to evaluate heat stress. Am J Physiol](https://journals.physiology.org/doi/full/10.1152/ajpregu.1998.275.1.R129)
- [The physiological strain index does not reliably identify individuals at risk of reaching a thermal tolerance limit (2021) Eur J Appl Physiol](https://link.springer.com/article/10.1007/s00421-021-04642-3) · [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8144153/)
- [Core Body Temperature Estimation From Heart Rate — USARIEM](https://usariem.health.mil/index.cfm/research/products/cbt_algorithm)
- [A real-time biphasic Kalman filter-based model for estimating human core temperature from heart rate (PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10961439/)
- [Core body temperature estimation from heart rate via multi-model Kalman filtering (IOPscience)](https://iopscience.iop.org/article/10.1088/1361-6579/ae0efd)
- [Comparison of methods for estimating WBGT index from standard meteorological measurements (PubMed)](https://pubmed.ncbi.nlm.nih.gov/23929057/)
- [Wet Bulb Globe Temperature: Indicating Extreme Heat Risk on a Global Grid (PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9941479/)
- [Actual and simulated weather data to evaluate WBGT and heat index as alerts for occupational heat-related illness (JOEH)](https://www.tandfonline.com/doi/full/10.1080/15459624.2018.1532574)
- [OSHA — Heat Hazard Recognition](https://www.osha.gov/heat-exposure/hazards)
- [Automated loss of pulse detection on a consumer smartwatch (Nature 2025)](https://www.nature.com/articles/s41586-025-08810-9)
- [Automated cardiac arrest detection using a photoplethysmography wristband — DETECT-1 (Lancet Digital Health)](https://www.thelancet.com/journals/landig/article/PIIS2589-7500(23)00249-2/fulltext)
- [Validation of Accelerometer Wear and Nonwear Time Classification Algorithm — Choi et al. (PubMed)](https://pubmed.ncbi.nlm.nih.gov/20581716/)
- [Validation of automatic wear-time detection algorithms in a free-living setting of wrist-worn and hip-worn ActiGraph GT3X+ (PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6393958/)
- [Free-living, continuous hypo-hydration, and cardiovascular response to exercise in a heated environment (PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5913590/)
- [Heart rate variability as an index of physiological strain in hyperthermic and dehydrated rats (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S0306456504000270)
