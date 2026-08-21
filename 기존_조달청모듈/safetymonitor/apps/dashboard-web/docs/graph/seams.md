# 런타임 경계 호출 지점 색인

grep 으로 실제 코드에서 찾은 것만 적는다. **추정·설계 의도는 넣지 않았다.**
없는 것은 0으로 적고, 0 옆에는 **그 조회가 눈멀지 않았음을 보이는 통제군**을 함께 둔다.

기준 = 2026-08-21 · 커밋 `86f8e78`
제외 = `node_modules` · `.next` · `Pods` · `build` · `dist` · `__pycache__` · `.dart_tool` · `DerivedData`

> 서술형 이음새 표(계약·실패 양상)는 `기존_조달청모듈/safetymonitor/docs/seams.md` 에 있다.
> 이 파일은 **줄 번호 색인**이고 그쪽은 **성격 설명**이다.

---

## 요약

| 범주 | 호출 지점 | 비고 |
|---|---|---|
| HTTP — Swift → 서버 | 6 | 폰이 서버를 부르는 전부 |
| HTTP — Python 엣지 → cctv-ai | 4 | + GoPro 기기 제어 2 |
| HTTP — Arduino → 서버 | 4 | 펌웨어 2종 각 2 |
| HTTP — TS 서버 → 외부 | 20 호스트 | 아래 목록 |
| HTTP — 브라우저 → cctv-ai | 1 | 빌드타임 주입 |
| WCSession (워치 ↔ 폰) | 송신 3 · 수신 3 | |
| Swift ↔ Dart 채널 | 정의 2 · 소비 3 | 요청 목록 밖이지만 경계다 |
| DB 클라이언트 (`pg`) | 풀 3 | 캠퍼스 PostgreSQL |
| **BLE** | **0** | 통제군 있음 |
| **큐 publish/subscribe** | **0** | 통제군 있음 |
| **Supabase** | **0** | 이 레포는 `pg` 를 쓴다 |

---

## 1. HTTP

### 1-1. Swift(폰) → 관제 서버

기준 URL은 `VitalPipeline.resolvedBaseURL()` 하나다. 경로만 다르다.

```
apps/vitalguard_app/ios/Runner/
  VitalPipeline.swift:273   URLRequest  api/app/vital          생체 배치 업로드
  VitalPipeline.swift:287   URLSession.shared.dataTask
  MediaCapture.swift:358    URLRequest  api/app-media          OCR 사진 업로드
  MediaCapture.swift:367    URLSession.shared.dataTask
  VitalBridge.swift:221     URLRequest  api/app/me/vitals      본인 파생 지표 조회
  VitalBridge.swift:233     URLSession.shared.dataTask
  VitalBridge.swift:264     URLRequest  api/calendar/media     (URLComponents 경유 · 275 에서 요청 생성)
  VitalBridge.swift:275     URLRequest
  VitalBridge.swift:280     URLSession.shared.dataTask
  VitalBridge.swift:326     URLRequest  api/<path> 변수         (336 에서 요청 생성)
  VitalBridge.swift:336     URLRequest
  VitalBridge.swift:345     URLSession.shared.dataTask
  VitalBridge.swift:372     URLRequest  api/app-auth/login     로그인
  VitalBridge.swift:378     URLSession.shared.dataTask
```

⚠ `VitalBridge.swift:326` 은 경로가 **변수**(`path`)다 — 이 한 곳은 grep 으로 목적지를 확정할 수 없다.

### 1-2. Dart(폰 UI) → 서버 — **직접 호출 0건**

```
pubspec.yaml            http · dio · chopper 의존 없음
lib/**/*.dart           http.get / http.post / HttpClient / Dio 호출 0건
```

**통제군** — 같은 파일들에서 `import` 는 35개 파일에서 잡힌다(조회는 정상).
로그인조차 Dart 가 아니라 Swift 가 한다(`VitalBridge.swift:372`).
⟹ Dart 는 네트워크 경계를 **한 번도 직접 넘지 않는다.** 전부 채널로 Swift 에 넘긴다(3절).

### 1-3. Python(젯슨 엣지) → cctv-ai

