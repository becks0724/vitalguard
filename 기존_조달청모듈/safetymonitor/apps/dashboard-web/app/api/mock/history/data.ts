// 발표용 mock 누적 데이터 — workerId + metric + day 로 deterministic 일별 평균 생성
// fall 은 시간/일 buckets 당 감지 건수 (count) 로 표현
export type HistoryMetric = "heartRate" | "spo2" | "skinTempC" | "fall";

export type HistoryPoint = {
  date: string;
  label?: string;
  value: number;
};

export type HistoryRange = 1 | 7 | 30 | 60 | 365;

type MetricProfile = {
  base: number;
  amplitude: number;
  jitter: number;
  decimals: number;
};

const PROFILES: Record<Exclude<HistoryMetric, "fall">, MetricProfile> = {
  heartRate: { base: 78, amplitude: 12, jitter: 6, decimals: 0 },
  spo2: { base: 97, amplitude: 1.5, jitter: 0.8, decimals: 0 },
  skinTempC: { base: 36.6, amplitude: 0.3, jitter: 0.2, decimals: 1 },
};

// 낙상 — 시간/일 buckets 당 0 또는 1 (드물게 2) 의 sparse count.
// hashSeed > 0.92 인 bucket 만 발생 → 24시간 ~2건, 7일 ~12건, 60일 ~100건 수준.
function fallCountAt(workerId: string, bucketSeed: number) {
  const s = hashSeed(workerId, "fall", bucketSeed);
  if (s > 0.985) return 2;
  if (s > 0.92) return 1;
  return 0;
}

function hashSeed(workerId: string, metric: HistoryMetric, dayIndex: number) {
  let h = 2166136261;
  const input = `${workerId}|${metric}|${dayIndex}`;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

// KST(UTC+9) 파츠 — Cloud Run 서버 로컬은 UTC 라 getHours() 등이 9시간 밀림(KST 11시가 02시로 표시).
// 라벨을 현장 시간(KST)에 맞춰 실시간 표와 동일 시각으로 보이게 한다(예: 24시간 뷰 마지막 버킷 = 현재 KST 시각).
function kst(date: Date): Date {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

function formatDay(date: Date) {
  const k = kst(date);
  const yyyy = k.getUTCFullYear();
  const mm = `${k.getUTCMonth() + 1}`.padStart(2, "0");
  const dd = `${k.getUTCDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatHour(date: Date) {
  const hh = `${kst(date).getUTCHours()}`.padStart(2, "0");
  return `${hh}:00`;
}

// 1년(월별) 라벨 — "YY/M" (예: 25/7). 12개월 각 월 고유.
function formatMonth(date: Date) {
  const k = kst(date);
  return `${`${k.getUTCFullYear()}`.slice(2)}/${k.getUTCMonth() + 1}`;
}

export function buildHistory(
  workerId: string,
  metric: HistoryMetric,
  range: HistoryRange,
  now = new Date(),
): HistoryPoint[] {
  const points: HistoryPoint[] = [];

  if (range === 1) {
    const hours = 24;
    for (let i = hours - 1; i >= 0; i -= 1) {
      const hour = new Date(now);
      hour.setMinutes(0, 0, 0);
      hour.setHours(hour.getHours() - i);

      const value =
        metric === "fall"
          ? fallCountAt(workerId, 1000 + i)
          : numericValueAt(workerId, metric, 1000 + i, hours, i);

      points.push({
        date: hour.toISOString(),
        label: formatHour(hour),
        value,
      });
    }

    return points;
  }

  if (range === 365) {
    // 1년 = 12 월별 포인트(일별 365점은 막대·도트가 겹쳐 가독성 저하 → 월 단위 집계).
    const months = 12;
    for (let i = months - 1; i >= 0; i -= 1) {
      const month = new Date(now);
      month.setHours(0, 0, 0, 0);
      month.setDate(1);
      month.setMonth(month.getMonth() - i);
      const idx = months - 1 - i; // 0(과거)~11(현재) — 계절성 위상
      let value: number;
      if (metric === "fall") {
        // 월별 총합 — 해당 월 ~30일 일별 카운트 결정적 합산.
        let sum = 0;
        for (let d = 0; d < 30; d += 1) sum += fallCountAt(workerId, i * 30 + d);
        value = sum;
      } else {
        value = numericValueAt(workerId, metric, 5000 + i, months, idx);
      }
      points.push({ date: formatMonth(month), label: formatMonth(month), value });
    }
    return points;
  }

  for (let i = range - 1; i >= 0; i -= 1) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);

    const value =
      metric === "fall"
        ? fallCountAt(workerId, i)
        : numericValueAt(workerId, metric, i, range, i);

    points.push({ date: formatDay(day), value });
  }

  return points;
}

// 사용자 지정 기간(시작일~종료일, YYYY-MM-DD) — 일별 결정적 포인트. 날짜 고정 시드라 같은 날짜는 항상 같은 값.
export function buildHistoryBetween(
  workerId: string,
  metric: HistoryMetric,
  fromISO: string,
  toISO: string,
): HistoryPoint[] {
  const dayMs = 86400000;
  const from = new Date(`${fromISO}T00:00:00Z`);
  const to = new Date(`${toISO}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return [];
  }
  const n = Math.round((to.getTime() - from.getTime()) / dayMs) + 1;
  const points: HistoryPoint[] = [];
  for (let idx = 0; idx < n; idx += 1) {
    const day = new Date(from.getTime() + idx * dayMs);
    const epochDay = Math.floor(day.getTime() / dayMs);
    const value =
      metric === "fall"
        ? fallCountAt(workerId, epochDay)
        : numericValueAt(workerId, metric, epochDay, n, idx);
    points.push({ date: formatDay(day), value });
  }
  return points;
}

function numericValueAt(
  workerId: string,
  metric: Exclude<HistoryMetric, "fall">,
  seed: number,
  span: number,
  i: number,
) {
  const profile = PROFILES[metric];
  const seasonal = Math.sin((i / span) * Math.PI * 2) * profile.amplitude * 0.6;
  const noise = (hashSeed(workerId, metric, seed) - 0.5) * 2 * profile.jitter;
  const drift = ((span - i) / span) * profile.amplitude * 0.15;
  return Number((profile.base + seasonal + noise - drift).toFixed(profile.decimals));
}

export function summarize(points: HistoryPoint[]) {
  if (points.length === 0) {
    return { min: 0, max: 0, avg: 0 };
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;

  return { min, max, avg };
}

// 낙상 등 count metric 에 한해 — 총합/최대건수/평균을 별도로 제공.
// summarize 와 동일 형태 (min/max/avg) 지만 의미가 "총 건수/최대/평균" 으로 재해석됨.
export function summarizeCount(points: HistoryPoint[]) {
  if (points.length === 0) {
    return { min: 0, max: 0, avg: 0 };
  }
  const values = points.map((p) => p.value);
  const total = values.reduce((sum, v) => sum + v, 0);
  const max = Math.max(...values);
  const avg = total / values.length;
  // min slot 은 의미가 적어 0 로 고정. min 자리에 "총합" 을 띄우기 위해 호출부에서 라벨 변환.
  return { min: total, max, avg };
}
