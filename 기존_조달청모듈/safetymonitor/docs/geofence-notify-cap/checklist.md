# 구획이탈 텔레그램 연발 수술 — 체크리스트 (2026-08-31)

- [x] 실측 — 08-30 79건 타임라인 + GPS 리플레이(이탈 전이 1회 확인) (`scratchpad/geofence-spam.mjs`)
- [x] 적합성 판단 보고 → 사용자 결정 ①+② (미착용 연동 제외)
- [x] ① `geofence-watch.ts` — `lastInsideTs` (확실한 안 표본 · 회색지대 제외)
- [x] ① `cron/geofence-check` — 24h 조회 창 + "안 관측 없이는 재알림 금지"
- [x] ② `telegram.ts` — `GEOFENCE_NOTIFY_DAILY_CAP=3` · 꼬리 문구 · `notifyAlertTelegram(input, extraLine?)`
- [x] ② `db.ts recordAlert` — INSERT 후 카운트 · 3회째 꼬리 · 4회째부터 통지 억제(원장은 기록)
- [x] 가드 신규 1(notify-cap) + 기존 가드 ④ 개정(server-check)
- [x] typecheck · lint · test 3종 통과 (0오류 · 1,496건 전부 통과)
- [ ] 커밋 (`git commit -- <경로>`)
- [ ] 배포 후 실측 — 다음 이탈일에 알림 ≤ 3건/일·에피소드 1건 확인, run-log 기록
