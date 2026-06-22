# fusion-design.md — 영상·워치 낙상 결합(fusion) 판정 설계

> 3단계 산출물(종합 설계 문서). 사용자 요구 "설계 문서(결합 알고리즘 + 결합 규칙 근거 + 검토 반영 내역)" 본체.
> 작성: 클로드(메인). 검토: 코덱스(read-only, 적대적). 모든 인터페이스는 실제 코드 필드에 대조됨.
> 상위 문서: [idea.md](idea.md) · [PRD.md](PRD.md).

---

## 0. 개요·설계 목표

영상(YOLOv8-pose CCTV, 존 단위)과 워치(CoreMotion 자체 알고리즘, 작업자 단위)의 낙상 신호를 **서버에서**
결합해 `의심(suspect) / 경보(warning) / 확정(confirmed)` 3단계 판정을 만든다. 두 신호는 현재 완전히 분리되어
있다(영상=표시·DB미저장·worker_id없음 / 워치=DB저장·즉시 danger). 결합의 목적은 **오탐 감소 + 미탐 불증가**.

### 불변 설계 원칙

1. **Safety Monotonicity** — fusion은 신뢰도를 올리기만 하고, 단독 신호가 이미 발생시킨 경보를 **절대 깎지 않는다**.
2. **부재 ≠ 음성** — 신호 없음은 `unknown`이며, 낙상 음성으로 해석하지 않는다.
3. **추가만, 갈아엎지 않음** — 기존 `VitalSample`/`HazardEvent`/`severity`/`alerts` 계약은 불변. 필드·테이블·라우트 **신설만**.
4. **대상 미특정의 정직성** — 영상만으로는 "누구"를 단정하지 않는다. worker 귀속과 zone 경보를 분리한다.

---

## 1. 단독 신호 정의 (실제 코드 필드 기준)

### 1.1 영상(YOLOv8-pose) — 존 단위

- 출처: 별도 FastAPI(:8000) `/cctv/stats{suffix}`. 대시보드 `FallDetectionStrip`이 1초 폴링.
  - 근거: `apps/dashboard-web/app/components/CctvQuadView.tsx:386-421`.
- 실제 소비 형식(코덱스 정정·코드 확인):
  ```ts
  // CctvQuadView.tsx:388-392
  { total: number; fallen: number; byStatus: { status: string; label: string; count: number }[] }
  ```
- `status` 도메인: `standing | unstable | lying | fallen` (CctvQuadView.tsx:415-420).
- **낙상 양성 후보** = `fallen > 0`. **약신호** = `lying > 0`(누움). 카메라ID·존(예: CAM-02 "지하 기계실"), 프레임 시각.
- **worker_id 없음**(카메라/존 단위). confidence는 통계에 미포함(있으면 어댑터에서 채움 — 확인 필요).

### 1.2 워치(CoreMotion) — 작업자 단위

- 출처: `POST /api/mock/vital` ← `VitalSample`. 낙상 관련 필드(`packages/schemas/src/vital-stream.ts`):
  - `fallDetected?: boolean` — 즉시 danger 트리거(severity.ts:93 `fall_detected===1 → danger`).
  - `fallCandidate?: boolean`, `fallCandidateId?: uuid`,
    `fallDecision?: "fall" | "rejected_no_corroboration" | "rejected_timeout"`,
    `fallUpdatePhase?`, `fallPromptOutcome?`.
  - `accelMagnitudeG?`(peakG), `motionStillSec?`, `freefallPreceded?`, `peakRotationRadS?`.
  - `workerId`(필수), `latitude/longitude`(GPS), `ts`(**발신 시각** — 충격 시각 아님).
- 알고리즘(`apps/worker-watch-poc/Sources/FallDetector.swift`): 자유낙하(≤0.6G/0.8s)→충격(≥2.8G)→저활동(1.2s)→자이로(≥6rad/s).

#### ⚠️ 워치는 이미 2단계다 (코드 확인 — 코덱스 R2 반영)

워치 송신은 한 번에 danger가 되지 않는다. 두 단계로 나뉜다.

