// 관제 알림(SOS/낙상/생체/구획이탈/위험구역진입)을 텔레그램 봇으로 전송하는 클라이언트(의존성 0 — fetch만).
// TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 미설정 시: no-op(로컬·미배선 환경에서 안전). 전송 실패는 삼켜 alert 기록을 막지 않는다.

import type { AlertType } from "./db";

export type AlertNotifyInput = {
  workerId: string;
  workerName?: string | null;
  type: AlertType;
  ts: string; // ISO
};

const TELEGRAM_ENDPOINT = (token: string) => `https://api.telegram.org/bot${token}/sendMessage`;

const ALERT_LABEL: Record<AlertType, string> = {
  sos: "🆘 SOS 긴급요청",
  fall: "🚨 낙상 감지",
  vital: "❤️ 생체 위험",
  geofence: "📍 현장 구획 이탈",
  danger_zone: "⛔ 위험구역 진입",
};

// ISO → KST "MM-DD HH:mm:ss". 파싱 실패 시 원본 반환.
function formatKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}:${p(k.getUTCSeconds())}`;
}

// 텔레그램 전송 본문 — 순수 함수(테스트 가능). 종류·작업자·발생시각.
export function formatAlertMessage(input: AlertNotifyInput): string {
  const label = ALERT_LABEL[input.type] ?? input.type;
  const name = input.workerName?.trim();
  const who = name ? `${name} (${input.workerId})` : input.workerId;
  return [`${label}`, `작업자 ${who}`, `발생 ${formatKst(input.ts)}`].join("\n");
}

// 텔레그램 알림 전송. 미설정이면 no-op, 실패/타임아웃은 삼킨다(절대 throw 하지 않음).
export async function notifyAlertTelegram(input: AlertNotifyInput): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // 미배선 환경 — 조용히 통과

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(TELEGRAM_ENDPOINT(token), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatAlertMessage(input),
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[telegram] sendMessage 실패 (${res.status})`);
    }
  } catch {
    // 네트워크/타임아웃 — 알림 전송 실패가 vital 수집·alert 기록을 막지 않도록 삼킨다.
  }
}
