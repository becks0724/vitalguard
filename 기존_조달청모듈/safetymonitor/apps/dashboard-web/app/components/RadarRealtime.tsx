// 실시간 강수 레이더 영상 — 한국 영역 베이스맵 + RainViewer 레이더 타일 오버레이 애니메이션
// 인라인(캐러셀)은 줌6 고정, 클릭 시 createPortal 확대 팝업.
// 팝업은 태풍 진로와 같은 슬리피맵 — 휠/＋－ 버튼 줌 + 드래그 팬 + ↺ 원래대로. 재생/일시정지 + 타임라인.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { latToWorldY, lonToWorldX, TILE, worldXToLon, worldYToLat } from "../lib/slippy-tiles";

type Frame = { time: number; path: string };
type Payload = { ok: boolean; host: string; frames: Frame[]; fetchedAt?: string };

// 한국 영역 경계(베이스맵·레이더 공통 타일 범위 산출용).
const KOREA = { n: 38.7, s: 33.0, w: 124.5, e: 131.2 };

function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2tile(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}
function tilesForBBox(z: number) {
  const x0 = lon2tile(KOREA.w, z);
  const x1 = lon2tile(KOREA.e, z);
  const y0 = lat2tile(KOREA.n, z);
  const y1 = lat2tile(KOREA.s, z);
  return { x0, y0, cols: x1 - x0 + 1, rows: y1 - y0 + 1 };
}

