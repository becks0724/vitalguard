# 런타임 이음새

이 레포는 런타임이 넷이다(TS·Python·Swift/Dart·Arduino C++). 런타임 **안쪽**은 각자 타입 검사와
CI 가 지키는데, **런타임이 만나는 지점**은 대체로 어느 것도 닿지 않는다. 이 문서가 그 지점의 목록이다.

그림은 커밋하지 않는다(재생성물 · `.gitignore`). 이 파일은 **지키려고** 두는 것이라 커밋한다 —
"순환이 언제 생겼나"·"이음새가 언제 늘었나"를 `git log -p` 로 추적할 수 있어야 한다.

> **줄 번호 색인은 `docs/seams-callsites.md` 에 있다** — `scripts/scan-seams.sh` 가 생성하며
> 코드가 바뀔 때마다 다시 뽑는다. 이 파일은 손으로 쓰는 **성격·계약** 쪽이고,
> 그쪽은 기계가 뽑는 **위치** 쪽이다. 줄 번호를 이 파일에 적지 않는 이유가 그것이다.

기준 = 2026-08-21 · 커밋 `c590712` 시점 실측.

---

## 1. 이음새 12곳

마지막 열이 이 표의 값이다. 이음새는 예외를 던지며 죽지 않고 **조용히 값이 사라지는 모습**으로
나타난다. 무엇을 보아야 하는지 미리 적어 둔다.

| # | 이음새 | 런타임 | 수단·주기 | 계약이 사는 곳 | 깨지면 보이는 모습 |
|---|---|---|---|---|---|
| A | 워치 → 폰 | Swift → Swift | WCSession sendMessage, 실패 시 transferUserInfo · 5초 | 가드 계약(2026-08-21) — 키 26개 양끝 집합 대조 · 런타임 검증은 없음 | 측정은 이어지는데 도착만 끊긴다. 복귀 시 수 분치가 한꺼번에 온다 |
| B | Swift → Dart | Swift → Dart | FlutterEventChannel `vitalguard/stream` | 가드 계약(2026-08-21) — 채널명·이벤트 키 15 양끝 집합 대조 · 런타임 검증은 없음 | 서버는 정상 수신 중인데 폰 화면만 언다. 서버 쪽엔 아무 이상이 안 보인다 |
| C | 폰 → 서버 | Swift → TS | HTTPS POST `/api/app/vital` · 앱 JWT · 디스크 큐 5,000 | zod `packages/schemas` — **Swift 쪽은 손으로 맞춘 것** | 스키마에 없는 필드는 파싱에서 조용히 탈락한다. 앱은 201 을 받고 큐를 지운다 |
| D | 가스포드 → 서버 | C++ → TS | POST `/api/gaspod/telemetry` · 5초 · soft 토큰 | zod + DB 컬럼 | 기기는 보내는데 행이 안 쌓인다. 링버퍼 폴백이 있어 화면은 잠시 정상으로 보인다 |
| E | 엣지 → cctv-ai | Python → Python | HTTP POST `/cctv/ingest3` · 푸시 6fps · 추론 12fps | 없음 (multipart 필드명) | 타일이 마지막 프레임에서 정지한다. 젯슨 로그를 봐야 푸시가 끊긴 건지 안다 |
| F | cctv-ai → 관제웹 | Python → TS | 관제웹이 **당겨간다** (`lib/cctv-poller.ts`) · MJPEG `/cctv/stream3` | 빌드 인자 `_AI_URL` + zod `cctv-event` | 치환을 빠뜨리면 localhost 로 폴백해 타일만 깨진다. 서버는 200 을 낸다 |
| G | 앱 → 스토리지 | Swift → 외부 | 서버 경유 `/api/app-media` | 서버가 업로드·등록을 함께 | 경로가 둘로 갈려 있다 — H 와 실패 모드가 다르다 |
| H | 관제웹 → 스토리지 | 브라우저 → 외부 | 만료형 프리사인 GET(표시·다운로드) · 삭제는 행→실물 순서. 업로드 다리(PUT+등록)는 2026-08-21 철거 — 30일 실사용 0 실측 | 만료형 URL + 봉인 가드(재생성 금지) | DELETE 의 실물 삭제 실패가 warn 로그만 남기고 **고아**가 된다 — 대사 스크립트가 없어 수작업 전수 대조가 유일한 회수 수단이다 |
| I | 스케줄러 → 서버 | GCP → TS | Cloud Scheduler · `x-cron-key` | `CRON_SECRET` 시크릿 | 401 이 조용히 반복된다. 부재 감시가 죽어도 화면엔 표시가 없다 |
| J | 서버 → DB | TS → PostgreSQL | 첫 쿼리에 `ensureSchema()` · CREATE/ALTER 89건 | 런타임 DDL **과** `db/*.sql` 12개 | 스키마 소스가 둘이라 갈릴 수 있다. 컬럼이 없으면 그 필드만 사라진다 — **있어도 읽는 경로가 없으면 같은 결과다**(§1-1) |
| K | 서버 → 텔레그램 | TS → 외부 | `recordAlert` 관문 · 수치 미포함 · 이름 마스킹 | 관문 타입(수치 필드 자체가 없음) + 발신 지점 허용목록 가드(2026-08-21) | 관문을 우회해 보내면 **발동 이력이 원장에 안 남는다**. 전례가 있다 |
| L | Colab → 엣지 | Python → Python | 사람이 파일을 옮긴다 (`.pt` → `.engine`) | 파일 이름의 `_v5_` 문자열 | 엔진과 노트북 버전이 어긋나도 아무 데서도 안 걸린다. 태그만 맞아 보인다 |