| 단계 | 송신 메서드 | payload | 서버 동작 |
|---|---|---|---|
| **후보(candidate)** | `sendFallCandidate`(VitalTransmitter.swift:103-133) | `fallCandidate=true` + `fallDecision="fall"` + `fallPromptOutcome="pending"`. **`fallDetected` 없음** | danger/alert **아님**. 작업자 폰/워치에 20초 자가확인 프롬프트 |
| **확정(escalation)** | `sendFallEscalation`(VitalTransmitter.swift:157-166) | **`fallDetected=true`** | 프롬프트 20초 무응답 또는 SOS 선택 시. `recordAlert("fall")` + severity danger (store.ts:88-95, severity.ts:93) |

- **워치 확정 양성** `confirmedByWatch` = `fallDetected===true`. 이미 danger. (기존 경로)
- **워치 후보 양성** `candidateByWatch` = `fallCandidate===true && fallDecision==="fall"` 이고 아직 `fallDetected`가
  아닌 상태. **워치 자체로는 "프롬프트 대기"** 중(아직 danger 아님).
- **음성** = `fallDecision ∈ {rejected_no_corroboration, rejected_timeout}`.

> 💡 **이것이 fusion의 핵심 가치다.** 영상 `fallen`이 워치 **후보**를 시간 정합으로 확증하면, 20초 프롬프트
> 대기를 **건너뛰고 즉시 confirmed**로 격상할 수 있다(쓰러진 사람은 폰 프롬프트를 못 누른다 — 무응답 20초를
> 기다리느니 영상 확증으로 조기 대응). 단, 기존 store.ts danger/alert 경로는 `fallDetected`만 보므로(store.ts:88),
> 이 조기 격상은 **fusion이 직접 `recordAlert`를 책임진다**(기존 코드 불변, 추가 경로).

> ⚠️ **시간 정합의 핵심 제약**: 워치 `ts = iso.string(from: Date())`(`VitalTransmitter.swift:83`)는 **페이로드
> 생성(발신) 시각**이다. 충격 정확 시각(`impactTs`)은 현재 payload에 **없다**. 낙상은 `flush(force:true)`로 즉시
> 전송되어 발신≈검출에 가깝지만(검출 게이트 통과까지 ~1–2초 지연 존재), 밀리초 정합은 불가능하다.

---

## 2. 가용성(Availability) 모델 — 부재를 명시 모델링

각 소스의 상태를 **낙상 양/음성과 분리된 별도 축**으로 둔다. 부재를 음성으로 흡수하는 함정을 차단한다.

```ts
type SourceAvailability =
  | "available"    // 최근 정상 수신, 신뢰 가능
  | "stale"        // 수신은 있었으나 신선도 임계 초과(워치 배칭 30초 고려) → 낮은 신뢰
  | "blind"        // 알지만 못 봄(카메라 OFF/사각지대, 워치 미착용 추정) → unknown
  | "unavailable"; // 소스 자체 미연결/미배치 → unknown
```

- 판정 함수 입력에 `watch: SourceAvailability`, `vision: SourceAvailability`를 **필수**로 받는다.
- `blind`/`unavailable`은 "낙상 아님"이 아니라 "모름". 결합식에서 **그 소스를 코로보레이션 후보에서 제외**할 뿐,
  다른 소스의 단독 판정을 약화시키지 않는다(monotonicity).
- 워치 신선도 임계: 기본 60초(기존 연결끊김 상태머신 60초와 정합 — 30초 배칭 오탐 회피, CLAUDE.md 결정 cc).
- 영상 신선도 임계: 폴링 주기(1초)의 수 배(기본 5초, 설정 가능).

---

## 3. 시간 동기화

### 3.1 현실 인정 — 좁은 윈도우 강제 금지

- 양측 `ts`는 모두 ISO8601 UTC지만 의미가 다르다: 워치=발신시각, 영상=프레임/폴 시각.
- 네트워크 지연·클럭 차이·`impactTs` 부재를 감안해 **넓은 후보창 + 낮은 정합 가중**만 허용한다.

### 3.2 정합 윈도우