// html.dark 클래스 추적 → 베이스맵 라이트/다크 전환.
function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function hhmm(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 부모 영역을 측정해 가장 큰 정사각형을 중앙에 배치 — flex/block 컨텍스트 무관하게 항상 채움.
// (aspect-ratio + width:auto 가 flex 안에서 폭을 못 잡아 빈 화면이 되던 문제 회피.)
function SquareFit({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // getBoundingClientRect 는 조상의 CSS transform(scale)이 걸리면 축소된 값을 준다.
      // 그 값을 다시 인라인 크기로 쓰면 이중 축소돼 지도가 작아지고 여백만 커진다(사이드 패널에서 발생).
      // offsetWidth/Height 는 transform 영향을 받지 않는 레이아웃 크기라 어디에 놓여도 정확하다.
      setSide(Math.floor(Math.min(el.offsetWidth, el.offsetHeight)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="flex h-full w-full items-center justify-center">
      <div style={{ width: side || "100%", height: side || "100%" }}>{children}</div>
    </div>
  );
}

// 타일 URL — 인라인 그리드와 팝업 슬리피맵이 같은 함수를 쓴다. 한쪽만 바꾸면 두 화면이 갈린다.
//
// ⚠️ 베이스맵은 2026-08-27 에 CARTO(basemaps.cartocdn.com) 에서 Esri 로 옮겼다.
// CARTO 가 키 없는 요청에 **워터마크를 구워 보내기 시작**했기 때문이다("API KEY REQUIRED"
// 사선 문구). HTTP 200 에 정상 PNG 라 서버 라우트 검증(/api/radar)·에러 로그·경보 어디에도
// 안 잡히고 오직 눈으로만 보인다 — 베이스맵은 브라우저가 CDN 에서 직접 받아 서버를 안 거친다.
// 되돌리지 말 것. CARTO 로 가려면 키 발급·도메인 등록·과금 관리가 함께 와야 한다.
//
// Esri 는 태풍 진로·작업자 GPS 지도가 이미 쓰는 호스트라 외부 의존이 늘지 않는다.
// 대신 CARTO 와 두 가지가 다르다.
//   ① @2x 가 없다 — 256px 소스라 레티나에서 지명이 조금 무르다(레이더 512px 는 그대로).
//   ② 바탕과 지명이 분리돼 있다 — Base 위에 Reference 를 겹쳐야 CARTO light_all 과 같아진다.
//      쌓는 순서는 바탕 → 지명 → 레이더. 종전 CARTO 는 지명이 바탕에 구워져 레이더 아래
//      있었으므로, 지명을 레이더 위로 올리면 그때 화면 인상이 바뀐다.
const ESRI_CANVAS = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
// ⚠️ Esri 타일 경로는 z/y/x 순서다(XYZ 의 z/x/y 가 아니다). 뒤집으면 엉뚱한 곳이 그려진다.
function baseTileUrl(base: string, z: number, x: number, y: number): string {
  return `${ESRI_CANVAS}/World_${base}_Gray_Base/MapServer/tile/${z}/${y}/${x}`;
}
// 지명·행정경계 오버레이 — 바탕과 짝을 이룬다(위 ② 참조).
//
// ⚠️ 지명은 **바탕보다 한 단계 높은 줌**에서 받아 **절반 크기로** 그린다(2026-08-27 · 사용자 요청).
//   라스터 타일이라 글자 크기를 CSS 로 못 줄인다. z+1 타일 4장은 z 타일 1장과 **정확히 같은 영역**
//   을 덮으므로(인덱스 2배), 각 장을 절반 크기로 놓으면 지리 정렬은 그대로인 채 글자만 1/2 이 된다.
//   ⚠ 대가 = 지명 수가 는다(z+1 은 더 작은 도시까지 싣는다). 줄이려면 z 로 되돌리는 것이지
//     투명도를 낮추는 것이 아니다 — 흐린 글씨는 작은 글씨보다 읽기 나쁘다.
export const LABEL_ZOOM_OFFSET = 1;
function labelTileUrl(base: string, z: number, x: number, y: number): string {
  return `${ESRI_CANVAS}/World_${base}_Gray_Reference/MapServer/tile/${z}/${y}/${x}`;
}
// ⚠️ URL 끝의 color(7)·snow(_1) 는 **RainViewer 무료 API 가 무시한다**(실측: 색상 0~8 이
// 전부 동일 md5, `1_1` 과 `1_0` 도 동일). 색상 스킴을 바꿔 가독성을 높이려는 시도는
// 이 API 에서 통하지 않으니 반복하지 말 것 — 실제로 먹는 것은 size 와 smooth 뿐이다.
// 근본 개선은 기상청 RadarImgInfoService(500m·5분) 이며 활용신청이 필요하다.
// 경위·후보 비교 = docs/radar-visual-upgrade.md
function radarTileUrl(host: string, path: string, z: number, x: number, y: number): string {
  return `${host}${path}/512/${z}/${x}/${y}/7/1_1.png`;
}

// 베이스맵 + 레이더 타일 그리드 — 래퍼를 100% 채우고, 내부 타일은 % 위치로 배치.
function RadarTiles({
  host,
  framePath,
  zoom,
  dark,
}: {
  host: string;
  framePath: string | null;
  zoom: number;
  dark: boolean;
}) {
  const { x0, y0, cols, rows } = tilesForBBox(zoom);
  const base = dark ? "Dark" : "Light";
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ c, r, x: x0 + c, y: y0 + r });
    }
  }
  const style = (c: number, r: number): React.CSSProperties => ({
    position: "absolute",
    left: `${(c / cols) * 100}%`,
    top: `${(r / rows) * 100}%`,
    width: `${100 / cols}%`,
    height: `${100 / rows}%`,
  });

  // 지명 격자 — 인덱스 2배·칸 2배로 같은 영역을 4배 조밀하게 덮는다(글자 1/2).
  const lCols = cols * 2;
  const lRows = rows * 2;
  const labelCells = [];
  for (let r = 0; r < lRows; r++) {
    for (let c = 0; c < lCols; c++) {
      labelCells.push({ c, r, x: x0 * 2 + c, y: y0 * 2 + r });
    }
  }
  const labelStyle = (c: number, r: number): React.CSSProperties => ({
    position: "absolute",
    left: `${(c / lCols) * 100}%`,
    top: `${(r / lRows) * 100}%`,
    width: `${100 / lCols}%`,
    height: `${100 / lRows}%`,
  });

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg bg-slate-200 dark:bg-slate-800">
      {cells.map((t) => (
        <img
          key={`b-${t.x}-${t.y}`}
          src={baseTileUrl(base, zoom, t.x, t.y)}
          alt=""
          aria-hidden
          draggable={false}
          style={style(t.c, t.r)}
        />
      ))}
      {labelCells.map((t) => (
        <img
          key={`l-${t.x}-${t.y}`}
          src={labelTileUrl(base, zoom + LABEL_ZOOM_OFFSET, t.x, t.y)}
          alt=""
          aria-hidden
          draggable={false}
          style={labelStyle(t.c, t.r)}
        />
      ))}
      {framePath &&
        cells.map((t) => (
          <img
            key={`r-${t.x}-${t.y}`}
            src={radarTileUrl(host, framePath, zoom, t.x, t.y)}
            alt=""
            aria-hidden
            draggable={false}
            style={{ ...style(t.c, t.r), mixBlendMode: "normal" }}
          />
        ))}
    </div>
  );
}

