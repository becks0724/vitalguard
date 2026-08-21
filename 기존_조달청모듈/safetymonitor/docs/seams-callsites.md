# 런타임 경계 호출 지점 색인

**이 파일은 `scripts/scan-seams.sh` 가 생성한다. 손으로 고치지 말 것** — 다음 실행에 덮인다.
고쳐야 할 것이 있으면 스크립트를 고친다.

grep 으로 실제 코드에서 찾은 것만 적는다. 추정·설계 의도는 넣지 않는다.
없는 것은 0으로 적되 **그 조회가 눈멀지 않았음을 보이는 통제군**을 옆에 둔다.

- 생성 = `scripts/scan-seams.sh` (에이전트는 `/graph-scan`)
- 기준 커밋 = `9c16b8d`
- 제외 = node_modules · .next · Pods · build · dist · __pycache__ · .dart_tool · DerivedData

> 이음새의 **성격·계약·실패 양상**은 `docs/seams.md` 에 있다. 이 파일은 **줄 번호 색인**이다.

---

## 1. HTTP

### 1-1. Swift(폰) → 관제 서버

```
Runner/VitalPipeline.swift:273:        var request = URLRequest(url: cfg.baseURL.appendingPathComponent("api/app/vital"))
Runner/VitalPipeline.swift:287:        let task = URLSession.shared.dataTask(with: request) { _, response, error in
Runner/MediaCapture.swift:358:        var request = URLRequest(url: VitalPipeline.resolvedBaseURL().appendingPathComponent("api/app-media"))
Runner/MediaCapture.swift:367:        URLSession.shared.dataTask(with: request) { data, response, error in
Runner/VitalBridge.swift:225:        var request = URLRequest(url: VitalPipeline.resolvedBaseURL().appendingPathComponent("api/app/me/vitals"))
Runner/VitalBridge.swift:237:        URLSession.shared.dataTask(with: request) { data, response, error in
Runner/VitalBridge.swift:279:        var request = URLRequest(url: url)
Runner/VitalBridge.swift:284:        URLSession.shared.dataTask(with: request) { data, response, error in
Runner/VitalBridge.swift:340:        var request = URLRequest(url: url)
Runner/VitalBridge.swift:349:        URLSession.shared.dataTask(with: request) { data, response, error in
Runner/VitalBridge.swift:376:        var request = URLRequest(url: VitalPipeline.resolvedBaseURL().appendingPathComponent("api/app-auth/login"))
Runner/VitalBridge.swift:382:        URLSession.shared.dataTask(with: request) { data, response, error in
```

### 1-2. Dart(폰 UI) → 서버

```
직접 호출: 0건
pubspec http/dio/chopper 의존: 0
0건
[통제군] *.dart 에서 import 가 잡히는 파일: 10개
```

### 1-3. Python(젯슨 엣지) → cctv-ai · 카메라 기기

```
cctv-ai/edge/gopro_ppe_edge.py:96:            urllib.request.urlopen(path, timeout=5).read()
cctv-ai/edge/gopro_ppe_edge.py:232:                req = urllib.request.Request(f"{url}?{q}", data=jpg,
cctv-ai/edge/gopro_ppe_edge.py:234:                with urllib.request.urlopen(req, timeout=4):
cctv-ai/edge/phone_ppe_relay.py:165:            req = urllib.request.Request(f"{url_base}?{q}", data=jpg,
cctv-ai/edge/phone_ppe_relay.py:168:                with urllib.request.urlopen(req, timeout=4):
```

### 1-4. Arduino(ESP32) → 관제 서버

```
Final_GasPod/firmware/gaspod_v4.ino:4:#include <WiFiClientSecure.h>
Final_GasPod/firmware/gaspod_v4.ino:52:  WiFiClientSecure client; client.setInsecure();
Final_GasPod/firmware/gaspod_v4.ino:55:  if(!http.begin(client, SERVER_URL)) { Serial.println("[net] begin 실패"); return; }
Final_GasPod/firmware/gaspod_v4.ino:63:  int code=http.POST(body);
Final_GasPod/firmware/gaspod_v5/gaspod_v5.ino:4:#include <WiFiClientSecure.h>
Final_GasPod/firmware/gaspod_v5/gaspod_v5.ino:57:  WiFiClientSecure client; client.setInsecure();
Final_GasPod/firmware/gaspod_v5/gaspod_v5.ino:59:  if(!http.begin(client, SERVER_URL)) return;
Final_GasPod/firmware/gaspod_v5/gaspod_v5.ino:67:  int code=http.POST(body);
```

