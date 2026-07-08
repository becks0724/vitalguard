// 18650(삼성 30Q) 근사 방전곡선 — 전압(V) → 잔량(%). 구간 선형보간.
// 리튬이온은 전압-잔량이 직선이 아니라 S자 곡선이라, 선형식((V-3.0)/1.2)보다 실제에 가깝다.
// 대시보드의 vbat → % 표시를 이 함수로 교체할 것 (하드웨어 쪽 보고와 숫자 일치).
const VBAT_CURVE: [number, number][] = [
  [4.15, 100],
  [4.00, 85],
  [3.90, 75],
  [3.80, 60],
  [3.70, 45],
  [3.60, 30],
  [3.50, 20],
  [3.40, 12],
  [3.30, 7],   // ← 펌웨어 저전압 경고선(3.2V) 부근
  [3.20, 4],
  [3.00, 0],   // ← 펌웨어 안전종료선
];

export function vbatToPercent(v: number): number {
  if (v >= VBAT_CURVE[0][0]) return 100;
  for (let i = 0; i < VBAT_CURVE.length - 1; i++) {
    const [hiV, hiP] = VBAT_CURVE[i];
    const [loV, loP] = VBAT_CURVE[i + 1];
    if (v >= loV) return Math.round(loP + ((v - loV) / (hiV - loV)) * (hiP - loP));
  }
  return 0;
}
// 검산: vbatToPercent(3.75) === 53
