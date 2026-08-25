// 작업자 본인 파생 지표 조회 — 폰 앱 전용. 서버만 낼 수 있는 값(추정 체온·PSI·스트레스·누적)만 준다.
//
// ★★ 관제 조회(`GET /api/monitor/vital`)를 폰에 열지 않은 이유가 이 파일의 존재 이유다.
// 그쪽 인가는 `verifyBasicAuth`(관제 세션·오너 자격)이고 응답은 **전 작업자 + PII** 다.
// 거기에 앱 JWT 를 통과시키면 작업자 폰이 동료 전원의 생체를 보게 된다 — 권한 범위가 뒤집힌다.
//
// ★ 스코프는 **서명된 클레임에서만** 읽는다. `?workerId=` 로 받으면 남의 사번을 넣어 조회할 수
// 있다. 수집 라우트가 같은 이유로 `bodyIsBoundToWorker(body, claims.workerId)` 를 강제한다.
// 계정 전환은 토큰 교체만으로 반영된다 — 로그인이 서버가 뽑은 사번을 서명해 넣기 때문이다
// (`app-login.ts` → `storedEmployeeId || EMP-<username>`).
import { NextResponse } from "next/server";

import { computeStressIndex, stressInputsFromSample } from "@safetymonitor/analyzers";

import {
  bearerToken,
  bootstrapOwnerWorkerId,
  diagnoseAppAuth,
  verifyAppJwt,
} from "../../../../../lib/app-jwt";
import { latestRestingHeartRate, recentSamplesForWorkers } from "../../../../../lib/db";
import { computePsi } from "../../../../../lib/psi";
import { vitalAgeMs, staleThresholdMs } from "../../../../../lib/vital-age";
import { gateStaleVitals } from "../../../../../lib/worker-signal";
import {
  coreTempEstimates,
  countsByWorker,
  mergeLatestByWorker,
  workerAliases,
} from "../../vital/store";

export const dynamic = "force-dynamic";