- 워치 낙상 발신 ts를 기준 `t_w`로, 영상 `fallen` 관측 시각 `t_v`가
  `t_w - PRE ≤ t_v ≤ t_w + POST` 안이면 **시간 정합 후보**.
- 기본값(설정 가능): `PRE = 10초`, `POST = 15초`(워치 발신이 검출보다 지연될 수 있고 영상 폴 해상도가 1초이므로 넓게).
- 정합 신뢰도 `timeConfidence ∈ [0,1]`: 시간차가 작을수록 1에 가깝게 선형 감쇠. `impactTs`가 도입되면 윈도우를
  좁히고 신뢰도를 상향(확인 필요 — §10).

### 3.3 시간 단조성 가드

- `Date.now()` 대신 **이벤트 ts**(워치 발신, 영상 폴) 기준으로만 비교한다. 서버 `received_at`은 보조 로그.

---

## 4. 대상 매칭 — worker 확정 vs zone 미확정 분리 (핵심)

`HazardEvent.workerId`는 **필수**(`hazard-event.ts:18` `z.string().min(1)`). zone-only 이벤트를 담을 수 없다.
따라서 두 트랙으로 분리한다.

### 4.1 worker 확정 트랙

- **앵커 = 워치 이벤트**(workerId 보유). 여기에 영상 `fallen`이 §3 정합 윈도 안에 있으면 코로보레이션으로 더한다.
- **zone 호환(zoneCompatible) 판정 — confirmed의 필수 조건**(코덱스 R2 반영):
  - 워치 GPS↔카메라 zone 매핑이 있고 **같은 zone으로 확인되면** → `zoneCompatible = true` → `confirmed` 격상 허용.
  - 매핑이 없거나(실내 GPS 약함) zone을 확인할 수 없으면 → `zoneCompatible = unknown` →
    **`confirmed` 금지**. 영상은 별도 zone 트랙(§4.2)으로만 처리하고, 워치는 자체 단계(후보/확정) 유지.
    `confidence`만 소폭 올릴 수 있으나 **단계는 올리지 않는다**(임의 zone fallen으로 worker 오귀속 방지).
- 산출: 기존 `HazardEvent`(type=`fall`) — workerId 보유. fusion 결과는 `detail.message`에 근거 요약.

> **금지 명문화**: "동시간·임의 zone fallen"만으로 워치 후보를 `confirmed`로 올리지 않는다. confirmed는
> `zoneCompatible===true`(명시 매핑 확인)일 때만. 매핑이 없으면 같은 시간대 영상은 zone warning(§4.2)으로 따로 뜬다.

### 4.2 zone 미확정 트랙

- **앵커 = 영상 `fallen`만**(워치 부재/미착용). worker를 특정할 근거가 없다.
- 산출: **신규 `ZoneHazardEvent`**(workerId 없음, cameraId/zone 보유). 관제 화면에 "해당 구역 낙상 의심 — 대상
  확인 필요"로 표시. **임의의 worker에 귀속 금지**(같은 zone 타인 오귀속 위험 — 코덱스 지적).

### 4.3 절대 금지

- 배정표/BLE/UWB/게이트 태그/수동 확인 없이 zone 이벤트를 특정 worker의 `HazardEvent`로 승격 금지.

---

## 5. 결합 규칙 — 판정 단계와 근거

`decideFusion(inputs)`는 순수 함수. 입력: 워치 낙상 상태·영상 zone 낙상 상태·양측 availability·시간차.
출력: `{ stage, confidence, basis, recommendedActions, target }`.

### 5.1 판정 표 (요지)

