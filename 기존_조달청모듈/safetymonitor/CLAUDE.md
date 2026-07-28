# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**SafetyMonitor (가칭 `IndusView`)** — 산업 현장 작업자 생체 모니터링 컨셉. Apple Watch + Android Wear 작업자 단말 ↔ AWS IoT Core 백엔드 ↔ 관제 웹 대시보드 + 모바일 보조 앱. KOSHA 산업안전보건법의 "실시간 위험성 평가" 의무 디지털 지원.

> **이 프로젝트의 목표는 발표용 프로토타입 *한정이 아니라* — 발표(2026-07-07)를 첫 검증 마일스톤으로 삼아 *최종 상용화·현장 실사용*까지 가는 것이다 (2026-06-07 방향 전환).** 따라서 — ① 발표까지는 *데모를 깨지 않는 선*에서 상용화 친화적 선택을 우선하고, ② AWS 실배포·유료 계정·멀티테넌트 같은 큰 전환은 *발표 직후* 착수하며, ③ 모든 결정 기준에 "데모만 되는가"가 아니라 **"현장에서 실제로 24/7 돌아가는가"** 를 포함한다. 제품 전반 상용화 갭 분석·단계별 로드맵은 [docs/commercialization-gap-analysis.md](docs/commercialization-gap-analysis.md), 잠금·배터리 심층은 [docs/commercialization-roadmap.md](docs/commercialization-roadmap.md), 성격 재정의 상세는 [docs/context-notes.md](docs/context-notes.md) 참조.

HealthPattern (개인용 HealthKit 패턴 앱) 의 분석 알고리즘만 이식. HealthKit·SwiftUI 종속 코드는 미사용. 외부 서버 0건 정책은 본 프로젝트에서 **폐기** (관제 자체가 서버 필수).

상세는 [docs/plan.md](docs/plan.md) · [docs/checklist.md](docs/checklist.md) · [docs/context-notes.md](docs/context-notes.md) · [docs/progress.md](docs/progress.md) 참조. 잠금·백그라운드 생체 모니터링 상용화 해결책은 [docs/commercialization-roadmap.md](docs/commercialization-roadmap.md) 참조.

## 현재 상태 (Status — 새 세션 시작 시 먼저 읽기)

