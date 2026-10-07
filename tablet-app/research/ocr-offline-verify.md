# OCR 온디바이스 검증 절차 (준비 완료 · 구현 나오면 바로 실행)

작성: Claude / 2026-09-13

## 왜 이 절차가 필요한가

`camera` 와 `google_mlkit_text_recognition` 을 **Socket 검사 없이** 넣었다.
pub 생태계는 Socket 미지원이고, ML Kit 은 Maven Central 이 아니라 Google Maven 에만 있어
`socket package score maven` 이 404 다(양쪽을 직접 조회해 확인).

대신 4가지로 검증하기로 태곤 님 승인을 받았다. **앞의 3개는 끝냈다:**

| # | 검증 | 결과 |
|---|---|---|
| ① | 제공 주체 | Flutter 공식팀 · flutter-ml.dev(pub.dev 검증 퍼블리셔) · Google |
| ② | 소스 읽기 | Dart 래퍼에 **네트워크 호출 없음**. import 가 `dart:math`·`flutter/material`·`flutter/services`·`google_mlkit_commons` 넷뿐 |
| ③ | 권한 | 플러그인 `AndroidManifest.xml` 이 **빈 껍데기** — 권한 요구 0 |
| ④ | **실기기 네트워크 관찰** | ★ **이 문서** — 구현 나오면 실행 |

④가 마지막 증거다. 소스가 "안 보낸다" 고 해도 **실물로 재는 것이 결론**이다.
STT 때 같은 방법으로 "진짜 온디바이스" 를 증명했다(`device-facts.md` §5-4).

---

## 시험 이미지

```
research/raw/ocr-test-target.png     1400×1000 · Swift CoreText 로 생성
```

**현장 어휘·숫자·단위·영문을 섞었다.** 일상 문장으로 재면 현장 성능을 못 잰다(STT 와 같은 판단).

| 넣은 것 | 왜 |
|---|---|
| `안전난간` `안전대` `비계` `타워크레인` | 현장 전문용어 — STT 에서 가장 약했던 부류 |
| **`미착용 금지`** | ★ STT 에서 **부정이 사라져 의미가 뒤집힌** 실패가 났다. OCR 도 같은지 본다 |
| `O2 20.9% / CO 15ppm / H2S 2ppm` | 숫자·단위·영문 혼용 |
| `2026-09-13 08:00 ~ 17:00` | 날짜·시각 형식 |
| **`EMP-6861`** | ★ 서버 파서(`ocr-stamp.ts`)가 찾는 형식. **이게 안 읽히면 각인 되뽑기가 깨진다** |
| `광주 스마트인재개발원 신축공사` | 고유명사 |

---

## 실행 절차

### 0) 기기에 시험 이미지 넣기

```
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
adb push "…/research/raw/ocr-test-target.png" /sdcard/Download/ocr-test-target.png
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
  -d file:///sdcard/Download/ocr-test-target.png
```

### 1) 온라인 기준선 먼저

네트워크 **켠 상태**로 OCR 을 돌려 결과를 기록한다.
⚠ **기준선 없이 오프라인만 재면 "원래 못 읽는 것" 과 "네트워크가 없어 못 읽는 것" 을 구분 못 한다.**

### 2) 네트워크를 실제로 끊는다

```
adb shell cmd connectivity airplane-mode enable
adb shell svc wifi disable
```

**확인 (사람 기억에 맡기지 않는다):**
```
adb shell settings get global airplane_mode_on      # 1 이어야 한다
adb shell dumpsys wifi | grep -m1 "Wi-Fi is"        # disabled 여야 한다
adb shell ping -c 2 8.8.8.8                          # 실패해야 한다
```

⚠ 이 기기는 **셀룰러가 없다**. 비행기모드 + Wi-Fi OFF 면 경로가 통째로 없다.

### 3) 같은 이미지로 다시 OCR

### 4) 판정

| 결과 | 뜻 |
|---|---|
| 오프라인에서 **온라인과 같은 수준**으로 읽힘 | ✅ **온디바이스 확정.** 모델이 APK 에 번들됨이 실물로 증명됨 |
| 오프라인에서 **아무것도 안 읽힘** | ❌ 네트워크를 탄다. 번들이 안 됐거나 `compileOnly` 좌표를 앱이 안 넣은 것 |
| 오프라인에서 **오류가 남** | 오류 메시지를 **숫자·원문 그대로** 기록. 뭉개지 말 것 |

### 5) 되돌리기 — ★ **자동으로 안 돌아온다. 실물로 확인했다**

```
adb shell cmd connectivity airplane-mode disable
adb shell svc wifi enable
```

⚠ **이것만으로는 부족하다.** 2026-09-13 00:4x 에 실제로 겪었다 —
비행기모드를 끄고 `svc wifi enable` 을 해도 **Wi-Fi 가 AP 에 다시 붙지 않았다.**

```
wlan0: <NO-CARRIER,...> state DOWN      ← 인터페이스는 UP, AP 연결은 없음
cmd wifi status → "Wifi is not connected"
ping 8.8.8.8   → Network is unreachable
```

그리고 **adb 로는 재연결을 못 시킨다:**
```
cmd wifi enable-network 0
  → SecurityException: Uid 2000 does not have access to enable-network wifi command
```

→ **되돌리기는 태블릿 화면에서 사람이 한다.** 빠른설정에서 Wi-Fi 타일을 누르거나
   설정 → 네트워크에서 SSID 를 고른다. 저장된 네트워크는 지워지지 않는다.

**반드시 확인하고 끝낸다:**
```
adb shell cmd wifi status | grep -m1 "connected"
adb shell ping -c 2 -W 3 8.8.8.8
```

### 0-b) ★ 시작 전에 기준선을 확인한다

⚠ **끊기 전에 원래 연결돼 있었는지부터 재라.** 안 재면 나중에
"내가 끊은 것" 과 "원래 안 되던 것" 을 구분 못 한다. 내가 이 단계를 빼먹어 한 번 겪었다.

```
adb shell cmd wifi status | grep -m1 "connected"
adb shell ping -c 2 -W 3 8.8.8.8
```

---

## 기록할 것

`research/device-facts.md` §5 에 **STT 절과 나란히** 넣는다. 형식도 맞춘다:

- 온라인/오프라인 **두 조건**의 인식 결과를 **원문 그대로**
- ⛔ **다듬지 마라.** 틀린 그대로 적어야 판단이 된다
- ⛔ **일치율을 새로 계산해 붙이지 마라.** 표본이 이미지 1장이다
- `미착용` 이 살아남았는지 **따로 표시**한다 — STT 에서 뒤집혔던 항목이다
- `EMP-6861` 이 읽혔는지 **따로 표시**한다 — 서버 파서 계약이 걸려 있다

---

## ⚠ 이 검증이 답하지 못하는 것

- **문서 스캐너**는 별개다. Play 서비스가 최초 1회 내려받으므로 **오프라인 첫 사용은 원래 실패한다.**
  같은 시험으로 묶지 마라 — 스캐너 실패를 OCR 실패로 오인하게 된다.
- **역지오코딩**도 별개다. 서버를 타는 게 설계다. 오프라인이면 기기 추정으로 떨어지고,
  각인이 그렇다고 밝혀야 한다.