| 입력 조합 | 단계 | 산출 | monotonicity |
|---|---|---|---|
| 워치 **확정**(fallDetected) + 영상 `fallen` 정합 + zoneCompatible | **confirmed** | 기존 danger 유지 + 영상확증 라벨 | 격상 ↑ |
| 워치 **후보**(fallDecision=fall) + 영상 `fallen` 정합 + zoneCompatible | **confirmed(조기격상)** | fusion이 `recordAlert("fall")` + danger | 격상 ↑(20초 대기 생략) |
| 워치 확정(fallDetected) + 영상 부재/blind/음성/zone불명 | **워치 확정 danger 유지** | 기존 경로 그대로 | 불변(깎지 않음) |
| 워치 후보(fallDecision=fall) + 영상 부재/blind/zone불명 | **워치 자체 프롬프트 유지** | fusion 개입 없음 | 불변(워치 동작 보존) |
| 영상 `fallen` 단독 + 워치 부재 | **warning(zone)** | `ZoneHazardEvent` + 관제 확인 | 신설 경로 |
| 영상 `lying` 단독 | **suspect** | 로깅·표시만 | 약신호 |
| 양측 모두 음성/없음 | (판정 없음) | — | — |

> **조기격상(2행)이 fusion의 핵심 효용**: 영상이 같은 zone에서 `fallen`을 확증하면, 워치 후보를 20초 프롬프트
> 무응답까지 기다리지 않고 즉시 danger로 올린다. 단 `zoneCompatible===true`일 때만(오귀속 방지).

### 5.2 핵심 근거

- **AND(둘 다 양성만 확정) 단독 채택 금지** — 한쪽 부재 시 미탐. 안전 크리티컬에서 부적합.
- **워치 단독은 현행 danger 보존** — 워치 자체 알고리즘이 이미 3단계 게이트(자유낙하+충격+정지+자이로)를
  통과한 결과다. fusion이 영상 없음을 이유로 이를 warning으로 격하하면 monotonicity 위반.
- **영상 단독은 차등** — `fallen`(확정 자세)은 zone `warning`, `lying`(누움)은 `suspect`. 앉기/눕기 정상행동을
  danger로 오인하지 않게 한다. 워치 코로보레이션이 붙어야 confirmed로 격상.
- **confidence는 가중 합산**이되, 그 값이 단독 신호의 단계를 **내리는 데 쓰이지 않는다**(올리는 데만).

### 5.3 의사 알고리즘

`i.watch.confirmed` = `fallDetected===true`. `i.watch.candidate` = `fallCandidate && fallDecision==="fall"` 이고
아직 `fallDetected`가 아님. `visionCorroborates` = 영상 available + `fallen` + §3 timeMatched + **zoneCompatible===true**.

```
function decideFusion(i):
  visionCorroborates = i.vision.availability == "available"
                       and i.vision.fallen
                       and timeMatched(i)            # §3 윈도
                       and zoneCompatible(i) == true # §4.1, 매핑 확인된 same-zone만

  # 1) 워치 확정(fallDetected) — 이미 danger. 절대 깎지 않음.
  if i.watch.confirmed:
     if visionCorroborates:
        return confirmed(worker=i.watch.workerId, confidence=high,
                         basis=[watch.fallDetected, vision.fallen, timeMatched])
     return danger_watch(worker=i.watch.workerId)     # 영상 부재/blind/음성/zone불명 무관, danger 유지

  # 2) 워치 후보(fallDecision=fall, 미확정) — 영상이 확증하면 조기 격상, 아니면 워치 자체 흐름 유지.
  if i.watch.candidate:
     if visionCorroborates:
        # fusion이 직접 책임: recordAlert("fall") + danger (기존 store 경로는 fallDetected 만 보므로)
        return confirmed(worker=i.watch.workerId, confidence=high, earlyEscalated=true,
                         basis=[watch.candidate, vision.fallen, timeMatched])
     return none   # 워치 자체 20초 프롬프트 흐름에 맡김(monotonicity: 워치 동작 보존, fusion 개입 안 함)

  # 3) 영상 단독(워치 없음/부재) — 대상 미특정 zone 트랙
  if i.vision.availability == "available":
     if i.vision.fallen: return warning_zone(camera=i.vision.cameraId)
     if i.vision.lying:  return suspect(camera=i.vision.cameraId)

  return none
```

> `zoneCompatible(i)`는 매핑이 **확인된 same-zone일 때만 true**, 매핑 없음/불명은 `false`(unknown 취급).
> 따라서 임의 zone fallen은 `visionCorroborates=false`가 되어 confirmed로 못 올라간다(코덱스 R2 §7 반영).

