# PPE 모델 — 데이터셋·프레임워크 라이선스와 상용 반입 가능 여부

작성 2026-07-31. 대상 = `ppe_yolo26s_640_v{3,4,5,6}_nc.*` 계열 전부.
학습 구성은 [ml/ppe-detection/README.md](../ml/ppe-detection/README.md),
경과는 [ppe-ml-run-20260729.md](ppe-ml-run-20260729.md).

> **한 줄 — 데이터를 전부 갈아엎어도 상용 납품이 되지 않는다.**
> 최대 걸림돌은 데이터가 아니라 **Ultralytics YOLO 의 AGPL-3.0** 이고,
> 이건 재학습으로 해결되지 않는다. **Enterprise 라이선스 구매 또는 프레임워크 교체**뿐이다.

---

## 1. 지금 가중치에 들어간 것

| # | 출처 | 기여 클래스 | 라이선스 | 상용 | 근거 |
|---|---|---|---|---|---|
| 1 | **SH17** (Kaggle `mugheesahmad/sh17-dataset-for-ppe-detection`) | `person` `head` `foot` `shoes` `hands` `gloves` `safety_vest` | **CC BY-NC-SA 4.0** | ❌ **불가** | 다운로드 로그 `License(s): CC-BY-NC-SA-4.0` |
| 2 | **CSS** (Roboflow `roboflow-universe-projects/construction-site-safety` v27) | `person` `head` `helmet` `safety_vest` | CC BY 4.0 (⚠️ 미검증) | 🟡 조건부 | 노트북 주석 · **원본 확인 필요** |
| 3 | **HHW** (Roboflow `joseph-nelson/hard-hat-workers` v13) | `head` `helmet` `person` | ⚠️ **미검증** | ⚠️ 불명 | **확인 필요** |
| 4 | **AI Hub E63** (082 전기설비 공사현장 위험상태 판단) | `head` `helmet` | AI Hub 조건 | ❌ **별도 협의** | AI Hub 이용정책 |
| 5 | **AI Hub 507** (122 고소작업 현장 실시간 영상) | `no_safety_shoes` `head` | AI Hub 조건 | ❌ **별도 협의** | 동일 |
| 6 | **COCO 사전학습** `yolo11x.pt` (person 자동 라벨 생성) | `person`(의사라벨) | AGPL-3.0 (가중치) / COCO 주석 CC BY 4.0 | ❌ 아래 참조 | Ultralytics |
| 7 | **베이스 모델** `yolo26s.pt` | 전 클래스 | **AGPL-3.0** | ❌ 아래 참조 | Ultralytics |
| 8 | **프레임워크** `ultralytics` | — | **AGPL-3.0** | ❌ **최대 걸림돌** | 아래 3절 |

**결론 — 현행 가중치는 `_nc` 가 맞다.** 1·4·5 세 출처만으로도 상용 불가이고,
6~8 이 그 위에 얹힌다.

---

## 2. AI Hub 조건 (E63 · 507 공통)

공식 이용정책 실측 인용.

```
학습 전용    "본 AI데이터는 인공지능 학습모델의 학습용으로만 사용할 수 있습니다"
재배포 금지  "제공 받은 AI데이터 등을 … 승인을 받지 않은 다른 법인, 단체 또는 개인에게
             열람하게 하거나 제공, 양도, 대여, 판매하여서는 안됩니다"
출처 표기    "반드시 한국지능정보사회진흥원의 사업결과임을 밝혀야"
국외 제한    "국외에 소재하는 법인, 단체 또는 개인이 … 별도로 합의가 필요"
```

**실무 함의**

- **상용 이용은 수행기관 + 한국지능정보사회진흥원 별도 협의**가 전제다. 불가가 아니라 **협의 대상**이다
- **가중치 재배포도 걸릴 수 있다** — 학습 결과물이 "AI데이터 등"에 해당하는지는 해석 문제다.
  조달청 납품처럼 제3자에게 산출물을 넘기는 형태라면 **사전 문의가 안전하다**
- 신청은 데이터셋마다 별개다(E63 승인 ≠ 507 승인)
- 국내 법인이므로 국외 제한 조항은 해당 없음

---

## 3. ★ 최대 걸림돌 — Ultralytics AGPL-3.0

데이터를 전부 CC BY 로 갈아끼워도 **여기서 막힌다.**

```
AGPL-3.0 의무 (Ultralytics 공식 라이선스 안내 인용)
  "Publicly releasing the complete corresponding source code for the entire
   derivative work, including the larger application, modifications, scripts,
   configuration files, and, where applicable, model weights."
```

