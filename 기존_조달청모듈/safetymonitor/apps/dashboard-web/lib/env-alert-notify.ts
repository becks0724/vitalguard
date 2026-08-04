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
//
// ★ 발송·건너뜀을 반드시 로그로 남긴다(L-35). 전에는 텔레그램을 쏘고 끝이라 "무엇을 왜 보냈는지"가
// 아무 데도 남지 않았고, DB 에는 severity 만 있어 사후 추적이 불가능했다. 그래서 오알림 2건을
// 17시간 뒤에야 **다른 작업의 라이브 검증 중 우연히** 발견했다(D-25). 판정 로직은 언제든 틀릴 수
// 있고, 관측이 없으면 틀린 것을 알 방법이 없다.
//
// ⚠️ 전이가 없어 안 보낸 건은 남기지 않는다 — 유형 11종 × 5분 폴링이라 로그가 도배된다.
// ⚠️ detail 은 첫 줄(시각·지역)만 — 본문 전문에는 개인정보가 섞일 수 있다(D-10).
export async function notifyEnvAlerts(items: EnvAlertItem[]): Promise<void> {
  for (const item of items) {
    let prev: string | null;
    try {
      prev = await upsertEnvAlertState(item.itemKey, item.severity);
    } catch (e) {
      // 조용한 skip 은 "알림이 왜 안 갔는지" 를 사후에 알 수 없게 만든다.
      console.error(
        `[env-alert] 상태 저장 실패 — ${item.itemKey} 알림 건너뜀. ${(e as Error).message}`,
      );
      continue;
    }
    const prevSev: RuleSeverity | null =
      prev === "caution" || prev === "danger" || prev === "normal" ? prev : null;
    if (!shouldSendEnv(prevSev, item.severity)) continue;

    const result = await sendTelegramMessage(formatEnvAlertMessage(item));
    const where = (item.detail ?? "").split("\n")[0] ?? "";
    const line = `[env-alert] ${item.itemKey} ${prevSev ?? "none"}→${item.severity} · ${item.currentValue}${where ? ` · ${where}` : ""}`;
    if (result === "sent") console.log(`${line} · 발송됨`);
    else if (result === "skipped") console.warn(`${line} · 미발송(텔레그램 미배선)`);
    else console.error(`${line} · 발송 실패`);
  }
}
