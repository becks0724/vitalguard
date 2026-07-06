<!-- AED(심장 제세동기) 알림 물리장치(라즈베리파이) ↔ 관제웹 연결 계약. RPi 담당자 전달용. -->
# AED 알림 물리장치(라즈베리파이) ↔ 관제웹 연결 계약

심장 제세동기(AED) 알림 H/W(라즈베리파이 GPIO — 빨강/노랑 LED · 부저 4개 · 강제 버튼 · 슬라이드 전원)가
관제웹에서 **AED 장비 상태 알림 레벨**을 받아 LED/부저를 구동하기 위한 연동 규격이다.

- **연결 방향**: 장치가 관제웹을 **주기 폴링(HTTP GET)** 한다. 관제웹 → 장치로 밀어주는(push) 방식이 아니다.
- **인증**: 없음(알림 레벨은 비민감 상태값). 장치는 URL만 알면 된다.
- **베이스 URL**: `https://vitalguard-dashboard-569797426568.asia-northeast3.run.app`

---

## 1. 엔드포인트

```
GET /api/aed/alarm?deviceId=<AED-ID>
```

| 파라미터 | 필수 | 설명 |
|---|---|---|
| `deviceId` | 선택 | 이 장치가 담당하는 AED 식별자(예: `AED-03`). **생략하면 전 구역 통합(worst-of)** — 하나라도 위험이면 DANGER. |

### 응답 (200)

```json
{
  "ok": true,
  "deviceId": "AED-03",
  "loc": "지하 주차장 B1",
  "sev": "danger",
  "level": "DANGER",
  "updatedAt": "2026-07-06T05:33:33.550Z"
}
```

| 필드 | 값 | 설명 |
|---|---|---|
| `level` | `CLEAR` \| `WARNING` \| `DANGER` | **장치가 사용할 값.** 파이썬 `apply_signal(level)` 인자와 1:1. |
| `sev` | `normal` \| `caution` \| `danger` | 내부 심각도(참고용). level 과 1:1 대응. |
| `loc` | 문자열 | 설치 위치(관제웹에서 수정 가능 — 아래 3항). |
| `deviceId` | 문자열 \| `null` | 요청한 장비 ID. 통합 조회 시 `null`. |
| `updatedAt` | ISO8601 | 응답 생성 시각. |

### 오류

| 상태 | 경우 | 장치 권장 처리 |
|---|---|---|
| `404` | 알 수 없는 `deviceId` | ID 오타 확인. |
| 비-200 / 타임아웃 | 서버·네트워크 일시 장애 | **직전 레벨 유지**(마지막 성공값 그대로). |

> `level` ↔ 장치 동작 매핑(이미 장치 코드에 구현됨): `CLEAR`=전부 OFF · `WARNING`=노랑 깜빡+부저 느림 · `DANGER`=빨강 깜빡+부저 빠름(CLEAR 전까지 래치).

---

## 2. 레벨은 무엇으로 결정되나 (장비 상태 미러)

관제웹의 **AED 장비 상태 심각도를 그대로 미러**한다. 세 가지를 worst-of(가장 심각한 것)로 합산한다.

| 차원 | 위험(DANGER) | 주의(WARNING) | 정상(CLEAR) |
|---|---|---|---|
| 알림 단말 배터리(실시간) | 20% 이하 | 50% 이하 | 초과 |
| AED 본체 배터리 교환주기 | 권장주기 경과 | 잔여 90일 이내 | 여유 |
| 전극패드 교환주기 | 권장주기 경과 | 잔여 90일 이내 | 여유 |

- 셋 중 하나라도 위험이면 `DANGER`, 하나라도 주의이면 `WARNING`, 전부 정상이면 `CLEAR`.
- 교환 이력은 현장 NFC 점검 태깅(관제웹 별도 기능)으로 갱신된다.
- **관제웹 대시보드의 AED 표와 항상 같은 상태**를 표시한다(임계 단일 소스).

