# AED 알람 장치 (라즈베리파이)

제세동기(AED) 상태를 관제서버에서 받아 **현장에서 빛·소리로 알리는 물리 경보 장치**.
회로도·부품 상세는 [`AED_alarm_부품목록_회로도.html`](AED_alarm_부품목록_회로도.html) (2026-07-06 기준).

## 동작 개요

```
관제서버 GET /api/aed/alarm?deviceId=AED-03  (8초 폴링)
  → CLEAR   : 모두 꺼짐 (DANGER 래치 해제)
  → WARNING : 노랑 LED 깜빡 + 부저 4개 순차 사이렌(0.25s 스텝)
  → DANGER  : 빨강 LED 깜빡 + 부저 순차(0.12s 스텝) — CLEAR 수신 전까지 래치
```

- 레벨 판정은 **관제서버 담당** — 단말 배터리(20/50%)·AED 본체 배터리·전극패드 교환주기의 worst-of
- 폴 실패(비-200/타임아웃) 시 **직전 레벨 유지** — 네트워크 장애로 경보가 꺼지지 않음
- **강제활성화 버튼**: 서버와 무관하게 1분 DANGER 래치 (현장 수동 경보)
- **슬라이드 전원 스위치**: OFF 시 LED·부저·버튼 차단 (폴링은 계속)
- systemd 서비스 `aed-alarm` — 부팅 자동 시작, 비정상 종료 시 5초 후 재시작 (재부팅 검증 완료)

## 부품·핀맵 (BCM / 물리핀)

| 부품 | 연결 | 비고 |
|---|---|---|
| Raspberry Pi | — | 5V 어댑터 직결, 와이파이 필수, RPi.GPIO |
| 빨강 LED (DANGER) | GPIO5 / 29 | 직렬 330Ω |
| 노랑 LED (WARNING) | GPIO6 / 31 | 직렬 330Ω |
| 액티브 부저 ×4 | GPIO17·27·22·23 / 11·13·15·16 | 순차 점등 사이렌, GPIO 직결 |
| 강제활성화 버튼 | GPIO20 / 38 | 내부 풀업, 누르면 GND |
| 슬라이드 전원 스위치 | GPIO21 / 40 | 외부 풀다운 10kΩ, 오른쪽=3.3V=ON |

장치 파일: `/home/pi/RaspberryPiStudy/Test_proj/AED_alarm_NoSignal_Pattern.py` — 담당 AED 변경은 상단 `AED_ID`만 수정.