---

## 6. 오탐·미탐 방어

- **워치 미착용 / 영상 사각지대**: 해당 소스를 `blind`/`unavailable`로 표기하고 코로보레이션에서 제외.
  가용 소스만으로 단독 판정 유지(graceful degrade). 부재를 음성으로 쓰지 않음.
- **앉기·눕기 오인**: 영상 `lying` 단독은 `suspect`(알림 없음). 워치 충격(freefall+impact)이 정합될 때만 격상.
- **워치 작업충격 오탐**(망치질 등): 워치 자체 게이트가 1차 방어. 영상 `fallen` 부재 시 confirmed로 격상되지
  않으므로 fusion이 2차 방어(단, 워치 단독 danger 자체는 보존 — 놓침 방지 우선).
- **신호 상충**(워치 양성 + 영상 standing): 워치 단독 danger 유지(monotonicity), confirmed 아님. 상충은
  `basis`에 기록해 관제가 판단. 영상 standing을 근거로 워치를 음성 처리하지 않는다.

---

## 7. 판정 단계 → 후속 동작

| 단계 | 후속 |
|---|---|
| suspect | DB 로깅 + 대시보드 표시(`cctv_fall_events`). 알림 없음. |
| warning(zone) | 관제 알림(대상 미특정 "구역 확인"). `ZoneHazardEvent`. 작업자 자가확인 프롬프트는 worker 미특정이라 미발송. |
| 워치 단독 danger | **기존 경로 그대로** — severity danger + SOS 모달 + `recordAlert("fall")`. |
| confirmed | 워치 danger + 영상 코로보레이션 격상. alerts 1건(기존 UNIQUE dedup), 근거에 "영상 확증" 표기. |

---

## 8. 데이터 모델 (신설)

### 8.1 `CctvFallEvent` (영상 이벤트 수신 스키마, Zod)

```ts
// packages/schemas/src/cctv-event.ts (신설)
const CctvFallEventSchema = z.object({
  cameraId: z.string().min(1),
  zone: z.string().min(1).max(60).optional(),     // "지하 기계실" 등 라벨
  ts: z.string().datetime(),                       // 프레임/폴 관측 시각(ISO8601 UTC)
  status: z.enum(["standing", "unstable", "lying", "fallen"]),
  fallenCount: z.number().int().min(0).default(0), // byStatus 의 fallen count
  total: z.number().int().min(0).optional(),
  confidence: z.number().min(0).max(1).optional(), // 모델 신뢰도(있으면)
  source: z.enum(["poller", "push"]).default("poller"),
});
```

### 8.2 `ZoneHazardEvent` (대상 미특정 위험 이벤트, Zod)

```ts
// packages/schemas/src/zone-hazard-event.ts (신설) — HazardEvent 와 형제, workerId 없음
const ZoneHazardEventSchema = z.object({
  eventId: z.string().min(1),
  cameraId: z.string().min(1),
  zone: z.string().optional(),
  type: z.literal("fall"),
  severity: z.enum(["caution", "warning", "danger"]),  // 기존 Severity 재사용
  ts: z.string().datetime(),
  // detail.status 가 required 이므로 .default({}) 금지(코덱스 R2 반영). detail 자체를 required object 로 둔다.
  detail: z.object({
    status: z.enum(["lying", "fallen"]),
    fallenCount: z.number().int().optional(),
    message: z.string().optional(),
  }),
});
```

> 기존 `HazardEvent`(workerId 필수)는 **불변**. 그 `detail`은 내부 필드가 전부 optional이라 `.default({})`가
> 성립하지만, `ZoneHazardEvent.detail.status`는 required이므로 `.default({})`를 **쓰지 않는다**(쓰면 status
> 누락 객체가 통과해 런타임에서 깨짐). detail은 호출부에서 항상 명시 생성한다.

### 8.3 `decideFusion` 입출력 타입