- **★ 2026-07-26~28 — PPE 탐지 트랙 신규(CCTV 엣지 안전모·안전조끼·안전화) · 1차 학습 완주 · 젯슨 배포 판정 확정 · 관제웹 코드 변경 0**. (목적) 현행 CAM-03 Hexmon `vyra_ppe.pt`(YOLOv8m 14클래스)를 **교체 가능한지 숫자로 판정**. 작업 폴더 [ml/ppe-detection/](ml/ppe-detection/README.md) · 경과 리포트 [docs/ppe-ml-run-20260728.md](docs/ppe-ml-run-20260728.md). **(설계)** 통합 8클래스(person/head/helmet/safety_vest/foot/shoes/hands/gloves) — **미착용을 별도 클래스로 두지 않고** `head`(맨머리)+person 포함관계로 코드 판정(`judge_ppe()`). 현행 Hexmon 의 `NO-*` 직접탐지는 각도·가림에 깜빡여 폐기. 데이터 = SH17(8,099장·**CC BY-NC-SA 비상업** → 가중치에 `-nc` 접미사 강제)+CSS(CC BY 4.0). 학습=코랩, **엔진 변환은 젯슨에서만**(코랩 `.engine` 은 Jetson 미호환). **(★ 젯슨 배포 판정 = 확정)** 사양 = **Orin Nano Super 4GB**(JetPack 6.2·TensorRT 10.7.0·**DLA 없음**·MAXN_SUPER). 정비 = 헤드리스 전환(여유 RAM 1.4→**2.8GB**)+ollama 모델 40GB·apt 캐시 삭제(디스크 9.0→**50GB**)+ultralytics 8.3.59→8.4.107(**`--no-deps` 필수** — 그냥 `-U` 하면 PyPI torch 가 NVIDIA 빌드를 덮어써 **CUDA 사망**). **TensorRT FP16 @960 실측 = yolo26s 27.0fps / yolo26m 17.1fps** → 목표선(≥10fps) 1.7배로 **m 도 배포 가능**. 함정 = **GUI 켠 채 빌드하면 GPU 가용 107MB 로 최적 커널 931회 건너뜀**(가짜 저성능) → `systemctl isolate multi-user.target` 후 빌드. **(1차 학습)** yolo26s·640·batch16·25ep·**12.345시간**(12,591장) → **mAP50 0.677**, head R 0.874·helmet R 0.633·vest R 0.567·**shoes R 0.612(안전화 탐지 가능성 확인 = 이번 단계 목표 달성)**. 함정 = 960+AutoBatch 는 에포크당 31분이라 완주 불가(77시간 추정) → **640+batch16 고정**으로 해결(GPU 가 71% 놀고 있었음). **(★★ 교차 데이터셋 홀드아웃 = 결론을 바꿈)** 실 현장 영상 부재를 메우려 **학습 미사용 제3 출처**(Hard Hat Workers)로 일반화 측정 → **helmet 19.3% 하락(양호) / head 70.4% 하락·precision 0.181(심각)**. **진단 = 모델이 안전모 쓴 머리를 `head`(맨머리)로 예측** — 학습 데이터 `head 14,413 : helmet 4,478 = 3.2:1` 편중의 직접 결과. **실사용 시 안전모 착용자가 미착용 위반으로 오탐 → 현 상태 관제 투입 불가.** 인도메인 val 만 봤다면 head R 0.874 로 "충분"하다 판단하고 배포했을 것(홀드아웃이 제 역할). 홀드아웃 함정 2건 = **버전별 클래스 병합**(v14 는 helmet+head 를 `head` 하나로 내보내 62.4% 하락은 **허상**)·**증강본**(v13 은 7,035→16,866장, Roboflow 는 `train` 만 증강하므로 **`valid`/`test` 원본만** 써야 공정). **(다음)** ① 1차 `best.pt` 로컬 저장 ② **2차 학습**(`ppe_yolo26_colab_v2.ipynb` 준비 완료·약 12시간) = **Hard Hat Workers(helmet 19,744) 학습 편입**으로 `helmet:head` 1:3.2→**1:0.64** 역전 + SH17 서브샘플 0.5 + Roboflow 증강 사본 제거 + 홀드아웃을 제3 데이터셋으로 교체(2단 확인 구조) ③ AI Hub 국내 데이터 신청 ④ 사진 30장(**착용 20/미착용 10**·3·6·10m·뒤통수·**안전모 손에 든 함정 케이스**) ⑤ 현행 `vyra_ppe.pt` 를 같은 홀드아웃에 태워 비교 ⑥ 학습 가중치로 젯슨 엔진 재변환 + **카메라 파이프라인 켠 상태 재측정**(현 fps 는 파이프라인 OFF 기준) ⑦ shadow 모드 후 교체. **(★ 교훈)** **공개 홀드아웃은 버전 클래스 구성·증강 여부를 먼저 확인**(안 하면 결론이 정반대로 나옴) · **인도메인 val 은 낙관 편향**(val 에 helmet 169·vest 90 인스턴스뿐이라 신뢰구간 넓음) · **코랩 ETA 표시는 실제보다 빠름**(순간속도라 정체 미반영 — 완료 에포크 실측으로만 판단) · **AutoBatch 맹신 금지** · **학습 종료 후 90분 유휴면 런타임 회수**(학습 중엔 실행 중이라 안 죽음).
- **★ 2026-07-27 — 기상특보 세부 모달이 발효 중에도 "정상 범위"로 뜨던 오표시 수정 · 라이브 `00158-2b6`→**`00159-dv5`** · main `85091cf`→`0b01586`**. (제보) 작업 환경에 폭염경보·열대야주의보 알림이 뜨는데 **항목을 클릭하면 세부는 "정상 범위 · 특보 없음"**. (원인) 한 모달 안에서 헤더와 본문이 **서로 다른 값을 보고 있었다** — 헤더 `위험` 배지는 `currentSeverity`(기상청 응답), 본문 정상범위 박스는 **`currentStep` 유무**(`WeatherRuleModal.tsx:103`). 그런데 `WeatherStrip.tsx:505-534` 가 기상특보·예비특보 `RuleEvaluation` 을 컴포넌트 안에서 손으로 만들며 **`currentStep` 을 아예 안 채웠다** → 어떤 특보가 떠도 본문은 영구히 "정상 범위". 다른 기상 항목(체감온도·풍속·미세먼지·자외선·강수·불쾌지수)은 `lib/weather-rules.ts` 의 `evaluate*` 가 `currentSeverity: hit?.severity` + `currentStep: hit` 을 **같은 출처에서 함께** 넣어 무사했다 — 즉 규약은 있었고 두 항목만 그 밖에 있었다. **예비특보도 동일 결함**(지금 발효 예정이 없어 안 보였을 뿐). (수정 `0b01586`) 두 평가를 다른 항목과 같은 자리(`weather-rules.ts`)로 옮기고 `evaluateKmaWarning`·`evaluateKmaPreliminary` 로 노출 + **심각도를 단계에서 파생**시켜(`currentSeverity: hit?.severity ?? "normal"`) 둘이 구조적으로 따로 놀 수 없게 함. 판정 내용·문구·`itemKey` 불변 → 알림·억제·DB 기록 파이프라인 영향 0. (동일 파일의 `kmaToEvaluations`(확인/조치 팝업·알림용)는 `currentStep` 을 이미 올바로 채워 정상 — 목적이 달라 통합하지 않음.) (회귀 고정) `weather-rules.test.ts` 에 기상특보 9건 + **전 항목 심각도·단계 동기 불변식 12건** 신규(총 21건) → **수정을 되돌려 5건 실패를 실제로 확인**한 뒤 복구(L-12 가드 방식). (검증) tsc0·lint0err(4warn 기존)·**test 421**(schemas35+analyzers50+dashboard336)·`next build` SUCCESS·**L-09 3자 일치**(BUILT==HEAD==origin `0b01586`)·라이브 루트200/rev100%/서빙 digest 일치/env24·시크릿·스케일1-4 보존. ★**번들로 실증** — 라이브 page 청크에서 특보 steps 가 모듈 최상위 상수(`let ee=[…],et=[…]`)로 올라갔고 `currentStep:r` 이 `ee.find(t=>t.severity===e?.severity)` 결과로 채워짐(예비특보 동일). (현재상태) **라이브 `00159-dv5` = 코드 `0b01586`**. ⚠ 이후 병렬 세션이 assignment chat 3커밋(`0a106cb`·`a9aeb59`·`a69b3dc`)을 main 에 올렸다 — **미배포이며 배포 주체는 해당 세션**(즉 main ≠ 라이브). cctv-ai OFF 유지. (육안 검증 완료 — 사용자) 라이브에서 기상특보 세부가 정상 표시됨을 확인. (한계) 모달 육안은 로그인 뒤라 curl 검증 불가 — L-04 준수로 테스트 계정 미생성. (다음·07-28 추가) **CCTV 재개(ON) 시** `/api/cctv` GET 신설 — 앱이 45초마다 `/api/mock/cctv`→`/api/cctv`→`/api/mock/vital` 3단 폴백을 도는데 3번째는 200이나 응답 최상위에 `cameras`/`cctv`/`items`/`feeds` 키가 없어 파싱 실패(`VitAlGuardPreviewApp.swift:8425-8477`) → **앱 CCTV 목록이 빈 상태**(30일 972회 헛요청). 재료는 이미 있다 = `CctvQuadView.tsx:29-38` 의 `CAMERAS` 8개소 필드(`id`·`location`·`aiKind`·`aiSuffix`)가 앱 파서 키와 그대로 일치하므로 공유 모듈로 빼서 내보내면 된다(L-12 대비 목록 복제 금지). **지금 만들지 않는 이유** = cctv-ai 가 **과금 방지로 수동 중단** 상태라 목록만 뜨고 영상이 안 나와 혼란만 준다. (다음) 직전 항목들의 이월 미해결(감사 BE-AUTHZ 계열·DB 결정 선행)은 그대로 유효.
- **★ 2026-07-27 — [별도 트랙] 앱 연동 3차 감사 + 감사 미해결 6건 수정 + 캘린더 사진 IDOR 종결 · 라이브 `00151-ntq`→`00153-dpp`→`00154-lm9`→`00155-7f6`→`00156-tbp`→`00157-qr9`→**`00158-2b6`** · main `00a51dc`→`85091cf`**. (요청) 양지후의 7.8 build 78 앱 소스 main 반영 후 **iOS앱↔관제웹/백엔드/DB 연동 감사** → 이후 오류 리스트업·수정·제보 대응까지. (1 · 3차 감사 — 산출물 로컬 `audit/REPORT3-앱연동감사-20260727.md`+PDF) 앱 소스가 처음으로 릴리스와 **diff 0바이트**라 신뢰 가능한 대조가 성립. **07-25 감사가 양지후로 넘긴 P0 5건 중 3건 해소 확인**(세션 자동복구·알림 배너탭 낙상 오분류·lowPower ML 무력화) + 낙상 오탐(`guard isFall`). **미해소 2건** = ★`.mlmodel` 빌드페이즈가 **7.9 시점에도 미해소이며 XcodeGen 도입(`project.yml:72-73 buildPhase: resources`)으로 오히려 고착** — pbxproj 는 생성물이라 손으로 고쳐도 되돌아감, 수정은 반드시 `project.yml` / 워치 활동량 하루누적 유지. **신규 발견** = 7.8 이 추가한 `mlFallPipelineActive` 가 스키마 부재로 **100% 무음 폐기**(`raw_json` 도 post-zod 라 복구 불가) → ML 이 안 도는데 안 돈다는 사실도 서버가 모르는 상태. 라이브 404 6종 실증(`/api/gas`·`mock/gas`·`aed`·`cctv`·`mock/cctv`·`wallet/pass`). (2 · `8ea6d0b`→`00153-dpp`) `mlFallPipelineActive` 스키마 수용. ★**타입 불일치를 판별자로 실증** — 스트립은 조용해 구/신이 둘 다 202 라 버전 구분 불가 → 문자열 `"true"` POST 로 **400 `Expected boolean`** 을 받아 신 스키마 확정. (3 · 이월 항목 **전수 재검증** 후 `8326f54`~`de1e208`→`00154-lm9`) 07-25 감사 이월분을 코드 위치까지 실재 확인(해소 1·부분해소 3 걸러냄) 후 우리 소유 4건 수정 = **댓글 IDOR**(로그인한 누구나 타인 댓글 수정·삭제 가능했음)·**세션 폐기 불가**(거절 계정이 refresh 로 무한 연장)·**외부 프록시 4종 빈도제한**(무인가·무리밋으로 유료 키 대리 소진)·**배치 상한 500**(자르지 않고 413 — 조용히 자르면 클라가 201 을 성공으로 읽어 무음 유실). ★★**L-11 을 실제로 밟았다(배포 전 자력 발견)** — 프록시 3종에 인가를 붙였고 **tsc·lint·test 386 이 전부 통과**했으나, 소비처 역추적에서 `nts`·`tax-invoice-issuance` 가 `app/safety-audit/page.tsx`("로그인 없이 데모")에서도 호출됨을 발견해 되돌림. `vworld-tile` 은 `<img src>` 라 헤더 자체가 불가. 결과 = **news 만 인가+리밋, 나머지 3종은 리밋만**. 교훈 = **테스트 통과는 기능 생존을 뜻하지 않는다**. ★타일 한도도 배포 전 자체 정정(600→3000/분) — 감이 아니라 실제 타일 수로 재계산(1화면 40요청·**IP당 키라 사무실 공용 IP 뒤 3명이면 900~1500**)하니 정상 사용 중 지도가 깨지는 값이었다. (4 · 사용자 제보 "내가 올리지 않은 사진이 삭제됨" → `524b4a0`·`752407b`→`00155-7f6`·`00156-tbp`) 미디어 DELETE·PATCH 소유권 검증. 댓글과 달리 **올리는 쪽(앱 JWT 사번)과 지우는 쪽(관제 세션 username)의 신원 체계가 달라** username 대조를 그대로 쓰면 아무도 못 지운다 → 정책 결정 요청 후 **B안(owner + 업로드 본인)** 채택. (5 · 제보 "내가 올린 사진인데 안 지워짐" ×2회 → `e992a47`→`00157-qr9`, `2cf718a`) ★★★**세 번째에야 진짜 원인을 찾았다** — 1차 소유권 추가, 2차 사번 환산·ID 병합 반영에도 증상이 남자 **코드를 더 고치지 않고 프로덕션 DB 를 읽기 전용 조회** → `users` **9명 중 8명의 `employee_id` 가 null**. 사진·생체는 `EMP-<로그인ID>`(iOS 앱이 서버가 값을 안 주면 만드는 폴백, `VitAlGuardPreviewApp.swift:14045`)로 쌓이는데 서버 컬럼이 비어 대조가 **구조적으로 항상 실패**했다. **2차까지의 코드는 옳았고 데이터가 없었다.** 교훈 = 두 번 고쳐도 증상이 남으면 코드가 아니라 전제를 의심하고 실데이터를 볼 것. 또 하나 = 화면의 "작업자 EMP-6861" 은 **OCR 로 읽은 사진 속 글자**였고 DB `worker_id` 는 null — **보이는 값 ≠ 서버가 대조하는 값**. (수정) 규칙을 새로 정하지 않고 **앱이 이미 쓰던 `EMP-<username>` 을 서버가 인정**(`lib/employee-id.ts` 단일 지점 + 백필 `WHERE employee_id IS NULL` + 가입 2경로). 이미 값이 있는 계정 불변(`worker1`=`EMP-6861` 보존 실측). ★**UI 가 서버 규칙을 복제하던 것도 걷어냄** — 화면에서 `role==="owner"` 로 버튼을 감췄던 게 **한 번 만에 어긋나 이 제보를 낳았다** → GET 이 항목별 `canDelete` 를 내려주고 화면은 받아쓰기(판정은 서버 한 곳·모르면 감춘다). (6 · `85091cf`→**`00158-2b6`**) 삭제 불가 사유 안내 — 사번 없는 사진만 "작업자 정보 없음", **남의 사진은 표시 없음**(설명할 일이 아니고 소유자를 강조할 이유도 없다). (7 · 데이터 정정, 사용자 승인) 사번 없던 과거 사진 **4건**(6/24~7/1)에 업로더 기준 사번 부여 → 남은 NULL **0건**. 프로덕션 쓰기라 1차는 분류기 차단 → 우회하지 않고 재승인 후 실행. (8 · 저장소 위생 `15a9405`) `docs/audit-*` **10건 추적 해제** + `.gitignore` 에 `audit/` 승격(종전 `.git/info/exclude` 는 다른 클론에 규칙이 없었다). 히스토리 재작성(3안)은 **비공개 저장소 + force push 로는 GitHub 잔존(Support purge 필요) + 릴리스 태그 6개 재생성** 비용을 근거로 사용자와 함께 2안으로 하향. (검증 공통) 매 배포 tsc0·lint0err(4warn 기존)·**test 338→401**(신규 63건)·L-09 3자 일치 전건 통과. **가드 테스트는 실제로 깨뜨려 실패까지 확인**(외부프록시 리밋 제거·백필 WHERE 절 제거). L-11 은 매 배포 **크론 수동 트리거**로 200 확인(정기 실행보다 배포가 늦으면 "안 돈 것"과 "무손상"을 구분해야 하므로). 앱 4xx 는 **직전 리비전과 대조**해 기존 현상(`/api/cctv` 404 등)과 분리(L-13). (현재상태) **라이브 `00158-2b6` = 코드 `85091cf`**. main 최신 2커밋(`6604d44`·`c0d6378`)은 **docs 전용이라 재배포 불필요** — 즉 코드 기준으로 main == 라이브다(직전 항목의 "병렬 세션 미배포분 존재" 기술은 이 배포로 해소됨). 계정 사번 **9/9**·사진 소유자 **29/29**·env24·스케일1-4·cctv-ai OFF 유지. (다음) ① **[양지후 조율]** `.mlmodel` 빌드페이즈 = `project.yml:72-73` 수정(pbxproj 수동편집은 XcodeGen 재생성에 되돌아감) · 워치 활동량 60초 창 · 앱 폴백 제거(`VitAlGuardPreviewApp.swift:14045` — 서버가 값을 주게 돼 안전해졌으나 값이 같아 급하지 않음) ② **[우리]** ML 텔레메트리 7종+상시모션 2종 **DB 컬럼·fall-export CSV 부재**(raw_json 에만 갇힘 — P0-1 과 함께 고쳐야 의미) · `POST /api/calendar/media` 귀속 위조(호출 클라 없음) · ~~404 6종 폴백 정리~~ → **07-28 실측으로 작업 불필요 판명**(30일 로그 집계 — `gas`·`mock/gas`·`aed`·`wallet/pass` 는 각 1회로 **감사 프로브 흔적**이며 앱은 폴백을 갖거나(`/api/aed`→`/api/aed/inspections`) 호출조차 안 한다(wallet 은 URL 파싱만). `cctv`·`mock/cctv` 972회만 실호출인데 이는 **CCTV 수동 중단(과금 방지)의 부산물** → `/api/cctv` 신설은 **CCTV 재개 시점에 묶는다**) ③ **[이월 미해결]** BE-AUTHZ-01(클라 토큰 배포 선행)·-05·-06(무인증 GET 5종)·-11·-12·-13 · BE-LEAK-01(weather:234·radar 업스트림 오류 노출) · BE-PERF-01(imu INSERT 마다 DDL 3회) · FE-PUBLIC-01(공개 4라우트)·FE-CSP-01·FE-POLL-01(메인 2초 폴 무가드) ④ **[결정 선행]** DB 5건 — 캠퍼스 DB 유지 여부가 전제(파기 수단 부재·인덱스가 실쿼리와 불일치=`idx_alerts_created` vs `ORDER BY ts`·마이그레이션 이력·FK 0건).
- **★ 2026-07-27 — 다크모드 파비콘 2단(테마 자동전환 SVG + Safari용 테마별 PNG) + /retro L-16 구조적 차단 · 라이브 `00149-rs6`→`00150-9cf`→**`00151-ntq`** · 커밋 `bce061b`·`1b03481`·`eef4454`**. (요청) 라이트 모드는 로고가 잘 나오는데 **다크모드에서 탭 아이콘 가독성이 떨어짐** → 다크모드용 아이콘 설정. 부수 요청 = 감사 산출물 push 금지. (선행 — 감사 산출물 로컬 전용) `.git/info/exclude` 에 `/audit/`·`/VitAlGuard-코드베이스-audit-보고서-*.pdf` anchored 등록(harness·발표자료와 동일 방식·exclude 규칙 자체도 push 안 됨). 감사에서 나온 **코드 수정 커밋은 정상 push** — 제외 대상은 리포트·findings 산출물뿐. (1차 `bce061b`→`00150-9cf`) 기존 `app/icon.png` 단일(네이비→블루 `#0d2038`→`#2a8dff`)이라 다크 크롬에서 배경에 묻힘 → 신규 `app/icon.svg`(브랜드 원본 방패+ECG 패스 그대로, CSS `prefers-color-scheme` 로 스트로크 전환 — 다크 `#ffffff`→`#effaff`→`#a9dcff`). ★ **`app/icon.png` 제거가 필수였다** — 같은 base name 이면 Next 가 **png 만 emit 하고 svg 를 통째로 무시**(dev 서버 head 실측으로 확인, 안 지웠으면 무효 배포). (2차 `1b03481`→**`00151-ntq`**) Safari 는 SVG 내부 media query 를 무시 → `public/brand/favicon-{dark,light}.png` 신규(브랜드 원본 4267px 에서 SVG 와 **동일 crop 박스**로 방패만 잘라 256px·두 장 기하 동일 → 테마 전환 시 위치 안 튐) + `app/icon.svg`→`public/brand/favicon.svg` 이동 + `metadata.icons` 로 순서 명시 = **다크 PNG → 라이트 PNG → SVG(sizes=any)**. 순서 근거 = Chrome·Firefox 는 SVG 를 골라 내부 전환하고, `media` 를 무시하고 '마지막'을 쓰는 브라우저는 **라이트(기존 동작)로 폴백**해 어느 경로로도 회귀가 없다. ★ **회귀 1건 자체 적발·복구** — `metadata.icons` 를 선언하면 파일 컨벤션 `app/icon.*`·`app/apple-icon.png` 링크가 **전부 사라진다** → apple-touch-icon(iOS 홈화면)이 조용히 빠졌고 `icons.apple` 재명시로 복구. 라이브 head 5종 = `favicon.ico(16x16)` + 다크PNG(media dark) + 라이트PNG(media light) + `favicon.svg(any)` + apple-touch-icon. (**/retro — L-16 추가 + 구조적 차단 완료**) L-16 = *프레임워크 컨벤션 자산은 "파일을 뒀다"가 반영을 뜻하지 않는다* — 위 두 함정 모두 tsc·lint·test·build 를 전부 통과했고 **렌더된 head 를 grep 해서야** 드러났다. 신규 `apps/dashboard-web/lib/icon-metadata.guard.test.ts`(5건)가 ⓐ `metadata.icons`+`app/icon.*` 혼용 ⓑ `icons.apple` 누락 ⓒ 존재하지 않는 아이콘 참조를 **테스트 실패로 차단**(위반 3종을 실제로 만들어 각각 실패 확인·L-12 가드 방식). `/verify` 에 "메타데이터·정적 자산 변경 시 렌더된 head 대조" 절 추가. (검증) 각 배포 tsc0·lint0err(4warn 기존)·**test 363→368**(가드 5 신규)·`next build` SUCCESS·**L-09 BUILT==HEAD==origin 3자 일치**·라이브 루트200/rev100%/서빙 digest 일치/아이콘 자산 5종 200/구 `/icon.png`·`/icon.svg` **404**/라이브 SVG·PNG 2장이 **커밋 파일과 바이트 동일**/다크 PNG 불투명 픽셀 평균 RGB **(232,247,255)** vs 라이트 **(23,69,118)** 실측(테마 반전 확인)/env5·시크릿19·스케일1-4 보존. (팀원 동기 — 사용자 지시) 배포 전·빌드 후·push 전 매 단계 `git fetch`. 가드테스트 push 시 팀원 커밋 **`d528db6`**(mayeramschel — VitAlGuard 7.8 build 78 앱 소스) 발견 → 겹치는 경로 0(Swift·pbxproj) 확인 후 rebase 통합·**재검증(tsc·test) 후** push. (현재상태) **라이브 `00151-ntq` = 파비콘 커밋 `1b03481` 이미지**. 내 트랙의 이후 2커밋(`d528db6`=팀원 iOS/watchOS 앱 소스·대시보드 무관, `eef4454`=가드 테스트 전용)은 **재배포 불필요**. ⚠ 단 그 뒤로 **병렬 세션이 대시보드 코드를 계속 커밋 중**(사진 소유권·사번 기본값·7.9 릴리스 등 `0180a5d`~`85091cf`) — **이들은 미배포이며 배포 주체는 해당 세션**이다. 즉 `main`(현재 `6604d44`) ≠ 라이브. `app/favicon.ico` 는 2026-07-24 Safari 대응으로 만든 **BMP-in-ICO 그대로 유지**(라이트 전용 레거시 폴백). cctv-ai OFF 유지. (다음) ① **(사용자 육안)** 다크모드에서 탭·북마크 아이콘 확인 — 브라우저 파비콘 캐시가 강하니 탭을 닫았다 다시 열거나 ⌘⇧R ② **Safari 의 icon `media` 속성 지원 여부 미검증** — 지원하면 테마별 PNG, 미지원이면 BMP ICO(라이트)로 폴백(회귀 없음). Safari 확인 후 필요하면 다크용 ICO 별도 배선 검토 ③ (참고·이 트랙 밖) 다른 세션의 감사 미해결 4건(BE-AUTHZ-03/-09/-08·BE-VALID-01)은 **이 워킹트리·main 에 없다**(그쪽 test 386 vs 현 368) — 별도 승인·배포 대기.
- **트랙**. 프로토타입 (D0~D4). 발표 후 로드맵 (M0~M9) 은 격하 보관.
- **현재 위치**. **D1 ~99% + D2 ~92% + D3 ~78% + D4 UI 폴리싱 진행** — iPhone **2대 install 완료** (BECKS 장우진/EMP-6861 + YJH 양지후/EMP-1024) + **Galaxy worker_phone install 완료** (김동현/EMP-2222). **Cyён iPhone 16 install 차단** (Apple Developer team `F2P5ZFP65Q` 디바이스 한도) → 발표 폰 구성 **iPhone 2대 + Galaxy 1대**. **2026-05-28 관제 웹 대폭 확장** = 다크/라이트 모드, 실시간 미수신 메트릭 차트 비활성화, SQLite DB 영속화, 관리자 메뉴 CSV/XLSX, 현장환경 weather_log, 온도 위험도 offset 0.5, worker-phone 자동 재연결, git baseline. **2026-05-29 관제 웹** = VitAlGuard 라이트/다크 CI 로고, Coinbase/VitAlGuard 톤 레이아웃, 히어로 최종 문구 `OPEN SAFETY · NEVER ALONE`, 현장정보/수신요약/WeatherStrip 정렬, 관리자 현장정보 localStorage+서버 DB `site_info_daily` KST 일 1회 snapshot, XLSX 시트1 현장정보·시트2 생체데이터·시트3 현장환경, CSV 현장정보 블록 포함. **현재 공유 네트워크 전체 종료 상태**(2026-06-12 세션37 — dev/cloudflared/CCTV :8000 OFF). 마지막 active cloudflared URL = `channels-respect-absolute-watches.trycloudflare.com`(세션37 발급 후 종료; quick tunnel 은 세션마다 만료 → 재기동 시 **새 URL 발급·회전**, 폰 인앱·워치·이 문서 갱신 필요). **CCTV AI 영상 = 2026-06-27부터 라이브는 Cloud Run AI 서버([cctv-ai/](cctv-ai/), `cctv-ai-569797426568.asia-northeast3.run.app`, **⏸ 현재 OFF(CCTV 보류·과금 0)** — `--min-instances 0 --ingress internal`(리비전 `00017-nld`, 외부 404 차단 → 안 깨고 과금 0·삭제 아님). **재개(ON)**: `gcloud run services update cctv-ai --region asia-northeast3 --min-instances 1 --ingress all`. ─ 기능 최종 `00015-pp4` 구성 보존: **CAM-01 YOLOv8n 객체+속도(로테르담 건설현장 부감 고정캠 클립·차량 한글검출·주차라 속도 거의 비표시)·CAM-03 Hexmon PPE+낙상 듀얼소스(번들 클립 기본 + 폰 라이브 `/cam3/capture`→`/cctv/ingest3` override·3초 폴백, stats3 `fall_count` 노출)**·CAM-02 합성·한글 라벨, `--cpu 4 --memory 4Gi --no-cpu-throttling --min-instances 1 --max-instances 1 --update-env-vars YOLO_IMGSZ=800,PLAYBACK_FPS=6,OMP_NUM_THREADS=1,MKL_NUM_THREADS=1`(재개 시 상시 과금). **관제웹 MJPEG 연결 OK·안정(429 해소).** ★ **핵심: `OMP/MKL_NUM_THREADS=1`(torch 스레드 제한)이 CPU 기아 429 해결** — 추론 2코어+HTTP 2코어 보장 → 단일 인스턴스로 **MJPEG 대시보드+폰 override 동시 양립**(과거 max↑ 는 콜드스타트 처닝으로 더 불안정). 상세는 [docs/progress.md](docs/progress.md) ★CCTV 섹션)로 연동 — 대시보드가 build-arg `NEXT_PUBLIC_AI_CCTV_API`로 그 URL을 빌드타임 주입. 로컬 dev 는 `.env.local`의 동일 키 또는 코드 폴백 `http://localhost:8000`. (옛 `/ai-cctv` 프록시·`safetymonitor-cctv-demo` 로컬기동 방식은 대체됨.)** **dev 서버는 세션18부터 `0.0.0.0:3000` LAN 바인딩**(발표 PC·내 폰 브라우저 접속용; 조원 차단은 `scripts/lan-firewall.sh` pf 허용목록 — sudo 필요·미적용 상태). Mac LAN IP `192.168.219.221`. **현장위치 GPS 화면 표시 ON** — `.env.local MOCK_VITAL_EXPOSE_PII=true`(GET 응답에 GPS·보호자 노출, SOS 모달 현장위치/지도용). **2026-05-29 세션4 — 워치 PoC 물리 §4 잠금 검증 PASS** (BECKS Apple Watch Ultra, iPhone 잠금 15분 워치 null 0%/폰 null 98% → 워치 워크아웃 세션이 잠금 우회 실증). **2026-05-29 세션5 — 워치 PoC 기능 확장** = 낙상(Core Motion)·SpO₂(anchored) 센서 + 인앱 URL/작업자 편집 + 스트레스 입력 7종 + 파스텔 카드 UI. **★ 워치 재설치 완료 + 실측 검증** — EMP-9001 신규 빌드가 SpO₂ 92·안정심박 100·활동에너지·낙상 accelG 5.45·배터리 70·작업자명 장우진 수신(store age 1s) → 센서/스트레스/인앱설정 전부 실기기 동작 확인. 앱 아이콘·헤더 로고 커밋 `65e13bf`. 블로커(세션32 정정) = Galaxy Health 권한 **해결**(stale APK 재빌드 — "Step 2 데이터 타입별 권한 미수행" 추정은 틀렸음, 권한 3종 이미 granted=true) — **워치 fresh 데이터도 해결**(세션32 이어서, 착용+"계속 측정"→Samsung Health→HC 동기화 라이브, 관제 웹 EMP-8888 김동현 hr 94~99 연속 수신·DB 2분 65건·코드 변경 0). 남은 것: 관제 웹 최종 QA + 관리자 저장/내보내기 회귀, 손목온도 freshness 필터 결정, Galaxy Health Connect 권한, 2 iPhone 최신 release 재install, 스트레스 baseline 축적(07-07), 워치 배터리 풀시프트 측정, D4 리허설
- **상세**. [docs/progress.md "Quick Summary"](docs/progress.md#quick-summary-30초-안에-읽기) 우선 확인
- **이전 세션 히스토리(2026-05-21~2026-07-21 및 운영 노트)** — 토큰 절감을 위해 [docs/claude-md-archive-20260723.md](docs/claude-md-archive-20260723.md) 로 이동(2026-07-23 다이어트, 내용 무손실). 누적 핵심 결정 (a)~(cn) 은 [docs/key-decisions.md](docs/key-decisions.md). 새 세션 항목은 이 목록 맨 위에 추가하되 **최신 3개만 유지**하고 밀려난 항목은 아카이브로 옮긴다.

## 환경

- 모노레포 — pnpm workspaces (TypeScript 영역) + 별도 Flutter 프로젝트 (`apps/worker-phone/`)
- TypeScript 5.x strict
- Node.js LTS
- **작업자 폰 앱 — Flutter (Dart 3.x)** · iOS 빌드용 Xcode 26.4+ · Android 빌드용 Android Studio + JDK 17
- **워치 — 앱 미작성**. Apple Watch / Galaxy Watch 모두 페어 폰의 HealthKit / Health Connect 로 데이터 query
- 웹 — Next.js 15 + Tailwind + shadcn/ui
- 인프라 — AWS CDK (TypeScript) · Region `ap-northeast-2` (서울)
- 외부 의존성 — AWS SDK · Flutter 공식 패키지 (`health` · `mqtt_client` 등) 외 신규 추가 시 사전 합의

## 빌드 / 테스트 / 검증

```bash
# 전체 모노레포
pnpm install
pnpm build                          # pnpm -r --filter=./packages/* --filter=./apps/dashboard-web build
pnpm test                           # pnpm -r --filter=./packages/* --filter=./apps/dashboard-web test (analyzers + schemas + dashboard)
pnpm lint

# 패키지 단독
pnpm --filter @safetymonitor/analyzers test
pnpm --filter @safetymonitor/dashboard-web dev

# 인프라
cd backend/infrastructure
pnpm cdk diff --profile dev
pnpm cdk deploy --profile dev

# 작업자 폰 앱 (Flutter — iOS + Android 단일 코드베이스)
cd apps/worker-phone
flutter pub get
flutter doctor                      # 환경 점검 (iOS · Android toolchain)
flutter test                        # 단위 테스트
flutter run -d "iPhone 16"          # iOS 시뮬레이터 실행
flutter emulators --launch SafetyMonitor_API_35
flutter run -d SafetyMonitor_API_35 \
  --dart-define=MOCK_RECEIVER_URL=http://10.0.2.2:3000/api/mock/vital
flutter build ios --simulator       # iOS 빌드 검증
flutter build apk --debug \
  --dart-define=MOCK_RECEIVER_URL=http://10.0.2.2:3000/api/mock/vital

# AWS 보류 중 local/mock receiver
pnpm dev:web                        # http://localhost:3000
pnpm mock:publish                   # 4 worker mock vital 5초 간격 publish
```

## 코드 구조 — 큰 그림 (M1 진입 후 채움)

> ⚠️ 아래 트리는 **목표(미래) 구조** — 발표 후 로드맵 항목을 포함한다. 현재 디스크에 **존재하지 않는 경로**: `apps/dashboard-mobile/`, `backend/lambdas/*`, `packages/thresholds/`, `docs/architecture.md`, `docs/HealthPattern-reference/`, `.github/workflows/`. 현존 = `apps/{dashboard-web,worker-phone,worker-watch-poc}` · `backend/infrastructure` · `packages/{analyzers,schemas}`.

```
06.safetymonitor/
├── apps/
│   ├── worker-phone/               Flutter 작업자 폰 앱 (iOS + Android 단일 코드)
│   ├── dashboard-web/              Next.js 관제 대시보드 (PC)
│   └── dashboard-mobile/           관제자 모바일 보조 (M7 — Flutter / RN / 네이티브 결정)
├── backend/
│   ├── infrastructure/             AWS CDK (IoT · Auth · Data · Lambda 스택)
│   └── lambdas/
│       ├── vital-ingest/           IoT Rule → Timestream/DDB 적재
│       ├── hazard-detect/          vital → analyzers → HazardEvent
│       └── notify-fan-out/         HazardEvent → APNs·FCM·SES·Slack
├── packages/
│   ├── analyzers/                  공통 위험 감지 5종 (TS) — HealthPattern 이식
│   ├── thresholds/                 임계값 상수 (KOSHA + 의료 reference)
│   └── schemas/                    공통 데이터 스키마 (Zod)
├── docs/
│   ├── plan.md                     비전 · MVP · 아키텍처 · 마일스톤
│   ├── checklist.md                M0~M9 체크박스
│   ├── context-notes.md            의사결정 기록
│   ├── compliance.md               KOSHA · 개보법 · 근로계약
│   ├── architecture.md             데이터 흐름 상세
│   └── HealthPattern-reference/    HealthPattern docs 사본 (참고용)
└── .github/workflows/              CI (lint · build · test)
```

데이터 흐름. **Apple Watch / Galaxy Watch (생체 센서)** → **페어 폰 (Flutter `worker-phone` 앱 — HealthKit/Health Connect query)** → MQTT/TLS → AWS IoT Core → IoT Rule → Lambda (vital-ingest → hazard-detect → notify-fan-out) → DynamoDB/Timestream → WebSocket → 웹 대시보드 / APNs·FCM → 관제자 모바일.

## HealthPattern 과의 정책 차이 (혼동 방지)

| 항목 | HealthPattern | SafetyMonitor |
|---|---|---|
| 사용자 | 단일 (본인) | 다수 + 관제자 |
| 외부 서버 | **0건 (정책)** | **필수 (AWS)** |
| 클라우드 | M7 한정 Apple 인프라 예외 | AWS 전면 |
| 인증 | 없음 | Cognito + 멀티 테넌트 |
| ML | 금지 | 1차 금지 · 2차 검토 |
| 다국어 | 금지 | 금지 (동일) |
| 외부 패키지 | 0건 | AWS SDK + 필요 시 |

HealthPattern 의 코드·정책을 본 프로젝트에 그대로 적용하면 안 됨. 분석 알고리즘 *로직* 만 차용.

## 핵심 관례 — 모르면 함정

- **단말 코드는 최소 분석만 — 본 분석은 서버 사이드**
  - 낙상처럼 즉시성 필수인 것만 폰 단말 (Flutter) 에서 detection. 나머지 (심박 이상·SpO₂·고립 등) 는 vital 만 publish 하고 분석은 Lambda 가 수행
  - 사유. `packages/analyzers` (TS) 가 단일 source. Flutter 단말도 가능하면 raw 송신만 하고 분석은 Lambda 위임 → drift 위험 제거

- **워치 앱 미작성 — 폰이 HealthKit / Health Connect 로 query**
  - 워치 (Apple Watch / Galaxy Watch) 는 *생체 센서* 로만 사용. 별도 watchOS App / Wear OS App 미작성
  - Flutter 폰 앱이 `health` 패키지 + platform channel 로 페어 워치의 HR · SpO₂ · 가속도 query
  - SOS 버튼·연결 상태 UI 는 *폰 화면* 에 (워치 화면 미사용)
  - 사유. 1인 개발 + 발표 임팩트 측면에서 워치 OS 별 2개 네이티브 부담 회피 ([context-notes.md 2026-05-21 "단말 아키텍처 정정"](docs/context-notes.md))

- **`packages/analyzers` 는 순수 함수 — I/O 금지**
  - 입력. 정규화된 vital 시계열. 출력. HazardEvent 후보
  - Lambda·웹·모바일 어디서든 호출 가능해야 함
  - AWS SDK · fetch · DB 호출 절대 금지

- **AWS Cost — 매주 확인 + 알람 단계화**
  - 월 알람 $50 / $100 / $200 단계
  - Free Tier 만료 12개월 후 IoT Core (메시지당 $1/M) · Timestream (스토리지) 부터 증가
  - 비용 폭증 1순위. Timestream 쿼리 (full scan 주의), CloudWatch Logs retention 무제한 방치

- **인증서 keystore — 디바이스별 격리 + 회수 절차 필수**
  - 작업자 퇴사 / 단말 분실 시 인증서 revoke 워크플로우 (Cognito 사용자 + IoT Thing 비활성화 동시)
  - 베타 시작 전 revoke 1회 모의 훈련 필수

- **개인정보 — 명시적 동의 없이 수집 절대 금지**
  - 작업자 onboarding 시 동의서 (디지털 서명 + 동의 철회 권리) → DynamoDB 별도 저장
  - 동의 철회 시 데이터 익명화 cron 자동 실행
  - 사고 데이터는 익명화 불가 (KOSHA 3년 보존) — 동의서에 명시 필수

- **알림 deduplication — 동일 워커·동일 type 5분 윈도우**
  - Lambda `hazard-detect` 에서 DynamoDB conditional write 로 5분 dedup key 체크
  - `danger` severity 는 dedup 미적용 (생명 우선)

- **한국어 단독 — 영문 라벨 추가 금지**
  - 로그·UI·문서 모두 한국어. 영어는 코드 식별자·API field name 만
  - 사유. HealthPattern 정책 계승 + KOSHA 보고서 한국어 의무

## 의도적 비범위 (out of scope)

손대지 말 것. 사용자가 명시적으로 결정함 ([docs/context-notes.md](docs/context-notes.md) 2026-05-21).

### 프로토타입 (현 시점) 비범위 — 발표 후로 이연
- **워치 앱 (watchOS App / Wear OS App)** — 워치는 생체 센서로만 사용. 폰 앱이 HealthKit/Health Connect query
- **멀티 테넌트** — 시연용 worker 2~4명 (실기기 2 + mock 1~2). 단 조직 1개·관제자 1명·멀티 테넌트 X 유지
- **Cognito 인증** — dev 데모는 인증 stub 또는 로컬 토큰
- **APNs / FCM / SES / Slack 알림** — 데모는 웹 alert 만
- **위험 감지 5종 중 고립** — 낙상·심박이상·SOS·**SpO₂·고온** 5종 시연. 고립은 발표 후
- **KOSHA PDF 리포트 / AuditLog 인프라** — 슬라이드 언급만, 구현 X
- **App Store / Play Store 배포** — Xcode 개발자 모드·실기기로 시연
- **베타 협력사 운용 / 법률 자문 / 도메인 정식 확보 / GitHub Organization / 의료기기 인증 검토** — 발표 후

### 영구 비범위 (프로토타입·프로덕션 공통)
- 머신러닝 / 자율 학습 — 2차 이후. 1차는 규칙·통계만
- 영상 (CCTV) 통합 — 2차
- 자동 119 연계 — 2차. 1차는 관제자 수동 호출
- 다국어 — 한국어 단독. 영문 fallback 추가 금지
- 의료기기 인증 (MFDS) — 산업 안전 보조 정보 범주로 한정. 진단·치료 주장 절대 금지
- iOS·Android 외 OS — 1차는 두 OS만
- 자체 단말 OEM — 기존 Apple·Samsung 단말 활용

## Flutter Project Guidelines

> ⚠️ **현 시점 (2026-05-27) 적용 상태** — `apps/worker-phone/` 은 아직 이 가이드라인을 따르지 않음. Riverpod 미도입 (의존성 없음), `lib/` 는 `models/ + services/ + main.dart` 평면 구조. **발표 (2026-06-04, D-8) 전까지 리팩토링 금지** — 신규 작성 코드부터 점진 적용, 기존 코드 대규모 이동은 발표 후 로드맵으로 이연.

### State Management
- Riverpod 2.x 사용
- Provider 직접 사용 금지

### Folder Structure
```
lib/
├── core/         # 공통 유틸, 상수
├── data/         # API, 로컬DB
├── domain/       # 모델, 유스케이스
├── presentation/ # 화면, 위젯
└── main.dart
```

### Code Style
- 한국어 주석 허용
- async/await 우선, .then() 지양
- const 위젯 적극 활용

### Testing
- 새 기능 추가 시 widget test 함께 작성
- 통합 테스트는 `integration_test/` 폴더
