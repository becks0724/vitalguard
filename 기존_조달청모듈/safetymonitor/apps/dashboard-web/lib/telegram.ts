// 관제 알림(SOS/낙상/생체/구획이탈)을 텔레그램 봇으로 전송하는 클라이언트(의존성 0 — fetch만).
// TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 미설정 시: no-op(로컬·미배선 환경에서 안전). 전송 실패는 삼켜 alert 기록을 막지 않는다.

import type { AlertType } from "./alert-type";

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
  // 감시 공백은 경과 시간·사후 판정이 들어가야 해서 본문을 `lib/absence-watch.ts` 가 따로 만든다.
  // 이 라벨은 공용 포맷으로 흘렀을 때의 안전망이다(그 경로로는 안 보내는 것이 정상).
  absence: "📵 생체 수신 없음",
};

// ISO → KST "MM-DD HH:mm:ss". 파싱 실패 시 원본 반환.
function formatKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}:${p(k.getUTCSeconds())}`;
}

// 이름 마스킹 — 2자는 끝 글자, 3자 이상은 가운데를 ○ 로 가린다. 1자·공백은 마스킹 불능이라 생략.
export function maskWorkerName(name: string): string | null {
  const n = name.trim();
  if (n.length < 2) return null;
  if (n.length === 2) return `${n[0]}○`;
  return `${n[0]}${"○".repeat(n.length - 2)}${n[n.length - 1]}`;
}

// 텔레그램 전송 본문 — 순수 함수(테스트 가능). 종류·작업자·발생시각.
// 실명 원문은 싣지 않는다(감사 SEC-PRIV-01) — 텔레그램은 국외 SaaS 라 실명+건강상태 조합이
// 민감정보 국외이전이 된다. 2026-08-12 사용자 결정으로 **마스킹 이름 + 사번**("장○진 (EMP-6861)")
// 절충 표기를 채택 — 식별성은 얻고 실명 원문 이전은 피한다. 실명 확인은 관제웹(국내 시스템)에서.
export function formatAlertMessage(input: AlertNotifyInput): string {
  const label = ALERT_LABEL[input.type] ?? input.type;
  const masked = input.workerName ? maskWorkerName(input.workerName) : null;
  const who = masked ? `${masked} (${input.workerId})` : input.workerId;
  return [`${label}`, `작업자 ${who}`, `발생 ${formatKst(input.ts)}`].join("\n");
}

// ── 구획이탈 일일 통지 상한(2026-08-31 사용자 결정) ────────────────────────────
// 원장(alerts 테이블)은 상한과 무관하게 전부 남는다 — 상한은 **텔레그램 통지에만** 건다.
// 근거: 08-30 같은 이탈 1건이 79건 통지된 연발. 원인(크론 되짚기 창의 exitTs 표류)은
// 따로 수술했고(geofence-check 에피소드 규칙), 이 상한은 경계 왕복·다중 기기 얽힘 같은
// 변종의 최종 안전망이다. 미착용 연동은 채택하지 않았다 — 판별이 이번 사건을 못 잡았고
// (still 0~2초), 벗음 의심은 "라벨만" 계약(가드 2건)이라 경보 경로에 넣지 않는다.
/** 작업자당 하루(KST) 구획이탈 텔레그램 상한. */
export const GEOFENCE_NOTIFY_DAILY_CAP = 3;
/** 상한 도달(3회째) 꼬리 — 이후의 침묵을 예고해 관제자가 채널 고장으로 오해하지 않게 한다. */
export const GEOFENCE_NOTIFY_CAP_TAIL =
  "오늘 이 작업자의 구획 이탈 알림은 여기까지 — 이후는 관제웹에서 확인";

// 발송 결과 — 호출부가 "보냈다/못 보냈다" 를 로그로 남길 수 있게 돌려준다.
// 전에는 void 라 실패도 미배선도 호출부에서 구별할 수 없었다(L-35).
export type TelegramSendResult = "sent" | "skipped" | "failed";

// 텔레그램 임의 텍스트 전송(공용) — 미설정이면 no-op, 실패/타임아웃은 삼킨다(절대 throw 하지 않음).
// 작업자 알림(notifyAlertTelegram)·현장환경 알림(env-alert-notify) 이 공유한다.
export async function sendTelegramMessage(text: string): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return "skipped"; // 미배선 환경 — 던지지 않고 그 사실만 알린다

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(TELEGRAM_ENDPOINT(token), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[telegram] sendMessage 실패 (${res.status})`);
      return "failed";
    }
    return "sent";
  } catch (e) {
    // 네트워크/타임아웃 — 알림 전송 실패가 vital 수집·alert 기록을 막지 않도록 삼킨다.
    console.warn(`[telegram] sendMessage 예외 — ${(e as Error).message}`);
    return "failed";
  }
}

// 작업자 알림(SOS/낙상/생체/구획이탈) 전송. `extraLine` 은 본문 끝에 한 줄
// 덧붙인다(구획이탈 상한 도달 예고용) — formatAlertMessage 는 순수하게 두고 여기서만 조립한다.
export async function notifyAlertTelegram(input: AlertNotifyInput, extraLine?: string): Promise<void> {
  const body = formatAlertMessage(input);
  await sendTelegramMessage(extraLine ? `${body}\n${extraLine}` : body);
}