**계약이 코드로 강제되는 이음새 — 두 층이다(2026-08-21).** **런타임에 값을 검사하는 것은
C·D·J 만이다**(zod 스키마·DB 컬럼 — 배선도가 초록으로 그리는 집합도 이것이다). A·B·K 는
2026-08-21 에 **가드 계약**(커밋 게이트 — 값이 아니라 코드 형태를 검사한다)으로 승격됐다.
A·B = 키 전수 집합 대조(`2026-08-21-app-seam-key-census`) · K = 발신 지점
허용목록(`2026-08-21-telegram-callsite-allowlist`) · 조사·근거 = `docs/seam-contracts/findings.md`.
나머지(E·F·G·I·L)는 문자열 키·필드명·빌드 인자·파일 이름 같은 *합의*로 유지되고, 어긋나도
예외가 나지 않는다. H 의 업로드 다리는 계약 대신 **철거**를 택했다(레포 안 호출자 0 +
프로덕션 30일 성공 0 실측).

⚠ `/api/cctv/event` 는 **레포 안에 호출자가 0건**이다(외부 기기가 부른다). 생산자를 코드로 확인할
수 없으므로 이 라우트의 계약 변경은 레포 안 검색만으로 안전을 판단할 수 없다.

### 1-1. J 의 두 번째 실패 양상 — 쓰기 전용 컬럼 (2026-08-21 실측)

표의 "컬럼이 없으면 그 필드만 사라진다" 에는 거울상이 있다. **컬럼이 있고 insert 도 되는데
아무도 SELECT 하지 않으면 결과가 같다** — 값은 쌓이는데 어떤 화면·판정에도 닿지 않는다.
차이는 이쪽이 더 오래 산다는 것이다. 없는 컬럼은 언젠가 에러로 드러나지만, 쓰기 전용 컬럼은
**가드 테스트가 초록으로 지켜 준다.**

실측 — `location_accuracy_m`. 2026-08-16 에 *"정확도 무음 폐기를 고쳤다"* 며 도입한 컬럼이
08-21 까지 **읽는 SELECT 0 · 화면 0** 이었다. 통제군(같은 자로) = 읽히는 컬럼은 `latitude` 68곳 ·
`heart_rate` 89곳 · `battery_pct` 24곳에서 잡힌다. 그리고 그 상태를
`2026-08-16-phone-gps-collection.guard.test.ts` 가 쓰기 3곳(스키마·ALTER·insert)을 정규식으로
고정해 **옳다고 못 박고 있었다.** 무음 폐기(BND-CONTRACT-01)를 고치면서 무음 미사용(L-91)을
새로 만든 것이다.

