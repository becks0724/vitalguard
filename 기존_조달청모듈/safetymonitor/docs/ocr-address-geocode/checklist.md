# OCR 각인 주소 — 체크리스트

결정·근거는 [context-notes.md](./context-notes.md).

## 0단계 · 진단 (완료)

- [x] 좌표가 맞는지 통제군으로 확인 — 기본 카메라 vs 앱, 같은 자리 0.8m 차 (등급 가설 반증)
- [x] 권한 확인 — 카메라 `앱 사용 중` · VitAlGuard `항상`, 정확한 위치 둘 다 켜짐
- [x] 주소 세 축이 틀린 것을 사용자 확인으로 확정 (광역명·자치구·지번)
- [x] 주소를 만드는 코드가 하나뿐임을 전수 확인 (`MediaCapture.swift:112 resolveAddress`)
- [x] 기존 NCP 키로 역지오코딩 가능 여부 확인 → 인증 통과·상품 구독 없음

## 1단계 · 서버 (지금)

- [x] ~~NCP 콘솔에서 Maps 구독~~ **취소 — 필요 없어졌다.** 이미 있는 `VWORLD_KEY` 로
      역지오코딩이 그대로 된다(등록 화면 직전에 발견). 경위는 context-notes 결정 ②.
- [x] `app/lib/vworld.ts` 에 `reverseGeocode()` 추가 (별도 모듈 안 만듦 — 같은 키·호스트·정책)
- [x] `app/lib/address-format.ts` — 도로명/지번 선별 + 각인 한 줄(`display`) 결정
- [x] `app/api/app/address/route.ts` 신설 — 앱 JWT 검증 후 좌표 → 주소
- [x] 가드 `lib/2026-08-28-ocr-address-geocode.guard.test.ts` — 고정물이 **실응답**이다
- [x] 가드 변이 시험 1종 이상으로 빨간불 실측 ([[L-113]]) — 3종 각 fail 1·3·1
      (좌표 순서 `${lon},${lat}`→`${lat},${lon}` · 자치구 `, t(g?.area2?.name)]`→`]` · `502`→`200`)
- [x] 검증 통과 — tsc 0 · lint 에러 0 · 순환 0 · test 1337/1337
- [x] **실응답으로 파서 검증 완료** — `reverseGeocode()` 를 코드 경로 그대로 살아 있는
      VWorld 에 호출했다.
      ```
      촬영 지점  전남광주통합특별시 동구 금남로3가 1-10   ← 사용자 확인 실주소와 일치
      계림동     전남광주통합특별시 동구 계림동 1869      ← 08-22 교훈의 실제 주소와 일치
      바다       null · "좌표에 등록된 주소가 없습니다."   ← NOT_FOUND 가 예외로 안 샘
      ```
- [x] 커밋 (옆 세션 배포 완료 후)
- [ ] 배포 — **사용자 `/deploy` 필요**

## 2단계 · 앱

- [x] `MediaCapture.resolveAddress` 를 서버 호출로 교체 (`serverAddress` 신설)
- [x] 실패 시 CLGeocoder 폴백 + `(기기 추정)` 표기 (`deviceAddress` 로 분리)
- [x] 표기 규칙(도로명/지번)을 **서버가 정한다** — `display` 한 필드.
      도로명 우선으로 뒀다(2014년부터 법정 표준). 지번으로 바꾸려면 `address-format.ts`
      의 `display: road ?? jibun` 한 줄만 뒤집고 **앱은 안 건드린다**.
- [x] 각인 형식 변경의 파장 확인
  - `lib/ocr-stamp.ts` 파서 — 새 형식·폴백 형식 둘 다 읽는 것을 가드로 고정
  - `2026-08-22-stamp-accuracy` — 좌표 줄만 보므로 무영향
  - `2026-08-19-photo-capture-location` — `LocationProvider.swift` 만 보므로 무영향
  - `2026-08-19-media-capture-contract` — **앵커 이동**(중복 제거가 `deviceAddress` 로
    내려갔다). 계약은 그대로 두고 슬라이스만 옮겼고, 변이 2종으로 재검증했다.
- [x] Swift 구문 검사 `swiftc -parse` 통과
      ⚠ **타입검사·빌드는 이 맥에서 못 한다**(iOS SDK 컨텍스트 없음). 실기기 빌드가 첫 관문이다.
- [ ] 실기기 촬영 1장으로 각인 확인 — **NCP 구독 후**
- [ ] 폰 재설치 (Runner 만이라 워치 재서명 창과 무관)

## 별건 (판단 대기)

- [ ] 이미 쌓인 `calendar_media.road_address` 재계산 — 좌표가 맞으므로 서버에서 가능.
      사진에 구워진 글자는 못 고친다.