/** 실패한 조회는 `null` 로 비운다. **0 을 쓰지 않는다** — 누적 0 은 "한 건도 없다"로 읽힌다. */
async function softly<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[me/vitals] ${label} 조회 실패 — 값 생략`, e);
    return null;
  }
}

export async function GET(request: Request) {
  const claims = verifyAppJwt(bearerToken(request));
  if (!claims?.workerId) {
    // 사유는 서버 로그로만 남긴다(응답에 넣으면 서명 성공 여부가 외부로 샌다) — 수집 라우트와 같은 규칙.
    const d = diagnoseAppAuth(request, { requireWorkerId: true });
    console.warn(`[me/vitals] ${d.logLine}`);
    return NextResponse.json(
      { ok: false, error: "유효하지 않은 토큰", action: d.action },
      { status: 401 },
    );
  }

  // env owner(부트스트랩 자격)는 사번이 `owner-<sha16>` 합성 ID 라 **생체가 영영 없다.**
  // 누적을 0 으로 주면 "수집됐는데 0 건" 으로 읽히므로 대상 아님을 따로 알린다.
  // 접두사를 여기서 비교하지 않고 **생성 함수로 재계산해 대조**한다 — 규칙이 두 벌이 되지 않게.
  let isBootstrapOwner = false;
  try {
    isBootstrapOwner = claims.workerId === bootstrapOwnerWorkerId(claims.sub);
  } catch {
    isBootstrapOwner = false;
  }
  if (isBootstrapOwner) {
    return NextResponse.json({
      ok: true,
      workerId: claims.workerId,
      applicable: false, // 생체 수집 대상 계정이 아니다 — 화면은 '해당 없음'
      coreTemp: null,
      psi: null,
      stress: { calibrating: true, index: null },
      totalPersisted: null,
    });
  }

  // ★ 관제웹과 **같은 접기**를 쓴다. 안 하면 EMP-admin6861 과 EMP-6861 이 따로 세어져
  //   폰 누적과 관제 누적이 갈린다(2026-08-12 에 실제로 겪은 형태).
  const aliasMap = await softly("별칭", workerAliases);
  const aliases = aliasMap ?? {};
  const me = aliases[claims.workerId] ?? claims.workerId;

  const [coreMap, countMap] = await Promise.all([
    softly("추정 체온", () => coreTempEstimates(aliases)),
    softly("누적 건수", () => countsByWorker(aliases)),
  ]);

  // 최신 샘플 — 스트레스·PSI 의 입력.
  //
  // ★ 메모리 링(`latestByWorker`)을 쓰지 않는다. 그건 **그 프로세스가 받은 POST** 만 담고 있어
  //   `maxScale=4` 에서 폰이 자기 샘플을 못 받은 인스턴스에 붙으면 값이 통째로 사라진다
  //   (2026-08-18 실측: 최근 1시간 인스턴스 2개). 한 사람만 보는 화면이라 관제보다 치명적이다.
  //   DB 에서 되살린 뒤 **관제와 같은 병합 함수**를 태워 값이 갈리지 않게 한다.
  //
  // 별칭 형제까지 모아서 조회한다 — EMP-admin6861 로 들어온 과거 행이 EMP-6861 에 접힌다.
  const siblings = [me, ...Object.keys(aliases).filter((raw) => aliases[raw] === me)];
  // 창은 180분 — 추정 체온과 같은 시간 기준이고, 안정심박·HRV 처럼 **드물게 오는 값**까지
  // 담아야 관제 화면과 같은 sticky 병합 결과가 나온다(30분이면 안정심박을 놓쳐 PSI 기준 심박이
  // 문헌 기본값 60 으로 떨어진다 — 2026-08-18 실측에서 실제로 갈렸다).
  const [rows, restingHr] = await Promise.all([
    softly("최근 샘플", () => recentSamplesForWorkers(siblings, 180)).then((r) => r ?? []),
    // 안정 심박만 창을 길게 본다 — 하루 단위 기준값이라 며칠 전 값도 그 사람의 기준으로 유효하다.
    // HRV·호흡수는 그 순간의 상태 지표라 같은 취급을 하지 않는다(위 180분 창에 맡긴다).
    softly("안정 심박", () => latestRestingHeartRate(siblings)),
  ]);
  const merged = mergeLatestByWorker(rows, aliases).find(
    (s) => (aliases[s.workerId] ?? s.workerId) === me,
  );

  // ★ 신선도 게이트 — 관제 화면과 **같은 함수**(심박 측정 시각 · 출처별 문턱).
  //   문턱을 여기 따로 적지 않는다 — 두 곳에 적으면 갈리고, 갈리면 같은 순간에 폰과 관제가
  //   서로 다른 말을 한다. 값과 근거는 lib/vital-age.ts (애플 60초 · 갤럭시 150초).
  //   sticky 병합은 마지막 실측값을 유지하므로, 게이트 없이는 워치를 벗어도 3시간 전 심박으로
  //   PSI·스트레스를 계산해 "지금 내 상태" 로 보여준다. 이 화면은 한 사람만 보므로 특히 나쁘다.
  //   ⚠ 관제 화면은 스트레스 칩에 이 게이트를 안 건다 — 끊긴 뒤 값이 갈릴 수 있고, 그때
  //   폰은 **아무것도 안 그린다**. 틀린 숫자보다 빈 자리가 낫다는 쪽을 택했다.
  const stale =
    merged === undefined ||
    vitalAgeMs(merged, Date.now()) >= staleThresholdMs(merged.dataOrigin);
  const shown = gateStaleVitals(merged, stale);
  const sample = stale ? undefined : merged;

  const coreTempC = coreMap?.[me]?.tempC ?? null;
  const psi = computePsi({
    coreTempC,
    heartRate: shown.heartRate,
    // 창 안에 있으면 그것을, 없으면 길게 본 기준값을. 둘 다 없으면 문헌 기본값(60)으로 떨어진다.
    restingHeartRate: sample?.restingHeartRate ?? restingHr?.bpm,
  });
  const stress = computeStressIndex(stressInputsFromSample(sample ?? {}));

  return NextResponse.json({
    ok: true,
    workerId: me,
    applicable: true,
    // 추정 체온 — 워밍업(30분) 미달이면 서버가 아예 안 만든다. 그때는 null 이 정직하다.
    coreTemp: coreMap?.[me]
      ? { tempC: coreMap[me].tempC, basisMinutes: coreMap[me].basisMinutes }
      : null,
    // PSI 는 추정 체온 파생이라 체온이 없으면 자동으로 null 이다(computePsi 계약).
    psi: psi ? { value: psi.value, personalized: psi.personalized } : null,
    // 보정 중(신호 없음)은 값이 아니라 상태다 — 0 으로 떨어뜨리지 않는다.
    stress: stress.calibrating
      ? { calibrating: true, index: null }
      : { calibrating: false, index: stress.index, level: stress.level },
    // DB 조회가 실패하면 null(화면 `--`). 0 으로 주면 "수집된 적 없음" 이 된다.
    totalPersisted: countMap ? (countMap[me] ?? 0) : null,
  });
}
