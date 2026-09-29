// 생체 경보 팝업·문자가 「그 위험 값을 언제 쟀나」를 고른다 — 표본이 도착한 시각(ts)과 산소포화도를 잰 시각은 최대 30분 벌어진다.
//
// ★ 2026-09-29 경보 14212 — 팝업이 「위험 감지 시각 09:13:22」 를 띄웠는데 그 시각 표본에는 산소포화도가
//   없었다. 86% 는 09:05:38 에 잰 값이 신선도 30분(`spo2-freshness.ts`) 동안 최신 카드에 겹쳐 보인 것이다.
//   관제자는 8분 전 값을 방금 잰 값으로 읽고, 보호자·119 문자에도 측정 시각 없이 실렸다.

type MeasuredCarrier = {
  ts: string;
  spo2MeasuredAt?: string | null;
  heartRateMeasuredAt?: string | null;
};

/**
 * 위험 값의 측정 시각(ISO). 산소포화도가 위험이면 그 측정 시각을 먼저 쓴다 — 심박은 표본마다 새로 실리지만
 * 산소포화도는 최대 30분 전 값이 겹쳐 보일 수 있다. 측정 시각이 없는 옛 표본은 종전처럼 `ts`.
 */
export function dangerMeasuredAt(
  sample: MeasuredCarrier,
  danger: { spo2: boolean; hr: boolean },
): string {
  if (danger.spo2 && sample.spo2MeasuredAt) return sample.spo2MeasuredAt;
  if (danger.hr && sample.heartRateMeasuredAt) return sample.heartRateMeasuredAt;
  return sample.ts;
}

const KST_CLOCK = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 한국 시각 「HH:mm」 — 문자·칸 주석용. 문자는 받는 쪽이 읽으므로 브라우저 시간대와 무관하게 KST 로 고정. 파싱 실패 시 null. */
export function kstClock(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return KST_CLOCK.format(new Date(t));
}
