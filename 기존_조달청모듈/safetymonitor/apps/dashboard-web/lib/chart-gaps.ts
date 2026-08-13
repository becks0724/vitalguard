// 추세 차트의 시간축 보조 — 결측 구간 끊기와 눈금 라벨 생성.
//
// 왜 필요한가 — 카테고리 축은 점을 시간 간격과 무관하게 균등 배치한다. 밤새 측정이 없어
// 16시간이 비어도 2시간 간격과 같은 폭으로 그려지고, 그 위를 곡선이 매끄럽게 지나가
// "계속 측정됐다"로 읽힌다(2026-08-13 사용자 제보 — 체온 1주일 뷰).
// 시간축(`type="number"`)으로 바꾸면 간격은 실제 비율로 벌어지지만, 그것만으로는
// 공백을 가로지르는 직선이 남는다. 그 구간에 값 없는 점을 끼워 선을 **끊어야** 한다.
//
// IncidentReview 의 `withGaps` 와 같은 처방이다. 지금은 두 곳에 있고, 사고 조사 트랙이
// 안정되면 그쪽 import 한 줄을 이 모듈로 바꿔 통합한다(2026-08-13 병렬 세션 합의).

export type TimedPoint = { date: string; label?: string; value: number; tsMs: number };
export type GappedPoint = { date: string; label?: string; value: number | null; tsMs: number };

/** 연속 간격의 중앙값(ms). 표본이 2개 미만이면 null. */
export function medianStepMs(points: { tsMs: number }[]): number | null {
  if (points.length < 2) return null;
  const steps: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const d = points[i]!.tsMs - points[i - 1]!.tsMs;
    if (d > 0) steps.push(d);
  }
  if (steps.length === 0) return null;
  steps.sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)]!;
}

/**
 * 정상 간격보다 크게 벌어진 구간에 `value: null` 점을 끼워 선을 끊는다.
 * `connectNulls={false}` 와 짝으로 써야 효과가 있다.
 *
 * 임계는 인자로 주지 않으면 **중앙값 간격 × 2.5** 로 잡는다. 버킷 크기가 기간마다
 * 다른데(24시간=5분·1주=1시간·30일=6시간…) 호출부가 그걸 다시 계산하게 하면
 * 서버의 버킷 규칙과 어긋날 수 있어, 데이터 자신에서 유도한다.
 */
export function withTimeGaps(points: TimedPoint[], maxGapMs?: number): GappedPoint[] {
  if (points.length === 0) return [];
  const step = medianStepMs(points);
  // 표본이 1개거나 간격을 못 구하면 끊을 근거가 없다 — 원본 그대로 둔다.
  const threshold = maxGapMs ?? (step === null ? Number.POSITIVE_INFINITY : step * 2.5);

  const out: GappedPoint[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const prev = points[i - 1];
    if (prev && p.tsMs - prev.tsMs > threshold) {
      // 공백 한가운데에 빈 점 하나. 양 끝에 붙이면 마지막/첫 실측점이 사라져 보인다.
      out.push({ date: p.date, value: null, tsMs: Math.round((prev.tsMs + p.tsMs) / 2) });
    }
    out.push(p);
  }
  return out;
}

/**
 * 시간축 눈금 라벨 — 표시 폭에 맞춰 KST 로 포맷한다.
 *
 * 서버가 점마다 붙여 주는 `label` 을 쓰지 않는 이유는, 시간축에서는 Recharts 가
 * **데이터에 없는 위치**에도 눈금을 찍기 때문이다(도메인을 균등 분할한다).
 * 규칙은 서버 `kstLabel` 과 같게 맞춰 화면 간 표기가 갈리지 않게 한다.
 */
export function formatTimeTick(ms: number, spanMs: number): string {
  const k = new Date(ms + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const day = 86_400_000;
  if (spanMs <= day * 1.01) return `${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
  if (spanMs <= day * 7.01) return `${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}시`;
  return `${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`;
}

/** 모든 점이 tsMs 를 갖는가 — 시간축을 쓸 수 있는지의 판정. */
export function hasFullTimestamps(
  points: { tsMs?: number }[],
): points is TimedPoint[] {
  return points.length > 0 && points.every((p) => typeof p.tsMs === "number");
}