---

## 3. 장비 식별자(설치 위치·관리책임자는 관제웹에서 수정)

| deviceId | 기본 설치 위치 |
|---|---|
| `AED-01` | 본관 1층 로비 |
| `AED-02` | 현장 사무동 |
| `AED-03` | 지하 주차장 B1 |
| `AED-04` | 식당동 입구 |
| `AED-05` | 자재 창고 |
| `AED-06` | 타워크레인 베이스 |
| `AED-07` | 안전교육장 |

- **설치 위치·관리책임자·비고는 관제웹에서 권한 계정이 수정 가능**(AED 표 → 관리책임자 칸 클릭). 수정하면 응답의 `loc` 도 바뀐다.
- 장치는 `deviceId` 만 고정하면 되고, 위치 문구 변경은 코드 수정 없이 관제웹에서 반영된다.

---

## 4. 라즈베리파이 연동 (가짜 `sequence` → 실서버 폴)

`AED_alarm_NoSignal_Pattern.py` 는 현재 `sequence = [...]` 로 8초마다 서버 신호를 흉내낸다. 이를 실제 폴링으로 교체한다.
표준 라이브러리 `urllib` 사용(pip 설치 불필요).

`main()` 상단(또는 파일 상단)에 추가:

```python
import urllib.request, json

AED_ID = "AED-03"   # 이 장치가 담당하는 AED. 전 구역 통합이면 "" (빈 문자열)
BASE = "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app"
ALARM_URL = BASE + "/api/aed/alarm" + (("?deviceId=" + AED_ID) if AED_ID else "")

def fetch_level():
    """관제 서버에서 CLEAR/WARNING/DANGER 폴. 실패 시 None(직전 레벨 유지)."""
    try:
        with urllib.request.urlopen(ALARM_URL, timeout=4) as r:
            data = json.loads(r.read().decode())
        lvl = data.get("level")
        return lvl if lvl in ("CLEAR", "WARNING", "DANGER") else None
    except Exception as e:
        print("[폴 실패] 직전 레벨 유지:", e)
        return None
```

루프 안의 `# ----- 신호 자동 상태 (MQTT 흉내) -----` 블록을 교체:

```python
# ----- 신호 상태 (관제 서버 폴링) -----
if now - sig_last >= SIGNAL_INTERVAL:
    level = fetch_level()
    if level is not None:
        apply_signal(level)
    sig_last = now
```

- `sequence` / `seq_i` 는 제거(불필요).
- 나머지(LED 깜빡임·부저 순차·강제 버튼·전원 스위치·1분 래치)는 **그대로 둔다**.
- `SIGNAL_INTERVAL`(현재 8초)은 유지 권장. AED 장비 상태는 천천히 변하므로 8초로 충분하다.

---

## 5. 확인·문제 해결

- **연결 확인**(PC/폰 브라우저): 위 `ALARM_URL` 을 열어 JSON 이 나오면 정상.
  - 예) `.../api/aed/alarm?deviceId=AED-03` → `"level":"DANGER"`(AED-03 은 단말 배터리 18% 샘플이라 현재 DANGER).
- **항상 CLEAR 만 나온다**: 해당 AED 가 실제로 정상 상태. 다른 `deviceId`(예: `AED-03`)로 테스트.
- **404**: `deviceId` 오타. 위 3항 표의 정확한 ID 사용.
- **폴 실패 반복**: 장치의 인터넷 연결·DNS 확인. 서버 장애 시에도 장치는 직전 레벨을 유지하므로 알림이 갑자기 꺼지지 않는다.
- **강제 버튼**: 서버 신호와 무관하게 현장에서 1분간 DANGER 강제(장치 자체 기능, 서버 미연동).

---

## 변경 이력
- 2026-07-06 — 최초 작성. `GET /api/aed/alarm` 연동 규격 + 설치위치/관리책임자 관제웹 편집 반영.