구조적 원인 = 이 레포의 **"3중주" 관례(스키마 + 컬럼 + insert 매핑)가 쓰기 쪽만 정의한다.**
처방 = **4중주** — 넷째는 읽는 경로(SELECT 에 있고, 응답 타입을 지나, 화면 문자열이나 판정
분기에 닿는 지점)다. 넷째를 코드로 지목하지 못하면 컬럼을 아직 넣지 않는다. 교훈 L-101.

⚠ 배관 착시 하나 — 트랙 경로에는 `ts` 가 이미 끝까지 흐른다(좁아지는 지점은 API 가 아니라
`WorkerTrail` 컴포넌트 prop 경계 한 곳뿐). 그래서 "타입 체계부터 넓혀야 한다" 는 과대,
"`ts` 가 있으니 됐다" 는 과소다 — 흐르는 `ts` 는 **전송 시각**이고 좌표 나이는
**전송 − 측위** 의 차라 `locationTimestamp` 없이는 계산 자체가 안 선다.

이 계열의 첫 수리 = D-1(`locationTimestamp` + 정확도 읽는 경로 · 2026-08-21 착수). 규모는
"트리오 + 배포 1회" 가 아니라 **여덟 자리**다(양 세션 합의 08-21) —
코드 여섯(①zod ②ALTER ③insert ④SELECT ⑤행→점 매핑 ⑥화면 타입·렌더) +
⑦라우트의 품질 요약(**다운샘플 이전**에 계산 — 이후에 세면 표본의 분포를 재게 된다) +
⑧가드를 3중주→4중주로 확장(기존 컬럼의 읽는 경로를 같은 커밋에서 살려 기준선 덮기 없이 통과).

---

## 2. `@safetymonitor/schemas` — 공유 계약과 그 소비자

이 패키지가 **런타임 경계에서 유일하게 코드로 강제되는 계약**이다. 그래서 의존성 그래프에서는
잎 노드로 접히지만(pnpm 심링크가 `dist` 를 가리켜 소스가 안 보인다) 이음새 분석에서는 중심이다.

### 내보내는 계약

```
vital-stream.ts       생체 샘플 (C 이음새의 계약)
cctv-event.ts         CCTV 이벤트 (F 이음새의 계약)
hazard-event.ts       위험 이벤트
zone-hazard-event.ts  구역 위험 이벤트
worker.ts             작업자
```

### ⚠ 실측 — 소비자는 TypeScript 뿐이다

```
TS      24개 파일이 import (아래 목록)
Python  0건   — cctv-ai · ml 어디에서도 참조하지 않는다
Swift   0건   — apps/vitalguard_app 에서 참조 0
Dart    0건   — 같음
```

**"엣지·웹·앱이 같은 이벤트 스키마를 쓴다" 는 성립하지 않는다.** 패키지 매니저가 다르니
구조적으로 불가능하다. 대신 비-TS 런타임은 **필드명을 손으로 맞춘다**.

```
zod (vital-stream)   workerId · heartRate · heartRateMeasuredAt · phoneReceivedAt · dataOrigin …
Swift 가 싣는 키      workerId · heartRate · heartRateMeasuredAt …   ← 컴파일러가 잇지 않는다
```

⟹ **이것이 이 패키지가 seams 분석의 핵심인 진짜 이유다.** 공유돼서가 아니라 **공유되지 않는데
같은 이름을 쓰기 때문**이다. zod 필드를 고치면 TS 24곳은 컴파일러가 잡지만 Swift 는 아무 일도
일어나지 않고, 값은 파싱에서 조용히 탈락한다(감사 BND-CONTRACT-01 — 같은 형태로 세 번 당했다).

### 소비자 목록 (dist 제외 · 24)

재생성 = `grep -rl "@safetymonitor/schemas" apps packages --include="*.ts" --include="*.tsx" | grep -v /dist/ | sort`

