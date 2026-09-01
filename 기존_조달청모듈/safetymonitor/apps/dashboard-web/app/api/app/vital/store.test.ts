// store.ts 순수 로직 단위 테스트 — reserved 필터 + mergeLatestByWorker(sticky / ts-ordering / 이벤트 비-sticky
// / 활동 필드 90초 TTL) + vitalDanger·dangerMetrics(안정 임계 판정)·hasNewDangerMetric(메트릭별 전이)
// + addSample 게이트(reserved 차단 / 스키마 위반 throw).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { VitalSample } from "@safetymonitor/schemas";

import {
  addSample,
  dangerMetrics,
  hasMonitorableSignal,
  hasNewDangerMetric,
  isReservedTestWorker,
  classifyVitalDataOrigin,
  mergeLatestByWorker,
  vitalDanger,
} from "./store";

const TS = "2026-06-03T10:00:00.000Z";

function s(partial: Partial<VitalSample> & { workerId: string; ts: string }): VitalSample {
  return partial as VitalSample;
}

test("isReservedTestWorker — 진단/예약 ID 는 차단, 실 작업자는 통과", () => {
  assert.equal(isReservedTestWorker("infra_check"), true);
  assert.equal(isReservedTestWorker("warmup"), true);
  assert.equal(isReservedTestWorker("test_abc"), true);
  assert.equal(isReservedTestWorker("smoke_x"), true);
  assert.equal(isReservedTestWorker("reserved_test_worker"), true);
  assert.equal(isReservedTestWorker("EMP-1024"), false);
  assert.equal(isReservedTestWorker("demo_ios_01"), false);
});

test("classifyVitalDataOrigin — 실 iPhone·Watch와 기기별 목업을 분리한다", () => {
  assert.equal(classifyVitalDataOrigin("VitAlGuard-iPhone"), "ios_data_vitalguard");
  assert.equal(classifyVitalDataOrigin("VitAlGuard-WatchVitals"), "watchos_data_vitalguard");
  // 갤럭시(Wear OS)는 애플(watchOS)과 다른 출처로 떨어져야 한다 — 체온이 실측 대 추정으로 갈린다.
  assert.equal(classifyVitalDataOrigin("VitAlGuard-GalaxyWatch"), "wearos_data_vitalguard");
  assert.equal(classifyVitalDataOrigin("VitAlGuard-Mock-iPhone"), "mockup_ios_data_vitalguard");
  assert.equal(classifyVitalDataOrigin("VitAlGuard-Mock-Watch"), "mockup_watchos_data_vitalguard");
  assert.equal(classifyVitalDataOrigin("demo"), null);
});

test("mergeLatestByWorker — reserved 워커는 결과에서 제외", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "reserved_test_worker", ts: "2026-06-03T10:00:00.000Z", heartRate: 80 }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", heartRate: 75 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.workerId, "EMP-1");
});

test("mergeLatestByWorker — null 메트릭은 직전 실측값 sticky 유지", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", heartRate: 80, spo2: 97 }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:05.000Z" }), // 잠금 등으로 vital 미동봉
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.heartRate, 80); // 직전값 유지
  assert.equal(out[0]?.spo2, 97);
  assert.equal(out[0]?.ts, "2026-06-03T10:00:05.000Z"); // ts 는 최신
});

test("mergeLatestByWorker — 워치 backlog(역순 삽입) 시 ts 가 역행하지 않는다 (L1)", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:10.000Z", heartRate: 80 }), // 최신이 먼저 삽입
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", heartRate: 60 }), // 더 오래된 backlog 가 나중 삽입
  ]);
  assert.equal(out[0]?.ts, "2026-06-03T10:00:10.000Z"); // 최신 ts 유지(역행 X)
  assert.equal(out[0]?.heartRate, 80); // 최신 샘플 값 유지
});

test("mergeLatestByWorker — 이벤트 플래그는 비-sticky(최신 샘플 값만)", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", manualSos: true }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:05.000Z", heartRate: 80 }), // SOS 미동봉
  ]);
  assert.equal(out[0]?.manualSos, undefined); // sticky 안 됨
  assert.equal(out[0]?.heartRate, 80);
});