// ── 확대 팝업용 슬리피맵 — 태풍 진로 지도와 같은 방식(center+zoom 으로 타일 실시간 배치) ──
//
// 인라인 그리드(RadarTiles)는 한국 bbox 를 % 로 채우는 고정 화면이라 확대·이동이 불가능하다.
// 팝업만 슬리피맵으로 둔다 — 인라인은 클릭이 '팝업 열기'라 드래그와 충돌한다(태풍도 같은 구조).
type View = { center: { lat: number; lon: number }; zoom: number };

// 줌 하한 4 — 한국 전역이 팝업 화면에 담기는 최소 줌. 상한 10 은 RainViewer 레이더의
// 실질 해상도 한계로, 더 당겨도 같은 에코가 뭉개져 보일 뿐이다.
const R_MIN_Z = 4;
const R_MAX_Z = 10;
const clampZoom = (z: number) => Math.max(R_MIN_Z, Math.min(R_MAX_Z, z));
// 팬 범위 — 한국 주변으로 제한한다. 풀어 두면 태평양 한가운데로 끌고 가 길을 잃는다.
const clampLat = (l: number) => Math.max(28, Math.min(45, l));
const clampLon = (l: number) => Math.max(118, Math.min(138, l));

// 한국 bbox 가 화면 90% 안에 들어오는 최대 줌 + 그 중심. 초기 화면이자 ↺ 가 되돌아갈 기준.
function fitKorea(w: number, h: number): View {
  let zoom = R_MIN_Z;
  for (let z = R_MAX_Z; z >= R_MIN_Z; z--) {
    const spanX = Math.abs(lonToWorldX(KOREA.e, z) - lonToWorldX(KOREA.w, z));
    const spanY = Math.abs(latToWorldY(KOREA.s, z) - latToWorldY(KOREA.n, z));
    if (spanX <= w * 0.9 && spanY <= h * 0.9) {
      zoom = z;
      break;
    }
  }
  // 위도 중심은 산술평균이 아니라 **픽셀 평균**이다 — 메르카토르는 위도에 따라 축척이 달라
  // (n+s)/2 를 쓰면 한국이 화면 중앙에서 아래로 밀린다.
  const cy = (latToWorldY(KOREA.n, zoom) + latToWorldY(KOREA.s, zoom)) / 2;
  return { center: { lat: worldYToLat(cy, zoom), lon: (KOREA.w + KOREA.e) / 2 }, zoom };
}

