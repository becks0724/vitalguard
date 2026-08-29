# 경로 정확도 필터(R-33) — 체크리스트 (2026-08-29 · [WATCH.APP])

근거 = `docs/wear-os-port/context-notes.md` R-33. 목표 = 기지국·wifi 좌표(정확도 >50m)가 경로 **선**에 섞여 없는 길을 그리던 것을
선에서 빼고, 반경=정확도의 흐린 원으로만 보여 준다. 데이터는 안 버린다.

- [x] `app/lib/track.ts` — `TRACK_LINE_ACC_MAX_M = 50` · `partitionTrackByAccuracy` · `TrackCoarsePoint`(null 은 선에 남김).
- [x] `app/api/monitor/track/route.ts` — 요약(전체) → 분할 → 선·coarse 각각 다운샘플 → 응답 `coarse` 추가(additive).
- [x] `WorkerGpsMap.tsx` — `WorkerTrail.coarse?` · 원 레이어(`worker-trail-coarse` · 반경 = accM/metersPerPx · 최소 4px) · 캡션 `부정확 N점 선 제외(>50m)`.
- [x] `DemoDashboard.tsx` — 응답 `coarse` → state → 지도 prop.
- [x] 단위시험 3(track.test) + 가드 4(2026-08-29-trail-accuracy-filter) — 변이 **7종 전부 검출**(route 2·lib 2·map 2·board 1).
- [x] typecheck 0 오류 · lint 0 오류(경고 2 = 기존 db.ts·env-alert-notify) · test 전부 통과 → 커밋 → push 묶음(`7e7f035` 동승).
- [ ] 배포는 사용자 `/deploy` 지시 시 · 라이브 실측 = 장우진 경로 열어 레드박스 구간이 원으로 바뀌는지 눈으로.