```
cctv-ai/edge/gopro_ppe_edge.py:232   urllib.request.Request   → {CCTV_BASE}/cctv/ingest3
cctv-ai/edge/gopro_ppe_edge.py:234   urlopen(req, timeout=4)
cctv-ai/edge/phone_ppe_relay.py:165  urllib.request.Request   → {url_base}/cctv/ingest3
cctv-ai/edge/phone_ppe_relay.py:168  urlopen(req, timeout=4)
```

같은 파일이 **카메라 기기 자체**도 HTTP 로 제어한다(서버 경계가 아니라 장치 경계).

```
cctv-ai/edge/gopro_ppe_edge.py:93-96 urlopen  → http://{GOPRO_IP}/gp/gpWebcam/START|STOP
```

### 1-4. Arduino(ESP32 가스포드) → 관제 서버

```
Final_GasPod/firmware/gaspod_v4.ino:52        WiFiClientSecure client; client.setInsecure()
Final_GasPod/firmware/gaspod_v4.ino:55        http.begin(client, SERVER_URL)
Final_GasPod/firmware/gaspod_v4.ino:63        http.POST(body)
Final_GasPod/firmware/gaspod_v5/gaspod_v5.ino:57  WiFiClientSecure client; client.setInsecure()
Final_GasPod/firmware/gaspod_v5/gaspod_v5.ino:59  http.begin(client, SERVER_URL)
Final_GasPod/firmware/gaspod_v5/gaspod_v5.ino:67  http.POST(body)
```

⚠ 양쪽 다 `client.setInsecure()` — **TLS 인증서 검증을 끈다.** 코드에 그렇게 적혀 있다.

### 1-5. TS(관제 서버) → 외부 서비스

호스트 상수가 정의된 지점이다(실제 `fetch` 는 같은 파일 안).

```
apps/dashboard-web/
  lib/google-oauth.ts:6            https://accounts.google.com
  lib/google-oauth.ts:7            https://oauth2.googleapis.com
  lib/email.ts:4                   https://api.resend.com
  lib/storage.ts:19                https://kr.object.ncloudstorage.com     NCloud Object Storage
  lib/telegram.ts:13               https://api.telegram.org/bot{token}/sendMessage
  app/api/weather/route.ts:291     https://api.open-meteo.com
  app/api/weather/route.ts:309     https://air-quality-api.open-meteo.com
  app/api/radar/route.ts:20        https://api.rainviewer.com
  app/api/radar/route.ts:27        https://tilecache.rainviewer.com
  app/api/assignment/chat/route.ts:130  https://clovastudio.stream.ntruss.com
  app/lib/risk-tagging.ts:52       https://api.anthropic.com
  app/lib/nts.ts:7                 https://api.odcloud.kr
  app/lib/vworld.ts:21             https://api.vworld.kr
  app/lib/vworld.ts:8              https://vitalguard-dashboard-…run.app   자기 자신
  app/lib/g2b-shop.ts:13           https://apis.data.go.kr
  app/lib/disaster-msg-api.ts:24   https://www.safetydata.go.kr
  app/lib/jma-typhoon.ts:18        https://www.jma.go.jp
  app/lib/moleg.ts:14              https://www.law.go.kr
  app/lib/gibs-himawari.ts:45      https://gibs.earthdata.nasa.gov
  app/lib/tax-invoice-issuance.ts:12   https://oauth.codef.io
  app/lib/tax-invoice-issuance.ts:35   https://development.codef.io
```

⚠ `app/lib/vworld.ts:8` 은 **서버가 자기 자신을 부른다**(프록시 경유). 경계가 아니라 자기호출이다.

### 1-6. 브라우저 → cctv-ai (직결)

```
apps/dashboard-web/app/components/CctvQuadView.tsx:13   NEXT_PUBLIC_AI_CCTV_API || "http://localhost:8000"
apps/dashboard-web/app/components/CctvQuadView.tsx:30-32  CAM-01/02/03 이 그 주소를 그대로 씀
```

★ 이 경로는 **서버를 안 거친다.** 브라우저가 cctv-ai 를 직접 부르므로 서버 이그레스가 죽어도 화면은 멀쩡히 보인다.
주소는 빌드타임 주입이고 미주입 시 `localhost:8000` 으로 폴백한다.

