// SpO₂ 표시 겹침 — 갱신 구조(측정 1건=1행)와 인스턴스 메모리 병합이 충돌하는 지점을 DB 로 메운다.
//
// 최신 카드(latest)는 인스턴스 메모리에서 병합되는데, spo2 단독 행은 그 POST 를 받은 인스턴스
// 한 곳의 메모리에만 남는다. 화면 폴링이 다른 인스턴스에 떨어지면 spo2 가 빈다
// (2026-08-12 실측 — DB 에 96% 저장됐는데 화면은 --%). 구 앱은 매 행에 spo2 를 복사해 실어
// 이 문제가 가려졌을 뿐이다(그 부작용이 19.4만 행 복사 전송 사고).
// → 워커별 "DB 의 마지막 spo2 행"(신선 범위 내)을 표시 시점에 겹쳐, 어느 인스턴스가 응답해도
//   같은 값을 보이게 한다. 저장 구조(측정 1건=1행)는 건드리지 않는다 — 표시만 공유 진실을 본다.

export type Spo2DbRow = {
  worker_id: string;
  spo2: number;
  spo2_measured_at: string | null;
  ts: string;
};

type LatestCard = {
  workerId: string;
  ts: string;
  spo2?: number;
  spo2MeasuredAt?: string;
};

function measuredAtMs(measuredAt: string | null | undefined, ts: string): number {
  const at = Date.parse(measuredAt ?? ts);
  return Number.isNaN(at) ? -Infinity : at;
}

/** latest 카드 배열에 DB 의 마지막 spo2 를 겹친다(제자리 수정). 더 새 측정만 이기고, 낡은 행은 무시. */
export function overlayLatestSpo2<T extends LatestCard>(
  latest: T[],
  rows: Spo2DbRow[],
  aliasMap: Record<string, string>,
  freshMs: number,
  nowMs: number,
): void {
  // 별칭 접기 — 행 worker_id 를 주 ID 로 바꿔 카드와 같은 키로 만든다(같은 주 ID 다건이면 최신 우선).
  const byPrimary = new Map<string, Spo2DbRow>();
  for (const r of rows) {
    if (typeof r.spo2 !== "number") continue;
    const key = aliasMap[r.worker_id] ?? r.worker_id;
    const at = measuredAtMs(r.spo2_measured_at, r.ts);
    if (nowMs - at > freshMs) continue;
    const prev = byPrimary.get(key);
    if (!prev || at > measuredAtMs(prev.spo2_measured_at, prev.ts)) byPrimary.set(key, r);
  }
  for (const card of latest) {
    const row = byPrimary.get(card.workerId);
    if (!row) continue;
    const rowAt = measuredAtMs(row.spo2_measured_at, row.ts);
    const cardAt =
      typeof card.spo2 === "number" ? measuredAtMs(card.spo2MeasuredAt, card.ts) : -Infinity;
    if (rowAt > cardAt) {
      card.spo2 = row.spo2;
      card.spo2MeasuredAt = row.spo2_measured_at ?? row.ts;
    }
  }
}
