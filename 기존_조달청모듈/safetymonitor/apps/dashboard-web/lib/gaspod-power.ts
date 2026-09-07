// 가스포드(gaspod-01) 전원 상태 판정 — vbat 시계열(5초 표본)만으로 충전/방전/USB단독/임박을 가른다.
//
// 왜 필요한가(2026-09-07 실측, 라이브 DB gaspod_telemetry):
//   · 11:23 켬(4.08V) → 14:46 **3.69~3.70V 에서 죽음**(마지막 10초 3.76→3.70→3.69 급락). 펌웨어의
//     3.2V 경고·3.0V 종료는 한 번도 오지 않았다 — 분압·ADC 스케일 또는 부스트 컷오프가 그 전에 죽인다.
//   · 그런데 화면은 vbatToPercent(=0% 를 3.0V 로 가정) 라서 **죽는 순간 약 63% 로 보였다.**
//   · 15:55 벽 어댑터(45W) 접속 → **즉시 +0.34V**(3.70→4.03) 뒤 +0.009V/min 상승. 충전 중엔 셀 전압에
//     I·R 상승분이 얹혀 %가 과대(4.05V=96%로 표시) → 충전 중엔 %가 아니라 "충전 중"을 보여야 한다.
//   · 방전 기울기 −0.114V/h(3.4h 평균). 분 단위 min/max 폭 최대 0.15V(히터·WiFi 부하 스파이크) —
//     단일 표본으로 판정하면 안 되고 5분 중앙값 + 10분 회귀 기울기로 본다.
//   · 4.25V 이상 = 배터리 스위치 OFF·USB 단독 급전(2026-08-03 실측 판별법).
//
// 문턱값 출처: 실측 5개(USB_ONLY_V·DEAD_V·CONNECT_JUMP_V·DISCHARGE_SLOPE·CV_V)는 측정에서 직접,
// 잠정 1개(CHARGE_SLOPE)는 16:00 구간(+0.009V/min)의 절반. 신 DB 가 서면 같은 규칙을
// gas_reading.vbat_v 위 SQL 함수로 옮긴다(062 파생).
//
// ★ 2026-09-07 17:27 라이브 오판과 그 수리 — 45W 어댑터에 물린 채로 화면이 **"100% · 약 9h"(방전)**
//   를 띄웠다. 표본 4,000건(400h) 재측정으로 원인이 둘로 갈렸다:
//     ① CV 평탄값이 실측 **4.130~4.140V** 인데 CV_V 를 4.15 로 잡아 두어 만충 가지에 **영영 못 들어갔다**.
//     ② 저전압 스파이크(분중앙 대비 −0.05V↓)가 **5.92%**(237/4,000) 섞이고, 최소제곱(OLS)은 이상치에
//        끌려간다 — 같은 10분에서 OLS −0.00105 vs 1분중앙 OLS +0.00030 vs Theil–Sen **0.00000**.
//        OLS 만 방전 문턱(−0.001)을 넘었다. 그래서 기울기를 **1분 중앙값 다운샘플 + Theil–Sen**
//        (쌍별 기울기의 중앙값 — 표본 절반이 오염돼도 버틴다)으로 바꿨다.
//
// 순수 함수 · 의존성 0 · 서버/클라이언트 어디서나. 상태 간 히스테리시스는 창(5분/10분) 자체가 준다 —
// 접속 점프만 즉시 반응(1분 중앙값 차이).

export type GaspodPowerState =
  | "usb_only" // 배터리 분리, USB 단독 급전
  | "charging" // 충전 중(접속 직후 점프 · 상승 기울기 · CV 구간)
  | "full_on_power" // 만충 근접·평탄 — 상시 전원에 물려 있음
  | "critical" // 방전 중이고 사망 전압에 근접(오늘 실측: 3.78→3.70 약 25분)
  | "discharging" // 배터리로 동작 중
  | "unknown"; // 표본 부족

export type GaspodPowerSample = { vbat: number; ts: string };

export type GaspodPower = {
  state: GaspodPowerState;
  label: string; // 화면용 한 줄
  vMed: number | null; // 5분 중앙값(V)
  slopeVpm: number | null; // 10분 회귀 기울기(V/min), 표본 부족이면 null
  jumpV: number | null; // 최근 1분 중앙값 − 그 이전 1분 중앙값
  percent: number | null; // 방전·임박일 때만. 실측 2점 보정(3.70=0%)
  remainingMin: number | null; // 방전 기울기 기준 사망까지 분. 기울기 없으면 null
  sampleCount: number;
};