```ts
// packages/fusion 또는 analyzers 확장
type FusionInputs = {
  watch: {
    confirmed: boolean;        // fallDetected===true (이미 danger)
    candidate: boolean;        // fallCandidate && fallDecision==="fall" 이고 아직 fallDetected 아님
    workerId?: string;
    zone?: string;             // 워치 GPS→zone 매핑 결과(있으면)
    ts?: string;               // 발신 시각
    availability: SourceAvailability;
  };
  vision: {
    fallen: boolean;
    lying: boolean;
    cameraId?: string;
    zone?: string;
    ts?: string;               // 프레임/폴 시각
    availability: SourceAvailability;
  };
  window?: { preSec: number; postSec: number };  // 기본 10/15
};
type FusionStage = "none" | "suspect" | "warning_zone" | "danger_watch" | "confirmed";
type FusionDecision = {
  stage: FusionStage;
  confidence: number;            // 0..1, 표시·로깅용(단계를 내리는 데 사용 금지)
  earlyEscalated?: boolean;      // 워치 후보를 영상으로 조기 격상한 경우 true
  target: { kind: "worker"; workerId: string } | { kind: "zone"; cameraId: string } | { kind: "none" };
  basis: string[];               // ["watch.fallDetected","vision.fallen","timeMatched"] 등
  recommendedActions: string[];  // ["alert.control","sos.modal","worker.prompt"] 등
};
```

---

## 9. API Spec — `POST /api/cctv/event` (신설)

기존 `POST /api/mock/vital` 패턴 답습(Zod 검증, 배열·단일 허용, 항목 격리). 단 **응답코드는 201/400만**
사용한다 — CCTV 이벤트에는 reserved worker 개념이 없어 기존 vital route의 202(reserved drop) 분기가 필요 없다
(코덱스 R2 반영, route.ts:79-84의 202는 워커 전용).

- **요청**: `CctvFallEvent` 단일 객체 또는 배열.
- **동작**: Zod 검증 → `cctv_fall_events` 저장 → in-memory 보관(최근 N) → 워치 최근 이벤트와 §5 결합 시도.
  - 워치 후보/확정과 정합되고 zoneCompatible이면 `recordAlert("fall")`/danger 격상(§5).
  - 워치 부재 + `fallen` → `ZoneHazardEvent`(메모리). `lying` → suspect.
- **응답**: 배열 `{ ok: true, accepted, dropped }`(201) / 단일 `{ ok: true, event }`(201) / Zod 실패 `{ ok:false, error }`(400).
- **읽기**: 기존 vital GET 응답에 `zoneHazards`(+필요 시 `cctvEvents` 요약)를 **동봉**(별 라우트 최소화). 4단계 확정.

### 폴링 어댑터(영상 수신 경로 — 확정)

- 데모 리포(FastAPI) 비침습. 대시보드 측 `lib/cctv-poller.ts`가 `/cctv/stats2`를 폴링.
- `fallen` 카운트의 **상승 전이(edge)**를 이벤트화 → 내부적으로 `POST /api/cctv/event`(또는 직접 store 호출).
- 폴링 주기(1초)만큼 시간 해상도 한계 — `log()`로 명시(silent cap 금지).

---

## 10. 시퀀스 (텍스트 다이어그램)

```
[CCTV FastAPI :8000] --/cctv/stats2--> [lib/cctv-poller (대시보드)]
                                              | fallen 상승 전이 감지
                                              v
                                    [POST /api/cctv/event] --Zod--> [cctv_fall_events (SQLite)]
                                              |                                  |
                                              v                                  |
[워치] --/api/mock/vital--> [store.addSample] --fallDetected--> [recordAlert("fall") + danger]  (기존 경로, 불변)
                                              |                                  |
                                              +-----------> [decideFusion(watch, vision, avail, window)]
                                                                   |
                                  +--------------------------------+--------------------------------+
                                  v                                v                                v
                       confirmed(worker)                  warning_zone                        suspect
                       HazardEvent + alerts             ZoneHazardEvent                    로깅·표시만
```

---

## 11. DB — `cctv_fall_events` (신설 테이블)

`lib/db.ts`의 `init()` 안 `db.exec(CREATE TABLE IF NOT EXISTS ...)`에 **추가**(기존 테이블 불변). `getDb()` 캐시
가드를 신규 statement로 갱신(기존 HMR 패턴).

