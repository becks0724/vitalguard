// 관리자 앱 — 작업자 현황(폰 화면 한 장에 들어갈 만큼만).
//
// 관제 GET(`/api/monitor/vital`)을 그대로 열지 않는 이유가 이 파일이다. 그쪽은 16개 필드에
// 목업·누적집계·온열패턴·구역위험까지 실린 **웹 대시보드 전용** 응답이고 인가도 다르다
// (`verifyBasicAuth`). 폰은 작업자 목록 한 화면이면 되므로 필요한 것만 골라 담는다.
//
// ★ **판정을 여기서 새로 하지 않는다.** `workerStatus`·`effectiveTone`·`gateStaleVitals` 는
//   관제웹 화면이 쓰는 그 함수들이다(2026-09-03 에 `lib/worker-signal` 로 모았다). 폰이 임계를
//   따로 두면 같은 작업자가 웹과 앱에서 다른 색으로 뜬다 — CLAUDE.md "임계·색은 관제웹에서
//   가져온다" 가 막으려는 지점이고, 실제로 구 앱에서 그 사고가 났다.
//
// ⚠ 위치·보호자 정보는 관제 GET 과 **같은 규칙**으로 가린다(`MOCK_VITAL_EXPOSE_PII`).
//   관리자 인증을 통과했다는 것과 PII 를 내려도 된다는 것은 별개다.
import { NextResponse } from "next/server";

import { requireAppAdmin } from "../../../../../lib/app-admin-auth";
import { STALE_LABEL, staleKind, staleThresholdMs, vitalAgeMs } from "../../../../../lib/vital-age";
import {
  disconnectMetric,
  effectiveTone,
  gateStaleVitals,
  workerStatus,
} from "../../../../../lib/worker-signal";
import {
  coreTempEstimates,
  latestByWorkerWithSpo2,
  rosterWorkerNamesMap,
  workerAliases,
  workerProfiles,
} from "../../vital/store";

export const dynamic = "force-dynamic";

// 관제 GET 과 같은 마스터 스위치 — 켜지 않으면 좌표·보호자 정보를 아예 싣지 않는다.
const EXPOSE_PII = process.env.MOCK_VITAL_EXPOSE_PII === "true";

/** 실패한 부수 조회가 화면 전체를 죽이지 않게 한다(관제 GET 의 `softly` 와 같은 취지). */
async function softly<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[app-admin/workers] ${label} 조회 실패 — 값 생략`, e);
    return fallback;
  }
}

export async function GET(request: Request) {
  const gate = await requireAppAdmin(request);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const now = Date.now();
  const aliasMap = await softly("별칭", workerAliases, {} as Record<string, string>);
  const latest = await latestByWorkerWithSpo2(aliasMap);
  const coreTemp = await softly("심부체온", () => coreTempEstimates(aliasMap), {});
  const names = await softly("이름", rosterWorkerNamesMap, {} as Record<string, string>);
  const profiles = await softly("직급", workerProfiles, {} as Record<string, string>);

  const workers = latest.map((sample) => {
    const ageMs = vitalAgeMs(sample, now);
    const stale = ageMs > staleThresholdMs(sample.dataOrigin);
    const coreTempC = coreTemp[sample.workerId]?.tempC;
    // 톤은 관제 화면과 같은 합성이다 — 생체 판정에 끊김을 얹어 최소 caution.
    // ⚠ 구획 이탈(outside)은 아직 안 싣는다. 판정에 넣으려면 현장 좌표·반경까지 함께
    //   내려야 하는데 이번 화면 범위 밖이다. 넣을 때 `effectiveTone` 의 `outside` 로 준다.
    const status = workerStatus(sample, now, coreTempC);
    const tone = effectiveTone(status.tone, { stale });
    // 끊긴 작업자의 값은 비운다 — 낡은 값을 현재값처럼 보이면 false-OK 가 된다.
    const vitals = gateStaleVitals(sample, stale);
    return {
      workerId: sample.workerId,
      name: names[sample.workerId] ?? sample.workerName ?? sample.workerId,
      jobTitle: profiles[sample.workerId] ?? null,
      tone,
      // 라벨도 화면과 같은 것을 쓴다 — 끊겼으면 사유가 상태를 대신한다.
      label: stale ? disconnectMetric(false) : status.label,
      staleLabel: stale ? STALE_LABEL[staleKind(sample, now, sample.dataOrigin)] : null,
      heartRate: vitals.heartRate ?? null,
      spo2: vitals.spo2 ?? null,
      skinTempC: vitals.skinTempC ?? null,
      coreTempC: coreTempC ?? null,
      // 착용 표식 — 서버 병합이 sticky 로 들고 있다. 끊김과 별개 축이라 게이트를 안 태운다.
      worn: typeof sample.worn === "boolean" ? sample.worn : null,
      lastSeenAt: sample.ts,
      ageSec: Math.round(ageMs / 1000),
      stale,
      ...(EXPOSE_PII && sample.latitude != null && sample.longitude != null
        ? {
            latitude: sample.latitude,
            longitude: sample.longitude,
            locationAccuracyMeters: sample.locationAccuracyMeters ?? null,
          }
        : {}),
    };
  });

  return NextResponse.json({
    ok: true,
    now: new Date(now).toISOString(),
    // 이상 인원은 서버가 센다 — 폰이 따로 세면 같은 화면에서 두 숫자가 갈린다.
    counts: {
      total: workers.length,
      danger: workers.filter((w) => w.tone === "danger").length,
      caution: workers.filter((w) => w.tone === "caution").length,
      stale: workers.filter((w) => w.stale).length,
    },
    workers,
    piiRedacted: !EXPOSE_PII,
  });
}