function RadarSlippyMap({
  host,
  framePath,
  dark,
}: {
  host: string;
  framePath: string | null;
  dark: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const fittedRef = useRef(false);
  const drag = useRef<{ px: number; py: number; cwx: number; cwy: number } | null>(null);

  // 최신 view/size 를 native wheel 핸들러에서 읽기 위한 ref 미러.
  const viewRef = useRef<View | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  viewRef.current = view;
  sizeRef.current = size;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 최초 1회만 프레이밍 — 이후 리사이즈로 다시 맞추면 사용자가 확대해 둔 화면이 되돌아간다.
  useEffect(() => {
    if (size.w === 0 || fittedRef.current) return;
    setView(fitKorea(size.w, size.h));
    fittedRef.current = true;
  }, [size]);

  const commit = useCallback((center: { lat: number; lon: number }, zoom: number) => {
    setView({
      center: { lat: clampLat(center.lat), lon: clampLon(center.lon) },
      zoom: clampZoom(zoom),
    });
  }, []);

  // 휠 줌(커서 기준) — native 리스너로 passive:false(페이지 스크롤 방지).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const s = sizeRef.current;
      if (!v || s.w === 0) return;
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const z = v.zoom;
      const tlx = lonToWorldX(v.center.lon, z) - s.w / 2;
      const tly = latToWorldY(v.center.lat, z) - s.h / 2;
      const lon = worldXToLon(tlx + sx, z);
      const lat = worldYToLat(tly + sy, z);
      const nz = clampZoom(z + (e.deltaY < 0 ? 1 : -1));
      if (nz === z) return;
      // 커서 지점(lon,lat)이 같은 화면 좌표에 오도록 새 center 계산.
      const ncx = lonToWorldX(lon, nz) - sx + s.w / 2;
      const ncy = latToWorldY(lat, nz) - sy + s.h / 2;
      commit({ lon: worldXToLon(ncx, nz), lat: worldYToLat(ncy, nz) }, nz);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [commit]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!view) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = {
      px: e.clientX,
      py: e.clientY,
      cwx: lonToWorldX(view.center.lon, view.zoom),
      cwy: latToWorldY(view.center.lat, view.zoom),
    };
    setGrabbing(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !view) return;
    const z = view.zoom;
    const ncx = drag.current.cwx - (e.clientX - drag.current.px);
    const ncy = drag.current.cwy - (e.clientY - drag.current.py);
    commit({ lon: worldXToLon(ncx, z), lat: worldYToLat(ncy, z) }, z);
  };
  const endDrag = () => {
    drag.current = null;
    setGrabbing(false);
  };
  const zoomBy = (d: number) => {
    if (view) commit(view.center, view.zoom + d);
  };
  const reset = () => {
    if (size.w) setView(fitKorea(size.w, size.h));
  };

  const base = dark ? "Dark" : "Light";
  const tiles: { key: string; left: number; top: number; z: number; x: number; y: number }[] = [];
  if (view && size.w > 0) {
    const z = view.zoom;
    const tlx = lonToWorldX(view.center.lon, z) - size.w / 2;
    const tly = latToWorldY(view.center.lat, z) - size.h / 2;
    const n = 2 ** z;
    for (let yt = Math.floor(tly / TILE); yt <= Math.floor((tly + size.h) / TILE); yt++) {
      if (yt < 0 || yt >= n) continue;
      for (let xt = Math.floor(tlx / TILE); xt <= Math.floor((tlx + size.w) / TILE); xt++) {
        tiles.push({
          key: `${xt}-${yt}`,
          left: xt * TILE - tlx,
          top: yt * TILE - tly,
          z,
          x: ((xt % n) + n) % n, // 경도 wrap
          y: yt,
        });
      }
    }
  }
  // maxWidth:none — Tailwind preflight 의 img{max-width:100%} 가 좁은 컨테이너에서 256px 타일을
  // 컨테이너 폭으로 압축해 타일 사이에 틈(띠)을 만드는 것 방지.
  const tileStyle = (t: { left: number; top: number }): React.CSSProperties => ({
    position: "absolute",
    left: t.left,
    top: t.top,
    width: TILE,
    height: TILE,
    maxWidth: "none",
  });

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      className="relative h-full w-full overflow-hidden rounded-lg bg-slate-200 dark:bg-slate-800"
      style={{ cursor: grabbing ? "grabbing" : "grab", touchAction: "none" }}
    >
      {tiles.map((t) => (
        <img
          key={`b-${t.key}`}
          src={baseTileUrl(base, t.z, t.x, t.y)}
          alt=""
          aria-hidden
          draggable={false}
          style={tileStyle(t)}
        />
      ))}
      {tiles.flatMap((t) =>
        // 타일 하나당 z+1 네 장(2×2)을 절반 크기로 — 같은 영역·글자 1/2.
        [0, 1].flatMap((dy) =>
          [0, 1].map((dx) => (
            <img
              key={`l-${t.key}-${dx}${dy}`}
              src={labelTileUrl(base, t.z + LABEL_ZOOM_OFFSET, t.x * 2 + dx, t.y * 2 + dy)}
              alt=""
              aria-hidden
              draggable={false}
              style={{
                position: "absolute",
                left: t.left + dx * (TILE / 2),
                top: t.top + dy * (TILE / 2),
                width: TILE / 2,
                height: TILE / 2,
                maxWidth: "none",
              }}
            />
          )),
        ),
      )}
      {framePath &&
        tiles.map((t) => (
          <img
            key={`r-${t.key}`}
            src={radarTileUrl(host, framePath, t.z, t.x, t.y)}
            alt=""
            aria-hidden
            draggable={false}
            style={tileStyle(t)}
          />
        ))}

      <div className="absolute right-2 top-2 z-10 flex flex-col gap-1.5">
        <MapBtn label="＋" onClick={() => zoomBy(1)} title="확대" />
        <MapBtn label="－" onClick={() => zoomBy(-1)} title="축소" />
        <MapBtn label="↺" onClick={reset} title="원래대로" />
      </div>
      {/* 줌 뱃지는 위쪽에 — 아래에 두면 하단 타임라인 쪽과 겹쳐 읽힌다. */}
      <div className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[11px] text-white">
        z{view?.zoom ?? "-"}
      </div>
    </div>
  );
}

