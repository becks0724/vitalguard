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
- [x] 배포 — `vitalguard-dashboard-00332-47z`(`ba2ecbf`) · digest `sha256:f9217de3…` 대조 일치
      · 라우트 실증 `/api/app/address` **401**(내 문구) vs 없는 경로 **404**(통제군)

## 2단계 · 앱

- [x] `MediaCapture.resolveAddress` 를 서버 호출로 교체 (`serverAddress` 신설)
- [x] 실패 시 CLGeocoder 폴백 + `(기기 추정)` 표기 (`deviceAddress` 로 분리)
- [x] 표기 규칙(도로명/지번)을 **서버가 정한다** — `display` 한 필드.
      ⚠ **지번 우선**이다(`display: jibun ?? road`). 처음엔 도로명 우선으로 뒀다가
      VWorld 로 갈아탄 뒤 실측을 보고 뒤집었다 — `type=ROAD` 가 촬영지점·하남산단·계림동
      **3/3 NOT_FOUND** 라 우리 현장에 도로명이 아예 없다. 근거는 context-notes 결정 ④.
      뒤집으려면 그 한 줄만 고치고 **앱은 안 건드린다**.
- [x] 각인 형식 변경의 파장 확인
  - `lib/ocr-stamp.ts` 파서 — 새 형식·폴백 형식 둘 다 읽는 것을 가드로 고정
  - `2026-08-22-stamp-accuracy` — 좌표 줄만 보므로 무영향
  - `2026-08-19-photo-capture-location` — `LocationProvider.swift` 만 보므로 무영향
  - `2026-08-19-media-capture-contract` — **앵커 이동**(중복 제거가 `deviceAddress` 로
    내려갔다). 계약은 그대로 두고 슬라이스만 옮겼고, 변이 2종으로 재검증했다.
- [x] Swift 구문 검사 `swiftc -parse` 통과
      ⚠ **타입검사·빌드는 이 맥에서 못 한다**(iOS SDK 컨텍스트 없음). 실기기 빌드가 첫 관문이다.
- [x] 폰 재설치 (Runner) — Swift 빌드 통과(이 맥에서 못 하던 첫 컴파일 관문)
- [x] **실기기 촬영으로 각인 확인 — 뜻하지 않은 프로덕션 A/B 가 잡혔다.**
      같은 좌표(`35.150525, 126.916306`)에서 서버 라우트 유무만 갈렸다.
      ```
      14:38:16  광주광역시 금남로3가 15-2 (기기 추정)   ← 배포 전 · 폴백 + 라벨
      14:49:24  전남광주통합특별시 동구 금남로3가 1-10   ← 배포 후 · VWorld 정답
      ```
      세 판단이 한꺼번에 실증됐다 — ①서버가 주소를 고친다 ②못 받으면 각인이 비지 않는다
      ③그때 `(기기 추정)` 이라고 밝힌다(설계 시 넣은 것이 배포 11분 전 사진에서 바로 쓰였다).

## 별건 (판단 대기)

- [ ] 이미 쌓인 `calendar_media.road_address` 재계산 — 좌표가 맞으므로 서버에서 가능.
      사진에 구워진 글자는 못 고친다.