**"전체 파생 저작물"에 우리 앱·서버·설정·가중치가 전부 포함**된다.
AGPL 은 GPL 과 달리 **네트워크 서비스로 제공만 해도** 소스 공개 의무가 발생한다
(ASP 루프홀 차단). 관제 웹·Cloud Run 추론 서버가 정확히 그 형태다.

### 선택지

| | 내용 | 비용 | 판단 |
|---|---|---|---|
| **A** | **Ultralytics Enterprise 라이선스 구매** | 조직 규모·용도별 개별 견적 | 가장 단순. **데이터 문제와 별개로 어차피 필요** |
| **B** | 전체 소스 공개(AGPL 준수) | 0원 | 조달청 납품 소프트웨어 전체 공개 = 현실성 낮음 |
| **C** | **프레임워크 교체** — AGPL 아닌 검출기로 재학습 | 재학습·재검증 비용 | 예 = MMDetection(Apache-2.0) · Detectron2(Apache-2.0) · RT-DETR 계열(구현별 확인) |

> ⚠️ **`yolo26s.pt`·`yolo11x.pt` 사전학습 가중치도 AGPL** 이다. C 로 가면 베이스 모델까지 바꿔야 한다.

---

## 4. 상용 빌드용으로 남는 것

지금 8클래스를 **상용 가능 데이터만으로** 재구성하면 이렇게 된다.

| 클래스 | 현행 주 공급원 | 상용 대체 가능성 |
|---|---|---|
| `head` `helmet` | E63(AI Hub) · HHW · CSS · SH17선별 | 🟡 CSS + HHW(라이선스 확인 시). **E63 을 잃으면 국내 도메인이 사라진다** |
| `person` | SH17 + CSS + 자동 라벨 | 🟡 CSS + COCO 계열 공개셋 |
| `safety_vest` | CSS 단독(1,028개) | 🟡 CSS 만 남음 — 이미 과업 제외 |
| `foot` `shoes` | **SH17 단독**(759 / 4,560) | ❌ **전멸** — SH17 이 유일 출처다 |
| `hands` `gloves` | **SH17 단독** | ❌ **전멸** |
| `no_safety_shoes` | 507(AI Hub) 단독 | ❌ **전멸** |

**즉 상용 빌드로 남는 것은 `head`·`helmet`·`person`·`safety_vest` 네 종뿐이고,
국내 현장 도메인(E63)을 잃는다.** 5차에서 확인했듯 도메인이 빠지면 그 장면에서
검출이 통째로 무너진다(9-1절 도메인 얽힘).

---

## 5. 판단

**현 단계(공모전·실증)에서는 문제없다.** `_nc` 로 관리하고 상용 파이프라인에 넣지 않으면 된다.
지금까지의 모든 산출물이 그 규칙을 지키고 있다.

**상용화 단계에서는 두 가지를 같이 풀어야 한다.**

```
① Ultralytics Enterprise 라이선스   ← 데이터와 무관하게 어차피 필요
② 국내 현장 데이터 자체 확보         ← E63·507 을 대체할 유일한 길
```

②는 **이미 필요한 일과 겹친다.** 6차에서 안전화 판정이 "일반화를 잴 수 없어" 보류된 이유가
공개셋에 독립 표본이 없어서였고(17-7절), 해법으로 잡은 것이 **직접 촬영**이다.
**자체 촬영·자체 라벨링 데이터는 성능 문제와 라이선스 문제를 동시에 푼다.**

→ **사진 30장은 성능 시험지일 뿐 아니라 상용 데이터 자산의 시작점이다.**

---

## 6. 미결 — 확인해야 할 것

```
□ HHW (joseph-nelson/hard-hat-workers v13) 라이선스   ← 미검증
□ CSS (construction-site-safety v27) 라이선스          ← 노트북 주석은 CC BY 4.0, 원본 미확인
□ AI Hub 학습 산출 가중치의 제3자 납품 가능 여부        ← 해석 문제. 사전 문의 권장
□ Ultralytics Enterprise 견적                          ← 상용화 착수 시
```

**Roboflow 는 웹 접근이 차단(403)되고 API 는 키를 요구한다.** 확인 방법은 둘이다.

```bash
# ① API (키 필요 — Colab getpass 로 쓰던 그 키)
curl -sS "https://api.roboflow.com/joseph-nelson/hard-hat-workers?api_key=<KEY>" | python3 -m json.tool | grep -i license
curl -sS "https://api.roboflow.com/roboflow-universe-projects/construction-site-safety?api_key=<KEY>" | python3 -m json.tool | grep -i license

# ② 다운로드 폴더의 동봉 문서 (Colab 세션에서만 존재)
cat /content/raw/hhw/README.dataset.txt /content/raw/css/README.dataset.txt
```

②가 더 간단하다 — **다음 학습 세션에서 데이터 다운로드 직후 한 줄 실행**하면 된다.