export const GASPOD_POWER_THRESHOLDS = {
  USB_ONLY_V: 4.25, // 실측(08-03): 이 위는 셀이 아니라 충전기 출력
  DEAD_V: 3.7, // 실측(09-07): POST 가 멈춘 전압
  CRITICAL_V: 3.78, // 실측(09-07): 여기서 사망까지 약 25분
  CONNECT_JUMP_V: 0.15, // 실측(09-07): 접속 순간 +0.34V — 절반이면 충분
  CHARGE_SLOPE_VPM: 0.004, // 잠정: 16:00 구간 +0.009V/min 의 절반
  CV_V: 4.12, // 실측(09-07): 45W 어댑터 만충 플래토 4.130~4.140V(60분 분중앙값) 바로 아래
  FLAT_SLOPE_VPM: 0.001, // |slope| 이 이 아래면 평탄
  DISCHARGE_SLOPE_VPM: -0.001, // 실측 평균 −0.0019V/min 의 절반
  MEDIAN_WINDOW_MS: 5 * 60_000,
  SLOPE_WINDOW_MS: 10 * 60_000,
  MIN_SAMPLES: 12, // 5초 표본 1분치
  MIN_SLOPE_SAMPLES: 24, // 2분치는 있어야 기울기를 믿는다
} as const;

const T = GASPOD_POWER_THRESHOLDS;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// 기울기 (V/min) — **1분 중앙값으로 다운샘플한 뒤 Theil–Sen**.
//
// 왜 최소제곱이 아닌가: 이 기기의 5초 표본에는 히터·WiFi 부하 스파이크가 5.92% 섞이고(2026-09-07
// 실측 237/4,000), OLS 는 제곱오차라 그 이상치 쪽으로 끌려간다 — 평탄한 만충 구간을 방전으로 읽었다.
// 1분 버킷 중앙값이 먼저 스파이크를 죽이고, Theil–Sen(모든 쌍의 기울기 중앙값)이 남은 이상치까지
// 버틴다(붕괴점 ~29%). 버킷이 10개 안팎이라 쌍은 45개 남짓 — 폴링마다 계산해도 무시할 만하다.
function slopePerMin(pts: { tMs: number; v: number }[]): number | null {
  if (pts.length < T.MIN_SLOPE_SAMPLES) return null;

  // 1분 버킷 중앙값.
  const buckets = new Map<number, number[]>();
  for (const p of pts) {
    const k = Math.floor(p.tMs / 60_000);
    const b = buckets.get(k);
    if (b) b.push(p.v);
    else buckets.set(k, [p.v]);
  }
  const xs = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, vs]) => ({ x: k, y: median(vs)! }));
  // 두 점으로는 중앙값이 곧 그 쌍이라 이상치 내성이 없다 — 최소 3버킷.
  if (xs.length < 3) return null;

  // Theil–Sen: 모든 쌍 기울기의 중앙값. x 가 분 단위(버킷 인덱스)라 그대로 V/min.
  const slopes: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const dx = xs[j]!.x - xs[i]!.x;
      if (dx !== 0) slopes.push((xs[j]!.y - xs[i]!.y) / dx);
    }
  }
  return median(slopes);
}