test("mergeLatestByWorker — 여러 워커는 workerId 정렬로 반환", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-2", ts: "2026-06-03T10:00:00.000Z" }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z" }),
  ]);
  assert.deepEqual(out.map((o) => o.workerId), ["EMP-1", "EMP-2"]);
});

test("mergeLatestByWorker — aliasMap 으로 secondary→primary 폴딩(같은 사람 다중 ID → 1카드·결합 메트릭)", () => {
  // 장우진: 폰(EMP-6861) 손목온도 + 워치(EMP-admin6861) 심박/SpO₂. 별칭 EMP-6861→EMP-admin6861.
  const phone = s({ workerId: "EMP-6861", ts: "2026-06-29T10:00:00.000Z", skinTempC: 36.2 });
  const watch = s({ workerId: "EMP-admin6861", ts: "2026-06-29T10:00:05.000Z", heartRate: 88, spo2: 95 });

  // 별칭 없으면 서로 다른 2카드.
  assert.equal(mergeLatestByWorker([phone, watch]).length, 2);

  // 별칭(secondary→primary)이면 primary 1카드로 접히고 메트릭이 결합된다.
  const folded = mergeLatestByWorker([phone, watch], { "EMP-6861": "EMP-admin6861" });
  assert.equal(folded.length, 1);
  assert.equal(folded[0]?.workerId, "EMP-admin6861"); // 방향 = primary 가 살아남음
  assert.equal(folded[0]?.heartRate, 88); // 워치 메트릭
  assert.equal(folded[0]?.spo2, 95);
  assert.equal(folded[0]?.skinTempC, 36.2); // 폰 메트릭(sticky 결합)
});

test("mergeLatestByWorker — 신선한 활동(90초 이내)은 sticky 유지(기존과 동일 동작)", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", activeEnergyKcal: 150, steps: 4000, flightsClimbed: 20 }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:01:00.000Z", heartRate: 145 }), // 60초 후, 활동 미동봉
  ]);
  assert.equal(out[0]?.activeEnergyKcal, 150);
  assert.equal(out[0]?.steps, 4000);
  assert.equal(out[0]?.flightsClimbed, 20);
});

test("mergeLatestByWorker — 활동 TTL 경계(정확히 90초)는 아직 신선(초과만 만료)", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", activeEnergyKcal: 150 }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:01:30.000Z", heartRate: 145 }), // 정확히 90초 후
  ]);
  assert.equal(out[0]?.activeEnergyKcal, 150);
});

test("mergeLatestByWorker — 90초 초과 stale 활동은 만료(undefined) → 안정 임계 폴백", () => {
  // 활동 전송이 끊긴 뒤에도 'heavy' 가 sticky 로 남으면 안정 HR 145 가 완화 밴드(caution)로
  // 가려져 위험 팝업이 안 뜨는 감사 지적 케이스 — 만료로 classifyActivity 가 null 을 반환하게 한다.
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", activeEnergyKcal: 150, steps: 4000, flightsClimbed: 20 }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:02:00.000Z", heartRate: 145 }), // 120초 후, 활동 미동봉
  ]);
  assert.equal(out[0]?.activeEnergyKcal, undefined);
  assert.equal(out[0]?.steps, undefined);
  assert.equal(out[0]?.flightsClimbed, undefined);
  assert.equal(out[0]?.heartRate, 145); // vital sticky 는 무관(유지)
});

test("mergeLatestByWorker — 최신 샘플이 활동을 재동봉하면 TTL 리프레시(만료 없음)", () => {
  // 활동 ts 는 워커 단위(3필드 중 하나라도 present 한 최대 ts) — 활동 전송이 재개되면
  // 자기 값 + 직전 sticky 값이 함께 신선 취급된다(활동 스트림이 살아있다는 신호).
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", activeEnergyKcal: 150 }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:05:00.000Z", heartRate: 145, steps: 3000 }), // 활동 재동봉
  ]);
  assert.equal(out[0]?.steps, 3000); // 자기 값
  assert.equal(out[0]?.activeEnergyKcal, 150); // 재동봉이 TTL 리프레시 → sticky 유지
});