### 1-7. Cloud Scheduler → 서버

호출자는 GCP 라 레포에 없다. **받는 쪽**만 코드에 있다.

```
apps/dashboard-web/app/api/cron/env-check/route.ts:11       cronAuth(x-cron-key, CRON_SECRET)
apps/dashboard-web/app/api/cron/absence-check/route.ts:31   cronAuth(x-cron-key, CRON_SECRET)
apps/dashboard-web/app/api/cron/env-check/route.ts:44       서버가 자기 크론 라우트를 다시 부를 때 쓰는 헤더
```

### 1-8. 모의 발행기

```
scripts/mock-publish.mjs:26   fetch(receiverUrl, { method: "POST" })
scripts/mock-publish.mjs:2    기본값 http://localhost:3000/api/mock/vital
```

⚠ 이름이 `publish` 지만 **큐가 아니라 HTTP POST** 다.
⚠ 기본 경로 `/api/mock/vital` 은 2026-08-18 개명으로 **404 다**(`POST` 미재수출).

---

## 2. WCSession (워치 ↔ 폰)

현행 앱(`apps/vitalguard_app`) 기준.

**송신 — 워치 → 폰**

```
apps/vitalguard_app/ios/VitalWatch/WatchStreamer.swift:262   WCSession.default.activate()
apps/vitalguard_app/ios/VitalWatch/WatchStreamer.swift:503   wc.sendMessage(payload, replyHandler: nil)
apps/vitalguard_app/ios/VitalWatch/WatchStreamer.swift:505   wc.transferUserInfo(payload)   ← sendMessage 실패 시
apps/vitalguard_app/ios/VitalWatch/WatchStreamer.swift:510   wc.transferUserInfo(payload)   ← 도달 불가일 때
```

**수신 — 폰**

```
apps/vitalguard_app/ios/Runner/PhoneReceiver.swift:178   func session(…)            활성화 완료
apps/vitalguard_app/ios/Runner/PhoneReceiver.swift:197   didReceiveMessage
apps/vitalguard_app/ios/Runner/PhoneReceiver.swift:201   didReceiveUserInfo
apps/vitalguard_app/ios/VitalWatch/WatchStreamer.swift:911  func session(…)         워치측 델리게이트
```

⚠ **구 앱 트리에도 같은 API 가 있다** — `apps/VitAlGuard-iOS-WatchOS-App` 에 22곳,
`apps/VitAlGuard-Flutter-Android-App` 계열 포함. 어느 트리가 살아 있는지는 코드로 안 갈린다
(셋 다 git 추적 중). 현행은 `apps/vitalguard_app`(2026-08-20 커밋).

---

## 3. Swift ↔ Dart 채널 — 요청 목록 밖이지만 런타임 경계다

```
정의 (Swift)
  apps/vitalguard_app/ios/Runner/VitalBridge.swift:88   FlutterMethodChannel("vitalguard/bridge")
  apps/vitalguard_app/ios/Runner/VitalBridge.swift:92   FlutterEventChannel("vitalguard/stream")

소비 (Dart)
  apps/vitalguard_app/lib/main.dart:17            MethodChannel('vitalguard/bridge')
  apps/vitalguard_app/lib/record_screen.dart:16   MethodChannel('vitalguard/bridge')
  apps/vitalguard_app/lib/vital_stream.dart:86    EventChannel('vitalguard/stream')
```

계약은 **채널 이름 문자열**뿐이다. 양쪽을 잇는 타입 검사가 없다.

---

## 4. DB 클라이언트 — Supabase 아님, `pg` (캠퍼스 PostgreSQL)

```
apps/dashboard-web/lib/db.ts:4     import pg, { Pool } from "pg"
apps/dashboard-web/lib/db.ts:154   new Pool({ … })                  ← 서버의 유일한 풀
ml/fall-detection/extract_imu_features.mjs:10   new Pool({ max: 1 })          분석 스크립트 전용
scripts/fall-ml/01-db-audit.mjs:28              new Pool({ max: 2, … })       감사 스크립트 전용
```

