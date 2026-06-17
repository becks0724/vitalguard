# SafetyWatch PoC — 워치 워크아웃 세션 기반 잠금-상태 생체 전송 검증

> **목적** — iPhone 잠금 상태에서도 생체데이터(심박)가 관제웹으로 전송되는지 입증하는 **독립 watchOS PoC**.
> 핵심 가설 — 워치 `HKWorkoutSession`+`HKLiveWorkoutBuilder` 는 *live 콜백*으로 HR 을 받으므로(폰의 잠긴 HealthKit 저장소 *읽기* 가 아님) **iPhone 잠금과 무관하게 수집·전송이 지속**된다.
> 상세 배경은 [../../docs/commercialization-roadmap.md](../../docs/commercialization-roadmap.md).

## ⚠ 이 PoC 와 "Xcode 빌드 금지" 규칙의 관계

CLAUDE.md 의 **"Xcode Run/직접 빌드 금지"** 는 *Flutter 앱(`apps/worker-phone`)* 의 release AOT 가 debug 로 덮어써지는 함정을 막는 규칙입니다. **이 PoC 는 Flutter 와 완전히 분리된 별도 watchOS 프로젝트**라 Flutter Runner 산출물을 건드리지 않습니다. watchOS 앱은 Flutter 로 빌드 불가하므로 **여기서는 Xcode 빌드가 정상적이고 유일한 경로**입니다. (단 `apps/worker-phone` 은 종전대로 `flutter build ios --release` CLI 만 사용.)

## 사전 준비

- Xcode 26.x (확인됨 26.5)
- 페어링된 Apple Watch (watchOS 10+)
- dev 서버 + cloudflared 기동 + **현재 URL 확인**
  ```bash
  grep -o 'https://[a-z-]*\.trycloudflare\.com' .runtime/cloudflared.log | tail -1
  ```
- ⚠ **디바이스 한도** — Apple Developer team `F2P5ZFP65Q` 는 100대 한도에 도달한 상태. Apple Watch 를 개발 디바이스로 등록할 슬롯이 없으면 install 이 막힐 수 있음(이미 등록돼 있으면 통과). 막히면 콘솔에서 슬롯 정리 필요.

## 셋업

### 경로 A — Xcode 수동 (권장, 추가 도구 0)

1. Xcode → **File ▸ New ▸ Project ▸ watchOS ▸ App**. Product Name `SafetyWatchPoC`, Interface SwiftUI, Language Swift. (companion iOS 앱 불필요 — watch-only.)
2. 생성된 `*App.swift` / `ContentView.swift` 를 **이 폴더 `Sources/` 의 4개 파일로 교체/추가** — `SafetyWatchPoCApp.swift`, `ContentView.swift`, `WorkoutManager.swift`, `VitalTransmitter.swift`.
3. **Signing & Capabilities** → Team `F2P5ZFP65Q` → **+ Capability ▸ HealthKit**.
4. **Info** 탭에 키 추가(또는 `SupportingFiles/Info.plist` 사용).
   - `Privacy - Health Share Usage Description` = `작업 중 심박을 측정해 관제 서버로 전송하기 위해 건강 데이터 읽기 권한이 필요합니다.`
   - `Privacy - Health Update Usage Description` = `작업 모니터링 세션(워크아웃) 기록을 위해 건강 데이터 쓰기 권한이 필요합니다.`
   - **WKBackgroundModes** 배열에 `workout-processing` 추가. (가장 중요 — 백그라운드/손목 내림에도 세션 유지)
5. `VitalTransmitter.swift` 의 `endpoint` 를 **현재 cloudflared URL** + `/api/mock/vital` 로 갱신.

### 경로 B — xcodegen (선택, 재현성)

```bash
brew install xcodegen
cd apps/worker-watch-poc
xcodegen generate          # project.yml → SafetyWatchPoC.xcodeproj
open SafetyWatchPoC.xcodeproj
```
이후 경로 A 의 4·5단계(권한 문구·URL)만 확인.

## 빌드 & install

1. Xcode 상단 스킴을 **SafetyWatchPoC (워치)** + 대상 Apple Watch 선택.
2. **Run (⌘R)**. 워치에 설치·실행.
3. 워치 앱에서 **건강 권한 요청** → 심박 허용 → **수집 시작**.
4. 화면에 `심박 bpm` 갱신 + `전송 N건` 증가 확인.

## §4 잠금-상태 검증 절차 (합격 기준)

1. 워치에서 **수집 시작** → 심박/전송 카운트 증가 확인.
2. **iPhone 잠금 + 화면 off** 상태로 **30분** 방치(워치는 손목 착용 유지).
3. 서버 DB 에서 `EMP-9001` 의 최근 수신을 **수신 간격 + null 패턴**으로 판정.
   ```bash
   cd apps/dashboard-web && node -e '
   const Database = require("better-sqlite3");
   const db = new Database(process.env.HOME + "/Documents/06.safetymonitor/.runtime/safetymonitor.db", { readonly: true });
   const rows = db.prepare("SELECT received_at, heart_rate FROM vital_samples WHERE worker_id=? ORDER BY received_at DESC LIMIT 200").all("EMP-9001");
   rows.reverse();
   let prev=null, gaps=0, nulls=0;
   for (const r of rows){ const t=new Date(r.received_at).getTime(); const g=prev?(t-prev)/1000:0; prev=t; if(g>20)gaps++; if(r.heart_rate==null)nulls++; }
   console.log("rows:",rows.length,"| gap>20s:",gaps,"| null hr:",nulls,"| first:",rows[0]?.received_at,"| last:",rows.at(-1)?.received_at);
   '
   ```
4. **합격 = `gap>20s` 0건 + `null hr` 0건** (잠금 30분 동안 끊김 없이 실 HR 연속 수신).
   - 대조군 — 현재 *폰-읽기* 방식은 잠금 구간 HR 전부 null 이었음. 워치 소스면 값이 계속 들어와야 성공.
5. 콘솔 로그가 필요하면 `xclog`(Axiom) 로 워치 앱 출력 캡처.

## 알려진 한계 (PoC 범위)

- **연속 메트릭은 HR 한정** — Apple Watch 는 워크아웃 세션에서 HR 은 연속이나 **SpO₂ 스팟·손목온도 수면 한정** → 연속 수집 불가.
- **배터리** — 워크아웃 세션은 소모가 큼. 8시간 풀시프트는 Ultra 또는 중간 충전 전제(검증 항목).
- **URL 회전** — cloudflared quick tunnel URL 은 세션마다 바뀜 → `VitalTransmitter.endpoint` 매번 갱신. (상용화 시 고정 도메인)
- **전송 세션** — 현재 `URLSession.shared`(foreground). 워크아웃 세션이 앱을 살려두므로 PoC 엔 충분하나, 상용화 시 `URLSessionConfiguration.background` 로 강화 권장.
- **TN3135** — watchOS 일반 앱은 raw socket·WebSocket·MQTT 직접 불가. HTTP(S) URLSession 만(현재 관제웹과 일치).
- **분석 금지 준수** — 워치는 raw HR 전송만. 위험 판정·스트레스 지수 등 분석은 폰/서버(`packages/analyzers`)가 수행.