test("mergeLatestByWorker — 스트레스 입력은 90초 초과여도 sticky 유지(TTL 미적용)", () => {
  const out = mergeLatestByWorker([
    s({
      workerId: "EMP-1",
      ts: "2026-06-03T10:00:00.000Z",
      hrvSdnnMs: 42,
      restingHeartRate: 62,
      walkingHeartRate: 95,
      respiratoryRate: 15,
    }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:05:00.000Z", heartRate: 80 }), // 5분 후
  ]);
  assert.equal(out[0]?.hrvSdnnMs, 42);
  assert.equal(out[0]?.restingHeartRate, 62);
  assert.equal(out[0]?.walkingHeartRate, 95);
  assert.equal(out[0]?.respiratoryRate, 15);
});

test("mergeLatestByWorker — 신선한 SpO₂(30분 이내 동일값)는 sticky 유지", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", heartRate: 80, spo2: 97 }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:20:00.000Z", heartRate: 82, spo2: 97 }), // 20분 후 재전송
  ]);
  assert.equal(out[0]?.spo2, 97);
});

test("mergeLatestByWorker — SpO₂ TTL 경계(정확히 30분)는 아직 신선(초과만 만료)", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", spo2: 97 }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:30:00.000Z", heartRate: 80, spo2: 97 }),
  ]);
  assert.equal(out[0]?.spo2, 97);
});

test("mergeLatestByWorker — 30분 초과 동일 SpO₂ 는 만료(undefined) → '--' 표시·판정 제외", () => {
  // 워치가 마지막 스팟 측정값을 매 심박 전송에 계속 얹어 보내므로 값은 present 지만 새 측정은 없다.
  // 게이트가 없으면 오래된 값이 계속 '정상' 으로 표시돼 실제 저산소를 놓친다.
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", spo2: 97 }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:31:00.000Z", heartRate: 80, spo2: 97 }), // 31분 후
  ]);
  assert.equal(out[0]?.spo2, undefined);
  assert.equal(out[0]?.heartRate, 80); // 다른 메트릭은 무관(유지)
});

test("mergeLatestByWorker — SpO₂ 값이 바뀌면 새 측정이므로 TTL 리프레시(만료 없음)", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-06-03T09:00:00.000Z", spo2: 95 }), // 1시간 전 옛 값
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", heartRate: 80, spo2: 92 }), // 값 변화 = 새 측정
  ]);
  assert.equal(out[0]?.spo2, 92);
});

test("mergeLatestByWorker — 값 변화 이후 다시 30분 넘게 고정되면 만료", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", spo2: 95 }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:10:00.000Z", spo2: 92 }), // 새 측정(run 시작)
    s({ workerId: "EMP-1", ts: "2026-06-03T10:45:00.000Z", heartRate: 80, spo2: 92 }), // 35분 고정
  ]);
  assert.equal(out[0]?.spo2, undefined);
});

test("mergeLatestByWorker — 며칠 지난 SpO₂ 가 정상으로 표시되던 회귀 차단 (실사례)", () => {
  // 2026-07-23 측정한 92% 가 07-25 까지 그대로 재전송되며 관제웹에 '정상' 으로 표시되던 케이스.
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-admin6861", ts: "2026-07-23T09:00:00.000Z", spo2: 92 }),
    s({ workerId: "EMP-admin6861", ts: "2026-07-25T15:58:00.000Z", heartRate: 82, spo2: 92 }),
  ]);
  assert.equal(out[0]?.spo2, undefined);
  assert.equal(out[0]?.heartRate, 82);
});

test("mergeLatestByWorker — SpO₂ 만료는 워커별 독립(다른 워커의 신선한 값은 유지)", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", spo2: 97 }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:40:00.000Z", spo2: 97 }), // 40분 고정 → 만료
    s({ workerId: "EMP-2", ts: "2026-06-03T10:39:00.000Z", spo2: 96 }),
    s({ workerId: "EMP-2", ts: "2026-06-03T10:40:00.000Z", spo2: 98 }), // 값 변화 → 신선
  ]);
  assert.equal(out[0]?.spo2, undefined);
  assert.equal(out[1]?.spo2, 98);
});

