// 태풍 진로 시각화 — Esri 위성 베이스맵(+지명·경계 라벨) 위에 진로 폴리라인 + 현재위치 + 중심기압/최대풍속.
// 인라인(캐러셀)은 진로에 맞춰 자동 프레이밍, 팝업은 정식 슬리피맵(동적 타일 줌+드래그 팬)으로 확대해도 선명.
// 데이터: /api/typhoon(기상청 getTyphoonInfo). 미승인/비시즌 시 샘플/없음 상태로 안전 표시.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  computeGate,
  EMPTY_GATE,
  pickWorst,
  type GateResult,
  type Zone,
} from "../lib/typhoon-gate";

type TrackPoint = {
  tm: string;
  lat: number;
  lon: number;
  dir?: string;
  speedKmh?: number;
  pressureHpa?: number;
  maxWindMs?: number;
  rad25?: string;
  rad15?: string;
  radPr?: string; // 70% 확률반경(km) — 예보점에만. 강풍반경이 아니라 중심이 있을 수 있는 범위.
};
// 태풍 1개 레코드 — 서버 typhoons 배열 원소이자 하위호환 스프레드 필드(구 단일 payload)와 동형.
type TyphoonRec = {
  source: "live" | "mock" | "none";
  seq?: string;
  name?: string;
  nameEn?: string;
  img?: string;
  tmFc?: string;
  track: TrackPoint[];
  currentIndex: number;
  note?: string;
};
type Payload = TyphoonRec & {
  ok: boolean;
  typhoons?: TyphoonRec[]; // 다중 태풍(쌍태풍) — 구 서버 응답엔 없음(폴백 [data])
};

// ── 웹 메르카토르 픽셀 좌표 변환(타일 256px 기준) ──
const TILE = 256;
const D2R = Math.PI / 180;
function lonToWorldX(lon: number, z: number): number {
  return ((lon + 180) / 360) * TILE * 2 ** z;
}
function latToWorldY(lat: number, z: number): number {
  const r = lat * D2R;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
}
function worldXToLon(x: number, z: number): number {
  return (x / (TILE * 2 ** z)) * 360 - 180;
}
function worldYToLat(y: number, z: number): number {
  const n = Math.PI * (1 - 2 * (y / (TILE * 2 ** z)));
  return Math.atan(Math.sinh(n)) / D2R;
}

// 하한 2 — 패널 지도가 131px 이라 원거리 태풍(감시구역)과 현장을 한 화면에 담으려면 z3 으로는 모자란다
// (z3 은 경도 31.5° 가 179px 이라 131px 캔버스를 넘겨 양쪽 마커가 전부 화면 밖으로 나갔다).
const MIN_Z = 2;

// 웹 메르카토르 km → 픽셀. 해상도는 위도에 따라 달라지므로(고위도일수록 축척이 커진다)
// 반경 원을 그릴 때 해당 지점의 위도로 환산해야 실제 크기가 맞는다.
function kmToPx(km: number, lat: number, z: number): number {
  const metersPerPx = (156543.03392804097 * Math.cos(lat * D2R)) / 2 ** z;
  return (km * 1000) / metersPerPx;
}
const MAX_Z = 11;
const clampZoom = (z: number) => Math.max(MIN_Z, Math.min(MAX_Z, z));
const clampLat = (l: number) => Math.max(8, Math.min(55, l));
const clampLon = (l: number) => Math.max(100, Math.min(165, l));

// Esri 타일(키 불필요). 위성 = World_Imagery(jpeg), 라벨 = 경계·지명 오버레이(투명 png). URL은 {z}/{y}/{x}.
const SAT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const REF =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile";

type View = { center: { lat: number; lon: number }; zoom: number };

// 정식 슬리피맵 — 위성 타일을 center+zoom 으로 실시간 배치(확대 시 더 높은 줌 타일을 로드 → 항상 선명).
// interactive=true 면 휠 줌(커서 기준)+드래그 팬+버튼. false 면 진로에 맞춰 자동 프레이밍만(정적).
// 프레이밍 최소 스팬(도) — 진로점이 1개거나 태풍이 현장 바로 위면 bbox 가 점이 되어 최대 줌으로 튄다.
// 고줌 원양 타일은 특징 없는 바다라 화면이 배경색만 남는다(감시구역 단계에서 실제로 그렇게 보였다).
const MIN_FIT_SPAN_DEG = 4;

