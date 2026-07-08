// 가스포드(gaspod-01) 단말 배터리 전압(V) → 잔량 %(추정) — 18650(삼성 30Q) 근사 방전곡선 구간 선형보간.
// 리튬이온은 전압-잔량이 직선이 아니라 S자 곡선이라, 단순 선형((V-3.0)/1.2)보다 실제에 가깝다(하드웨어 보고와 숫자 일치).
// 곡선/검산 출처 = Final_GasPod/GasPod_Calculation_battery_capacity.ts. 펌웨어 저전압경고 3.2V·안전종료 3.0V.
const VBAT_CURVE: readonly (readonly [number, number])[] = [
  [4.15, 100],
  [4.0, 85],
  [3.9, 75],
  [3.8, 60],
  [3.7, 45],
  [3.6, 30],
  [3.5, 20],
  [3.4, 12],
  [3.3, 7], // ← 펌웨어 저전압 경고선(3.2V) 부근
  [3.2, 4],
  [3.0, 0], // ← 펌웨어 안전종료선
];

// 검산: vbatToPercent(3.75) === 53.
export function vbatToPercent(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const top = VBAT_CURVE[0]!;
  if (v >= top[0]) return 100;
  for (let i = 0; i < VBAT_CURVE.length - 1; i++) {
    const hi = VBAT_CURVE[i]!;
    const lo = VBAT_CURVE[i + 1]!;
    if (v >= lo[0]) {
      return Math.round(lo[1] + ((v - lo[0]) / (hi[0] - lo[0])) * (hi[1] - lo[1]));
    }
  }
  return 0;
}