**관문이 하나다** — `lib/db.ts` 안에 `.query(` 14곳, **그 밖에서 `pool.query`/`client.query` 는 0곳**.

접속 방식은 `db.ts:126-152` 주석에 기록돼 있다 — `uselibpqcompat=true&sslmode=require`,
즉 **검증 없는 암호화**다(캠퍼스 DB 인증서에 SAN 이 없어 `verify-full` 이 구조적으로 불가).

---

## 5. 없는 것 — 0건과 그 통제군

### 5-1. BLE — 0건

```
CoreBluetooth · CBCentralManager · CBPeripheral   (*.swift)   0
flutter_blue · BluetoothDevice · blue_plus        (*.dart)    0
BLEDevice · NimBLE · BLEServer · BLECharacteristic (*.ino)    0
```

**통제군** — 같은 대상 파일에서 있는 것을 찾으면 나온다.

```
*.swift 에서 "import"   50개 파일
*.dart  에서 "import"   35개 파일
*.ino   에서 "WiFi"      2개 파일
```

⚠ 대소문자 무시 `bluetooth|gatt` 로 넓히면 3건이 걸리는데 **전부 오탐**이다 —
`pendin` **`gAtt`** `achments` 가 `gatt` 에 걸린 것이다(`…Assistant.swift:219` 등).

가스포드 ESP32 는 BLE 가 아니라 **WiFi**로 서버에 직접 붙는다(1-4).

### 5-2. 큐 publish/subscribe — 0건

```
mqtt · MQTT · AWSIoT · IoTDataPlane · @google-cloud/pubsub · bullmq · amqp · new Redis   0
```

유일한 언급은 **발표자료 HTML 한 줄**이고, 그 문장 자체가 미구현을 밝힌다.

```
발표자료/VitAlGuard-기술스택-발표자료.html:642
  "AWS IoT Core(MQTT over TLS) → Rule → Lambda … 현재 CDK 스캐폴드만"
```

`backend/infrastructure` 에 AWS IoT **CDK 선언**은 있으나 런타임 발행 호출이 아니다.

```
backend/infrastructure/lib/iot-stack.ts:4    import * as iot from "aws-cdk-lib/aws-iot"
backend/infrastructure/lib/iot-stack.ts:25   new iot.CfnThing(…)      인프라 선언(IaC)
```

이 하위 트리를 참조하는 코드는 0건이다(`docs/seams.md` 참조).

### 5-3. Supabase — 0건

```
@supabase · supabase-js · createClient(     0
```

**통제군** — 같은 방식으로 실제 DB 클라이언트를 찾으면 3개 파일이 나온다(4절).
이 레포의 DB 는 **캠퍼스 PostgreSQL** 이고 클라이언트는 `pg` 다.

---

## 재현

```bash
# 이 문서의 모든 수치는 아래로 재현된다 (레포 루트에서)
EX='--exclude-dir=node_modules --exclude-dir=.next --exclude-dir=Pods --exclude-dir=build
    --exclude-dir=dist --exclude-dir=__pycache__ --exclude-dir=.dart_tool --exclude-dir=DerivedData'

grep -rn $EX -E "URLRequest\(url:|URLSession\.shared\.(data|upload)" --include='*.swift' .
grep -rn $EX -E "urlopen|requests\.(get|post)"                        --include='*.py'    .
grep -rn $EX -E "http\.begin|http\.POST|WiFiClientSecure"             --include='*.ino'   .
grep -rn $EX -E "\.sendMessage\(|\.transferUserInfo\(|didReceive"     --include='*.swift' .
grep -rn $EX -E "FlutterMethodChannel\(|FlutterEventChannel\(|MethodChannel\(|EventChannel\("  .
grep -rn $EX -E "new Pool\(|from \"pg\""                              --include='*.ts' --include='*.mjs' .
grep -rn $EX -E "@supabase|supabase-js"                               .   # 0 이어야 한다
grep -rn $EX -E "CoreBluetooth|BLEDevice|flutter_blue"                .   # 0 이어야 한다
grep -rn $EX -E "mqtt|AWSIoT|@google-cloud/pubsub|bullmq"             .   # 발표자료 1건뿐
```