// 주어진 점들이 화면 80% 안에 들어오는 최대 줌으로 프레이밍. 최소 줌에서도 못 담으면 null.
// ★ null 을 돌려주는 것이 핵심 — 예전 구현은 못 담아도 조용히 MIN_Z 를 쓰는 바람에 마커가
//   화면 밖에 그려지고도 지도는 멀쩡해 보였다(빈 바다만 보이는 원인).
function frameOf(pts: { lat: number; lon: number }[], w: number, h: number): View | null {
  if (pts.length === 0 || w === 0 || h === 0) return null;
  let minLat = Infinity,
    maxLat = -Infinity,
    minLon = Infinity,
    maxLon = -Infinity;
  for (const p of pts) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  // 점에 가까운 bbox 는 최소 스팬으로 넓힌다(과확대 방지).
  if (maxLat - minLat < MIN_FIT_SPAN_DEG) {
    const c = (minLat + maxLat) / 2;
    minLat = c - MIN_FIT_SPAN_DEG / 2;
    maxLat = c + MIN_FIT_SPAN_DEG / 2;
  }
  if (maxLon - minLon < MIN_FIT_SPAN_DEG) {
    const c = (minLon + maxLon) / 2;
    minLon = c - MIN_FIT_SPAN_DEG / 2;
    maxLon = c + MIN_FIT_SPAN_DEG / 2;
  }
  const center = { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
  for (let z = MAX_Z; z >= MIN_Z; z--) {
    const spanX = Math.abs(lonToWorldX(maxLon, z) - lonToWorldX(minLon, z));
    const spanY = Math.abs(latToWorldY(minLat, z) - latToWorldY(maxLat, z));
    if (spanX <= w * 0.8 && spanY <= h * 0.8) return { center, zoom: z };
  }
  return null;
}

// 태풍 마커 — 붉은 점 대신 회전하는 나선(태풍 심볼). 위성(어두운 바다) 위에서 읽히도록 흰 외곽선을 깐다.
// 회전은 SMIL(animateTransform) — CSS 키프레임 없이 SVG 안에서 끝난다.
function TyphoonMarker({ x, y, size = 30 }: { x: number; y: number; size?: number }) {
  const s = size / 24;
  const arms = (
    <>
      <path d="M12 5c3.6 0 6 2 6 4.6 0 1.9-1.6 3.1-3.4 3.1" />
      <path d="M12 19c-3.6 0-6-2-6-4.6 0-1.9 1.6-3.1 3.4-3.1" />
    </>
  );
  return (
    <g transform={`translate(${x - 12 * s} ${y - 12 * s}) scale(${s})`}>
      <g>
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="14s"
          repeatCount="indefinite"
        />
        <g fill="none" stroke="#0f172a" strokeWidth={5.2} strokeLinecap="round" opacity={0.55}>
          {arms}
        </g>
        <g fill="none" stroke="#fff" strokeWidth={3.6} strokeLinecap="round">
          {arms}
        </g>
        <g fill="none" stroke="#ef4444" strokeWidth={1.9} strokeLinecap="round">
          {arms}
        </g>
      </g>
      <circle cx={12} cy={12} r={2.4} fill="#ef4444" stroke="#fff" strokeWidth={1.5} />
    </g>
  );
}

function SlippyMap({
  track,
  currentIndex,
  interactive,
  siteLat,
  siteLon,
}: {
  track: TrackPoint[];
  currentIndex: number;
  interactive: boolean;
  siteLat?: number;
  siteLon?: number;
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

  // 진로 bbox 가 화면 80% 안에 들어오는 최대 줌으로 프레이밍.
  // bbox 에 현장 좌표를 함께 넣는다 — 원거리 태풍(감시구역)에서 태풍만 확대하면 바다밖에 안 보인다.
  // 태풍과 현장이 한 화면에 있어야 "얼마나 떨어져 있는가"가 눈으로 읽힌다.
  // 1차 = 진로 + 현장(거리 맥락). 화면에 못 담으면 2차 = 진로만. 둘 다 실패하면 진로 시작점 기준 최소 줌.
  const fit = useCallback(
    (w: number, h: number): View => {
      const trackPts = track.map((p) => ({ lat: p.lat, lon: p.lon }));
      const first = trackPts[0];
      if (!first) return { center: { lat: 34, lon: 128 }, zoom: 5 };
      const withSite =
        typeof siteLat === "number" && typeof siteLon === "number"
          ? [...trackPts, { lat: siteLat, lon: siteLon }]
          : trackPts;
      return (
        frameOf(withSite, w, h) ??
        frameOf(trackPts, w, h) ?? { center: { lat: first.lat, lon: first.lon }, zoom: MIN_Z }
      );
    },
    [track, siteLat, siteLon],
  );

  // 초기/리핏 — interactive 면 1회만(사용자 조작 보존), static 이면 size/track 변경 시 갱신.
  useEffect(() => {
    if (size.w === 0) return;
    if (interactive) {
      if (!fittedRef.current) {
        setView(fit(size.w, size.h));
        fittedRef.current = true;
      }
    } else {
      setView(fit(size.w, size.h));
    }
  }, [size, fit, interactive]);

  const commit = useCallback((center: { lat: number; lon: number }, zoom: number) => {
    setView({ center: { lat: clampLat(center.lat), lon: clampLon(center.lon) }, zoom: clampZoom(zoom) });
  }, []);

  // 휠 줌(커서 기준) — native 리스너로 passive:false(페이지 스크롤 방지).
  useEffect(() => {
    if (!interactive) return;
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
  }, [interactive, commit]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || !view) return;
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
    if (size.w) setView(fit(size.w, size.h));
  };

  // ── 타일/진로 렌더 산출 ──
  const tiles: { key: string; left: number; top: number; z: number; x: number; y: number }[] = [];
  let polyPts: { x: number; y: number }[] = [];
  let sitePt: { x: number; y: number } | null = null;
  let prCircles: { x: number; y: number; r: number }[] = [];
  if (view && size.w > 0) {
    const z = view.zoom;
    const tlx = lonToWorldX(view.center.lon, z) - size.w / 2;
    const tly = latToWorldY(view.center.lat, z) - size.h / 2;
    const n = 2 ** z;
    const xt0 = Math.floor(tlx / TILE);
    const xt1 = Math.floor((tlx + size.w) / TILE);
    const yt0 = Math.floor(tly / TILE);
    const yt1 = Math.floor((tly + size.h) / TILE);
    for (let yt = yt0; yt <= yt1; yt++) {
      if (yt < 0 || yt >= n) continue;
      for (let xt = xt0; xt <= xt1; xt++) {
        const tx = ((xt % n) + n) % n; // 경도 wrap
        tiles.push({
          key: `${xt}-${yt}`,
          left: xt * TILE - tlx,
          top: yt * TILE - tly,
          z,
          x: tx,
          y: yt,
        });
      }
    }
    polyPts = track.map((p) => ({
      x: lonToWorldX(p.lon, z) - tlx,
      y: latToWorldY(p.lat, z) - tly,
    }));
    if (typeof siteLat === "number" && typeof siteLon === "number") {
      sitePt = { x: lonToWorldX(siteLon, z) - tlx, y: latToWorldY(siteLat, z) - tly };
    }
    // 70% 확률반경 원 — 예보점에만 있다(관측 위치는 오차 개념이 없다).
    prCircles = track.flatMap((p, i) => {
      if (i <= currentIndex) return [];
      const km = p.radPr ? Number.parseFloat(p.radPr) : NaN;
      const pt = polyPts[i];
      if (!pt || !Number.isFinite(km) || km <= 0) return [];
      return [{ x: pt.x, y: pt.y, r: kmToPx(km, p.lat, z) }];
    });
  }
  const curPt = polyPts[currentIndex] ?? null;
  // 현재 지점을 경계로 나눈다(현재 점은 양쪽에 포함 — 선이 끊기지 않게).
  const pastPts = polyPts.slice(0, Math.min(currentIndex + 1, polyPts.length));
  const futurePts = polyPts.slice(Math.max(0, Math.min(currentIndex, polyPts.length - 1)));

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      className="relative h-full w-full overflow-hidden rounded-lg bg-slate-900"
      style={
        interactive
          ? { cursor: grabbing ? "grabbing" : "grab", touchAction: "none" }
          : undefined
      }
    >
      {/* 위성 + 라벨 타일. maxWidth:none — Tailwind preflight 의 img{max-width:100%} 가 좁은
          컨테이너(<256px)에서 256px 타일을 컨테이너 폭으로 압축해 타일 사이 틈(어두운 띠)을 만드는 것 방지. */}
      {tiles.map((t) => (
        <img
          key={`s-${t.key}`}
          src={`${SAT}/${t.z}/${t.y}/${t.x}`}
          alt=""
          aria-hidden
          draggable={false}
          style={{ position: "absolute", left: t.left, top: t.top, width: TILE, height: TILE, maxWidth: "none" }}
        />
      ))}
      {tiles.map((t) => (
        <img
          key={`r-${t.key}`}
          src={`${REF}/${t.z}/${t.y}/${t.x}`}
          alt=""
          aria-hidden
          draggable={false}
          style={{ position: "absolute", left: t.left, top: t.top, width: TILE, height: TILE, maxWidth: "none" }}
        />
      ))}

      {/* 진로 오버레이(px 좌표) */}
      {polyPts.length > 0 && size.w > 0 && (
        <svg
          className="pointer-events-none absolute inset-0"
          width={size.w}
          height={size.h}
          aria-hidden
        >
          {/* 70% 확률반경 — 예보 위치의 불확실성. 맨 아래에 깔아 진로선·마커를 가리지 않게 한다.
              작은 인라인 지도에서는 원 7개가 겹쳐 지저분해지므로 확대 팝업에서만 표시한다.
              ⚠️ 강풍 범위가 아니라 '중심이 있을 수 있는 범위'다(범례에 명시). */}
          {interactive &&
            prCircles.map((c, i) => (
              <circle
                key={`pr-${i}`}
                cx={c.x}
                cy={c.y}
                r={c.r}
                fill="rgba(248,113,113,0.08)"
                stroke="rgba(248,113,113,0.40)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            ))}
          {/* 현장 마커 — 태풍과의 거리를 눈으로 읽게 한다(태풍 점보다 먼저 그려 겹칠 때 태풍이 위로). */}
          {sitePt && (
            <g>
              <circle cx={sitePt.x} cy={sitePt.y} r={5} fill="#38bdf8" stroke="#fff" strokeWidth={1.6} />
              <text
                x={sitePt.x}
                y={sitePt.y - 8}
                textAnchor="middle"
                fill="#fff"
                stroke="#0f172a"
                strokeWidth={2.5}
                paintOrder="stroke"
                style={{ fontSize: 10, fontWeight: 700 }}
              >
                현장
              </text>
            </g>
          )}
          {/* 지나온 경로 = 실선, 예보 진로 = 점선. 안전 판단 화면에서 둘을 같은 선으로 그리면
              '앞으로 갈 길'로 오독된다 — 실제로 지나온 곳과 예측은 신뢰도가 다르다. */}
          {pastPts.length > 1 && (
            <polyline
              points={pastPts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#f87171"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
          )}
          {futurePts.length > 1 && (
            <polyline
              points={futurePts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#f87171"
              strokeWidth={2.5}
              strokeDasharray="6 5"
              strokeLinejoin="round"
            />
          )}
          {/* 예보/관측 지점은 작은 점, 현재 위치만 태풍 심볼(회전 나선). */}
          {polyPts.map((p, i) =>
            i === currentIndex ? null : (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={4.5}
                fill="rgba(248,113,113,0.7)"
                stroke="#fff"
                strokeWidth={1.3}
              />
            ),
          )}
          {curPt && <TyphoonMarker x={curPt.x} y={curPt.y} size={interactive ? 44 : 30} />}
        </svg>
      )}

      {interactive && (
        <>
          <div className="absolute right-2 top-2 z-10 flex flex-col gap-1.5">
            <MapBtn label="＋" onClick={() => zoomBy(1)} title="확대" />
            <MapBtn label="－" onClick={() => zoomBy(-1)} title="축소" />
            <MapBtn label="↺" onClick={reset} title="원래대로" />
          </div>
          {/* 줌 뱃지는 위쪽에 — 아래에 두면 하단 관측값 오버레이에 반쯤 가린다. */}
          <div className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[11px] text-white">
            z{view?.zoom ?? "-"}
          </div>
        </>
      )}
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

function fmtTmFc(s?: string): string {
  if (!s || s.length < 12) return "";
  return `${s.slice(4, 6)}/${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
}

// ── 작업현장 조기 경보 표시 — 판정(기상청 구역 + 강풍/폭풍반경 하이브리드·예보 선행)은 lib/typhoon-gate ──
// 6단계 = 구역 축(watch·alert·emergency) + 반경 축(approach·gale·storm). 결정·근거는 docs/typhoon-zone-hybrid.
const ZONE_LABEL: Record<Zone, string> = {
  storm: "폭풍역 진입",
  gale: "강풍역 진입",
  approach: "영향권 접근",
  emergency: "비상구역 진입",
  alert: "경계구역 진입",
  watch: "감시구역",
  none: "영향권 밖",
};
// 기상청 구역명 단독 표기 — 반경 축이 등급을 이겼을 때 구역 근거를 푸터에 병기하는 용도.
const KMA_ZONE_LABEL: Record<Zone, string> = {
  storm: "",
  gale: "",
  approach: "",
  emergency: "비상구역",
  alert: "경계구역",
  watch: "감시구역",
  none: "",
};
// 현재 시점(실측) 안내 — 건설 작업중지 기준(산업안전보건기준에 관한 규칙 제37·143·383조).
const ZONE_ADVISORY: Record<Zone, string> = {
  storm: "전면 작업중지 · 순간풍속 25m/s급 — 타워크레인·고소·양중 중지·대피",
  gale: "작업중지 · 순간풍속 15m/s급 — 타워크레인 운전·철골·고소작업 중지",
  approach: "진입 대비 · 자재 결박·타워크레인 하강·가설물 점검",
  emergency: "사전 대비 · 자재 결박·타워크레인 하강 준비·배수로 점검",
  alert: "대비 검토 · 기상 정보 주시·가설물 상태 확인",
  watch: "진로 주시",
  none: "",
};
// 예보 시점 안내 — 등급은 예보대로 올리되 지시는 '대비' 수준으로 유지한다.
// 5일 뒤 폭풍역 예보로 지금 "전면 작업중지·대피"를 띄우면 오작동이다(docs/typhoon-zone-hybrid T-05).
// 등급명은 배너 제목이 이미 말하므로 여기서 반복하지 않는다(반복하면 배너가 세 줄이 되어
// flex-1 인 지도를 0 까지 밀어낸다 — 실제로 진로 5점 예보에서 지도가 통째로 사라졌다).
const ZONE_FORECAST_ADVISORY: Record<Zone, string> = {
  storm: "대피계획 점검·타워크레인 하강 확정",
  gale: "자재 결박·타워크레인 하강·고소작업 조정",
  approach: "자재 결박·가설물 점검",
  emergency: "기상 정보 주시·대비 계획 수립",
  alert: "진로 주시",
  watch: "진로 주시",
  none: "",
};
const ZONE_TEXT: Record<Zone, string> = {
  storm: "text-red-600 dark:text-red-300",
  gale: "text-orange-600 dark:text-orange-300",
  approach: "text-amber-600 dark:text-amber-300",
  emergency: "text-amber-600 dark:text-amber-300",
  alert: "text-sky-600 dark:text-sky-300",
  watch: "text-zinc-500 dark:text-on-dark-soft",
  none: "text-zinc-500 dark:text-on-dark-soft",
};
// 지도 위(항상 어두운 위성 배경)에 얹을 때 쓰는 밝은 톤 — 라이트 모드 색을 그대로 쓰면 읽히지 않는다.
const ZONE_TEXT_ON_MAP: Record<Zone, string> = {
  storm: "text-red-300",
  gale: "text-orange-300",
  approach: "text-amber-300",
  emergency: "text-amber-300",
  alert: "text-sky-300",
  watch: "text-zinc-200",
  none: "text-zinc-200",
};
// 색은 5종 — emergency 와 approach 가 amber 를 공유한다. 어휘 절약이 아니라 두 단계에서
// 현장이 할 행동이 같기 때문이다(사전 대비). 등급·라벨·문구는 분리되어 있어 정보 손실이 없다.
const ZONE_BANNER: Record<Zone, string> = {
  storm: "border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
  gale: "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300",
  approach: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  emergency: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  alert: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300",
  watch: "",
  none: "",
};

// 도달 리드타임 — 통보문 시각끼리의 차이라 브라우저 시계와 무관하다(typhoon-gate.tmToMs).
function fmtLead(h: number | null): string {
  if (h === null || h <= 0) return "";
  const hours = Math.round(h);
  if (hours < 24) return `약 ${hours}시간 뒤`;
  return `D-${Math.floor(hours / 24)} · 약 ${hours}시간 뒤`;
}

// 태풍(사이클론) 모노톤 라인 아이콘 — 다른 대시보드 아이콘과 동일 테마(currentColor 라인 SVG).
// 눈(중심 원) + 회전하는 두 나선 팔로 태풍을 표현. 이모지(🌀) 대체.
function TyphoonIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="1.7" />
      <path d="M12 5c3.6 0 6 2 6 4.6 0 1.9-1.6 3.1-3.4 3.1" />
      <path d="M12 19c-3.6 0-6-2-6-4.6 0-1.9 1.6-3.1 3.4-3.1" />
    </svg>
  );
}

// 태풍 표기 라벨 — "제11호 하이선"(샘플은 이름만).
function typhoonLabel(t: TyphoonRec): string {
  const name = t.name ?? "태풍";
  return t.seq && t.seq !== "샘플" ? `제${t.seq}호 ${name}` : name;
}

// 영향권 밖 — 추적 중지 패널(지도·상세 대신 발효 태풍별 거리만 안내, 쌍태풍이면 각각 한 줄).
function TrackingStopped({
  entries,
}: {
  entries: { label: string; cur: TrackPoint | null; gate: GateResult }[];
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center dark:border-white/10 dark:bg-white/[0.02]">
      <TyphoonIcon size={28} className="text-zinc-400 dark:text-zinc-500" />
      <span className="text-sm font-semibold text-ink dark:text-on-dark">태풍 추적 중지</span>
      <span className="text-xs text-body dark:text-on-dark-soft">현장·국토 강풍 영향권 밖</span>
      {entries.map((e) => (
        <div
          key={e.label}
          className="mt-1 flex flex-wrap items-center justify-center gap-x-3 text-[11px] text-muted dark:text-on-dark-soft"
        >
          {entries.length > 1 && <span className="font-semibold">{e.label}</span>}
          {e.gate.galeKm > 0 && <span>강풍반경 {Math.round(e.gate.galeKm).toLocaleString()}km</span>}
          {e.gate.siteKm !== null && <span>현장 {Math.round(e.gate.siteKm).toLocaleString()}km</span>}
          {e.gate.koreaKm !== null && <span>한국 {Math.round(e.gate.koreaKm).toLocaleString()}km</span>}
        </div>
      ))}
      {entries.length === 1 && entries[0]?.cur && (
        <span className="text-[10px] text-muted dark:text-on-dark-soft">
          현재 위치 {entries[0].cur.lat.toFixed(1)}, {entries[0].cur.lon.toFixed(1)}
        </span>
      )}
    </div>
  );
}

// 단계 배너 — 경계구역 이상에서 조치를 색상으로 강조(구역 단계 3종 + 영향권 단계 3종).
// title = 원인 태풍 귀속 포함 라벨(예: "제9호 바비 · 비상구역 진입 예보"), lead = 예보 시 도달 리드타임.
// watch(감시구역)는 배너를 띄우지 않는다 — 태풍 시즌 내내 점등되면 배너가 벽지가 된다(패널 텍스트로 충분).
function ZoneBanner({
  zone,
  title,
  advisory,
  lead,
}: {
  zone: Zone;
  title: string;
  advisory: string;
  lead: string;
}) {
  if (zone === "none" || zone === "watch") return null;
  return (
    <div className={`shrink-0 rounded-lg border px-2 py-1.5 text-center leading-tight ${ZONE_BANNER[zone]}`}>
      <span className="text-[11px] font-bold">
        {title}
        {lead ? ` · ${lead}` : ""}
      </span>
      <span className="ml-1 text-[10px]">{advisory}</span>
    </div>
  );
}

// 위협 없음 / 레이더 대기 — 샘플(mock)·발효없음(none)·빈 진로(실데이터 위협 아님)일 때 지도 대신 표시.
// 정책: 실제 태풍 위협이 없으면 진로 레이더를 가동하지 않는다(거짓 추적 점등 방지).
function IdleNoThreat({ note }: { note?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center dark:border-white/10 dark:bg-white/[0.02]">
      <TyphoonIcon size={28} className="text-zinc-400 opacity-60 dark:text-zinc-500" />
      <span className="text-sm font-semibold text-ink dark:text-on-dark">태풍 위협 없음</span>
      <span className="text-xs text-body dark:text-on-dark-soft">레이더 대기</span>
      {note && (
        <span className="mt-1 text-[10px] text-muted dark:text-on-dark-soft">{note}</span>
      )}
    </div>
  );
}

export function TyphoonTrack({ lat, lon }: { lat?: number; lon?: number }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/typhoon", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: Payload) => {
          if (!alive) return;
          if (j.ok) {
            setData(j);
            setError(null);
          } else setError("조회 실패");
        })
        .catch(() => alive && setError("네트워크 오류"));
    load();
    const id = setInterval(load, 30 * 60 * 1000); // 30분마다 갱신
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // 발효 태풍 배열 — 신 서버는 typhoons 동봉, 구 응답(서버 캐시·배포 시차)은 단일 payload 폴백.
  const typhoons = useMemo<TyphoonRec[]>(() => {
    if (!data) return [];
    return data.typhoons?.length ? data.typhoons : [data];
  }, [data]);
  const liveList = useMemo(
    () => typhoons.filter((t) => t.source === "live" && t.track.length > 0),
    [typhoons],
  );

  // 태풍별 영향권 판정(현재 위치 + 예보점 선행) 후 worst-of 합성 — 쌍태풍에서 근접 태풍이 드랍되지 않게.
  const gates = useMemo(
    () => liveList.map((t) => computeGate(t.track, t.currentIndex, lat, lon)),
    [liveList, lat, lon],
  );
  const worstIdx = gates.length > 0 ? pickWorst(gates) : -1;
  const active = worstIdx >= 0 ? (liveList[worstIdx] ?? null) : null;
  const gate = worstIdx >= 0 ? (gates[worstIdx] ?? EMPTY_GATE) : EMPTY_GATE;
  const cur = useMemo<TrackPoint | null>(() => {
    if (!active || active.track.length === 0) return null;
    return active.track[Math.min(active.currentIndex, active.track.length - 1)] ?? null;
  }, [active]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted dark:text-on-dark-soft">
        태풍정보 — {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted dark:text-on-dark-soft">
        태풍정보 불러오는 중…
      </div>
    );
  }

  // 실제 위협 = 실데이터(live) 태풍 1개 이상. 샘플(mock)·발효없음(none)·빈 진로는 위협 아님 → 레이더 미가동.
  const realThreat = liveList.length > 0;
  const idleNote =
    data.source === "mock" ? "활용신청 승인 후 실시간 가동" : "발효 중인 태풍 없음";
  // 표시 대상 = worst 태풍(발효 중) ?? 대표(샘플/없음 안내용). 헤더·지도·상세·모달이 같은 소스를 쓴다.
  const disp = active ?? typhoons[0] ?? data;
  // 배너/푸터 존 라벨 — 예보 선행 점등이면 "예보" 접미로 실측과 근거를 구분.
  const zoneLabelText = ZONE_LABEL[gate.zone] + (gate.forecast ? " 예보" : "");
  const leadText = gate.forecast ? fmtLead(gate.leadHours) : "";
  // 반경 축이 등급을 이겼을 때만 구역 근거를 병기(등급 자체가 구역명이면 중복이다).
  const kmaNote = KMA_ZONE_LABEL[gate.zone] ? "" : KMA_ZONE_LABEL[gate.kmaZone];

  const badge =
    data.source === "live" ? "기상청 실시간" : data.source === "mock" ? "샘플(대기)" : "발효 없음";
  const badgeClass =
    data.source === "live"
      ? "bg-emerald-500 text-white"
      : data.source === "mock"
        ? "bg-amber-500 text-white"
        : "bg-zinc-400 text-white dark:bg-white/15";

  // 출처·판정 요약 — 지도가 있으면 지도 위 오버레이(onMap = 밝은 톤), 없으면 패널 아래 기본 톤.
  const footerContent = (onMap: boolean) => (
    <>
      {!realThreat
        ? data.source === "mock"
          ? "샘플 데이터 · 활용신청 승인 후 실시간 가동"
          : "현재 발효 중인 태풍 없음 · 레이더 대기"
        : `기상청 태풍정보${disp.tmFc ? ` · ${fmtTmFc(disp.tmFc)} 발표` : ""}`}
      {realThreat &&
        (gate.tracking ? (
          <>
            {" · "}
            <span
              className={`font-semibold ${onMap ? ZONE_TEXT_ON_MAP[gate.zone] : ZONE_TEXT[gate.zone]}`}
            >
              {zoneLabelText}
            </span>
            {leadText ? ` · ${leadText}` : ""}
            {kmaNote ? ` · 기상청 ${kmaNote}` : ""}
            {gate.galeKm > 0 ? ` · 강풍반경 ${Math.round(gate.galeKm).toLocaleString()}km` : ""}
            {gate.siteKm !== null
              ? ` · 현장 ${Math.round(gate.siteKm).toLocaleString()}km`
              : ` · 한국 ${Math.round(gate.koreaKm ?? 0).toLocaleString()}km`}
            {liveList.length > 1 ? ` · 발효 태풍 ${liveList.length}개 감시` : ""}
          </>
        ) : (
          <>
            {" · "}
            <span className="font-semibold text-zinc-500 dark:text-on-dark-soft">
              국토 강풍 영향권 밖 · 추적 중지
            </span>
          </>
        ))}
    </>
  );

  return (
    <div className="flex h-full flex-col gap-1.5 p-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink dark:text-on-dark">
            <TyphoonIcon /> 태풍 진로
          </span>
          {disp.name && (
            <span className="truncate text-xs text-body dark:text-on-dark-soft">
              {disp.seq && disp.seq !== "샘플" ? `제${disp.seq}호 ` : ""}
              {disp.name}
              {disp.nameEn ? ` (${disp.nameEn})` : ""}
              {liveList.length > 1 ? ` 외 ${liveList.length - 1}` : ""}
            </span>
          )}
        </div>
        <span className={`shrink-0 rounded-pill px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}>
          {badge}
        </span>
      </div>

      {!realThreat ? (
        <>
          <IdleNoThreat note={idleNote} />
          <p className="shrink-0 text-center text-[10px] text-muted dark:text-on-dark-soft">
            {footerContent(false)}
          </p>
        </>
      ) : gate.tracking ? (
        <>
          {/* 태풍명은 헤더에 이미 있다 — 쌍태풍일 때만 원인 귀속을 위해 배너에도 넣는다. */}
          <ZoneBanner
            zone={gate.zone}
            title={`${liveList.length > 1 && active ? `${typhoonLabel(active)} · ` : ""}${zoneLabelText}`}
            advisory={(gate.forecast ? ZONE_FORECAST_ADVISORY : ZONE_ADVISORY)[gate.zone]}
            lead={leadText}
          />
          {/* 지도가 카드를 꽉 채우고(정사각 제한 없음) 관측값·출처는 그 위에 얹는다.
              텍스트를 아래로 빼면 그만큼 지도가 줄어든다 — 지도가 이 패널의 본체다. */}
          <button
            type="button"
            onClick={() => setOpen(true)}
            title="클릭하여 크게 보기"
            className="group relative flex min-h-[120px] flex-1 overflow-hidden rounded-lg"
          >
            <SlippyMap
              track={disp.track}
              currentIndex={disp.currentIndex}
              interactive={false}
              siteLat={lat}
              siteLon={lon}
            />
            <span className="pointer-events-none absolute right-1.5 top-1.5 z-10 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
              ⤢ 크게 보기
            </span>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-1.5 pb-1.5 pt-6">
              {cur && (
                <div className="grid grid-cols-3 gap-1.5">
                  <Stat label="중심기압" value={cur.pressureHpa !== undefined ? `${cur.pressureHpa}` : "--"} unit="hPa" />
                  <Stat label="최대풍속" value={cur.maxWindMs !== undefined ? `${cur.maxWindMs}` : "--"} unit="m/s" />
                  <Stat
                    label="이동"
                    value={cur.dir ?? "--"}
                    unit={cur.speedKmh !== undefined ? `${cur.speedKmh}km/h` : ""}
                  />
                </div>
              )}
              <p className="text-center text-[11px] font-medium leading-tight text-white">
                {footerContent(true)}
              </p>
            </div>
          </button>
        </>
      ) : (
        <>
          <TrackingStopped
            entries={liveList.map((t, i) => ({
              label: typhoonLabel(t),
              cur: t.track[Math.min(t.currentIndex, t.track.length - 1)] ?? null,
              gate: gates[i] ?? EMPTY_GATE,
            }))}
          />
          <p className="shrink-0 text-center text-[10px] text-muted dark:text-on-dark-soft">
            {footerContent(false)}
          </p>
        </>
      )}

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <TyphoonModal t={disp} onClose={() => setOpen(false)} siteLat={lat} siteLon={lon} />,
          document.body,
        )}
    </div>
  );
}

// 관측값 — 지도 위에 얹히므로 반투명 검정 배경 + 흰 글씨로 위성 배경과 분리한다.
// big = 확대 팝업용(인라인보다 한 단계 큰 활자).
function Stat({
  label,
  value,
  unit,
  big,
}: {
  label: string;
  value: string;
  unit?: string;
  big?: boolean;
}) {
  return (
    <div className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-black/55 px-2 py-1 text-center backdrop-blur-[2px]">
      <span className={`text-white/75 ${big ? "text-[12px]" : "text-[10px]"}`}>{label}</span>
      <span className={`font-mono font-bold leading-none text-white ${big ? "text-[18px]" : "text-[14px]"}`}>
        {value}
        {unit && (
          <span className={`ml-0.5 font-normal text-white/75 ${big ? "text-[11px]" : "text-[10px]"}`}>
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}

// 확대 팝업 — 정식 슬리피맵(위성, 휠/버튼 줌 + 드래그 팬) + 현재 정보. 배경/ESC/닫기 해제.
// t = 인라인 지도와 동일한 표시 대상 태풍(worst) — 크게 보기에서 다른 진로가 뜨지 않게 단일 소스.
function TyphoonModal({
  t,
  onClose,
  siteLat,
  siteLon,
}: {
  t: TyphoonRec;
  onClose: () => void;
  siteLat?: number;
  siteLon?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cur = t.track[Math.min(t.currentIndex, t.track.length - 1)] ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="태풍 진로 확대"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 dark:bg-black/80"
    >
      {/* 폭 — 궤적이 쌓이면 경도 스팬이 넓어진다(돌핀 40°). max-w-lg(512px) 에서는 z4 가 안 들어가
          z3 으로 떨어지며 호주까지 나왔다. 넓혀야 태풍–현장 관계가 적정 배율로 보인다. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-hairline-strong bg-canvas dark:border-white/10 dark:bg-surface-dark"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-2.5 dark:border-white/10">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500 vital-blink-caution" />
            <h2 className="flex min-w-0 items-center gap-1.5 text-base font-bold text-ink dark:text-on-dark">
              <TyphoonIcon size={18} className="shrink-0" />
              <span className="truncate">태풍 진로{t.name ? ` · ${t.name}` : ""}</span>
            </h2>
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

        {/* 지도가 팝업 본체를 꽉 채우고(정사각 제한 없음) 관측값·안내는 그 위에 얹는다. */}
        <div className="relative h-[72vh] w-full shrink-0 overflow-hidden">
          <SlippyMap
            track={t.track}
            currentIndex={t.currentIndex}
            interactive
            siteLat={siteLat}
            siteLon={siteLon}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-3 pt-10">
            {cur && (
              <div className="grid grid-cols-3 gap-2">
                <Stat
                  label="중심기압"
                  value={cur.pressureHpa !== undefined ? `${cur.pressureHpa}` : "--"}
                  unit="hPa"
                  big
                />
                <Stat
                  label="최대풍속"
                  value={cur.maxWindMs !== undefined ? `${cur.maxWindMs}` : "--"}
                  unit="m/s"
                  big
                />
                <Stat
                  label="이동"
                  value={cur.dir ?? "--"}
                  unit={cur.speedKmh !== undefined ? `${cur.speedKmh}km/h` : ""}
                  big
                />
              </div>
            )}
            <p className="text-center text-[12px] font-medium leading-tight text-white/90">
              {t.source === "mock"
                ? t.note ?? "샘플 진로 — 활용신청 승인 후 실시간"
                : `태풍 심볼=현재 위치 · 실선=지나온 경로 · 점선=예보 진로 · 옅은 원=70% 확률반경(중심이 있을 범위, 강풍 범위 아님) · 휠/＋−·드래그${t.tmFc ? ` · ${fmtTmFc(t.tmFc)} 발표` : ""}`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