```sql
CREATE TABLE IF NOT EXISTS cctv_fall_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  camera_id TEXT NOT NULL,
  zone TEXT,
  ts TEXT NOT NULL,                 -- 프레임/폴 관측 시각
  status TEXT NOT NULL,             -- standing|unstable|lying|fallen
  fallen_count INTEGER,
  total INTEGER,
  confidence REAL,
  source TEXT,                      -- poller|push
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cfe_camera_ts ON cctv_fall_events(camera_id, ts);
CREATE INDEX IF NOT EXISTS idx_cfe_ts ON cctv_fall_events(ts);
```

**저장 위치 고정(코덱스 R2 반영 — 인터페이스 흔들림 제거)**:
- **모든 영상 이벤트**(suspect/warning/fallen/lying)는 `cctv_fall_events`에 저장(감사·이력).
- **zone hazard(대상 미특정 경보)**는 **별도 테이블을 만들지 않고** 인메모리 보관 + 기존 vital GET 응답에
  `zoneHazards`로 동봉한다. 이유: `alerts.worker_id TEXT NOT NULL` + `UNIQUE(worker_id,type,ts)`이고
  `recordAlert`도 workerId 필수(db.ts:190-198, 720-731)라 worker 없는 zone은 alerts에 못 들어간다(코드 확인).
- worker 확정(confirmed) 경보만 기존 `alerts`(type=`fall`)에 들어간다(workerId 보유).

---

## 12. 핵심 결정 (ADR 흡수)

| # | 결정 | 근거 | 대안(기각) |
|---|---|---|---|
| D1 | Safety Monotonicity | 한쪽 부재가 경보를 깎으면 미탐 | 순수 가중합(단계 하향 허용) → 기각 |
| D2 | worker/zone 트랙 분리 + `ZoneHazardEvent` 신설 | HazardEvent.workerId 필수, 오귀속 위험 | zone을 임의 worker 귀속 → 기각 |
| D3 | 영상 수신 = 폴링 어댑터 | 데모 리포 비침습, 사용자 승인 | FastAPI push 훅(샌드박스·별 리포 수정) → 보류 |
| D4 | 가용성 4상태 명시 모델링 | 부재≠음성 | boolean 유무 → 기각(함정) |
| D5 | 넓은 시간창 + 낮은 가중 | 워치 ts=발신시각, impactTs 부재 | ±수초 정밀창 → 현 코드선 불가 |
| D6 | 워치 후보를 영상이 확증하면 조기격상(20초 프롬프트 생략), fusion이 alert 책임 | 쓰러진 사람은 프롬프트 못 누름·영상이 확증 | 항상 20초 대기 → 대응 지연 |
| D7 | confirmed는 zoneCompatible===true(매핑 확인) 시에만 | 임의 zone fallen 오귀속 방지 | 동시간 임의 zone 격상 → 기각 |

---

## 13. 검증 시나리오 (단위 테스트 매핑)

| # | 입력 | 기대 stage | 검증 포인트 |
|---|---|---|---|
| T1 | 워치 확정(fallDetected) + 영상 fallen 정합 + zoneCompatible | confirmed | 격상·영상확증 라벨 |
| T2 | 워치 확정 + 영상 unavailable | danger_watch | monotonicity(깎지 않음) |
| T3 | 워치 확정 + 영상 blind | danger_watch | 부재≠음성 |
| T4 | 워치 확정 + 영상 standing(상충) | danger_watch | 영상으로 워치 음성화 금지 |
| T5 | 영상 fallen 단독 + 워치 unavailable | warning_zone | 대상 미특정 |
| T6 | 영상 lying 단독 | suspect | 앉기/눕기 오인 방지 |
| T7 | 워치 확정 + 영상 fallen 시간창 밖 | danger_watch (confirmed 아님) | 시간 정합 실패 |
| T8 | 워치 stale + 영상 fallen | warning_zone (confirmed 아님) | 신선도 가드 |
| T9 | 양측 음성/없음 | none | 오발화 0 |
| T10 | 워치 **후보**(fallDecision=fall) + 영상 fallen 정합 + zoneCompatible | confirmed(earlyEscalated) | 20초 대기 생략·fusion이 alert 책임 |
| T11 | 워치 후보 + 영상 부재 | none | 워치 자체 프롬프트 유지(개입 안 함) |
| T12 | 워치 확정 + 영상 fallen 정합이나 zone 불명(매핑 없음) | danger_watch (confirmed 아님) | 오귀속 방지(임의 zone 격상 금지) |