### 1-5. TS(관제 서버) → 외부 서비스 — 호스트 상수 정의 지점

```
lib/google-oauth.ts:6:"https://accounts.google.com
app/api/weather/route.ts:309:"https://air-quality-api.open-meteo.com
app/lib/risk-tagging.ts:52:"https://api.anthropic.com
app/lib/nts.ts:7:"https://api.odcloud.kr
app/api/weather/route.ts:291:"https://api.open-meteo.com
app/api/radar/route.ts:20:"https://api.rainviewer.com
lib/email.ts:4:"https://api.resend.com
app/lib/vworld.ts:21:"https://api.vworld.kr
app/lib/typhoon.ts:36:"https://apis.data.go.kr
app/lib/tax-invoice-issuance.ts:35:"https://development.codef.io
app/lib/gibs-himawari.ts:45:"https://gibs.earthdata.nasa.gov
lib/storage.ts:19:"https://kr.object.ncloudstorage.com
app/lib/tax-invoice-issuance.ts:12:"https://oauth.codef.io
lib/google-oauth.ts:7:"https://oauth2.googleapis.com
app/api/radar/route.ts:27:"https://tilecache.rainviewer.com
app/lib/vworld.ts:8:"https://vitalguard-dashboard-569797426568.asia-northeast3.run.app
app/lib/jma-typhoon.ts:18:"https://www.jma.go.jp
app/lib/moleg.ts:14:"https://www.law.go.kr
app/lib/disaster-msg-api.ts:24:"https://www.safetydata.go.kr
```

### 1-6. 브라우저 → cctv-ai (서버를 안 거친다)

```
app/components/CctvQuadView.tsx:13:const AI_CCTV_API = process.env.NEXT_PUBLIC_AI_CCTV_API || "http://localhost:8000";
app/components/CctvQuadView.tsx:30:  { id: "CAM-01", location: "정문 출입구", aiApi: AI_CCTV_API, aiKind: "object", aiSuffix: "" },
app/components/CctvQuadView.tsx:31:  { id: "CAM-02", location: "지하 기계실", aiApi: AI_CCTV_API, aiKind: "fall", aiSuffix: "2" },
app/components/CctvQuadView.tsx:32:  { id: "CAM-03", location: "현장 작업구역(GoPro)", aiApi: AI_CCTV_API, aiKind: "ppe", aiSuffix: "3" },
app/components/CctvQuadView.tsx:125:  aiApi: string;
app/components/CctvQuadView.tsx:384:function useAiStats<T>(aiApi: string, suffix: string) {
app/components/CctvQuadView.tsx:424:function DetectionStrip({ aiApi, suffix = "" }: { aiApi: string; suffix?: string }) {
app/components/CctvQuadView.tsx:485:function FallDetectionStrip({ aiApi, suffix = "2" }: { aiApi: string; suffix?: string }) {
app/components/CctvQuadView.tsx:551:function PpeDetectionStrip({ aiApi, suffix = "3" }: { aiApi: string; suffix?: string }) {
```

### 1-7. Cloud Scheduler → 서버 (받는 쪽만 코드에 있다)

```
app/api/cron/env-check/route.ts:11:  const auth = cronAuth(request.headers.get("x-cron-key"), process.env.CRON_SECRET);
app/api/cron/env-check/route.ts:44:  const cronHeaders = { "x-cron-key": process.env.CRON_SECRET ?? "" };
app/api/cron/absence-check/route.ts:31:  const auth = cronAuth(request.headers.get("x-cron-key"), process.env.CRON_SECRET);
```

## 2. WCSession (워치 ↔ 폰)

### 현행 앱 — apps/vitalguard_app

```
Runner/PhoneReceiver.swift:210:    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
Runner/PhoneReceiver.swift:214:    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
VitalWatch/WatchStreamer.swift:262:        WCSession.default.activate()
VitalWatch/WatchStreamer.swift:503:            wc.sendMessage(payload, replyHandler: nil) { [weak self] _ in
VitalWatch/WatchStreamer.swift:505:                wc.transferUserInfo(payload)
VitalWatch/WatchStreamer.swift:510:            wc.transferUserInfo(payload)
```

⚠ 구 앱 트리(`apps/VitAlGuard-*`)에도 같은 API 가 **31건** 있다.
   어느 트리가 살아 있는지는 코드로 안 갈린다 — 셋 다 git 추적 중이다.

## 3. Swift ↔ Dart 채널

