// 태풍 진로 시각화 — Esri 위성 베이스맵(+지명·경계 라벨) 위에 진로 폴리라인 + 현재위치 + 중심기압/최대풍속.
// 인라인(캐러셀)은 진로에 맞춰 자동 프레이밍, 팝업은 정식 슬리피맵(동적 타일 줌+드래그 팬)으로 확대해도 선명.
// 데이터: /api/typhoon(기상청 getTyphoonInfo). 미승인/비시즌 시 샘플/없음 상태로 안전 표시.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
};
type Payload = {
  ok: boolean;
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

const MIN_Z = 3;
const MAX_Z = 11;
const clampZoom = (z: number) => Math.max(MIN_Z, Math.min(MAX_Z, z));
const clampLat = (l: number) => Math.max(8, Math.min(55, l));
const clampLon = (l: number) => Math.max(100, Math.min(165, l));

// Esri 타일(키 불필요). 위성 = World_Imagery(jpeg), 라벨 = 경계·지명 오버레이(투명 png). URL은 {z}/{y}/{x}.
const SAT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const REF =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile";

// 부모 영역을 측정해 가장 큰 정사각형을 중앙 배치(flex 컨텍스트 무관 채움).
function SquareFit({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSide(Math.floor(Math.min(r.width, r.height)));
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

type View = { center: { lat: number; lon: number }; zoom: number };

// 정식 슬리피맵 — 위성 타일을 center+zoom 으로 실시간 배치(확대 시 더 높은 줌 타일을 로드 → 항상 선명).
// interactive=true 면 휠 줌(커서 기준)+드래그 팬+버튼. false 면 진로에 맞춰 자동 프레이밍만(정적).
function SlippyMap({
  track,
  currentIndex,
  interactive,
}: {
  track: TrackPoint[];
  currentIndex: number;
  interactive: boolean;
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
  const fit = useCallback(
    (w: number, h: number): View => {
      if (track.length === 0) return { center: { lat: 34, lon: 128 }, zoom: 5 };
      let minLat = Infinity,
        maxLat = -Infinity,
        minLon = Infinity,
        maxLon = -Infinity;
      for (const p of track) {
        minLat = Math.min(minLat, p.lat);
        maxLat = Math.max(maxLat, p.lat);
        minLon = Math.min(minLon, p.lon);
        maxLon = Math.max(maxLon, p.lon);
      }
      const center = { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
      if (w === 0 || h === 0) return { center, zoom: 5 };
      let zoom = MIN_Z;
      for (let z = MAX_Z; z >= MIN_Z; z--) {
        const spanX = Math.abs(lonToWorldX(maxLon, z) - lonToWorldX(minLon, z));
        const spanY = Math.abs(latToWorldY(minLat, z) - latToWorldY(maxLat, z));
        if (spanX <= w * 0.8 && spanY <= h * 0.8) {
          zoom = z;
          break;
        }
      }
      return { center, zoom };
    },
    [track],
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
  }

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
          {polyPts.length > 1 && (
            <polyline
              points={polyPts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#f87171"
              strokeWidth={2.5}
              strokeDasharray="6 5"
              strokeLinejoin="round"
            />
          )}
          {polyPts.map((p, i) => {
            const cur = i === currentIndex;
            return (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={cur ? 7 : 4.5}
                fill={cur ? "#ef4444" : "rgba(248,113,113,0.7)"}
                stroke="#fff"
                strokeWidth={cur ? 2 : 1.3}
              />
            );
          })}
        </svg>
      )}

      {interactive && (
        <>
          <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
            <MapBtn label="＋" onClick={() => zoomBy(1)} title="확대" />
            <MapBtn label="－" onClick={() => zoomBy(-1)} title="축소" />
            <MapBtn label="⤾" onClick={reset} title="원래대로" />
          </div>
          <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white">
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
      className="flex h-7 w-7 items-center justify-center rounded bg-black/55 text-sm font-bold text-white transition hover:bg-black/80"
    >
      {label}
    </button>
  );
}

function fmtTmFc(s?: string): string {
  if (!s || s.length < 12) return "";
  return `${s.slice(4, 6)}/${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
}

// ── 작업현장 조기 경보 게이팅 — 기상청 강풍반경(rad15)/폭풍반경(rad25) 기준 영향권 판정 ──
// 태풍 중심에서 15m/s(강풍)·25m/s(폭풍) 바람이 미치는 실제 반경으로 현장/국토 영향을 판정한다.
// 구 방식(한국/현장 고정거리 500·1000km)은 임의값이라 폐기 — 반경 미제공 시에만 폴백값 사용.
const KOREA_CENTER = { lat: 36.0, lon: 127.8 }; // 한반도 중앙 내륙 근사
const APPROACH_LEAD_KM = 300; // 강풍역 바깥 '접근 대비'(조기 인지) 마진
const KOREA_REACH_BUFFER_KM = 400; // 현장 GPS 없을 때 국토 가장자리 근사(강풍역이 국토에 닿는지)
const SITE_FALLBACK_KM = 500; // 강풍반경 미제공 시 현장 폴백 거리
const KOREA_FALLBACK_KM = 1000; // 강풍반경 미제공 시 한국 폴백 거리

// 태풍 영향권 등급 — 폭풍역(≥25m/s)·강풍역(≥15m/s)·접근 대비·밖.
type Zone = "storm" | "gale" | "approach" | "none";
const ZONE_LABEL: Record<Zone, string> = {
  storm: "폭풍역 진입",
  gale: "강풍역 진입",
  approach: "영향권 접근",
  none: "영향권 밖",
};
// 작업중지 안내 — 건설 작업중지 기준(산업안전보건기준에 관한 규칙 제37·143·383조).
const ZONE_ADVISORY: Record<Zone, string> = {
  storm: "전면 작업중지 · 순간풍속 25m/s급 — 타워크레인·고소·양중 중지·대피",
  gale: "작업중지 · 순간풍속 15m/s급 — 타워크레인 운전·철골·고소작업 중지",
  approach: "진입 대비 · 자재 결박·타워크레인 하강·가설물 점검",
  none: "",
};
const ZONE_TEXT: Record<Zone, string> = {
  storm: "text-red-600 dark:text-red-300",
  gale: "text-orange-600 dark:text-orange-300",
  approach: "text-amber-600 dark:text-amber-300",
  none: "text-zinc-500 dark:text-on-dark-soft",
};
const ZONE_BANNER: Record<Zone, string> = {
  storm: "border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
  gale: "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300",
  approach: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  none: "",
};

// 강풍/폭풍반경 문자열("300"·"0"·"")을 km 숫자로. 값 없음/0 이하 → 0.
function parseRadiusKm(s?: string): number {
  const n = s ? Number.parseFloat(s) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = (bLat - aLat) * D2R;
  const dLon = (bLon - aLon) * D2R;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * D2R) * Math.cos(bLat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
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

// 영향권 밖 — 추적 중지 패널(지도·상세 대신 거리만 안내).
function TrackingStopped({
  cur,
  siteKm,
  koreaKm,
  galeKm,
}: {
  cur: TrackPoint | null;
  siteKm: number | null;
  koreaKm: number | null;
  galeKm: number;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center dark:border-white/10 dark:bg-white/[0.02]">
      <TyphoonIcon size={28} className="text-zinc-400 dark:text-zinc-500" />
      <span className="text-sm font-semibold text-ink dark:text-on-dark">태풍 추적 중지</span>
      <span className="text-xs text-body dark:text-on-dark-soft">현장·국토 강풍 영향권 밖</span>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 text-[11px] text-muted dark:text-on-dark-soft">
        {galeKm > 0 && <span>강풍반경 {Math.round(galeKm).toLocaleString()}km</span>}
        {siteKm !== null && <span>현장 {Math.round(siteKm).toLocaleString()}km</span>}
        {koreaKm !== null && <span>한국 {Math.round(koreaKm).toLocaleString()}km</span>}
      </div>
      {cur && (
        <span className="text-[10px] text-muted dark:text-on-dark-soft">
          현재 위치 {cur.lat.toFixed(1)}, {cur.lon.toFixed(1)}
        </span>
      )}
    </div>
  );
}

// 작업중지 안내 배너 — 영향권(폭풍역/강풍역/접근) 진입 시 건설 작업중지 조치를 색상으로 강조.
function WorkStoppageBanner({ zone, advisory }: { zone: Zone; advisory: string }) {
  if (zone === "none") return null;
  return (
    <div className={`shrink-0 rounded-lg border px-2 py-1.5 text-center leading-tight ${ZONE_BANNER[zone]}`}>
      <span className="text-[11px] font-bold">{ZONE_LABEL[zone]}</span>
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

  const cur = useMemo<TrackPoint | null>(() => {
    if (!data || data.track.length === 0) return null;
    return data.track[Math.min(data.currentIndex, data.track.length - 1)] ?? null;
  }, [data]);

  // 강풍반경(rad15)/폭풍반경(rad25) 기준 영향권 판정 — 태풍 강풍역/폭풍역이 현장(또는 국토)에 닿는지.
  // 현장 GPS(작업자 등록) 있으면 현장 기준(정밀), 없으면 국토 중앙점 근사로 판정.
  const gate = useMemo(() => {
    if (!cur)
      return {
        tracking: false,
        zone: "none" as Zone,
        siteKm: null as number | null,
        koreaKm: null as number | null,
        galeKm: 0,
        stormKm: 0,
      };
    const galeKm = parseRadiusKm(cur.rad15); // 강풍반경(15m/s)
    const stormKm = parseRadiusKm(cur.rad25); // 폭풍반경(25m/s)
    const koreaKm = haversineKm(cur.lat, cur.lon, KOREA_CENTER.lat, KOREA_CENTER.lon);
    const siteKm =
      typeof lat === "number" && typeof lon === "number"
        ? haversineKm(cur.lat, cur.lon, lat, lon)
        : null;

    let zone: Zone = "none";
    if (galeKm > 0) {
      if (siteKm !== null) {
        // 현장 GPS 기준(정밀) — 강풍역/폭풍역 진입 여부.
        if (stormKm > 0 && siteKm <= stormKm) zone = "storm";
        else if (siteKm <= galeKm) zone = "gale";
        else if (siteKm <= galeKm + APPROACH_LEAD_KM) zone = "approach";
      } else {
        // 현장 GPS 없음 — 국토 중앙점 근사로 강풍역 국토 도달 판정.
        if (koreaKm <= galeKm + KOREA_REACH_BUFFER_KM) zone = "gale";
        else if (koreaKm <= galeKm + KOREA_REACH_BUFFER_KM + APPROACH_LEAD_KM) zone = "approach";
      }
    } else {
      // 강풍반경 미제공 — 고정거리 폴백(접근 대비만).
      const inSite = siteKm !== null && siteKm <= SITE_FALLBACK_KM;
      const inKorea = koreaKm <= KOREA_FALLBACK_KM;
      if (inSite || inKorea) zone = "approach";
    }
    return { tracking: zone !== "none", zone, siteKm, koreaKm, galeKm, stormKm };
  }, [cur, lat, lon]);

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

  // 실제 위협 = 실데이터(live) + 발효 진로 존재. 샘플(mock)·발효없음(none)·빈 진로는 위협 아님 → 레이더 미가동.
  const realThreat = data.source === "live" && data.track.length > 0;
  const idleNote =
    data.source === "mock" ? "활용신청 승인 후 실시간 가동" : "발효 중인 태풍 없음";

  const badge =
    data.source === "live" ? "기상청 실시간" : data.source === "mock" ? "샘플(대기)" : "발효 없음";
  const badgeClass =
    data.source === "live"
      ? "bg-emerald-500 text-white"
      : data.source === "mock"
        ? "bg-amber-500 text-white"
        : "bg-zinc-400 text-white dark:bg-white/15";

  return (
    <div className="flex h-full flex-col gap-1.5 p-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink dark:text-on-dark">
            <TyphoonIcon /> 태풍 진로
          </span>
          {data.name && (
            <span className="truncate text-xs text-body dark:text-on-dark-soft">
              {data.seq && data.seq !== "샘플" ? `제${data.seq}호 ` : ""}
              {data.name}
              {data.nameEn ? ` (${data.nameEn})` : ""}
            </span>
          )}
        </div>
        <span className={`shrink-0 rounded-pill px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}>
          {badge}
        </span>
      </div>

      {!realThreat ? (
        <IdleNoThreat note={idleNote} />
      ) : gate.tracking ? (
        <>
          <WorkStoppageBanner zone={gate.zone} advisory={ZONE_ADVISORY[gate.zone]} />
          <button
            type="button"
            onClick={() => setOpen(true)}
            title="클릭하여 크게 보기"
            className="group relative flex min-h-0 flex-1"
          >
            <SquareFit>
              <SlippyMap track={data.track} currentIndex={data.currentIndex} interactive={false} />
            </SquareFit>
            <span className="pointer-events-none absolute right-1.5 top-1.5 z-10 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
              ⤢ 크게 보기
            </span>
          </button>

          {cur && (
            <div className="grid shrink-0 grid-cols-3 gap-1.5">
              <Stat label="중심기압" value={cur.pressureHpa !== undefined ? `${cur.pressureHpa}` : "--"} unit="hPa" />
              <Stat label="최대풍속" value={cur.maxWindMs !== undefined ? `${cur.maxWindMs}` : "--"} unit="m/s" />
              <Stat
                label="이동"
                value={cur.dir ?? "--"}
                unit={cur.speedKmh !== undefined ? `${cur.speedKmh}km/h` : ""}
              />
            </div>
          )}
        </>
      ) : (
        <TrackingStopped cur={cur} siteKm={gate.siteKm} koreaKm={gate.koreaKm} galeKm={gate.galeKm} />
      )}

      <p className="shrink-0 text-center text-[10px] text-muted dark:text-on-dark-soft">
        {!realThreat
          ? data.source === "mock"
            ? "샘플 데이터 · 활용신청 승인 후 실시간 가동"
            : "현재 발효 중인 태풍 없음 · 레이더 대기"
          : `기상청 태풍정보${data.tmFc ? ` · ${fmtTmFc(data.tmFc)} 발표` : ""}`}
        {realThreat &&
          (gate.tracking ? (
            <>
              {" · "}
              <span className={`font-semibold ${ZONE_TEXT[gate.zone]}`}>{ZONE_LABEL[gate.zone]}</span>
              {gate.galeKm > 0 ? ` · 강풍반경 ${Math.round(gate.galeKm).toLocaleString()}km` : ""}
              {gate.siteKm !== null
                ? ` · 현장 ${Math.round(gate.siteKm).toLocaleString()}km`
                : ` · 한국 ${Math.round(gate.koreaKm ?? 0).toLocaleString()}km`}
            </>
          ) : (
            <>
              {" · "}
              <span className="font-semibold text-zinc-500 dark:text-on-dark-soft">국토 강풍 영향권 밖 · 추적 중지</span>
            </>
          ))}
      </p>

      {open &&
        typeof document !== "undefined" &&
        createPortal(<TyphoonModal data={data} onClose={() => setOpen(false)} />, document.body)}
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  // 라벨 + 값 + 단위를 한 줄로 표시. 텍스트를 줄여 좁은 박스(패널 크기 불변) 안에 줄바꿈 없이 들어가게 한다.
  return (
    <div className="flex min-h-[2.25rem] items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-canvas px-1.5 py-1 text-center dark:bg-surface-dark">
      <span className="text-[9px] text-muted dark:text-on-dark-soft">{label}</span>
      <span className="font-mono text-[11px] font-bold leading-none text-ink dark:text-on-dark">
        {value}
        {unit && <span className="ml-0.5 text-[8px] font-normal text-muted dark:text-on-dark-soft">{unit}</span>}
      </span>
    </div>
  );
}

// 확대 팝업 — 정식 슬리피맵(위성, 휠/버튼 줌 + 드래그 팬) + 현재 정보. 배경/ESC/닫기 해제.
function TyphoonModal({ data, onClose }: { data: Payload; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cur = data.track[Math.min(data.currentIndex, data.track.length - 1)] ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="태풍 진로 확대"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 dark:bg-black/80"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-hairline-strong bg-canvas dark:border-white/10 dark:bg-surface-dark"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-2.5 dark:border-white/10">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500 vital-blink-caution" />
            <h2 className="flex min-w-0 items-center gap-1.5 text-base font-bold text-ink dark:text-on-dark">
              <TyphoonIcon size={18} className="shrink-0" />
              <span className="truncate">태풍 진로{data.name ? ` · ${data.name}` : ""}</span>
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

        <div className="shrink-0 overflow-hidden bg-slate-100 p-3 dark:bg-black/40">
          <div className="h-[60vh] w-full">
            <SquareFit>
              <SlippyMap track={data.track} currentIndex={data.currentIndex} interactive />
            </SquareFit>
          </div>
        </div>

        <div className="shrink-0 border-t border-hairline px-4 py-2.5 dark:border-white/10">
          {cur && (
            <div className="grid grid-cols-3 gap-2">
              <Stat label="중심기압" value={cur.pressureHpa !== undefined ? `${cur.pressureHpa}` : "--"} unit="hPa" />
              <Stat label="최대풍속" value={cur.maxWindMs !== undefined ? `${cur.maxWindMs}` : "--"} unit="m/s" />
              <Stat
                label="이동"
                value={cur.dir ?? "--"}
                unit={cur.speedKmh !== undefined ? `${cur.speedKmh}km/h` : ""}
              />
            </div>
          )}
          <p className="mt-1.5 text-center text-[10px] text-muted dark:text-on-dark-soft">
            {data.source === "mock"
              ? data.note ?? "샘플 진로 — 활용신청 승인 후 실시간"
              : `Esri 위성 · 빨강 점=현재 위치, 점선=이동 경로 · 휠/＋− 확대 · 드래그 이동${data.tmFc ? ` · ${fmtTmFc(data.tmFc)} 발표` : ""}`}
          </p>
        </div>
      </div>
    </div>
  );
}