```
apps/dashboard-web/app/api/admin/incidents/route.ts
apps/dashboard-web/app/api/app/vital/route.ts
apps/dashboard-web/app/api/app/vital/store.test.ts
apps/dashboard-web/app/api/app/vital/store.ts
apps/dashboard-web/app/api/cctv/event/route.ts
apps/dashboard-web/app/api/cctv/ingest.ts
apps/dashboard-web/app/components/DemoDashboard.tsx
apps/dashboard-web/app/components/GeofenceAlertModal.tsx
apps/dashboard-web/app/components/SosAlertModal.tsx
apps/dashboard-web/app/components/WorkerQueueModal.tsx
apps/dashboard-web/lib/2026-07-30-measured-at.guard.test.ts
apps/dashboard-web/lib/2026-07-31-ts-canonical-format.guard.test.ts
apps/dashboard-web/lib/2026-08-20-session-end-telemetry.guard.test.ts
apps/dashboard-web/lib/cctv-fall-poller.test.ts
apps/dashboard-web/lib/cctv-poller.ts
apps/dashboard-web/lib/db.ts
apps/dashboard-web/next.config.ts
packages/analyzers/src/collapse.ts
packages/analyzers/src/fall.ts
packages/analyzers/src/heart-rate.ts
packages/analyzers/src/hyperthermia.ts
packages/analyzers/src/sos.ts
packages/analyzers/src/spo2.ts
packages/analyzers/src/stress-index.ts
```

★ **스키마 필드를 바꿀 때 이 목록만으로는 부족하다.** TS 24곳은 `tsc` 가 잡는다 — 잡히지 않는
쪽이 위험한 쪽이고, 그것은 목록에 **없는** 셋이다.

```
apps/vitalguard_app/ios/Runner/VitalPipeline.swift    폰이 싣는 키
apps/vitalguard_app/ios/VitalWatch/WatchStreamer.swift 워치가 싣는 키
cctv-ai/main.py · cctv-ai/edge/*.py                    엣지가 싣는 필드
```

---

## 3. 그래프 산출물

| 파일 | 커밋 | 이유 |
|---|---|---|
| `apps/dashboard-web/docs/graph/cycles.txt` | ○ | 이력이 값어치 있다 — 순환이 언제 생겼는지 PR diff 에 보여야 한다 |
| `docs/seams.md` (이 파일) | ○ | 같음 |
| `…/graph/*.svg` | ✗ | diff 를 읽을 사람이 없고, 의존 하나만 늘어도 전역 재배치로 파일 전체가 바뀐다 |
| `…/graph/cycles.json` | ✗ | 384KB · 286 모듈 전체를 담아 같은 문제를 갖는다. CI 는 그때그때 만든다 |

```
pnpm graph          모듈 그래프 SVG   ← graphviz 필요
pnpm graph:archi    폴더 그래프 SVG   ← graphviz 필요
pnpm graph:cycles   cycles.txt/json   graphviz 불필요
pnpm graph:check    CI 게이트          graphviz 불필요
```

⚠ SVG 는 **같은 입력이면 바이트가 동일**하다(실측). 그러니 문제는 "무의미한 재생성 diff" 가
아니라 **의존이 실제로 바뀔 때마다 628KB 가 통째로 새 객체가 되고 이력에 영구 누적되는 것**이다.

### 그림을 보려면 graphviz 를 깔아야 한다

```
brew install graphviz          (macOS)
apt-get install -y graphviz    (Debian/Ubuntu)
```

★ **일부러 npm 의존으로 두지 않았다.** `@hpcc-js/wasm`(순수 JS 렌더러)을 devDependency 로 두면
**배포 빌드가 매번 그걸 내려받는다** — `Dockerfile:14` 이 `pnpm install --frozen-lockfile` 을
`--prod` 없이 돌리고 Cloud Build 에는 스토어 캐시가 없다(빌드 로그 `reused 0` · `Packages: +408`).
그 패키지는 36MB 인데 **29MB 가 duckdb** 이고 우리가 쓰는 graphviz 는 800KB 다.

⟹ 그림 한 장 때문에 **모든 배포에 36MB 를 영구히** 얹는 교환이라 물렀다.
CI 게이트는 JSON 만 읽으므로 graphviz 없이 돈다 — **파이프라인은 이 결정에 영향받지 않는다.**
