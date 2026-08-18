// 온열 예방 알림(온열 ③) — 단계 판정·전이 결정·텔레그램 문구. 순수 함수(I/O·시계 없음).
//
// 사용자 결정(2026-08-13): ① 주의+경고 텔레그램 발송(기존 단체방) ② 경고 시 안전 신호등 주의
// 점등(단, 생체 판정 workerStatus/overallStatus 는 여전히 미주입 — 통제된 예외는 신호등 톤 합성뿐)
// ③ **텔레그램 문구에 생체 수치 미포함**(체온·심박 등) — 민감정보(건강)의 국외 SaaS 이전을
// 이벤트 사실 통지 수준으로 제한(SEC-PRIV-01 절충과 동일 선). 수치는 관제웹(국내)에서 확인.
//
// 단계 정의(보수적 시작값 — 현장 실측 정답 없이 정한 값·실운영 관찰 후 조정):
//   주의(caution) = 추정 심부체온 37.8℃ 이상 10분 지속
//   경고(warning) = 38.0℃ 이상 10분 지속
// 근거 — 38.0℃ = ACGIH 미순응자 작업 중지선. "지속"(10분 + 창 내 최소 8점)이 추정 오차(±0.3℃)發
// 단발 오경보를 거른다. 상승 추세(+0.8℃/h) 조건은 v1 제외(오경보 방향 리스크 — 후속 검토).
//
// ★★ 2026-08-18 — 경고에서 "저활동·고심박 패턴 동시" 요건을 **제거했다**(문헌 검토 조치 B-1a).
// 그 요건이 경고를 **구조적으로 발동 불가**하게 만들고 있었다. 패턴의 저활동 임계는 분당 1.5 kcal
// 인데 실측 하한이 **2.40**(08-13 이후 심박 커버 ≥10분인 온전한 분 2,067개 · 임계 이하 **0개**)이라
// 어떤 15분 창 평균도 임계 이하가 될 수 없다. 원인은 우리 코드가 아니라 상시 `HKWorkoutSession`
// 이다 — 애플이 하루 종일을 "운동 중"으로 간주해 앉아 있어도 활동에너지를 시간당 약 288 kcal 로
// 산출한다(건강 앱 대조 검산 완료). 상시 워크아웃은 폰 강제종료·잠금 생존의 핵심 장치라 못 뺀다.
// 실측·근거 = `lib/heat-pattern.ts` 상수 주석 · `docs/heat-activity-axis/checklist.md`.
//
// ⚠ **확증 조건이 없는 잠정형이다.** 남은 필터는 "10분 지속" 하나뿐인데, 추정 심부체온이 가장
// 약한 구간이 하필 37.75~38.5℃ 시작점이다(문헌 검토 조치 B). 후속으로 **활동 축을 교체한 확증
// 조건**(심박 주 · 걸음/정지 배제 = B-1b)을 다시 붙이기로 돼 있다 — `docs/heat-activity-axis/` §2.
//
// (참고 — 2026-08-18 서버 로그 전수에서 `[heat-alert]` 발사는 **0건**이다. 경고뿐 아니라 주의도
//  한 번도 임계에 닿은 적이 없다. 즉 이 변경으로 당장 알림이 늘지 않는다. 바뀌는 것은
//  "실제 온열 사건이 왔을 때 격상 경로가 존재하는가" 다.)

import { maskWorkerName } from "./telegram";

export const HEAT_CAUTION_TEMP_C = 37.8;
export const HEAT_WARNING_TEMP_C = 38.0;
/** 지속 판정 창(분) — 창 안의 모든 추정점이 임계 이상이어야 한다. */
export const HEAT_SUSTAIN_MINUTES = 10;
/** 창 내 최소 추정점 수(1분 버킷 기준) — 미만이면 판단 불가(수신 공백을 지속으로 오독 방지). */
export const HEAT_MIN_POINTS = 8;

export type HeatStage = "caution" | "warning";
export type HeatTempPoint = { tsMs: number; tempC: number };

const STAGE_RANK: Record<string, number> = { normal: 0, caution: 1, warning: 2 };

/**
 * 워커 1명의 추정 체온 궤적 → 온열 단계.
 * null = 정상 또는 판단 불가(추정점 부족) — 둘 다 알림 없음이 안전한 방향이다
 * (점 부족 = 미착용·수신 공백이고, 그건 온열이 아니라 연결 문제로 이미 따로 표시된다).
 *
 * ⚠ 패턴 인자를 다시 넣지 말 것 — 위 헤더의 B-1a 근거 참조. 확증을 되살릴 때는 활동에너지가
 * 아니라 교체된 축(B-1b)으로 붙인다.
 */
