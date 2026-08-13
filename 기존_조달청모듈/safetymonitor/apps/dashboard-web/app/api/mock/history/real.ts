// 추세 차트 실데이터 경로 — 심박(전 기간)·심부체온 추정 궤적(≤1주일)을 DB 실측 심박에서 만든다.
//
// 이 폴더의 data.ts 는 발표용 모의 곡선 생성기다. 알고리즘 검증(추정↔심박 비교)이 목적이 되면서
// 두 메트릭만 실데이터로 분기한다(2026-08-12 사용자 결정). SpO₂·낙상 탭은 아직 모의 경로(이월).
// 추정 궤적은 카드와 같은 analyzers 구현·같은 계수를 쓴다 — 화면 간 숫자가 어긋나지 않는다.
import { estimateCoreTempSeries, type HrPoint } from "@safetymonitor/analyzers";

import { getWorkerAliasMap, heartRateBucketAverages, spo2MeasurementsBetween } from "../../../../lib/db";

import type { HistoryPoint } from "./data";

export type RealMetric = "heartRate" | "coreTempEst" | "spo2";

/** 추정 궤적 제공 상한(일) — 열 스트레스는 시간 단위 현상이고 장기 추정 추세는 검증 근거가 없다. */
export const CORE_TEMP_EST_MAX_DAYS = 7;

// 기간 폭 → 심박 표시 버킷(초). 점 수를 120~300 대로 유지해 차트가 읽히게 한다.
function hrBucketSec(spanDays: number): number {
  if (spanDays <= 1) return 300; // 5분 → 288점
  if (spanDays <= 7) return 3600; // 1시간 → 168점
  if (spanDays <= 30) return 21_600; // 6시간 → 120점
  if (spanDays <= 60) return 43_200; // 12시간 → 120점
  return 86_400; // 1일 → 365점
}

// KST 라벨 — 모의 경로와 같은 원칙(서버 UTC 에서 현장 시간으로 표기).
function kstLabel(ms: number, spanDays: number): { date: string; label: string } {
  const k = new Date(ms + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`;
  const hm = `${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
  if (spanDays <= 1) return { date, label: hm };
  if (spanDays <= 7) return { date, label: `${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}시` };
  return { date, label: `${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}` };
}

// 별칭 확장 — primary 로 접힌 카드의 과거 이력은 secondary ID 행에 있다(신원 전환 이력).
// export = 사고 조사 뷰(admin/incidents/data)도 같은 확장을 쓴다(중복 구현 방지).
export async function aliasIdsOf(workerId: string): Promise<string[]> {
  try {
    const aliasMap = await getWorkerAliasMap();
    const ids = Object.entries(aliasMap)
      .filter(([, primary]) => primary === workerId)
      .map(([secondary]) => secondary);
    return [workerId, ...ids];
  } catch {
    return [workerId];
  }
}

export async function buildRealHistory(
  workerId: string,
  metric: RealMetric,
  fromMs: number,
  toMs: number,
): Promise<HistoryPoint[]> {
  const spanDays = Math.max((toMs - fromMs) / 86_400_000, 1 / 24);
  const ids = await aliasIdsOf(workerId);

  if (metric === "spo2") {
    // 기회 측정 — 측정 1건 = 점 1개(곡선으로 잇지 않도록 패널이 막대 강제). ≤7일 = 원본 점,
    // 30일+ = KST 일평균 + 측정 횟수 병기(2026-08-12 사용자 결정 — 점 수백 개는 안 읽힌다).
    const rows = await spo2MeasurementsBetween(ids, fromMs, toMs);
    if (spanDays <= 7) {
      return rows.map((r) => {
        const at = Date.parse(r.spo2_measured_at ?? r.ts);
        const { date, label } = kstLabel(at, spanDays);
        return { date, label, value: Math.round(Number(r.spo2)), tsMs: at };
      });
    }
    const byDay = new Map<string, { sum: number; n: number }>();
    for (const r of rows) {
      const at = Date.parse(r.spo2_measured_at ?? r.ts);
      const { date } = kstLabel(at, spanDays);
      const b = byDay.get(date) ?? { sum: 0, n: 0 };
      b.sum += Number(r.spo2);
      b.n += 1;
      byDay.set(date, b);
    }
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, b]) => ({
        date,
        label: `${date.slice(5)}·${b.n}회`,
        value: Math.round(b.sum / b.n),
      }));
  }

  if (metric === "heartRate") {
    const rows = await heartRateBucketAverages(ids, fromMs, toMs, hrBucketSec(spanDays));
    return rows.map((r) => {
      const at = r.bucket_start_sec * 1000;
      const { date, label } = kstLabel(at, spanDays);
      // tsMs = 버킷 시작 시각. 차트가 이 값으로 시간축을 잡고 결측 구간을 끊는다 —
      // 없으면 카테고리 축으로 떨어져 16시간 공백이 2시간 간격과 같은 폭으로 그려진다.
      return { date, label, value: Math.round(Number(r.bpm)), tsMs: at };
    });
  }

  // coreTempEst — 필터 입력은 1분 해상도 실측 평균, 표시로는 5분(24시간)/1시간(1주일) 평균.
  const hrRows = await heartRateBucketAverages(ids, fromMs, toMs, 60);
  const points: HrPoint[] = hrRows.map((r) => ({ tsMs: r.bucket_start_sec * 1000, bpm: Number(r.bpm) }));
  const series = estimateCoreTempSeries(points);
  const displaySec = spanDays <= 1 ? 300 : 3600;
  const bins = new Map<number, { sum: number; n: number }>();
  for (const pt of series) {
    const bin = Math.floor(pt.tsMs / 1000 / displaySec) * displaySec;
    const b = bins.get(bin) ?? { sum: 0, n: 0 };
    b.sum += pt.tempC;
    b.n += 1;
    bins.set(bin, b);
  }
  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bin, b]) => {
      const at = bin * 1000;
      const { date, label } = kstLabel(at, spanDays);
      // 심박과 같은 이유로 tsMs 를 함께 싣는다(시간축·결측 끊기).
      return { date, label, value: Math.round((b.sum / b.n) * 10) / 10, tsMs: at };
    });
}
