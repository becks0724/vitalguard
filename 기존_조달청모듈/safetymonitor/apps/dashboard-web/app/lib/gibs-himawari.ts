// NASA GIBS Himawari 구름 오버레이 — 태풍 지도 배경에 '지금 실제 구름'을 얹는다.
//
// 왜 Himawari 인가 — 서태평양을 보는 정지궤도 위성은 사실상 이것뿐이다.
// 미국 GOES 는 서반구만 커버해 우리 해역 타일이 아예 없다(실측 404).
// NASA 는 태풍 진로를 예보하지 않지만, 일본 위성 영상을 GIBS 로 재배포한다.
//
// 라이선스 — 미국 정부 저작물(공개 도메인)이며 서드파티 임베드가 명시적으로 허용된다.
// 좌표계가 GoogleMapsCompatible(웹 메르카토르 XYZ)이라 우리 슬리피맵에 그대로 얹힌다.
//
// ⚠️ 레이어마다 쓸 수 있는 줌 상한이 다르다(실측). 상한을 넘겨 요청하면 오류가 아니라
//    **400B 남짓한 빈 타일이 HTTP 200 으로** 돌아온다 — onError 가 걸리지 않는 조용한 실패다.
//    그래서 줌 상한을 코드로 들고 있다가 넘으면 아예 그리지 않는다.

export type CloudLayer = {
  key: "ir" | "vis";
  label: string;
  layerId: string;
  matrixSet: string;
  // 이 줌까지만 타일이 존재한다. 넘으면 빈 타일이라 렌더를 멈춘다.
  maxZoom: number;
  note: string;
};

export const CLOUD_LAYERS: readonly CloudLayer[] = [
  {
    key: "ir",
    label: "적외",
    layerId: "Himawari_AHI_Band13_Clean_Infrared",
    matrixSet: "GoogleMapsCompatible_Level6",
    maxZoom: 6,
    // 구름 정상 온도를 색으로 강조한다(초록·노랑·빨강 = 강한 대류). 야간에도 관측된다.
    note: "구름 온도 · 24시간",
  },
  {
    key: "vis",
    label: "가시",
    layerId: "Himawari_AHI_Band3_Red_Visible_1km",
    matrixSet: "GoogleMapsCompatible_Level7",
    maxZoom: 7,
    // 해상도가 higher(1km)지만 **밤에는 검게 나온다** — 야간에 화면이 비면 고장으로 오해한다.
    note: "1km 고해상도 · 주간만",
  },
] as const;

const BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

// 관측 시각 → 타일 시각. 10분 간격 산출물이고 GIBS 반영에 30~60분이 걸린다(실측:
// 현재-50분은 빈 타일, 현재-70분은 실데이터). 70분을 빼고 10분 단위로 내린다.
export const GIBS_LAG_MS = 70 * 60 * 1000;

export function gibsTimeFor(nowMs: number): string {
  const t = new Date(nowMs - GIBS_LAG_MS);
  t.setUTCMinutes(Math.floor(t.getUTCMinutes() / 10) * 10, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}` +
    `T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:00Z`
  );
}

// 타일 URL. z 가 레이어 상한을 넘으면 null — 호출부가 렌더를 건너뛴다(빈 타일 방지).
export function cloudTileUrl(
  layer: CloudLayer,
  time: string,
  z: number,
  x: number,
  y: number,
): string | null {
  if (z > layer.maxZoom) return null;
  return `${BASE}/${layer.layerId}/default/${time}/${layer.matrixSet}/${z}/${y}/${x}.png`;
}

// 상한을 넘는 줌에서 쓸 대체 줌과 화면 배율. 상한 줌 타일을 그만큼 확대해 이어 붙이면
// 구름이 끊기지 않는다(흐려질 뿐이다). 지도 타일의 표준 처리이며, 이것이 없으면
// "확대하면 구름이 사라진다"가 되어 상시 합성을 할 수 없다.
export function cloudZoomFor(layer: CloudLayer, zoom: number): { z: number; scale: number } {
  const z = Math.min(zoom, layer.maxZoom);
  return { z, scale: 2 ** (zoom - z) };
}
