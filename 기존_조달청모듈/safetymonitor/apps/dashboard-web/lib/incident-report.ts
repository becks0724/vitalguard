// 사고 조사 보고 헬퍼 — 조회 창 계산·보고용 CSV 직렬화. 순수 함수(I/O·시계 없음).
//
// 사고 조사는 "특정 시점의 상세 재구성"이다 — 추정 체온 추세 7일 상한(장기 집계 방지)과
// 층이 다르므로 창은 ≤48h 로 화이트리스트한다(자유 입력 금지 — 검증 범위 이탈 방지).

/** 조회 창 크기(시간) — 사고 시각 전후 대칭으로 나눈다(전조 + 대응·회복 양쪽이 조사 대상). */
export const INCIDENT_WINDOW_HOURS = [6, 12, 24, 48] as const;
export type IncidentWindowHours = (typeof INCIDENT_WINDOW_HOURS)[number];

export function isIncidentWindowHours(h: number): h is IncidentWindowHours {
  return (INCIDENT_WINDOW_HOURS as readonly number[]).includes(h);
}

/** 사고 시각 전후 대칭 창 — 24h 지정 시 전 12h·후 12h. */
export function incidentWindow(
  atMs: number,
  hours: IncidentWindowHours,
): { fromMs: number; toMs: number } {
  const half = (hours * 3_600_000) / 2;
  return { fromMs: atMs - half, toMs: atMs + half };
}

export type IncidentSeriesPoint = {
  /** epoch ms */
  tsMs: number;
  value: number;
};

export type IncidentEvent = {
  /** 발생 시각 ISO */
  ts: string;
  /** 알림 종류(sos·fall 등 — alerts.type 그대로) */
  type: string;
  ackAt: string | null;
  ackBy: string | null;
};

export type IncidentReportData = {
  workerId: string;
  workerName?: string | null;
  /** 사고 시각 ISO */
  occurredAt: string;
  windowFromMs: number;
  windowToMs: number;
  heartRate: IncidentSeriesPoint[];
  coreTempEst: IncidentSeriesPoint[];
  spo2: IncidentSeriesPoint[];
  activeEnergyKcal: IncidentSeriesPoint[];
  events: IncidentEvent[];
};

// CSV 필드 이스케이프 — 콤마·따옴표·개행이 든 값만 따옴표로 감싼다(RFC 4180).
function csvField(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const METRIC_LABELS: [keyof Pick<
  IncidentReportData,
  "heartRate" | "coreTempEst" | "spo2" | "activeEnergyKcal"
>, string][] = [
  ["heartRate", "심박(bpm)"],
  ["coreTempEst", "심부체온 추정(℃)"],
  ["spo2", "산소포화도(%)"],
  ["activeEnergyKcal", "활동에너지(kcal)"],
];

/**
 * 보고자료 CSV — 메타 헤더 주석 + 롱포맷(시각,항목,값,비고) + 이벤트 행. 시각 오름차순.
 * 추정 체온은 저장값이 아니라 **내보내기 시점에 원시 심박으로 재계산한 값**임을 메타에 명시한다
 * (모델 = Buller 2013 문헌 계수 고정 — 재계산이어도 같은 입력이면 항상 같은 출력).
 */
export function buildIncidentCsv(data: IncidentReportData, generatedAtIso: string): string {
  const lines: string[] = [];
  lines.push(`# VitAlGuard 사고 조사 자료`);
  lines.push(`# 작업자,${csvField(data.workerId)}${data.workerName ? `,${csvField(data.workerName)}` : ""}`);
  lines.push(`# 사고 시각,${data.occurredAt}`);
  lines.push(
    `# 조회 창,${new Date(data.windowFromMs).toISOString()} ~ ${new Date(data.windowToMs).toISOString()}`,
  );
  lines.push(`# 생성 시각,${generatedAtIso}`);
  lines.push(
    `# 심부체온 추정 = 생성 시점에 원시 심박으로 재계산(Buller 2013 문헌 계수·의료 판정 아님)`,
  );
  lines.push(`시각,항목,값,비고`);

  const rows: { tsMs: number; line: string }[] = [];
  for (const [key, label] of METRIC_LABELS) {
    for (const p of data[key]) {
      rows.push({
        tsMs: p.tsMs,
        line: `${new Date(p.tsMs).toISOString()},${csvField(label)},${p.value},`,
      });
    }
  }
  for (const e of data.events) {
    const tsMs = Date.parse(e.ts);
    const ack = e.ackAt ? `대응 ${e.ackAt}${e.ackBy ? ` (${e.ackBy})` : ""}` : "미대응";
    rows.push({
      tsMs: Number.isNaN(tsMs) ? data.windowFromMs : tsMs,
      line: `${e.ts},${csvField(`이벤트:${e.type}`)},,${csvField(ack)}`,
    });
  }
  rows.sort((a, b) => a.tsMs - b.tsMs);
  for (const r of rows) lines.push(r.line);
  return lines.join("\n");
}
