# OCR 각인 주소 — 체크리스트

결정·근거는 [context-notes.md](./context-notes.md).

## 0단계 · 진단 (완료)

- [x] 좌표가 맞는지 통제군으로 확인 — 기본 카메라 vs 앱, 같은 자리 0.8m 차 (등급 가설 반증)
- [x] 권한 확인 — 카메라 `앱 사용 중` · VitAlGuard `항상`, 정확한 위치 둘 다 켜짐
- [x] 주소 세 축이 틀린 것을 사용자 확인으로 확정 (광역명·자치구·지번)
- [x] 주소를 만드는 코드가 하나뿐임을 전수 확인 (`MediaCapture.swift:112 resolveAddress`)
- [x] 기존 NCP 키로 역지오코딩 가능 여부 확인 → 인증 통과·상품 구독 없음

## 1단계 · 서버 (지금)

- [ ] **⚠ 사용자 몫 — NCP 콘솔에서 Maps 의 Reverse Geocoding 구독.** 이것 없이는
      라우트가 `configured:false` 만 낸다. 실응답 검증이 여기 걸려 있다.
- [x] `app/lib/reverse-geocode.ts` 신설 — NCP 호출 + 도로명/지번 조립
- [x] `app/api/app/address/route.ts` 신설 — 앱 JWT 검증 후 좌표 → 주소
- [x] 가드 `lib/2026-08-28-ocr-address-geocode.guard.test.ts`
- [ ] 가드 변이 시험 1종 이상으로 빨간불 실측 ([[L-113]])
- [ ] `/verify` 통과
- [ ] **실응답 1건으로 파서 검증** — 구독 후 `35.150535,126.916294` 를 넣어
      `전남광주 동구 금남로3가 1-10` 계열이 나오는지 눈으로 확인
      ⚠ 지금 파서는 **문서상 응답 형태로만** 쓴 것이고 실응답으로 검증되지 않았다
- [ ] 커밋 — **옆 세션 배포가 끝난 뒤에만** ([[L-116]] · context-notes 조율 절)
- [ ] 배포

## 2단계 · 앱 (서버 배포 후)

- [ ] `MediaCapture.resolveAddress` 를 서버 호출로 교체
- [ ] 실패 시 CLGeocoder 폴백 + `(기기 추정)` 표기
- [ ] 각인 형식이 바뀌므로 `lib/ocr-stamp.ts` 파서와 기존 가드 영향 확인
      (`2026-08-22-stamp-accuracy` · `2026-08-19-photo-capture-location`)
- [ ] 실기기 촬영 1장으로 각인 확인
- [ ] 폰 재설치 (Runner 만이라 워치 재서명 창과 무관)

## 별건 (판단 대기)

- [ ] 이미 쌓인 `calendar_media.road_address` 재계산 — 좌표가 맞으므로 서버에서 가능.
      사진에 구워진 글자는 못 고친다.