export function evaluateHeatStage(
  series: HeatTempPoint[],
  nowMs: number,
): HeatStage | null {
  const fromMs = nowMs - HEAT_SUSTAIN_MINUTES * 60_000;
  let count = 0;
  let minTemp = Infinity;
  for (const p of series) {
    if (!Number.isFinite(p.tsMs) || p.tsMs < fromMs || p.tsMs > nowMs) continue;
    if (!Number.isFinite(p.tempC)) continue;
    count += 1;
    if (p.tempC < minTemp) minTemp = p.tempC;
  }
  if (count < HEAT_MIN_POINTS) return null;
  if (minTemp >= HEAT_WARNING_TEMP_C) return "warning";
  if (minTemp >= HEAT_CAUTION_TEMP_C) return "caution";
  return null;
}

/**
 * 전이 결정 — 발송할 통지와 저장할 다음 상태를 돌려준다(env_alert_state 재사용·prev 는 upsert 반환값).
 *  - 악화 전이(normal→caution·caution→warning 등)만 해당 단계 발송.
 *  - 호전(warning→caution)은 무발송·상태만 갱신 — 이후 재악화 시 warning 재발송이 가능해진다.
 *  - 해제(단계→normal)는 이전에 발송된 단계가 있을 때만 "해제" 1건.
 *  - 동일 단계 유지는 무발송(같은 단계 반복 발송 없음 — 경보 피로 방지).
 */
export function decideHeatNotify(
  prev: string | null,
  next: HeatStage | null,
): { notify: HeatStage | "cleared" | null; nextState: "normal" | HeatStage } {
  const prevRank = STAGE_RANK[prev ?? "normal"] ?? 0;
  const nextState = next ?? "normal";
  const nextRank = STAGE_RANK[nextState] ?? 0;
  if (nextRank > prevRank) return { notify: next, nextState };
  if (nextRank < prevRank && nextState === "normal" && prevRank > 0) {
    return { notify: "cleared", nextState };
  }
  return { notify: null, nextState };
}

// ── 텔레그램 문구 (★ 생체 수치 미포함 — 아래 문자열에 ℃·bpm·kcal 값을 넣지 않는다) ──────────

const HEAT_ADVICE: Record<HeatStage, string> = {
  caution: "권고: 그늘 휴식 10분 + 수분 섭취 (물·그늘·휴식)",
  warning: "권고: 즉시 그늘 이동·냉각·수분 공급, 작업자 상태 직접 확인",
};

/**
 * 온열 알림 본문 — 단계 사실 + 행동 요령만. 수치(체온·심박)는 의도적으로 받지 않는다
 * (시그니처에 없어야 실수로도 못 싣는다 — 가드 테스트가 이 경계를 고정).
 */
export function formatHeatMessage(input: {
  stage: HeatStage | "cleared";
  workerId: string;
  workerName?: string | null;
}): string {
  const masked = input.workerName ? maskWorkerName(input.workerName) : null;
  const who = masked ? `${masked} (${input.workerId})` : input.workerId;
  if (input.stage === "cleared") {
    return [`✅ [온열 해제] ${who}`, "정상 범위 복귀 — 조치 결과 기록 권장"].join("\n");
  }
  const head = input.stage === "warning" ? "🚨 [온열 경고]" : "⚠️ [온열 주의]";
  const body =
    input.stage === "warning"
      // ⚠ "휴식 중에도 회복되지 않는다"고 단언하지 않는다 — 그 확증(저활동·고심박 동반)은
      // 2026-08-18 B-1a 로 제거됐고, 지금 검증하는 것은 **지속**뿐이다. 걷는 중이든 쉬는 중이든
      // 임계를 10분 넘으면 이 문구가 나간다. 검증하지 않는 것을 알림이 주장하면, 받는 사람이
      // "쉬는데도 안 내려간 상태" 로 읽고 판단을 그 위에 얹는다.
      ? "온열 경고 단계 — 추정 심부체온이 경고 기준 이상으로 10분 지속(활동 여부는 미판정). 즉시 확인 조치 필요"
      : "온열 주의 단계 도달 — 관제웹에서 상세 확인";
  return [
    `${head} ${who}`,
    body,
    HEAT_ADVICE[input.stage],
    "※ 심박 기반 추정 — 의료 판정 아님",
  ].join("\n");
}
