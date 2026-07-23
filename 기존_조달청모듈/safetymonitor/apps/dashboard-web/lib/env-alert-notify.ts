// 현장환경(날씨·기상특보) 위험을 텔레그램으로 발송 — 악화 전이(주의/위험)일 때만 1회.
// /api/weather·/api/kma-warning 라우트가 fresh 데이터 시점에 호출(브라우저 연동, 별도 cron 없음).

import { upsertEnvAlertState } from "./db";
import { sendTelegramMessage } from "./telegram";
import type { RuleEvaluation, RuleSeverity } from "./weather-rules";

export type EnvAlertItem = {
  itemKey: string;
  itemLabel: string;
  currentValue: string;
  severity: RuleSeverity;
  detail?: string;
};

const SEV_RANK: Record<RuleSeverity, number> = { normal: 0, caution: 1, danger: 2 };
const SEV_EMOJI: Record<RuleSeverity, string> = { normal: "🟢", caution: "🟡", danger: "🔴" };
const SEV_LABEL: Record<RuleSeverity, string> = { normal: "정상", caution: "주의", danger: "위험" };

// 발송 임계 = 주의(1) 이상. 사용자 결정: 주의+위험 발송.
const SEND_THRESHOLD = SEV_RANK.caution;

// 발송 여부 — 주의 이상이면서 이전 발송 severity 보다 악화(전이)됐을 때만. 이전 없음(null)=정상 취급.
export function shouldSendEnv(prev: RuleSeverity | null, next: RuleSeverity): boolean {
  return SEV_RANK[next] >= SEND_THRESHOLD && SEV_RANK[next] > SEV_RANK[prev ?? "normal"];
}

// weather-rules 의 RuleEvaluation → 발송 항목. 임계 단계가 걸리면 라벨·조치를 detail 로.
export function ruleEvalToItem(e: RuleEvaluation): EnvAlertItem {
  return {
    itemKey: e.itemKey,
    itemLabel: e.itemLabel,
    currentValue: e.currentValue,
    severity: e.currentSeverity,
    detail: e.currentStep ? `${e.currentStep.label} · ${e.currentStep.action}` : e.notes,
  };
}

// 텔레그램 본문(순수 함수) — 이모지·심각도·항목·현재값·조치.
export function formatEnvAlertMessage(item: EnvAlertItem): string {
  const lines = [
    `${SEV_EMOJI[item.severity]} 현장환경 ${SEV_LABEL[item.severity]} — ${item.itemLabel}`,
    `현재 ${item.currentValue}`,
  ];
  if (item.detail) lines.push(item.detail);
  return lines.join("\n");
}

// 각 항목 상태를 갱신하고, 악화 전이(주의+)인 것만 텔레그램 발송. 한 항목 실패가 나머지를 막지 않는다.
export async function notifyEnvAlerts(items: EnvAlertItem[]): Promise<void> {
  for (const item of items) {
    let prev: string | null;
    try {
      prev = await upsertEnvAlertState(item.itemKey, item.severity);
    } catch {
      continue; // 상태 저장 실패 — 이 항목 건너뜀
    }
    const prevSev: RuleSeverity | null =
      prev === "caution" || prev === "danger" || prev === "normal" ? prev : null;
    if (shouldSendEnv(prevSev, item.severity)) {
      await sendTelegramMessage(formatEnvAlertMessage(item));
    }
  }
}
