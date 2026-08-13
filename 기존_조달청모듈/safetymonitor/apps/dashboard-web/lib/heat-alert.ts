// 온열 예방 알림(온열 ③) — 단계 판정·전이 결정·텔레그램 문구. 순수 함수(I/O·시계 없음).
//
// 사용자 결정(2026-08-13): ① 주의+경고 텔레그램 발송(기존 단체방) ② 경고 시 안전 신호등 주의
// 점등(단, 생체 판정 workerStatus/overallStatus 는 여전히 미주입 — 통제된 예외는 신호등 톤 합성뿐)
// ③ **텔레그램 문구에 생체 수치 미포함**(체온·심박 등) — 민감정보(건강)의 국외 SaaS 이전을
// 이벤트 사실 통지 수준으로 제한(SEC-PRIV-01 절충과 동일 선). 수치는 관제웹(국내)에서 확인.
//
// 단계 정의(보수적 시작값 — 현장 실측 정답 없이 정한 값·실운영 관찰 후 조정):
//   주의(caution) = 추정 심부체온 37.8℃ 이상 10분 지속
//   경고(warning) = 38.0℃ 이상 10분 지속 + 저활동·고심박 패턴 동시(쉬는데 심박이 안 내려옴)
// 근거 — 38.0℃ = ACGIH 미순응자 작업 중지선. "지속"과 "패턴 동시"는 추정 오차(±0.3℃)發
// 단발 오경보 필터. 상승 추세(+0.8℃/h) 조건은 v1 제외(오경보 방향 리스크 — 후속 검토).

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
 * 워커 1명의 추정 체온 궤적 + 저활동·고심박 패턴 여부 → 온열 단계.
 * null = 정상 또는 판단 불가(추정점 부족) — 둘 다 알림 없음이 안전한 방향이다
 * (점 부족 = 미착용·수신 공백이고, 그건 온열이 아니라 연결 문제로 이미 따로 표시된다).
 */
export function evaluateHeatStage(
  series: HeatTempPoint[],
  heatPatternFlagged: boolean,
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
  if (minTemp >= HEAT_WARNING_TEMP_C && heatPatternFlagged) return "warning";
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
      ? "온열 경고 단계 — 휴식 중에도 회복되지 않는 상태, 즉시 확인 조치 필요"
      : "온열 주의 단계 도달 — 관제웹에서 상세 확인";
  return [
    `${head} ${who}`,
    body,
    HEAT_ADVICE[input.stage],
    "※ 심박 기반 추정 — 의료 판정 아님",
  ].join("\n");
}