test("vitalDanger — 안정 임계로 판정(활동 메트릭 동봉해도 작업 게이트로 가려지지 않음)", () => {
  // 심박 140 은 작업 메트릭(고활동)을 동봉해도 안정 임계(≥130)로 danger — false-negative 0.
  assert.equal(
    vitalDanger(
      s({
        workerId: "EMP-1",
        ts: TS,
        heartRate: 140,
        activeEnergyKcal: 150,
        steps: 4000,
        flightsClimbed: 20,
      }),
    ),
    true,
  );
  assert.equal(vitalDanger(s({ workerId: "EMP-1", ts: TS, spo2: 85 })), true); // dangerPct 88 미만
  assert.equal(vitalDanger(s({ workerId: "EMP-1", ts: TS, skinTempC: 38.5 })), true); // 추정 심부 39.0℃
});

test("vitalDanger — 정상치/undefined 는 위험 아님", () => {
  assert.equal(
    vitalDanger(s({ workerId: "EMP-1", ts: TS, heartRate: 75, spo2: 97, skinTempC: 35.5 })),
    false,
  );
  assert.equal(vitalDanger(undefined), false);
});

test("dangerMetrics — danger 인 메트릭만 독립적으로 반환", () => {
  assert.deepEqual(dangerMetrics(s({ workerId: "EMP-1", ts: TS, heartRate: 140 })), ["hr"]);
  assert.deepEqual(dangerMetrics(s({ workerId: "EMP-1", ts: TS, spo2: 85 })), ["spo2"]);
  assert.deepEqual(
    dangerMetrics(s({ workerId: "EMP-1", ts: TS, heartRate: 140, spo2: 85, skinTempC: 38.5 })),
    ["hr", "spo2", "temp"],
  );
  assert.deepEqual(dangerMetrics(s({ workerId: "EMP-1", ts: TS, heartRate: 75, spo2: 97 })), []);
  assert.deepEqual(dangerMetrics(undefined), []);
});

test("hasNewDangerMetric — 정상→위험 전이는 감지, 같은 메트릭 지속은 미기록", () => {
  const normal = s({ workerId: "EMP-1", ts: TS, heartRate: 75, spo2: 97 });
  const hrDanger = s({ workerId: "EMP-1", ts: TS, heartRate: 140, spo2: 97 });
  const hrDangerStill = s({ workerId: "EMP-1", ts: TS, heartRate: 145, spo2: 97 });
  assert.equal(hasNewDangerMetric(normal, hrDanger), true); // 정상→위험(기존 동작 보존)
  assert.equal(hasNewDangerMetric(undefined, hrDanger), true); // 첫 샘플부터 위험
  assert.equal(hasNewDangerMetric(hrDanger, hrDangerStill), false); // 같은 메트릭 지속 = 중복 기록 없음
  assert.equal(hasNewDangerMetric(hrDanger, normal), false); // 회복은 미기록
});

test("hasNewDangerMetric — HR danger 지속 중 SpO₂ 신규 진입(두 번째 별개 응급)을 감지", () => {
  // 이진 vitalDanger 전이(prev/cur 모두 danger)로는 삼켜지던 케이스 — 메트릭별 추적으로 감지.
  const hrOnly = s({ workerId: "EMP-1", ts: TS, heartRate: 140, spo2: 97 });
  const hrPlusSpo2 = s({ workerId: "EMP-1", ts: TS, heartRate: 140, spo2: 85 });
  assert.equal(vitalDanger(hrOnly) && vitalDanger(hrPlusSpo2), true); // 이진 전이로는 미감지 상황
  assert.equal(hasNewDangerMetric(hrOnly, hrPlusSpo2), true); // spo2 신규 진입 감지
});