export function gaspodPowerState(rows: GaspodPowerSample[], nowMs: number = Date.now()): GaspodPower {
  const pts = rows
    .map((r) => ({ tMs: Date.parse(r.ts), v: r.vbat }))
    .filter((p) => Number.isFinite(p.tMs) && Number.isFinite(p.v) && p.v > 0)
    .sort((a, b) => a.tMs - b.tMs);

  const inWindow = (ms: number) => pts.filter((p) => nowMs - p.tMs <= ms);
  const med5 = inWindow(T.MEDIAN_WINDOW_MS).map((p) => p.v);
  const base = { vMed: null, slopeVpm: null, jumpV: null, percent: null, remainingMin: null, sampleCount: pts.length };

  if (med5.length < T.MIN_SAMPLES) {
    return { ...base, state: "unknown", label: "수신 부족" };
  }

  const vMed = median(med5)!;
  const slopeVpm = slopePerMin(inWindow(T.SLOPE_WINDOW_MS));
  const last1 = median(pts.filter((p) => nowMs - p.tMs <= 60_000).map((p) => p.v));
  const prev1 = median(pts.filter((p) => nowMs - p.tMs > 60_000 && nowMs - p.tMs <= 120_000).map((p) => p.v));
  const jumpV = last1 != null && prev1 != null ? last1 - prev1 : null;

  const common = { vMed, slopeVpm, jumpV, sampleCount: pts.length };

  // 1. USB 단독 — 배터리 스위치 OFF. 어떤 %도 의미 없다.
  if (vMed >= T.USB_ONLY_V || (last1 != null && last1 >= T.USB_ONLY_V)) {
    return { ...common, state: "usb_only", label: "USB 전원 (배터리 분리)", percent: null, remainingMin: null };
  }
  // 2. 접속 점프 — 5분 중앙값이 따라오기 전에 1분 단위로 먼저 잡는다.
  if (jumpV != null && jumpV >= T.CONNECT_JUMP_V) {
    return { ...common, state: "charging", label: "충전 시작", percent: null, remainingMin: null };
  }
  // 3. 상승 기울기 또는 CV 구간(만충 근접에서 기울기는 거의 0 이 된다).
  if (slopeVpm != null && slopeVpm >= T.CHARGE_SLOPE_VPM) {
    return { ...common, state: "charging", label: "충전 중", percent: null, remainingMin: null };
  }
  if (vMed >= T.CV_V && slopeVpm != null) {
    return slopeVpm > -T.FLAT_SLOPE_VPM && slopeVpm < T.FLAT_SLOPE_VPM
      ? { ...common, state: "full_on_power", label: "충전 완료 · 상시 전원", percent: null, remainingMin: null }
      : slopeVpm >= -T.FLAT_SLOPE_VPM
        ? { ...common, state: "charging", label: "충전 중", percent: null, remainingMin: null }
        : discharging(common, vMed, slopeVpm);
  }
  // 4·5. 방전(평탄 포함) — 임박은 방전의 특수 경우.
  return discharging(common, vMed, slopeVpm);
}

function discharging(
  common: { vMed: number; slopeVpm: number | null; jumpV: number | null; sampleCount: number },
  vMed: number,
  slopeVpm: number | null,
): GaspodPower {
  const percent = vbatToPercentMeasured(vMed);
  const remainingMin =
    slopeVpm != null && slopeVpm <= T.DISCHARGE_SLOPE_VPM / 2
      ? Math.min(24 * 60, Math.max(0, Math.round((vMed - T.DEAD_V) / -slopeVpm)))
      : null;
  if (vMed <= T.CRITICAL_V) {
    return { ...common, state: "critical", label: remainingMin != null ? `곧 꺼짐 · 약 ${fmtMin(remainingMin)}` : "곧 꺼짐", percent, remainingMin };
  }
  return {
    ...common,
    state: "discharging",
    label: remainingMin != null ? `배터리 ${percent}% · 약 ${fmtMin(remainingMin)}` : `배터리 ${percent}%`,
    percent,
    remainingMin,
  };
}

export function fmtMin(min: number): string {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

// 실측 2점 보정 잔량 — 0% = 3.70V(사망 실측) · 100% = 4.10V(잠정 만충 휴지 전압, 플래토 관측 후 교정).
// 모양은 하드웨어 팀 30Q 곡선(gaspod-battery.ts)을 그대로 쓰고 양 끝만 실측에 못박는다:
//   pct = (curve(v) − curve(3.70)) / (curve(4.10) − curve(3.70)) × 100 = (curve(v) − 45) × 2.
// 검산: 3.70→0 · 3.78→24 · 3.90→60 · 4.05→90 · 4.10→100.
export const MEASURED_FULL_V = 4.1;
export function vbatToPercentMeasured(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const lo = curve30Q(T.DEAD_V);
  const hi = curve30Q(MEASURED_FULL_V);
  const p = ((curve30Q(v) - lo) / (hi - lo)) * 100;
  return Math.max(0, Math.min(100, Math.round(p)));
}

// gaspod-battery.ts 의 VBAT_CURVE 와 같은 꼭짓점(중복 import 를 피하려 여기 복제 — 바뀌면 두 곳을 같이).
const CURVE_30Q: readonly (readonly [number, number])[] = [
  [4.15, 100], [4.0, 85], [3.9, 75], [3.8, 60], [3.7, 45], [3.6, 30], [3.5, 20], [3.4, 12], [3.3, 7], [3.2, 4], [3.0, 0],
];
function curve30Q(v: number): number {
  const top = CURVE_30Q[0]!;
  if (v >= top[0]) return 100;
  for (let i = 0; i < CURVE_30Q.length - 1; i++) {
    const hi = CURVE_30Q[i]!;
    const lo = CURVE_30Q[i + 1]!;
    if (v >= lo[0]) return lo[1] + ((v - lo[0]) / (hi[0] - lo[0])) * (hi[1] - lo[1]);
  }
  return 0;
}