function MapBtn({ label, onClick, title }: { label: string; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onPointerDown={(e) => e.stopPropagation()}
      className="flex h-10 w-10 items-center justify-center rounded-md bg-black/60 text-xl font-bold leading-none text-white transition hover:bg-black/85"
    >
      {label}
    </button>
  );
}

// 타임라인 — 재생/일시정지 + 프레임 시각 라벨(현재 강조). 라벨 클릭 시 해당 프레임으로 점프.
function Timeline({
  frames,
  idx,
  playing,
  onToggle,
  onSeek,
  compact,
}: {
  frames: Frame[];
  idx: number;
  playing: boolean;
  onToggle: () => void;
  onSeek: (i: number) => void;
  compact?: boolean;
}) {
  if (frames.length === 0) return null;
  // 라벨이 너무 많으면 일부만(균등 간격) 노출.
  const maxLabels = compact ? 4 : 7;
  const step = Math.max(1, Math.ceil(frames.length / maxLabels));
  const shown = frames.map((f, i) => ({ f, i })).filter(({ i }) => i % step === 0 || i === frames.length - 1);

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-label={playing ? "일시정지" : "재생"}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-primary text-xs text-on-primary active:scale-90"
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="wx-cards-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {shown.map(({ f, i }) => (
          <button
            key={f.time}
            type="button"
            onClick={() => onSeek(i)}
            className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] transition ${
              i === idx
                ? "bg-emerald-500 font-bold text-white"
                : "bg-surface-strong text-body dark:bg-white/10 dark:text-on-dark-soft"
            }`}
          >
            {hhmm(f.time)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RadarRealtime() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [open, setOpen] = useState(false);
  const dark = useIsDark();

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/radar", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: Payload) => {
          if (!alive) return;
          if (j.ok && j.frames?.length) {
            setData(j);
            setError(null);
            setIdx((prev) => (prev >= j.frames.length ? j.frames.length - 1 : prev));
          } else setError("프레임 없음");
        })
        .catch(() => alive && setError("네트워크 오류"));
    load();
    const id = setInterval(load, 2 * 60 * 1000); // 2분마다 새 프레임
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const frames = useMemo(() => data?.frames ?? [], [data]);

  // 애니메이션 — 재생 중 700ms 마다 다음 프레임(끝나면 처음으로 루프, 마지막엔 잠깐 정지 효과).
  useEffect(() => {
    if (!playing || frames.length <= 1) return;
    const last = frames.length - 1;
    const t = window.setInterval(() => {
      setIdx((i) => (i >= last ? 0 : i + 1));
    }, 700);
    return () => window.clearInterval(t);
  }, [playing, frames.length]);

  if (error && !data) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted dark:text-on-dark-soft">
        레이더 — {error}
      </div>
    );
  }
  if (!data || frames.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted dark:text-on-dark-soft">
        레이더 영상 불러오는 중…
      </div>
    );
  }

  const cur = frames[Math.min(idx, frames.length - 1)];

  return (
    <div className="flex h-full flex-col gap-1.5 p-2">
      {/* 인라인 레이더 — 클릭 시 확대 팝업 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="클릭하여 크게 보기"
        className="group relative flex min-h-0 flex-1"
      >
        <SquareFit>
          {/* 팝업이 열려 있으면 인라인 타일 렌더를 중단 — 동일 타일 2배 로드 방지(모달이 줌7로 표시 중). */}
          {open ? (
            <div className="flex h-full w-full items-center justify-center rounded-lg bg-slate-200 text-[10px] text-muted dark:bg-slate-800 dark:text-on-dark-soft">
              확대 보기 중…
            </div>
          ) : (
            <RadarTiles host={data.host} framePath={cur?.path ?? null} zoom={6} dark={dark} />
          )}
        </SquareFit>
        <span className="pointer-events-none absolute right-1.5 top-1.5 z-10 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
          ⤢ 크게 보기
        </span>
      </button>

      <Timeline
        frames={frames}
        idx={idx}
        playing={playing}
        onToggle={() => setPlaying((p) => !p)}
        onSeek={(i) => {
          setPlaying(false);
          setIdx(i);
        }}
        compact
      />

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <RadarModal
            host={data.host}
            frames={frames}
            idx={idx}
            playing={playing}
            dark={dark}
            onToggle={() => setPlaying((p) => !p)}
            onSeek={(i) => {
              setPlaying(false);
              setIdx(i);
            }}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </div>
  );
}

// 확대 팝업 — 화면 중앙 큰 레이더(줌7) + 타임라인. 배경/ESC/닫기로 해제.
function RadarModal({
  host,
  frames,
  idx,
  playing,
  dark,
  onToggle,
  onSeek,
  onClose,
}: {
  host: string;
  frames: Frame[];
  idx: number;
  playing: boolean;
  dark: boolean;
  onToggle: () => void;
  onSeek: (i: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cur = frames[Math.min(idx, frames.length - 1)];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="실시간 레이더 영상 확대"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 dark:bg-black/80"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-hairline-strong bg-canvas dark:border-white/10 dark:bg-surface-dark"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-2.5 dark:border-white/10">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 vital-blink-caution" />
            <h2 className="text-base font-bold text-ink dark:text-on-dark">실시간 레이더 영상</h2>
            <span className="font-mono text-xs text-muted dark:text-on-dark-soft">
              {cur ? hhmm(cur.time) : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-white/15 dark:text-zinc-400 dark:hover:bg-white/10"
          >
            닫기
          </button>
        </header>

        <div className="shrink-0 overflow-hidden bg-slate-100 p-3 dark:bg-black/40">
          <div className="h-[64vh] w-full">
            <SquareFit>
              <RadarSlippyMap host={host} framePath={cur?.path ?? null} dark={dark} />
            </SquareFit>
          </div>
        </div>

        <div className="shrink-0 border-t border-hairline px-4 py-2.5 dark:border-white/10">
          <Timeline
            frames={frames}
            idx={idx}
            playing={playing}
            onToggle={onToggle}
            onSeek={onSeek}
          />
          <p className="mt-1.5 text-center text-[10px] text-muted dark:text-on-dark-soft">
            기상청·RainViewer · 강수 에코(파랑→초록→노랑→빨강 = 약→강) · 휠·드래그로 확대·이동
          </p>
        </div>
      </div>
    </div>
  );
}