test("hasMonitorableSignal — 실측 신호 유무 판별(빈 샘플=false)", () => {
  // EMP-admin(VitAlGuard 관리자) 빈 샘플 재현 — 메타데이터 + 이벤트 false 만 → 신호 없음.
  assert.equal(
    hasMonitorableSignal(
      s({
        workerId: "EMP-admin",
        ts: TS,
        workerName: "VitAlGuard 관리자",
        employeeId: "EMP-admin",
        jobTitle: "관리자",
        manualSos: false,
        fallDetected: false,
      }),
    ),
    false,
  );
  // 실측 생체·스트레스는 하나만 있어도 신호.
  assert.equal(hasMonitorableSignal(s({ workerId: "EMP-1", ts: TS, heartRate: 80 })), true);
  assert.equal(hasMonitorableSignal(s({ workerId: "EMP-1", ts: TS, spo2: 97 })), true);
  assert.equal(hasMonitorableSignal(s({ workerId: "EMP-1", ts: TS, skinTempC: 35.5 })), true); // EMP-admin6861(장우진) 케이스
  assert.equal(hasMonitorableSignal(s({ workerId: "EMP-1", ts: TS, steps: 0 })), true); // 0 도 실측 결과
  // 이벤트는 true 만 신호(false 는 무신호 — 빈 샘플에 false 로 실려온다).
  assert.equal(hasMonitorableSignal(s({ workerId: "EMP-1", ts: TS, manualSos: true })), true);
  assert.equal(hasMonitorableSignal(s({ workerId: "EMP-1", ts: TS, fallDetected: true })), true);
  assert.equal(hasMonitorableSignal(s({ workerId: "EMP-1", ts: TS, fallCandidate: true })), true);
  // 착용 전이는 true/false 둘 다 신호 — 벗음 표식은 생체가 없어 이 줄이 없으면 통째로 버려진다(08-31 유실).
  assert.equal(hasMonitorableSignal(s({ workerId: "EMP-1", ts: TS, worn: false })), true);
  assert.equal(hasMonitorableSignal(s({ workerId: "EMP-1", ts: TS, worn: true })), true);
  // 메타데이터/위치/배터리만 있으면 빈 샘플(false) — 모니터링 값 없음.
  assert.equal(
    hasMonitorableSignal(
      s({
        workerId: "EMP-1",
        ts: TS,
        latitude: 35.15,
        longitude: 126.9,
        batteryPct: 80,
        guardianPhone: "010-0000-0000",
      }),
    ),
    false,
  );
});

test("addSample — reserved 워커 입력은 null 반환(DB 미접근)", async () => {
  // 스키마는 통과하지만 예약 ID 이므로 persist 전에 차단되어 DB 를 건드리지 않는다(쿼리 0).
  const r = await addSample({ workerId: "smoke_x", ts: TS, heartRate: 80 });
  assert.equal(r.sample, null);
  // ★ 저장 대상이 아닌 것과 저장 실패는 다르다 — 여기서 persistFailed 가 서면 폰이 영원히 재시도한다.
  assert.equal(r.persistFailed, false);
});

test("addSample — 빈 샘플(실측 신호 없음)은 null 반환(persist 도달 전 드롭)", async () => {
  // EMP-admin 빈 하트비트 재현 — 실측 신호 없어 ring·DB 진입 전 드롭(persistSample 미도달).
  const empty = await addSample({
    workerId: "EMP-admin",
    ts: TS,
    manualSos: false,
    fallDetected: false,
  });
  assert.equal(empty.sample, null);
  assert.equal(empty.persistFailed, false);
  const meta = await addSample({ workerId: "EMP-1", ts: TS }); // 순수 메타데이터
  assert.equal(meta.sample, null);
  assert.equal(meta.persistFailed, false);
});

test("addSample — 스키마 위반 입력은 reject(persist 도달 전 거부)", async () => {
  // async 함수 안의 동기 throw(Zod parse 실패)는 reject 로 전파된다(DB 도달 전).
  await assert.rejects(addSample({ ts: TS })); // workerId 누락
  await assert.rejects(addSample({ workerId: "", ts: TS })); // 빈 workerId(min 1)
});
