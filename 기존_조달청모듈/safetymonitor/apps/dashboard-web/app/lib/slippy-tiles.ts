// 슬리피맵 공용 좌표 변환 — 위경도 ↔ 웹 메르카토르 픽셀(타일 256px 기준).
// 태풍 진로 지도와 실시간 레이더 지도가 같은 타일 좌표계를 쓴다. 한쪽만 고치면 두 지도가
// 서로 다른 위치를 가리키게 되므로 변환은 여기 한 곳에만 둔다.

export const TILE = 256;
const D2R = Math.PI / 180;

export function lonToWorldX(lon: number, z: number): number {
  return ((lon + 180) / 360) * TILE * 2 ** z;
}
export function latToWorldY(lat: number, z: number): number {
  const r = lat * D2R;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
}
export function worldXToLon(x: number, z: number): number {
  return (x / (TILE * 2 ** z)) * 360 - 180;
}
export function worldYToLat(y: number, z: number): number {
  const n = Math.PI * (1 - 2 * (y / (TILE * 2 ** z)));
  return Math.atan(Math.sinh(n)) / D2R;
}

// km → 픽셀. 해상도는 위도에 따라 달라지므로(고위도일수록 축척이 커진다)
// 반경 원을 그릴 때 해당 지점의 위도로 환산해야 실제 크기가 맞는다.
export function kmToPx(km: number, lat: number, z: number): number {
  const metersPerPx = (156543.03392804097 * Math.cos(lat * D2R)) / 2 ** z;
  return (km * 1000) / metersPerPx;
}
