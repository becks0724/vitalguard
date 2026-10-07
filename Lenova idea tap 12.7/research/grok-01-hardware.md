# Lenovo Idea Tab Pro 12.7 (TB373FU) — 하드웨어·스타일러스·Flutter API 리서치

- 조사일: 2026-09-12
- 조사 주체: Grok (피어 의뢰 #1)
- 원칙: 수치는 출처 URL을 붙인다. 확인 못 한 항목은 **확인 불가**로 명시. 추측으로 채우지 않음. 스펙이 상충하면 양쪽을 적고 어느 쪽이 공식인지 표시.
- 공식 기준: Lenovo PSREF (2026-05-06 판)

> 이 파일은 peers 브로커 전달 실패로 **파일로 재전달**한 전문이다. 요약본이 아니다.

---

## 실기기 adb 실측 (Claude Code 메인, 2026-09-12) — 대조

맥에 USB로 붙인 실기기 실측값. 웹 조사와 **일치**한다. 아래 항목은 이미 확정.

| 항목 | 실측값 | 웹 조사와의 관계 |
|---|---|---|
| 모델 | `TB373FU` · Lenovo · characteristics=tablet | 공식 모델 코드와 일치 |
| USB Product Name | Lenovo Idea Tab Pro | 1세대 12.7" (Gen 2 아님) |
| OS | **Android 16 / API 36** · ZUI **17.5.10.095** · 보안패치 2026-07-05 | 웹에서 확인한 최신 라인(17.5.10.x)과 일치. 이 기기가 그 라인의 최신 빌드 |
| 화면 | 물리 **1840×2944** · density **340** (×2.125) · 논리 **866×1385 dp** · 실측 273.3 dpi → 대각 12.70" | 공식 해상도·PPI와 일치. **densityDpi=340은 공식 미게재 → 실측으로 확정** |
| 주사율 | **144 / 120 / 60 / 30 Hz** (기본 120) · HDR 1~4 · 최대 500 nit | 공식은 144 Hz·400 nits. **기본 120 Hz·500 nit·HDR 모드는 실측이 더 정확** |
| SoC | MediaTek **MT8792** (플랫폼 mt6897) · arm64-v8a | Dimensity 8300의 태블릿 SKU가 MT8792. 공식 마케팅명 Dimensity 8300 / 플랫폼 mt6897과 일치 |
| RAM | 7.87 GB | 8 GB soldered 구성과 일치 (가용 용량) |
| 펜 입력장치 | `touch-pen` (`/dev/input/event3`) · Sources=`TOUCHSCREEN\|STYLUS` · **PRESSURE 0~1 · TILT 0~1.571(=90°) · ORIENTATION ±π · DISTANCE 0~1(호버)** 전부 보고 | 공식 tilt·필압 지원과 일치. 호버(DISTANCE)는 공식 미기재 → **실측으로 확정** |
| 무선 | GPS ✅ / **telephony feature 없음(LTE 없음)** / NFC 없음 | 공식 WWAN Not Supported와 일치 |
| 로케일 | ko-KR | 한국 정식 출시품과 일치 |

실측으로 못 얻는 항목(펜 프로토콜명·필압 단계 수·샘플링레이트·MyScript SDK 라이선스·Lenovo 펜 서비스 공개 API·ROLE_NOTES 구현·Flutter 패키지·저지연 잉킹)은 아래 B·C 및 「실측으로 못 얻는 항목」절에 자세히 적는다.

---

## 대상 기기 특정

USB Product Name `"Lenovo Idea Tab Pro"` = 공식 제품명 **Lenovo Idea Tab Pro** (12.7인치, 2025).

- 공식 모델 코드: **TB373FU** (Wi-Fi / ROW·글로벌)
- 중국 동기종: **TB375FC** (Xiaoxin Pad Pro 12.7 2025). 하드웨어 동일, 펌웨어만 다름 (TB373FU는 ZUI, TB375FC는 ZUXOS)
- 재배지: Moto Pad 60 Pro (XT2571-1)
- 한국 파트번호 예: **ZAE40079KR**. KC: **R-C-LVK-TB373FU**
- ※ 2026년 6월 출시 **Idea Tab Pro Gen 2** (13인치, Snapdragon 8s Gen 4, Android 16) 와는 **다른 기기**. USB명에 Gen 2가 없으면 이 리서치 대상(1세대 TB373FU)이 맞다.

출처:

- https://psref.lenovo.com/syspool/Sys/PDF/Lenovo_Tablets/Idea_Tab_Pro/Idea_Tab_Pro_Spec.PDF (공식 PSREF, 2026-05-06)
- https://psref.lenovo.com/Detail/Idea_Tab_Pro?M=ZAE50004GR (Product: TB373FU)
- https://www.gsmarena.com/lenovo_idea_tab_pro-13733.php
- https://github.com/LosSantosPro/android_device_lenovo_TB373FU

---

# A. 하드웨어 공식 스펙 (전수)

## A.1 정식 제품명 · 모델 코드 · 출시 시기 · 국내 정식 출시 여부

- 정식명: **Lenovo Idea Tab Pro**
- 모델 코드: **TB373FU** (기계 타입 ZAE4/ZAE5. 예: ZAE40079KR / ZAE50004GR)
- 공식 Announce Date: **2024-10-17** (PSREF 개별 모델 페이지)
- GSMArena 출시: 2025-03-14 (비공식. 지역별 판매 시점은 다름)
- 중국 Xiaoxin Pad Pro 12.7 2025: 2024-07-27 출시라는 기술(나무위키). 공식 Lenovo 글로벌 출시와 시점 상이.
- **국내 정식 출시: 예.** 한국레노버/인증 총판 판매. 한국판은 펜 기본 구성. 8/128GB 출고가 약 409,000원(나무위키). Matte 에디션 별도 출시.
  - 레노버 코리아 제품페이지: https://www.lenovo.com/kr/ko/p/tablets/android-tablets/idea-tab-series/lenovo-idea-tab-pro/len103l0026 (이 세션에서는 Access Denied. URL 자체는 존재)
  - KC: R-C-LVK-TB373FU — 예: https://www.ssg.com/item/itemView.ssg?itemId=1000641681770
  - 컴퓨존 판매: ZAE40079KR https://compuzone.co.kr/product/product_detail.htm?ProductNo=1261660
  - 나무위키: https://namu.wiki/w/%EB%A0%88%EB%85%B8%EB%B2%84%20Idea%20Tab%20Pro%2012.7
- 실측 로케일 `ko-KR` → 한국 정식 출시품과 정합.

## A.2 디스플레이 — 인치, 해상도, 종횡비, 주사율, 패널, 밝기, DPI/densityDpi

**공식 (PSREF PDF):**

- 인치: **12.7"**
- 해상도: **2944 × 1840** (3K). 실측 물리 픽셀은 1840×2944 (방향만 다름, 동일)
- 종횡비: **16:10**
- 주사율: **144 Hz** (공식 표기). 실측 지원 모드: **144 / 120 / 60 / 30 Hz, 기본 120 Hz**
- 패널: **LTPS IPS** (IPS/PLS/ADS/AHVA/AAS 포함 가능이라고 주석)
- 밝기: **400 nits** (공식). 실측 최대 **500 nit**. **상충 — 공식 400, 실측 500. 설계에는 실측 500을 상한, 공식 400을 정격으로 병기.**
- 대비: 1500:1
- 색영역: **96% DCI-P3**
- PPI: **273** (공식 표기)
- 터치: In-cell, 10-point multi-touch
- 표면: Glossy 또는 Paper-like Anti-glare(Matte) 두 버전
- 시야각: 85° / 85° / 85° / 85°
- TÜV Flicker Free, TÜV Low Blue Light (Hardware). Matte는 TÜV Reflection Free 추가
- 한국 판매 표기 중 Corning Gorilla Glass 3 언급 있음(컴퓨존). **PSREF PDF에는 유리 표기 없음.**

**계산 PPI:** √(2944² + 1840²) / 12.7 ≈ **273.4 ppi** → 공식 273 및 실측 273.3 dpi와 일치.

**DPI / densityDpi:**

- 물리 PPI: 273 (공식) / 273.3 (실측)
- Android `densityDpi`: 공식 게재 없음. **실측으로 확정: density 340 (scale ×2.125), 논리 해상도 866×1385 dp.**
  - 확인 방법: `adb shell getprop ro.sf.lcd_density` 또는 `dumpsys display`
- HDR: 공식 PSREF에는 HDR10 언급 없음. GSMArena는 HDR10. **실측 HDR 모드 1~4 존재.** 공식은 미기재, 실측이 우선.

**상충 정리:**

| 항목 | 공식 PSREF | 비공식 | 실측 | 채택 |
|---|---|---|---|---|
| 해상도 | 2944×1840 | M3.se 2944×1870 | 1840×2944 | 공식·실측 (1870은 오류) |
| 밝기 | 400 nits | — | 최대 500 nit | 정격 400 / 실측 피크 500 |
| 주사율 | 144 Hz | — | 144/120/60/30, 기본 120 | 실측 모드 목록 |
| HDR | 미기재 | GSMArena HDR10 | HDR 1~4 | 실측 |
| densityDpi | 미기재 | — | 340 | 실측 |

출처:

- https://psref.lenovo.com/syspool/Sys/PDF/Lenovo_Tablets/Idea_Tab_Pro/Idea_Tab_Pro_Spec.PDF
- https://www.gsmarena.com/lenovo_idea_tab_pro-13733.php

## A.3 SoC / RAM / 저장용량 옵션별

**SoC (공식):** MediaTek **Dimensity 8300** (플랫폼 **mt6897**), 4 nm

- 1× Cortex-A715 @ 3.35 GHz + 3× A715 @ 3.2 GHz + 4× A510 @ 2.2 GHz
- GPU **공식: Arm Mali-G615 MC5**
- NPU: MediaTek NPU/APU 780 (리뷰·유통사 표기. PSREF에는 NPU 행 없음)
- 실측 칩 ID: **MT8792** (Dimensity 8300의 태블릿 SKU). 플랫폼 mt6897과 일치.

**GPU 상충:** GSMArena / DeviceSpecifications는 Mali-G615 **MC6**. 공식 PSREF·Lenovo 상품페이지·나무위키는 **MC5**(그래픽 코어 1개 제거). **공식은 MC5.** Notebookcheck도 본문에서 Mali-G615 MP6로 적는 곳이 있음 — 비공식.

**RAM (공식):** LPDDR5X soldered, 비업그레이드

- 8 GB 또는 12 GB
- 실측 가용 **7.87 GB** → 이 대는 **8 GB 구성**
- 한국 판매: 8 GB만 확인. 12 GB 국내 SKU **확인 불가**
- 일부 한국 상품고시 LPDDR4x로 적힘 → **공식은 LPDDR5X.** 고시 오류로 봄.

**저장 (공식):**

- 128 GB **UFS 3.1**
- 256 GB **UFS 4.0**
- microSD 최대 1 TB (exFAT)

GSMArena 옵션: 128GB/8GB, 256GB/8GB, 256GB/12GB.

출처:

- PSREF PDF
- https://www.lenovo.com/my/msd/en/p/tablets/lenovo-idea-tab-pro/len103l0026

## A.4 출고 OS · 현재 최신 OS · Android API level

- 출고: **Android 14** + Lenovo **ZUI 16** (API **34**)
- 공식 업그레이드 약속: Android 14 → 15 → **16** (2 major OS), 보안 패치 4년. 그 이후 major OS 없음.
- **이 대기 현재 (실측 확정):** Android **16** / API **36** / ZUI **17.5.10.095** / 보안패치 **2026-07-05**
- 웹에서 확인된 동일 라인 ROM:
  - ZUI 17.5.10.020 (2025-12, Android 16)
  - 17.5.10.043 (2026-01)
  - 17.5.10.084 (2026-05)
  - 17.5.10.095 — 실측 (이 대기)
- 중국 TB375FC는 ZUXOS (Android 16 기반 보고).
- 출고 시점 이 대기의 최초 ZUI 번호: **확인 불가** (이미 16으로 올라와 있음).

출처:

- PSREF: Android 14 or later — https://support.lenovo.com/solutions/ht501098
- https://www.androidauthority.com/lenovo-idea-tab-pro-review-3559142/
- https://www.gizmochina.com/2025/12/17/lenovo-android-16-update-eligible-devices-list-and-rollout-timeline/
- https://www.needrom.com/download/lenovo-idea-tab-pro-tb373fu-16/
- https://forums.lenovo.com/t5/Lenovo-Android-based-Tablets-and-Phablets/T373FU-nach-Update-auf-17-5-10-020-fehlerhaft/m-p/10017239

## A.5 배터리 용량 · 충전 W · 무게 · 두께

- 배터리: **10200 mAh** typical Li-ion (공식). GSMArena는 Li-Po로 표기 — 타입 표기 상충, 용량은 동일.
- 충전: **45 W** USB-PD 3.0 / PPS (5~11V / 4.5A). 역충전(reverse wired) 지원 (공식 USB-C 설명 + GSMArena).
- 무게: **약 620 g**
- 두께: **6.9 mm** (카메라 범프 제외)
- 체적: 291.8 × 189.1 × 6.9 mm
- IP52, 금속 유니바디
- YouTube 스트리밍 공칭 11시간 (공식)

출처: PSREF PDF

## A.6 카메라 · 스피커 · 마이크

- 후면: **13 MP AF** + 플래시
- 전면: **8 MP FF**, 얼굴 잠금
- 스피커: **JBL 4개** (1W×4, 일부 SKU 표기), Dolby Atmos. 24-bit/192 kHz Hi-Res는 리뷰 표기(비공식)
- 마이크: **듀얼 (공식 Dual microphone)**
- 3.5 mm 없음. 진동 모터 없음.

## A.7 센서 · GPS · LTE/5G · Wi-Fi

**공식 센서:**

- Accelerometer + Gyroscope
- Hall sensor
- RGB sensor (조도)
- Coulomb counter (전량계)
- 전원키 지문 인식
- 진동 모터: 미지원

**상충 — 나침반/자기계:**

- GSMArena: compass, proximity (accessories only)
- **PSREF에 magnetometer/compass 행 없음.** 공식은 나침반 미기재. 현장 방위에는 GPS에 의존하는 것이 안전. 실측 센서 목록은 이 파일 작성 시점에 dumpsys sensors 전문을 받지 못함 → **자기계 실측 여부 확인 불가 (메인 실측 표에 없음).**

**GPS: 있음. ★현장 순찰 앱에 중요.**

- 공식: **GPS + GLONASS + Galileo** (Wi-Fi 전용 모델에도 GNSS 칩 장착)
- 실측: GPS ✅
- Notebookcheck 실측: 실외에서 위치 잡힘. 신속·위성 수는 중하. https://www.notebookcheck.com/Test-Lenovo-Idea-Tab-Pro-Grosses-Tablet-mit-Stift-und-langer-Laufzeit-kostet-keine-400-Euro.946267.0.html
- **실내·도심에서는 A-GPS/위치 정확도가 떨어질 수 있음.** 현장 순찰이면 GNSS 실측(오픈스카이 vs 실내) 필수.

**LTE/5G:**

- **TB373FU = Wi-Fi only. WWAN Not Supported (공식).** SIM 트레이 없음.
- 실측: **telephony feature 없음.**
- 중국 TB375FC도 Wi-Fi 전용이라는 리뷰 증거 다수. Dimensity 8300이 셀룰러 가능한 칩이지만 **이 제품군에 LTE/5G SKU는 공식 없음.**
- 현장 데이터는 Wi-Fi 항시 또는 단말 GNSS.

**Wi-Fi / BT:**

- **Wi-Fi 6E**, 802.11ax **2×2**, 2.4/5/6 GHz (6E는 국가 규제 의존)
- Wi-Fi Direct, Wi-Fi Display 지원
- Bluetooth **5.3**
- NFC 없음 (실측 일치)

출처: PSREF PDF; GSMArena; Notebookcheck

## A.8 USB 포트 규격 · 외부 디스플레이 출력

- **1× USB-C USB 5Gbps (USB 3.2 Gen 1)**, 충전 + **DP-Out** + 오디오
- microSD, 3-point pogo pin (키보드 팩)
- **외부 디스플레이 출력: 지원 (공식 DP-Out).** DisplayPort alt-mode.
- 최대 외부 해상도/리프레시 레이트: **확인 불가**

---

# B. 스타일러스(펜) — 이 앱의 핵심

## B.1 정품 펜 이름 · 기기 동봉 여부

- 정품: **Lenovo Tab Pen Plus** (AP500U / AP501U)
- 파트: ZG38C05190 (WW) 등 지역별 MTM
- **동봉: 지역/번들에 따라 다름.** PSREF: “Pen Bundled” 또는 “No pen bundled (purchase separately)”. 가용성은 국가/지역에 따라 다름.
- **한국 정식판: 펜 기본 포함** (나무위키, 컴퓨존 “전용펜 포함”, 실측 로케일 ko-KR).
- 레노버 공식 마케팅 다수 지역(말레이시아·인도 등)도 “Tab Pen Plus Included”.
- 홍콩 페이지 중 일부는 “Lenovo Tab Pen Pro Plus”로 표기. **공식 PSREF·지원 문서는 Tab Pen Plus.** Pro Plus는 오표기/별도 펜일 수 있음.
- 자석 부착(뒷면/하단 엣지). **무선 충전 아님** — 펜 자체 USB-C로 충전.
- 배터리 80 mAh, 약 35시간, 14 g, 길이 158 mm × 직경 9.13 mm

출처:

- PSREF PDF
- https://support.lenovo.com/us/en/accessories/acc500311-overview-lenovo-tab-pen-ap500u
- https://support.lenovo.com/gb/en/solutions/ht516607-lenovo-tab-pen-plus-product-compatibility
- https://www.lenovo.com/my/msd/en/p/tablets/lenovo-idea-tab-pro/len103l0026

이 대기(TB373FU, ko-KR)가 **실제로 펜을 박스에 넣었는지**는 개봉 구성품 사진이 이 리서치에 없으므로, 한국 유통 표기·나무위키·공식 “Pen Bundled” SKU를 근거로 **한국 정식판은 동봉이 기본**이라고 적는다. 해당 대 박스를 열어서 확인하는 것이 최종.

## B.2 펜 프로토콜 규격

- 레노버 공식 펜 페이지: **LPP 2.0** (Lenovo Pen Protocol 2.0)
- FRU 부품명: `Picasso;LPP&MPP2.0;AP500U;Type-C` → 칩은 **LPP + MPP 2.0** 둘 다 지원.
- **AES 아님.**
- **USI 공식 언급 아님.** 일부 사설품 판매사가 USI 2.0이라고 적음 — **비공식, 신뢰도 낮음.**
- 앱 개발 관점: Android에서는 프로토콜이 `MotionEvent.TOOL_TYPE_STYLUS`로 추상됨. LPP/MPP 구분은 터치 IC 펌웨어. 서드파티 앱은 표준 Android 스타일러스 API로 충분.
- 실측 입력장치명 `touch-pen`, Sources=`TOUCHSCREEN|STYLUS` — 프로토콜 문자열(LPP/MPP)은 커널 노드에서 안 나옴. 프로토콜 정식 명칭은 공식 문서에 의존.

출처: https://support.lenovo.com/us/en/accessories/acc500311-overview-lenovo-tab-pen-ap500u

## B.3 필압 단계 수 · 기울기 · 펜 버튼 · 지우개 꼬리

- 필압: **4096단계** (공식 PSREF + 펜 지원 페이지 + 주간아스키 리뷰)
  - PSREF 원문: “Lenovo® Tab Pen Plus, remote control, 4096 levels of pressure sensitivity, tilt detection, palm rejection”
  - 실측 축: **PRESSURE 0~1** (Android가 4096을 0~1로 정규화해 보고). 단계 수 4096은 OS 축이 아니라 펜/터치IC 스펙.
- 기울기(tilt): **지원** (공식). 실측 **TILT 0~1.571 rad (= 90°)**, **ORIENTATION ±π**.
- 호버: 실측 **DISTANCE 0~1**. 공식 펜 페이지에는 hover 축 수치 없음.
- **주의:** ZUI 17 초기(17.0.4.021 등)에서 펜 틸트 기능 전역 소실. **17.5.10.020에서 수정**되었다는 포럼 보고. 이 대기는 17.5.10.095이므로 해당 버그 라인 이후. 그래도 앱에서 tilt 값이 실제로 변하는지 한 번 그려 볼 것.
  - https://forums.lenovo.com/t5/Lenovo-Android-based-Tablets-and-Phablets/Idea-Tab-Pro-Pen-TILT-not-working-in-ZUI17/m-p/5384675
- 버튼: **측면 1개**. 리모컨(스크린샷, 펜/지우개 전환, 퀵노트, 미디어 컨트롤). 지우개 꼬리 버튼이 아님.
- **지우개 꼬리: 공식 언급 없음.** 리뷰 사진·스펙에 테일 이레이저 없음. 지우개는 측면 버튼 또는 앱 모드.

출처:

- PSREF PDF
- https://weekly.ascii.jp/elem/000/004/269/4269674/2
- https://www.91mobiles.com/hub/lenovo-idea-tab-pro-review/
- https://geizhals.de/lenovo-tab-pen-plus-zg38c05190-a3019024.html (1 Taste, 4096 Druckstufen)

## B.4 화면 터치 샘플링레이트 · 펜 레이턴시

- **터치 샘플링레이트:** 레노버 마케팅(말레이시아 제품페이지, PBTech, 일본 리뷰 for-real.jp) **360 Hz**.
  - https://www.lenovo.com/my/msd/en/p/tablets/lenovo-idea-tab-pro/len103l0026 — “360Hz touch sampling rate”
  - https://for-real.jp/lenovo-idea-tab-pro-review/ — “터치샘플링레이트는 360Hz”
  - **PSREF PDF에는 360 Hz 행이 없음.** 마케팅 수치. 펜 전용 샘플링레이트와는 별개(게임 터치용으로 적히는 경우가 많음).
- **펜 샘플링레이트 공식값: 확인 불가.** Tab Pen Plus 지원 페이지는 구형 태블릿 기준 “90 Hz / 120 Hz refresh rate 지원”만 적음. 144 Hz Idea Tab Pro 대상 펜 Hz는 공식 미기재.
- **공식 펜 레이턴시(ms): 확인 불가.** 어느 Lenovo 문서에도 ms 수치가 없음.
- 실측·리뷰 정성:
  - 91mobiles: “no perceivable input lag”
  - Business Standard: “smooth input, low latency”
  - PCMag: “responds to pressure, though we experienced some latency issues”
  - dailyweb.pl: 빠른 필기에서 약간의 지연은 있으나 일상 사용에 지장 없을 정도
- 디스플레이 자체 응답(패널, 펜 아님): Notebookcheck 흑↔백 20.3 ms. 잉크 레이턴시와는 다른 측정.

## B.5 팜 리젝션

- **하드웨어/OS 지원 (공식).** PSREF: “palm rejection”. 리뷰에서 손바닥을 올려도 오입력이 없다고 확인.
- Android `GLFrontBufferedRenderer.cancel()` 문서에 palm rejection 시나리오 언급. OS가 팜을 취소 이벤트로 보낼 수 있음.
- 서드파티 앱은 추가로 `PointerDeviceKind.stylus`만 그리고 touch는 무시하는 것이 안전.

## B.6 레노버 자체 필기 앱/SDK

- **Lenovo Pen SDK / WriteIt 공개 서드파티 SDK: 확인 불가 (공개 문서 미발견).**
- 기기 선설치 (실측 확인):
  - `com.myscript.nebo.lenovo` v6.4.13
  - `com.myscript.calculator.lenovo`
  - 시스템: `com.lenovo.penservice`, `com.zui.pengen` (메인 실측)
- 공식 PSREF 선설치 목록에도 **Nebo®**, **MyScript® Calculator**가 있음.
- 이것들은 OEM 앱이지 공개 SDK가 아님. 서드파티는 **표준 Android MotionEvent / Flutter PointerEvent** 사용.
- MyScript Interactive Ink SDK를 우리 앱에 넣는 것은 별도 상용 라이선스 (아래 「실측으로 못 얻는 항목」 3번).

---

# C. Android 스타일러스 개발 API (2026-09 현재)

## C.1 Android 표준 API 요점

`MotionEvent`:

- `getToolType(i) == TOOL_TYPE_STYLUS` / `TOOL_TYPE_ERASER`
- `getPressure(i)` : 0.0~1.0 (이 대기 실측 범위 0~1)
- `getAxisValue(AXIS_TILT)` : 법선 대비 기울기(라디안). 실측 0~1.571
- `getAxisValue(AXIS_ORIENTATION)` : 방위각. 실측 ±π
- `getAxisValue(AXIS_DISTANCE)` : 호버 거리. 실측 0~1
- `getButtonState()` : `BUTTON_STYLUS_PRIMARY` 등
- hover: `ACTION_HOVER_ENTER/MOVE/EXIT` (`OnHoverListener`)
- 이력: `getHistoricalX/Y/Pressure` (high-rate sample)

공식:

- https://developer.android.com/develop/ui/views/touch-and-input/stylus-input
- https://developer.android.com/develop/ui/compose/touch-input/stylus-input/advanced-stylus-features

이 대기는 위 축이 **커널 입력장치에서 모두 보고**되므로, Flutter `PointerEvent.pressure` / `tilt` / `orientation` / `distance`로 올라올 가능성이 높다. 앱에서 한 번 로그로 확인하는 것이 최종.

## C.2 저지연 잉킹 — 최신 버전과 실사용 가능 여부

**(1) Motion prediction**

- `androidx.input:input-motionprediction` **1.0.0 stable** (2025-11-19)
- API 19+. β06부터 시스템 prediction API 사용.
- https://developer.android.com/jetpack/androidx/releases/input
- 실사용 가능.

**(2) Front-buffered renderer**

- `androidx.graphics:graphics-core` **1.0.4 stable** (2025-12-03, 릴리스 페이지 2026-05-06 기준 최신)
- `GLFrontBufferedRenderer`, `CanvasFrontBufferedRenderer` (`@RequiresApi 29`)
- 실사용 가능. 샘플: https://github.com/android/input-samples/tree/main/StylusLowLatency
- https://developer.android.com/jetpack/androidx/releases/graphics
- https://developer.android.com/reference/kotlin/androidx/graphics/lowlatency/CanvasFrontBufferedRenderer

**(3) Jetpack Ink**

- `androidx.ink:*` **1.0.0 stable** (2025-12-17) + **1.1.0-alpha08** (2026-09-09)
- 스트로크·브러시·저지연 렌더링 통합. Compose 모듈(`ink-authoring-compose` 등) 있음.
- https://developer.android.com/jetpack/androidx/releases/ink
- https://android-developers.googleblog.com/2024/10/introducing-ink-api-jetpack-library.html

**중요:** 이 API는 **네이티브(Kotlin/Java) 또는 Android View/SurfaceView**. Flutter `Canvas`/`CustomPaint`는 표준 vsync 더블버퍼라 **서브프레임 저지연이 안 나온다**. 저지연이 필수면 PlatformView/FFI로 내리는 것이 정답.

Flutter 혼용: 공식 Flutter 바인딩 없음. Android `PlatformView`로 SurfaceView를 붙이거나, `stylet`이 AndroidX Input prediction을 쓴다고 문서에 적혀 있음(아래 C.4). Jetpack Ink를 Flutter에 직접 넣는 공식 경로는 **확인 불가 (없음)**.

## C.3 Flutter에서 스타일러스 필압을 받을 수 있는가

**동작함.** Android에서 `PointerDeviceKind.stylus` + `PointerEvent.pressure` / `tilt` / `orientation` 전달됨. 이 대기는 커널에서 PRESSURE·TILT·ORIENTATION·DISTANCE를 보고하므로 실기기에서 받을 조건은 충족.

공식 API:

- https://api.flutter.dev/flutter/gestures/PointerEvent-class.html
- https://api.flutter.dev/flutter/dart-ui/PointerDeviceKind.html

사용 요점:

- `Listener`(Raw pointer)가 `GestureDetector`보다 스타일러스에 안전. Gesture arena가 펜 제스처를 삼킬 수 있음.
- `pressureMin < 1.0`이면 실제 필압. 손가락은 보통 `pressure=1.0`, `pressureMin=1.0`.
- `kind == PointerDeviceKind.stylus` (지우개는 `invertedStylus`)
- `perfect_freehand` 예제도 `details.pressureMin < 1`로 실필압을 구분: https://pub.dev/packages/perfect_freehand/example

**알려진 이슈 (번호 포함):**

1. **#162443** (2025-01, closed duplicate): 스타일러스→손가락→스타일러스 순서에 MouseTracker assertion. Xiaomi Pad 등 Android 15. https://github.com/flutter/flutter/issues/162443
2. **#42846** (open, 6년+): 스타일러스가 PointerDownEvent를 안 내거나 앱 정지. 기기 특정. 펜 버튼을 화면 접촉 전에 누르면 pointer가 사라지는 보고. https://github.com/flutter/flutter/issues/42846
3. **#112627** (2022, closed): 스타일러스 버튼 클릭 시 AndroidTouchProcessor crash (Flutter 3.3). 오래된 이슈이나 버튼 처리는 테스트 필수.
4. **#175886** (2025-09, open): Android Scribe(핸드라이팅 IME) Flutter 미완. 필기 캔버스와 별개. https://github.com/flutter/flutter/issues/175886
5. **#179597** (2025-12, open): Lenovo 펜 버튼 일부가 Flutter에서 안 잡힘 (**Linux 노트북**, 이 태블릿과 다른 기기). 버튼 매핑은 이 대기에서 별도 테스트 권장.

**한계:** Flutter는 표준 포인터 파이프라인 레이턴시(한 프레임 내외). 필압·틸트·kind는 되지만 네이티브 front-buffer 수준 저지연은 안 됨.

## C.4 Flutter용 필기/드로잉 패키지 (필압+기울기+팜리젝션)

필압+기울기+팜리젝션을 **모두 완벽히** 지원하는 패키지는 거의 없음. 2026-09-12 pub.dev 조회.

| 패키지 | 버전 | 마지막 업데이트 | likes | 필압 | 기울기 | 팜리젝 | 비고 |
|---|---|---|---|---|---|---|---|
| **stylet** | 0.1.1 | 2026-08-25 | **0** | 예 (Android 포함) | 예 | 입력 단계에서 stylus만 | 입력 전용, 캔버스 없음. AndroidX Input prediction 연동. **새 패키지, 채택 적음.** https://pub.dev/packages/stylet |
| **scribble** | 0.10.0+1 | **2024-04-06** | 225 | 예 | 아님 (포인터 kind 필터만) | kind로 펜만 허용 | **2년 미관리. 관리 안 됨.** perfect_freehand 의존. https://pub.dev/packages/scribble |
| **perfect_freehand** | 2.5.2+1 | 2026-01 (약 7개월 전) | 191 | 예 (스트로크 생성) | 아님 | 아님 (입력 X) | 입력 아님, 윤곽선 알고리즘. 유지보수 됨. https://pub.dev/packages/perfect_freehand |
| **flutter_drawing_board** | 1.0.1+2 | 2025-12-26 | 267 | 기본 그리기 | 확인 불가 (스타일러스 전문 X) | 확인 불가 | 드로잉보드. 필압/틸트 핵 기능 아님. https://pub.dev/packages/flutter_drawing_board |
| onyxsdk_pen | 1.5.0 | ~2026-05 | — | Onyx e-ink 전용 | — | — | **Lenovo 비호환. 쓰지 말 것.** |

**설계 권장:**

- 입력: Flutter `Listener` 또는 `stylet`(0 likes라 리스크 크지만 API가 가장 맞음) + `kind==stylus` 필터(팜리젝).
- 스트로크: `perfect_freehand`.
- 저지연이 필요하면 Kotlin PlatformView + Jetpack Ink / graphics-core. 순찰 앱 서명 정도면 Flutter Canvas로 충분할 수 있으나, 144 Hz 대비 1~수 프레임 지연은 남음.

## C.5 Flutter로 스타일러스 앱을 만들 때 네이티브(Kotlin)로 내려가야만 하는 부분

**필수는 아님.** 필압·틸트·펜/손 구분·기본 팜리젝은 Dart로 가능. 이 대기는 축이 커널에서 보고되므로 1차 구현은 순수 Flutter가 맞다.

**네이티브가 필요한 경우:**

1. **저지연 잉킹** — front-buffer (`graphics-core`), motion prediction, Jetpack Ink. Flutter에 대응 API 없음.
2. **시스템 핸드라이팅 IME(Scribe)** — Flutter #175886 미완. 텍스트필드에 펜으로 바로 쓰기.
3. **펜 시스템 버튼 앱 통합**(스크린샷 주석, 퀵노트) — Lenovo가 브로드캐스트하는 부분. 서드파티는 대체 제공 어려움 (`com.lenovo.penservice` 공개 API 없음, 아래 4번).
4. **ROLE_NOTES / CREATE_NOTE** — 매니페스트·RoleManager는 Flutter Android 임베딩(Kotlin)에서 선언·요청. Dart만으로는 역할을 잡을 수 없음 (아래 5번).
5. **MyScript iink** — 공식 Android AAR. Flutter는 PlatformView 래핑 (공식 플러그인 없음).
6. **고속 샘플 배치** — Android `MotionEvent` history를 Flutter가 모두 올리지 않을 수 있음. `stylet`이 Motion history를 낸다고 표기. 이 대기 검증 **확인 불가**.

순찰 앱(서명·체크리스트+검사 결과 기록) 기준: **1차는 순수 Flutter**. 저지연이 필드백 후 피드백이면 PlatformView로 Ink 검토. 잠금화면/펜버튼 즉시 메모가 필요하면 ROLE_NOTES를 Kotlin 쪽에서 구현.

---

# 실측으로 못 얻는 항목 (의뢰 보강)

아래 7개는 adb dumpsys로 안 나오는 정보. 웹 공식·문서 기준.

## 1. Lenovo Tab Pen Plus — 동봉, 필압, 프로토콜, 버튼, 충전, 레이턴시

이미 B.1~B.4에 전수. 한 줄 재확인:

| 항목 | 값 | 출처 성격 |
|---|---|---|
| 이름 | Lenovo Tab Pen Plus (AP500U/AP501U) | 공식 |
| 이 대기(한국 TB373FU) 동봉 | **기본 동봉** (한국 유통·나무위키·다수 SKU “Pen Bundled”). 해당 대 박스 개봉이 최종 | 공식+유통. 이 대 박스 실사 **확인 불가** |
| 필압 | **4096단계** (Android 축은 0~1로 정규화) | 공식 PSREF |
| 프로토콜 | **LPP 2.0**. 칩은 LPP & MPP 2.0 (`Picasso;LPP&MPP2.0;AP500U`). AES 아님. USI는 비공식 | 공식 지원 페이지 + FRU명 |
| 버튼 | **측면 1개**. 지우개 꼬리 없음 | 공식·Geizhals |
| 충전 | **USB-C 유선**. 태블릿 자석 부착은 수납만 (무선충전 아님). 80 mAh, ~35시간, <15분에 25% | 공식 |
| 공식 레이턴시 ms | **확인 불가** | — |

https://support.lenovo.com/us/en/accessories/acc500311-overview-lenovo-tab-pen-ap500u

## 2. 터치/펜 샘플링레이트 (Hz) 공식값

- 터치: 마케팅 **360 Hz** (Lenovo 제품 페이지, PSREF 미기재).
- 펜: **확인 불가**.
- 화면 리프레시: 공식 144 Hz, 실측 144/120/60/30 (기본 120).

360 Hz를 설계 문서에 넣을 거면 “마케팅 표기, PSREF 미기재”라고 주석.

## 3. MyScript Interactive Ink SDK

실측 선탑재: `com.myscript.nebo.lenovo` v6.4.13, `com.myscript.calculator.lenovo`. 이는 **OEM 앱**이지 SDK 라이선스가 서드파티에 양도되는 것이 아님.

### ⓐ 한국어(한글) 필기인식 지원 여부

**지원.** MyScript iink 언어 목록에 **Korean - Korea** (`ko_KR`)가 있다. 리소스 예: `ko_KR/ko_KR-ak-cur.res`, `ko_KR/ko_KR-lk-text.res`.

- https://developer.myscript.com/docs/interactive-ink/3.0/overview/text-languages/
- 한글 받아쓰기 앱 사례: https://developer-support.myscript.com/support/discussions/topics/16000028305

주의: iink SDK 4.3의 **새 다국어 엔진은 라틴 7개 언어만** 한 리소스로 묶는다. CJK(한·중·일)는 “dedicated resource for CJK scripts”를 **개발 중**이라고 2026-01 블로그에 적혀 있다. **한글은 레거시 per-language 리소스(`ko_KR`)로 동작하는 것이 현재 문서의 상태.** 4.x 최신 엔진에 한글이 통합됐는지는 **확인 불가** (문서에 라틴만 명시).

- https://www.myscript.com/blog/multilingual-text-recognition-arrives-in-iink-sdk-4-3/

### ⓑ 라이선스·가격 정책 (무료 티어)

- **상용, 기기 기반(device-based).** “A license is defined as the first launch of one application on one device.”
- 인증서(certificate)를 앱에 임베드해야 엔진이 켜짐.
- **공개 가격표 없음.** OEM/엔터프라이즈 문의. 서드파티 분석: “SDK pricing is not publicly disclosed.”
- 개발자 포털에서 샘플용 인증서 다운로드는 가능 (예제 앱용).
- **인터넷 연결이 라이브러리 기동·실행에 필요.** 단, 사용자 첫 실행부터 **30일 grace period**.
- 추가 라이선스 팩은 나중에 구매 가능.
- Lenovo에 선탑재된 Nebo 라이선스를 우리 앱이 재사용할 수 있는 공개 경로: **확인 불가 (없음으로 보는 것이 맞음).**

https://developer.myscript.com/support/account/on-device-license-management

https://developer.myscript.com/docs/interactive-ink/2.0/android/fundamentals/get-started/

### ⓒ Flutter 연동 가능 여부

- **공식 Flutter 플러그인: 없음.** 공식 타깃은 Android / iOS / Windows 네이티브. Maven `com.myscript:iink` 4.5.0 (AAR).
  - https://central.sonatype.com/artifact/com.myscript/iink
  - https://developer.myscript.com/docs/interactive-ink/latest/android/
- MyScript 공식 포럼에 Flutter 래핑 질문: 지원 측 답변은 “Using MyScript recognition with flutter may need some adjustments” + **회사 간 컨택을 권고**. 인증서 오류가 Flutter 래핑에서 난 사례.
  - https://developer-support.myscript.com/support/discussions/topics/16000032525
- 경로는 Android PlatformView / MethodChannel로 `Engine.create(MyCertificate.getBytes())`를 감싸는 **자체 플러그인**. FFI 공개 사례는 검색에서 **확인 불가**.
- pub.dev에 myscript / iink 공식 패키지 **없음** (2026-09-12 검색 기준).

### ⓓ 오프라인 동작 여부

- 인식 자체는 **온디바이스** (리소스를 앱에 넣음).
- 라이선스: **기동·실행에 인터넷이 필요**하다고 공식 라이선스 페이지가 명시. 30일 grace 후 네트워크 체크가 다시 필요한지는 문구상 “launch and run the library”라 **상시 온라인을 요구하는 쪽으로 읽힘**. 완전 에어갭 현장(순찰, 지하)에서 영구 오프라인은 **위험. 확인 불가(완전 오프라인 SLA 문서 없음).**
- 순찰 앱이 손글씨→텍스트 변환을 **오프라인 필수**로 가져가면 MyScript는 라이선스 조건과 충돌할 수 있다. 대안은 자체 필기 보존(잉크만 저장) + 온라인 시 변환, 또는 다른 온디바이스 엔진.

## 4. `com.lenovo.penservice` · `com.zui.pengen` — 공개 API/인텐트

- 두 패키지 모두 **공개 개발자 문서·공개 SDK·안정적 Intent contract를 찾지 못함.**
- Lenovo/ZUI 내부 펜 페어링·분실 알림·버튼 매핑·Stylus Toolbox용 시스템 서비스로 보는 것이 맞다.
- 서드파티가 호출할 수 있는 공개 API: **확인 불가 (공개된 것 없음).**
- 권장: 펜 입력은 표준 `MotionEvent` / Flutter `PointerEvent`만 사용. 펜 버튼 시스템 제스처(퀵노트, 스크린샷)는 ROLE_NOTES 또는 우리 앱 내부 버튼 처리로 대체.
- 비공개 인텐트를 리버스해서 호출하는 것은 ZUI 업데이트에 깨지고 정책 리스크가 있으므로 설계에 넣지 말 것.

## 5. Android `ROLE_NOTES` — 펜 제스처로 즉시 메모, Flutter 가능 여부

실측: `com.android.role.notes.enabled` 확인. Android 14+ (이 대기 API 36)에서 역할이 켜져 있음.

**역할이 하는 일 (공식):**

- `RoleManager.ROLE_NOTES`를 가진 **단 하나의** 기본 노트 앱.
- 권한 `LAUNCH_CAPTURE_CONTENT_ACTIVITY_FOR_NOTE` 부여.
- 잠금화면에서 전체화면, 잠금 해제 상태에서는 플로팅 윈도우로 `ACTION_CREATE_NOTE`에 응답.
- 스타일러스 테일 버튼(USI 등) 또는 잠금화면 숏컷으로 기동. Lenovo Tab Pen Plus는 테일 이레이저가 없고 **측면 1버튼**이라, 그 버튼이 시스템 노트 역할에 묶이는지는 **OEM 구현. 이 대기에서 버튼→CREATE_NOTE 매핑 실측은 확인 불가.**

**서드파티 앱이 역할을 잡는 방법 (공식, Kotlin):**

1. 매니페스트 Activity에 `android.intent.action.CREATE_NOTE`, `showWhenLocked=true`, `turnScreenOn=true`.
2. `RoleManager.isRoleAvailable(ROLE_NOTES)` 확인.
3. `createRequestRoleIntent(ROLE_NOTES)` → 사용자가 설정에서 우리 앱을 기본 노트 앱으로 지정.
4. 인텐트 extra `EXTRA_USE_STYLUS_MODE==true`이면 즉시 펜 캔버스를 연다.
5. 플로팅 윈도우 + multi-instance. 콘텐츠 캡처는 `ACTION_LAUNCH_CAPTURE_CONTENT_ACTIVITY_FOR_NOTE`.

공식: https://developer.android.com/develop/ui/compose/touch-input/stylus-input/create-a-note-taking-app

샘플: Google Cahier — https://developer.android.com/blog/posts/introducing-cahier-a-new-android-git-hub-sample-for-large-screen-productivity-and-creativity

**Flutter:**

- 역할 요청·매니페스트·잠금화면 Activity는 **Android 임베딩(Kotlin) 필수**. Dart 패키지로 ROLE_NOTES를 잡아 주는 공식 플러그인은 검색에서 **확인 불가**.
- 기동된 Activity 안에서 Flutter 엔진을 띄워 캔버스를 그리는 것은 가능 (`FlutterActivity`/`FlutterFragment`).
- 잠금화면·플로팅 윈도우·화면 캡처 URI 수신은 네이티브 쪽 코드가 필요.
- **가능: 하이브리드 (Kotlin이 역할·인텐트, Flutter가 잉크 UI). 불가능에 가까운 것: pub.dev 한 줄로 ROLE_NOTES.**

Lenovo 펜 측면 버튼이 이 역할 기동에 연결돼 있는지는 실기기에서 기본 노트 앱을 우리 앱으로 바꾼 뒤 버튼을 눌러 봐야 한다. 문서만으로는 **확인 불가**.

## 6. Flutter 스타일러스 pub.dev 실사용 후보

C.4 표가 전수. 실사용 후보만 다시:

- **입력 계층 1순위:** 프레임워크 `Listener` (패키지 의존 없음, 이 대기 축이 표준 Android라 충분할 가능성 큼)
- **입력 보강:** `stylet` 0.1.1 — 필압+틸트+prediction. likes 0, 2026-08-25. 채택 리스크 큼.
- **스트로크:** `perfect_freehand` 2.5.2+1 — 유지보수됨, 필압 윤곽. 기울기·팜리젝은 직접 구현.
- **쓰지 말 것:** `scribble` (2년 정지), `onyxsdk_pen` (Onyx 전용)
- `flutter_drawing_board`는 화이트보드 UI용. 스타일러스 전문 아님.

## 7. Android 저지연 잉킹 × Flutter 혼용

C.2와 동일, 버전만 재확인 (2026-09-12):

| 라이브러리 | 최신 | 상태 | Flutter |
|---|---|---|---|
| `androidx.ink:ink-*` | **1.0.0 stable** / 1.1.0-alpha08 (2026-09-09) | 실사용 가능 | 공식 바인딩 없음. PlatformView |
| `androidx.input:input-motionprediction` | **1.0.0 stable** (2025-11-19) | 실사용 가능 | `stylet`이 Android에서 사용한다고 문서. 프레임워크 미포함 |
| `androidx.graphics:graphics-core` FrontBufferedRenderer | **1.0.4 stable** (2025-12-03) | API 29+, 실사용 가능 | 공식 바인딩 없음. SurfaceView PlatformView |

혼용 가능성: **가능하나 Kotlin PlatformView가 필요.** 순수 Dart Canvas로는 서브프레임 저지연 불가.

---

# 설계에 바로 쓰는 요약

- 대상: **TB373FU, 12.7" 2944×1840 @144Hz(기본 120), densityDpi 340, 273 ppi, Dimensity 8300/MT8792, 8 GB, Wi-Fi 6E only, GPS 있음, LTE 없음, Android 16 / API 36 / ZUI 17.5.10.095.**
- 펜: **Tab Pen Plus, LPP 2.0(+MPP 2.0 칩), 4096, tilt·hover 실측 보고, 팜리젝, 버튼 1, 지우개 꼬리 없음, USB-C 충전. 공식 레이턴시 ms 없음. 터치 360 Hz는 마케팅.**
- 현장 위치: **GNSS 있음. 실내·도심은 부족할 수 있음. LTE 없음.**
- 필기인식: 선탑재 Nebo는 OEM. 우리 앱에 MyScript를 넣으면 **상용 라이선스 + 네트워크 조건 + Flutter는 자체 래핑.** 한글은 `ko_KR` 리소스로 지원.
- Lenovo 펜 서비스 공개 API: **없음.**
- 펜 제스처 즉시 메모: **ROLE_NOTES + CREATE_NOTE**, Kotlin 필수. 펜 측면 버튼 매핑은 실측 필요.
- Flutter 필기: 가능 (이 대기 축이 표준). 저지연 Ink는 네이티브.