---

## 14. 검토 반영 내역 (코덱스 적대적 검토 R1 → 전면 수용)

| 코덱스 지적 | 코드 근거 | 반영 |
|---|---|---|
| 부재를 false로 두는 함정 | severity.ts:93 즉시 danger | §2 가용성 4상태(unknown 모델링) |
| "의심 또는 경보" 모호 | FallDetector 3단계 통과 | §5.1 표로 단계 확정 |
| 워치 ts=발신시각, impactTs 없음 | VitalTransmitter.swift:83 | §3 넓은 창+낮은 가중, impactTs 확인필요 |
| zone-only 표현 불가 | hazard-event.ts:18 workerId 필수 | §4·§8.2 ZoneHazardEvent 신설 |
| 영상 통계 형식 오인(byClass) | CctvQuadView.tsx:388-392 | §1.1 byStatus/fallen 정정 |
| 영상 DB 미저장·표시만 | ai-cctv route 프록시 | §9·§11 수신 API·테이블 신설 |

### R2 — 설계 문서 리뷰(코덱스) → 치명 3건 수용

| 코덱스 지적 | 코드 근거 | 반영 |
|---|---|---|
| `fallDecision="fall"`만으론 기존 danger/alert 경로 안 탐 | store.ts:88, severity.ts:93 | §1.2 워치 후보/확정 2단계 분리. 후보 조기격상 시 fusion이 `recordAlert` 직접 책임 |
| `ZoneHazardEvent.detail.default({})` 위험(status required) | hazard-event.ts:22-33 | §8.2 `.default({})` 제거, detail required object |
| 임의 zone fallen으로 confirmed 격상 여지(오귀속) | fusion-design 초안 | §4.1·§5.3 `zoneCompatible===true`(매핑 확인) 필수, 불명 시 confirmed 금지 |
| 202 분기 불필요(CCTV reserved 없음) | route.ts:79-84 | §9 응답 201/400만 |
| zone hazard 저장 위치 미고정(인터페이스 흔들림) | db.ts:190-198 | §11 저장 고정: 영상은 cctv_fall_events, zone hazard는 메모리+GET 동봉 |

---

## 15. 확인 필요 (미확정 가정 — 구현 시 보수적 기본값 채택)

1. **영상 confidence/zone 메타**: `/cctv/stats2`에 confidence가 없을 수 있음 → 어댑터에서 optional 처리.
2. **zone↔worker 배정표**: 현재 코드에 없음 → MVP는 worker 자동 귀속 금지(워치 앵커만 worker 확정).
3. **워치 `impactTs`**: 미동봉 → 정밀 시간 정합 불가. 도입 전엔 넓은 창 유지.
4. **카메라↔zone 매핑**: CAM-02="지하 기계실" 라벨만. GPS↔zone 매핑은 보류(약한 코로보레이션만).
5. ~~zone hazard 저장 위치~~ → **고정됨**(§11): 영상 이벤트는 `cctv_fall_events`, zone hazard는 메모리+GET 동봉.
6. **폴링 vs push**: 폴링 어댑터 확정. 시간 해상도 1초 한계는 `log()`로 노출.
7. **워치 후보 조기격상의 zoneCompatible**: 현재 zone 매핑 데이터가 없으므로(확인필요 2·4) MVP에서 `zoneCompatible`은
   대부분 `false`가 되어 후보 조기격상(T10)이 실제로는 거의 발화하지 않을 수 있다. 매핑이 들어오면 활성화된다.
   따라서 데모에서는 zone 매핑을 명시 주입(설정/시드)할 수 있게 해 T10 경로를 시연 가능하게 한다.