```
ios/Runner/VitalBridge.swift:88:        let channel = FlutterMethodChannel(name: "vitalguard/bridge", binaryMessenger: messenger)
ios/Runner/VitalBridge.swift:92:        let events = FlutterEventChannel(name: "vitalguard/stream", binaryMessenger: messenger)
lib/vital_stream.dart:1:// 네이티브 EventChannel(vitalguard/stream) 구독 래퍼 — 표시용 상태만 다룬다(원본 생체 경로는 네이티브 전담)
lib/vital_stream.dart:86:  static const EventChannel _channel = EventChannel('vitalguard/stream');
lib/main.dart:17:const MethodChannel _bridge = MethodChannel('vitalguard/bridge');
lib/record_screen.dart:16:const MethodChannel _bridge = MethodChannel('vitalguard/bridge');
```

계약은 **채널 이름 문자열**뿐이다. 양쪽을 잇는 타입 검사가 없다.

## 4. DB 클라이언트

```
apps/dashboard-web/lib/db.ts:4:import pg, { Pool } from "pg";
apps/dashboard-web/lib/db.ts:154:    const pool = new Pool({
scripts/fall-ml/01-db-audit.mjs:28:const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 15000 })
ml/fall-detection/extract_imu_features.mjs:10:const pool = new Pool({ connectionString: m[1].trim(), max: 1 });
```

`lib/db.ts` 안 `.query(` : 14곳
그 밖에서 `pool.query`/`client.query` : 0곳

## 5. 없는 것 — 0건과 통제군

### BLE — 0건

**통제군** — 같은 대상 파일에서 있는 것을 찾으면 나온다.
```
*.swift 에서 import : 50개 파일
*.dart  에서 import : 35개 파일
*.ino   에서 WiFi   : 2개 파일
```

⚠ 대소문자 무시 `bluetooth|gatt` 로 넓히면 **25건** — 판정하지 않고 그대로 보인다.
```
./apps/VitAlGuard-iOS-WatchOS-App/Phone/Sources/2026-07-24-VitAlGuardAssistant.swift:219:    private var pendingAttachments: [AssistantAttachment] = []
./apps/VitAlGuard-iOS-WatchOS-App/Phone/Sources/2026-07-24-VitAlGuardAssistant.swift:1112:        let attachmentSummary = pendingAttachments.isEmpty
./apps/VitAlGuard-iOS-WatchOS-App/Phone/Sources/2026-07-24-VitAlGuardAssistant.swift:1114:            : "\n\n첨부: \(pendingAttachments.count)개 (파일명·원본은 서버로 전송하지 않음)"
./apps/VitAlGuard-iOS-WatchOS-App/Phone/Sources/2026-07-24-VitAlGuardAssistant.swift:1116:        pendingAttachments.removeAll()
./apps/VitAlGuard-iOS-WatchOS-App/Phone/Sources/2026-07-24-VitAlGuardAssistant.swift:1217:        pendingAttachments.append(contentsOf: attachments)
./apps/VitAlGuard-iOS-WatchOS-App/Phone/Sources/2026-07-24-VitAlGuardAssistant.swift:1229:        for attachment in pendingAttachments {
```

### 큐 publish/subscribe — 0건

인프라 선언(IaC)은 런타임 발행 호출이 아니다 — 참고로 함께 낸다.
```
backend/infrastructure/lib/iot-stack.ts:4:import * as iot from "aws-cdk-lib/aws-iot";
backend/infrastructure/lib/iot-stack.ts:9:  public readonly thing: iot.CfnThing;
backend/infrastructure/lib/iot-stack.ts:25:    this.thing = new iot.CfnThing(this, "DemoWorkerThing", {
backend/infrastructure/lib/iot-stack.d.ts:3:import * as iot from "aws-cdk-lib/aws-iot";
```

### Supabase — 0건

**통제군** — 같은 방식으로 이 레포가 실제로 쓰는 DB 클라이언트를 찾으면 나온다.
```
pg 를 싣는 파일: 6개
  그중 from "pg" 로만 잡히는 것: 1개
```

이 레포의 DB 는 **캠퍼스 PostgreSQL** 이고 클라이언트는 `pg` 다(4절).

⚠ 두 분석 스크립트는 `createRequire(…)("pg")` 와 동적 `import()` 로 pg 를 싣는다 —
  `from "pg"` 만 grep 하면 안 잡힌다. 4절 목록은 `new Pool(` 로 잡은 것이다.

---

## 재실행

```
scripts/scan-seams.sh        docs/seams-callsites.md 갱신
scripts/scan-seams.sh -      표준출력만
```
