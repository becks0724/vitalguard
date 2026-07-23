// 작업자 GPS 지도 모드 — Esri 위성 타일(키·비용 불필요, 태풍 진로와 동일 소스) 위에 작업자 마커 표시.
// 마커 호버 시 생체 데이터(심박·SpO₂·손목온도·상태·수신) 툴팁. 휠 줌(커서 기준)+드래그 팬+리셋.
// 슬리피맵 수학은 TyphoonTrack 의 검증된 패턴을 따르되 현장 스케일(고줌 z18)에 맞게 독립 구현.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type WorkerMapPoint = {
  workerId: string;
  name: string;
  employeeId?: string;
  jobTitle?: string;
  lat: number;
  lon: number;
  heartRate?: number | null;
  spo2?: number | null;
  skinTempC?: number | null;
  statusLabel: string; // 낙상 감지 / SOS 요청 / 위험 / 주의 / 정상 / 대기 / 연결끊김
  tone: "danger" | "caution" | "normal" | "idle";
  ageSec: number | null;
  // 60초(STALE_MS) 초과 미수신 — 마커를 지우지 않고 고스트(마지막 확인 위치)로 유지한다.
  stale?: boolean;
};

// 지도에 못 올린 작업자(수신 상태 패널용) — 사유는 표시 문구 그대로 받는다.
export type WorkerMapExcluded = { workerId: string; name: string; reason: string };

// 현장 구획 근사 원 — 현장 좌표(작업자 GPS 평균·서버 캐시) 중심 반경 표시(지적 구획 아님).
export type SiteCircle = { lat: number; lon: number; radiusM: number };

// 알림 → 지도 포커스 — key 가 바뀔 때마다 해당 좌표로 flyTo + 펄스 링 표시(초기 프레이밍보다 우선).
export type MapFocus = { lat: number; lon: number; key: number };

// 이동 경로 트레일 — 마커 클릭으로 토글, 최근 윈도(TRACK_WINDOW_MIN)의 좌표 시계열 폴리라인.
export type WorkerTrail = {
  workerId: string;
  name: string;
  windowMin: number;
  points: { lat: number; lon: number }[];
};

// 위험구역(진입 금지 존) — 서버 등록분 표시 + 권한있음 계정의 배치/삭제 편집.
export type MapZone = { id: number; name: string; lat: number; lon: number; radiusM: number };

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

// 현장 스케일 — 확대 상한 z18(Esri 국내 위성 안정 커버리지), 초기 프레이밍은 z17 캡(주변 맥락 확보).
const MIN_Z = 5;
const MAX_Z = 18;
const FIT_MAX_Z = 17;
const clampZoom = (z: number) => Math.max(MIN_Z, Math.min(MAX_Z, z));

// Esri 타일(키 불필요). 위성 = World_Imagery(jpeg), 라벨 = 경계·지명 오버레이(투명 png). URL은 {z}/{y}/{x}.
const SAT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const REF =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile";

const TONE_DOT: Record<WorkerMapPoint["tone"], string> = {
  danger: "bg-semantic-down vital-blink-danger",
  caution: "bg-amber-400 vital-blink-caution",
  normal: "bg-semantic-up",
  idle: "bg-slate-400",
};
const TONE_TEXT: Record<WorkerMapPoint["tone"], string> = {
  danger: "text-semantic-down",
  caution: "text-amber-600 dark:text-amber-300",
  normal: "text-semantic-up",
  idle: "text-muted",
};

function fmt(v: number | null | undefined, unit: string): string {
  return v === null || v === undefined ? "--" : `${v}${unit}`;
}

function ageLabel(ageSec: number | null): string {
  if (ageSec === null) return "--";
  if (ageSec < 60) return `${ageSec}초 전`;
  return `${Math.floor(ageSec / 60)}분 전`;
}

type View = { center: { lat: number; lon: number }; zoom: number };

export function WorkerGpsMap({
  points,
  excluded,
  siteCircle,
  sitePolygon,
  focus,
  trail,
  onToggleTrail,
  zones,
  canManage,
  onCreateZone,
  onDeleteZone,
}: {
  points: WorkerMapPoint[];
  excluded: WorkerMapExcluded[];
  siteCircle?: SiteCircle;
  // 현장 필지 경계(연속지적도) 외곽 링 — 있으면 실선 레드라인, 구획 원은 점선 보조로 강등(판정은 원 유지).
  sitePolygon?: { lat: number; lon: number }[];
  focus?: MapFocus;
  trail?: WorkerTrail;
  onToggleTrail?: (workerId: string) => void;
  zones?: MapZone[];
  // 위험구역 편집(배치·삭제) 노출 게이트 — 서버(hasAdminMenuAccess)와 이중.
  canManage?: boolean;
  onCreateZone?: (zone: { name: string; lat: number; lon: number; radiusM: number }) => void;
  onDeleteZone?: (id: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // 수신 상태 펼침 패널 — 칩 클릭 토글, 지도 드래그 시작 시 닫힘.
  const [statusOpen, setStatusOpen] = useState(false);
  // 베이스맵 모드 — sat: Esri 위성(기본) / cad: VWorld 베이스 + 연속지적도 오버레이(서버 프록시).
  const [baseMode, setBaseMode] = useState<"sat" | "cad">("sat");
  // 위험구역 배치 모드 — "＋ 위험구역" 클릭 → 지도 클릭으로 중심 지정 → 이름·반경 폼.
  const [placingZone, setPlacingZone] = useState(false);
  const [zoneDraft, setZoneDraft] = useState<{ lat: number; lon: number } | null>(null);
  const [zoneDraftName, setZoneDraftName] = useState("");
  const [zoneDraftRadius, setZoneDraftRadius] = useState("20");
  // 존 라벨 클릭 팝오버(상세·삭제) 대상 id.
  const [zoneMenuId, setZoneMenuId] = useState<number | null>(null);
  const fittedRef = useRef(false);
  const drag = useRef<{ px: number; py: number; cwx: number; cwy: number } | null>(null);
  // 드래그 팬 직후의 click 을 배치로 오인하지 않기 위한 이동 플래그.
  const dragMovedRef = useRef(false);

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

  // 작업자 bbox 가 화면 70% 안에 들어오는 최대 줌(≤FIT_MAX_Z)으로 프레이밍.
  const fit = useCallback(
    (w: number, h: number): View => {
      if (points.length === 0) return { center: { lat: 36.0, lon: 127.8 }, zoom: 6 };
      let minLat = Infinity,
        maxLat = -Infinity,
        minLon = Infinity,
        maxLon = -Infinity;
      for (const p of points) {
        minLat = Math.min(minLat, p.lat);
        maxLat = Math.max(maxLat, p.lat);
        minLon = Math.min(minLon, p.lon);
        maxLon = Math.max(maxLon, p.lon);
      }
      const center = { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
      if (w === 0 || h === 0) return { center, zoom: FIT_MAX_Z };
      let zoom = MIN_Z;
      for (let z = FIT_MAX_Z; z >= MIN_Z; z--) {
        const spanX = Math.abs(lonToWorldX(maxLon, z) - lonToWorldX(minLon, z));
        const spanY = Math.abs(latToWorldY(minLat, z) - latToWorldY(maxLat, z));
        if (spanX <= w * 0.7 && spanY <= h * 0.7) {
          zoom = z;
          break;
        }
      }
      return { center, zoom };
    },
    [points],
  );

  // 초기 1회만 프레이밍(사용자 조작 보존). 지도 모드 재진입(재마운트) 시 다시 프레이밍.
  useEffect(() => {
    if (size.w === 0) return;
    if (!fittedRef.current) {
      setView(fit(size.w, size.h));
      fittedRef.current = true;
    }
  }, [size, fit]);

  // 알림 포커스 — 같은 key 는 1회만 적용(사용자 조작 보존), 마운트 직후에도 초기 프레이밍을 덮는다.
  const focusKeyRef = useRef<number | null>(null);
  useEffect(() => {
    if (!focus || size.w === 0) return;
    if (focusKeyRef.current === focus.key) return;
    focusKeyRef.current = focus.key;
    fittedRef.current = true;
    setView({
      center: { lat: focus.lat, lon: focus.lon },
      zoom: clampZoom(Math.max(viewRef.current?.zoom ?? FIT_MAX_Z, FIT_MAX_Z)),
    });
  }, [focus, size]);

  const commit = useCallback((center: { lat: number; lon: number }, zoom: number) => {
    setView({ center, zoom: clampZoom(zoom) });
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

  // 수신 목록에서 작업자 클릭 → 그 작업자로 지도 이동(확대 유지·최소 FIT_MAX_Z).
  const flyTo = useCallback(
    (p: WorkerMapPoint) => {
      const z = Math.max(viewRef.current?.zoom ?? FIT_MAX_Z, FIT_MAX_Z);
      commit({ lat: p.lat, lon: p.lon }, z);
    },
    [commit],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    setStatusOpen(false);
    setZoneMenuId(null);
    if (!view) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragMovedRef.current = false;
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
    if (
      Math.abs(e.clientX - drag.current.px) > 4 ||
      Math.abs(e.clientY - drag.current.py) > 4
    ) {
      dragMovedRef.current = true;
    }
    const z = view.zoom;
    const ncx = drag.current.cwx - (e.clientX - drag.current.px);
    const ncy = drag.current.cwy - (e.clientY - drag.current.py);
    commit({ lon: worldXToLon(ncx, z), lat: worldYToLat(ncy, z) }, z);
  };

  // 위험구역 배치 — 배치 모드에서 지도 클릭 시 화면 좌표 → 위경도 역산해 중심 지정.
  const onMapClick = (e: React.MouseEvent) => {
    if (!placingZone || dragMovedRef.current) return;
    const el = ref.current;
    const v = viewRef.current;
    const s = sizeRef.current;
    if (!el || !v || s.w === 0) return;
    const r = el.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const z = v.zoom;
    const tlx = lonToWorldX(v.center.lon, z) - s.w / 2;
    const tly = latToWorldY(v.center.lat, z) - s.h / 2;
    setZoneDraft({ lat: worldYToLat(tly + sy, z), lon: worldXToLon(tlx + sx, z) });
    setPlacingZone(false);
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

  if (points.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted dark:text-on-dark-soft">
        <p>
          GPS 수신 작업자가 없습니다 — 작업자 폰 위치 권한(항상 허용)과 로그인 세션(GPS 표시
          게이트)을 확인하세요.
        </p>
        {excluded.length > 0 && (
          <ul className="wx-cards-scroll max-h-44 w-72 overflow-y-auto rounded-xl border border-hairline p-2 text-left dark:border-white/10">
            {excluded.map((w) => (
              <li key={w.workerId} className="px-1.5 py-1">
                <span className="block truncate text-xs text-ink dark:text-on-dark">{w.name}</span>
                <span className="block truncate text-[10px] text-muted dark:text-on-dark-soft">
                  {w.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── 타일/마커/구획 원 렌더 산출 ──
  const tiles: { key: string; left: number; top: number; z: number; x: number; y: number }[] = [];
  const markers: { p: WorkerMapPoint; x: number; y: number }[] = [];
  let circle: { x: number; y: number; r: number } | null = null;
  let focusPt: { x: number; y: number } | null = null;
  let trailPts: { x: number; y: number }[] | null = null;
  const zoneCircles: { zone: MapZone; x: number; y: number; r: number }[] = [];
  let draftPt: { x: number; y: number; r: number } | null = null;
  let polyPts: { x: number; y: number }[] | null = null;
  if (view && size.w > 0) {
    const z = view.zoom;
    const tlx = lonToWorldX(view.center.lon, z) - size.w / 2;
    const tly = latToWorldY(view.center.lat, z) - size.h / 2;
    const metersPerPx = (lat: number) => (156543.03392 * Math.cos(lat * D2R)) / 2 ** z;
    for (const zone of zones ?? []) {
      zoneCircles.push({
        zone,
        x: lonToWorldX(zone.lon, z) - tlx,
        y: latToWorldY(zone.lat, z) - tly,
        r: zone.radiusM / metersPerPx(zone.lat),
      });
    }
    if (zoneDraft) {
      const radius = Math.min(500, Math.max(5, Number(zoneDraftRadius) || 20));
      draftPt = {
        x: lonToWorldX(zoneDraft.lon, z) - tlx,
        y: latToWorldY(zoneDraft.lat, z) - tly,
        r: radius / metersPerPx(zoneDraft.lat),
      };
    }
    if (focus) {
      focusPt = { x: lonToWorldX(focus.lon, z) - tlx, y: latToWorldY(focus.lat, z) - tly };
    }
    if (trail && trail.points.length >= 2) {
      trailPts = trail.points.map((p) => ({
        x: lonToWorldX(p.lon, z) - tlx,
        y: latToWorldY(p.lat, z) - tly,
      }));
    }
    if (sitePolygon && sitePolygon.length >= 4) {
      polyPts = sitePolygon.map((p) => ({
        x: lonToWorldX(p.lon, z) - tlx,
        y: latToWorldY(p.lat, z) - tly,
      }));
    }
    if (siteCircle) {
      // 미터 → 픽셀 — 웹 메르카토르 지상해상도(위도 보정): 156543.03392·cos(lat)/2^z (m/px, 256px 타일).
      const mpp = (156543.03392 * Math.cos(siteCircle.lat * D2R)) / 2 ** z;
      circle = {
        x: lonToWorldX(siteCircle.lon, z) - tlx,
        y: latToWorldY(siteCircle.lat, z) - tly,
        r: siteCircle.radiusM / mpp,
      };
    }
    const n = 2 ** z;
    const xt0 = Math.floor(tlx / TILE);
    const xt1 = Math.floor((tlx + size.w) / TILE);
    const yt0 = Math.floor(tly / TILE);
    const yt1 = Math.floor((tly + size.h) / TILE);
    for (let yt = yt0; yt <= yt1; yt++) {
      if (yt < 0 || yt >= n) continue;
      for (let xt = xt0; xt <= xt1; xt++) {
        const tx = ((xt % n) + n) % n; // 경도 wrap
        tiles.push({ key: `${xt}-${yt}`, left: xt * TILE - tlx, top: yt * TILE - tly, z, x: tx, y: yt });
      }
    }
    for (const p of points) {
      const x = lonToWorldX(p.lon, z) - tlx;
      const y = latToWorldY(p.lat, z) - tly;
      if (x < -60 || x > size.w + 60 || y < -60 || y > size.h + 60) continue;
      markers.push({ p, x, y });
    }
  }

  // 수신 상태 패널 그룹 — 라이브 수신 vs 연결끊김(마지막 위치 유지) 분리 표기.
  const freshPts = points.filter((p) => !p.stale);
  const stalePts = points.filter((p) => p.stale);

  return (
    <div className="relative h-full w-full">
      <div
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={onMapClick}
        className={`relative h-full w-full touch-none select-none overflow-hidden rounded-lg bg-[#0b1420] ${
          placingZone ? "cursor-crosshair" : grabbing ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        {tiles.map((t) => {
          const style = { left: t.left, top: t.top, width: TILE, height: TILE, maxWidth: "none" as const };
          return baseMode === "sat" ? (
            <span key={t.key}>
              <img src={`${SAT}/${t.z}/${t.y}/${t.x}`} alt="" width={TILE} height={TILE} draggable={false} className="absolute" style={style} />
              <img src={`${REF}/${t.z}/${t.y}/${t.x}`} alt="" width={TILE} height={TILE} draggable={false} className="absolute opacity-80" style={style} />
            </span>
          ) : (
            <span key={t.key}>
              <img src={`/api/vworld-tile?kind=base&z=${t.z}&y=${t.y}&x=${t.x}`} alt="" width={TILE} height={TILE} draggable={false} className="absolute" style={style} />
              <img src={`/api/vworld-tile?kind=cadastral&z=${t.z}&y=${t.y}&x=${t.x}`} alt="" width={TILE} height={TILE} draggable={false} className="absolute opacity-90" style={style} />
            </span>
          );
        })}

        {/* 현장 필지 경계(연속지적도) — 실선 레드라인 폴리곤. 마커 아래 레이어·이벤트 통과. */}
        {polyPts && (
          <svg
            aria-hidden
            data-testid="site-parcel"
            className="pointer-events-none absolute inset-0 z-[6]"
            width={size.w}
            height={size.h}
          >
            <polygon
              points={polyPts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="rgba(239,68,68,0.08)"
              stroke="rgba(239,68,68,0.95)"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
          </svg>
        )}
        {polyPts && polyPts[0] && (
          <span
            className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-pill bg-red-600/85 px-1.5 py-0.5 text-[9px] font-semibold text-white"
            style={{ left: polyPts[0].x, top: polyPts[0].y - 16 }}
          >
            필지 경계(연속지적도)
          </span>
        )}

        {/* 현장 구획 근사 원(레드라인) — 현장 좌표 중심 반경. 마커 아래 레이어·이벤트 통과.
            필지 폴리곤이 있으면 점선 보조로 강등(이탈 판정 기준은 여전히 이 원). */}
        {circle && siteCircle && (
          <>
            <span
              aria-hidden
              className={`pointer-events-none absolute rounded-full ${
                polyPts
                  ? "border-2 border-dashed border-red-500/80 bg-red-500/[0.07]"
                  : "border-2 border-red-500/90 bg-red-500/10"
              }`}
              style={{
                left: circle.x - circle.r,
                top: circle.y - circle.r,
                width: circle.r * 2,
                height: circle.r * 2,
              }}
            />
            <span
              className={`pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-pill px-1.5 py-0.5 text-[9px] font-semibold text-white ${
                polyPts ? "bg-red-500/60" : "bg-red-600/85"
              }`}
              style={{ left: circle.x, top: circle.y - circle.r - 16 }}
            >
              {polyPts
                ? `구획 판정 원 · 반경 ${siteCircle.radiusM}m`
                : `현장 구획(근사) · 반경 ${siteCircle.radiusM}m`}
            </span>
          </>
        )}

        {/* 위험구역(진입 금지 존) — 오렌지 원 + 이름 라벨. 라벨 클릭 시 상세·삭제 팝오버. */}
        {zoneCircles.map(({ zone, x, y, r }) => (
          <span key={`zone-${zone.id}`}>
            <span
              aria-hidden
              className="pointer-events-none absolute rounded-full border-2 border-orange-500/90 bg-orange-500/15"
              style={{ left: x - r, top: y - r, width: r * 2, height: r * 2 }}
            />
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setZoneMenuId((cur) => (cur === zone.id ? null : zone.id));
              }}
              title="위험구역 상세(권한있음 계정은 삭제 가능)"
              className="absolute -translate-x-1/2 whitespace-nowrap rounded-pill bg-orange-600/90 px-1.5 py-0.5 text-[9px] font-semibold text-white hover:bg-orange-500"
              style={{ left: x, top: y - r - 16 }}
            >
              ⚠ {zone.name}
            </button>
            {zoneMenuId === zone.id && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute z-30 w-44 -translate-x-1/2 rounded-xl border border-white/15 bg-[#0d1117]/95 p-2.5 text-left shadow-xl backdrop-blur"
                style={{ left: x, top: y - r + 4 }}
              >
                <p className="truncate text-[12px] font-semibold text-white">⚠ {zone.name}</p>
                <p className="mt-0.5 text-[10px] text-zinc-400">
                  진입 금지 반경 {zone.radiusM}m — 진입 확정 시 경보
                </p>
                <div className="mt-1.5 flex justify-end gap-1.5">
                  {canManage && onDeleteZone && (
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteZone(zone.id);
                        setZoneMenuId(null);
                      }}
                      className="rounded-lg bg-red-600/85 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-red-500"
                    >
                      삭제
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setZoneMenuId(null)}
                    className="rounded-lg bg-white/10 px-2 py-0.5 text-[10px] text-zinc-200 hover:bg-white/20"
                  >
                    닫기
                  </button>
                </div>
              </div>
            )}
          </span>
        ))}

        {/* 위험구역 배치 드래프트 — 클릭 지정 중심 + 반경 미리보기 + 이름·반경 폼. */}
        {draftPt && zoneDraft && (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute rounded-full border-2 border-dashed border-orange-400/90 bg-orange-400/10"
              style={{
                left: draftPt.x - draftPt.r,
                top: draftPt.y - draftPt.r,
                width: draftPt.r * 2,
                height: draftPt.r * 2,
              }}
            />
            <div
              onPointerDown={(e) => e.stopPropagation()}
              data-testid="zone-draft-form"
              className="absolute z-30 w-52 -translate-x-1/2 rounded-xl border border-orange-400/40 bg-[#0d1117]/95 p-2.5 shadow-xl backdrop-blur"
              style={{ left: draftPt.x, top: draftPt.y + draftPt.r + 8 }}
            >
              <p className="text-[11px] font-semibold text-orange-300">위험구역 등록</p>
              <input
                type="text"
                value={zoneDraftName}
                onChange={(e) => setZoneDraftName(e.target.value)}
                placeholder="구역 이름 (예: 크레인 선회 반경)"
                maxLength={40}
                className="mt-1.5 w-full rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white placeholder:text-zinc-500 focus:outline-none"
              />
              <label className="mt-1.5 flex items-center gap-1.5 text-[10px] text-zinc-300">
                반경(m)
                <input
                  type="number"
                  value={zoneDraftRadius}
                  onChange={(e) => setZoneDraftRadius(e.target.value)}
                  min={5}
                  max={500}
                  className="w-16 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white focus:outline-none"
                />
              </label>
              <div className="mt-2 flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const radiusM = Math.min(500, Math.max(5, Number(zoneDraftRadius) || 20));
                    const name = zoneDraftName.trim();
                    if (!name) return;
                    onCreateZone?.({ name, lat: zoneDraft.lat, lon: zoneDraft.lon, radiusM });
                    setZoneDraft(null);
                    setZoneDraftName("");
                  }}
                  disabled={!zoneDraftName.trim()}
                  className="rounded-lg bg-orange-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  등록
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setZoneDraft(null);
                    setZoneDraftName("");
                  }}
                  className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-white/20"
                >
                  취소
                </button>
              </div>
            </div>
          </>
        )}

        {/* 이동 경로 트레일 — 마커 클릭으로 토글된 작업자의 최근 동선 폴리라인(어두운 외곽선 + 시안 라인). */}
        {trailPts && (
          <svg
            aria-hidden
            data-testid="worker-trail"
            className="pointer-events-none absolute inset-0 z-[7]"
            width={size.w}
            height={size.h}
          >
            <polyline
              points={trailPts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#0b1420"
              strokeWidth={4}
              strokeOpacity={0.55}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <polyline
              points={trailPts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#38bdf8"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {trailPts[0] && (
              <circle cx={trailPts[0].x} cy={trailPts[0].y} r={3.5} fill="#38bdf8" stroke="#fff" strokeWidth={1.5} />
            )}
          </svg>
        )}

        {/* 알림 포커스 펄스 링 — 알림 모달 "관제 지도에서 보기"로 진입한 위치 강조(12초 후 부모가 해제). */}
        {focusPt && (
          <span
            aria-hidden
            data-testid="map-focus-pulse"
            className="pointer-events-none absolute z-[9]"
            style={{ left: focusPt.x - 22, top: focusPt.y - 22, width: 44, height: 44 }}
          >
            <span className="absolute inset-0 animate-ping rounded-full bg-red-500/40" />
            <span className="absolute inset-[13px] rounded-full border-2 border-red-400" />
          </span>
        )}

        {/* 작업자 마커 — 신호등 톤 점 + 이름 칩. 호버 시 생체 툴팁.
            연결끊김(stale)은 고스트 마커(회색·점선 링·경과 병기)로 마지막 확인 위치를 유지. */}
        {markers.map(({ p, x, y }) => (
          <div
            key={p.workerId}
            className={`absolute z-10 ${onToggleTrail ? "cursor-pointer" : ""}`}
            style={{ left: x, top: y }}
            onMouseEnter={() => setHoveredId(p.workerId)}
            onMouseLeave={() => setHoveredId((cur) => (cur === p.workerId ? null : cur))}
            // 컨테이너 pointer capture(드래그 팬)가 클릭을 삼키지 않게 전파 차단(줌 버튼과 동일 함정).
            // 배치 모드에선 차단하지 않고 컨테이너 클릭(중심 지정)에 양보한다.
            onPointerDown={(e) => {
              if (!placingZone) e.stopPropagation();
            }}
            onClick={() => {
              if (placingZone) return;
              onToggleTrail?.(p.workerId);
            }}
            title={onToggleTrail ? "클릭하면 최근 이동 경로를 표시/해제합니다" : undefined}
          >
            <span
              className={`absolute block h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_6px_rgba(0,0,0,0.6)] ${
                p.stale
                  ? "border-2 border-dashed border-white/80 bg-slate-500/60"
                  : `ring-2 ring-white ${TONE_DOT[p.tone]}`
              }`}
            />
            <span
              className={`absolute left-0 top-2 -translate-x-1/2 whitespace-nowrap rounded-pill px-1.5 py-0.5 text-[10px] font-medium ${
                p.stale ? "bg-black/45 text-zinc-300" : "bg-black/60 text-white"
              }`}
            >
              {p.name}
              {p.stale ? ` · ${ageLabel(p.ageSec)}` : ""}
            </span>
            {hoveredId === p.workerId && (
              <div className="pointer-events-none absolute bottom-3 left-0 z-20 w-48 -translate-x-1/2 rounded-xl border border-white/15 bg-[#0d1117]/95 p-2.5 text-left shadow-xl backdrop-blur">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-white">{p.name}</span>
                  <span className={`shrink-0 text-[11px] font-semibold ${TONE_TEXT[p.tone]}`}>
                    {p.statusLabel}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[10px] text-zinc-400">
                  {p.employeeId ?? p.workerId}
                  {p.jobTitle ? ` · ${p.jobTitle}` : ""}
                </div>
                {p.stale && (
                  <div className="mt-0.5 text-[10px] text-amber-300/90">
                    마지막 확인 위치 표시 중 — 수신 두절
                  </div>
                )}
                <dl className="mt-1.5 space-y-0.5 text-[11px] text-zinc-300">
                  <div className="flex justify-between">
                    <dt>심박</dt>
                    <dd className="tabular-nums">{fmt(p.heartRate, " bpm")}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>산소포화도</dt>
                    <dd className="tabular-nums">{fmt(p.spo2, " %")}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>손목 온도</dt>
                    <dd className="tabular-nums">{fmt(p.skinTempC, " ℃")}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>수신</dt>
                    <dd className="tabular-nums">{ageLabel(p.ageSec)}</dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        ))}

        {/* 좌상단 컨트롤 컬럼 — 베이스맵 토글 / (권한있음) 위험구역 배치 / 트레일 칩. 전파 차단 필수(드래그 캡처). */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute left-2 top-2 z-20 flex flex-col items-start gap-1.5"
        >
          <div className="flex overflow-hidden rounded-lg bg-black/55 text-[11px] font-semibold text-white backdrop-blur">
            {(
              [
                { mode: "sat", label: "위성" },
                { mode: "cad", label: "지적도" },
              ] as const
            ).map((b) => (
              <button
                key={b.mode}
                type="button"
                onClick={() => setBaseMode(b.mode)}
                title={b.mode === "sat" ? "Esri 위성지도" : "VWorld 베이스맵 + 연속지적도(필지 경계)"}
                className={`px-2.5 py-1 ${baseMode === b.mode ? "bg-primary text-on-primary" : "hover:bg-black/75"}`}
              >
                {b.label}
              </button>
            ))}
          </div>

          {canManage && onCreateZone && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setZoneDraft(null);
                setPlacingZone((v) => !v);
              }}
              title="위험구역(진입 금지 존) 등록 — 클릭 후 지도에서 중심 위치를 클릭하세요"
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold backdrop-blur ${
                placingZone
                  ? "bg-orange-600 text-white"
                  : "bg-black/55 text-orange-300 hover:bg-black/75"
              }`}
            >
              {placingZone ? "지도를 클릭해 중심 지정 · 취소" : "＋ 위험구역"}
            </button>
          )}

          {trail && (
            <div className="flex items-center gap-1.5 rounded-pill bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
              <span className="inline-block h-1.5 w-4 rounded-full bg-[#38bdf8]" aria-hidden />
              경로: {trail.name} · 최근 {trail.windowMin}분
              {trail.points.length < 2 && <span className="text-zinc-400">(경로 데이터 없음)</span>}
              <button
                type="button"
                onClick={() => onToggleTrail?.(trail.workerId)}
                aria-label="이동 경로 해제"
                className="ml-0.5 rounded-full px-1 text-zinc-300 hover:bg-white/15 hover:text-white"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* 줌 컨트롤 — 컨테이너 pointer capture(드래그 팬)가 버튼 클릭을 삼키지 않게 전파 차단 필수. */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute right-2 top-2 z-20 flex flex-col gap-1"
        >
          {[
            { label: "＋", action: () => zoomBy(1), title: "확대" },
            { label: "－", action: () => zoomBy(-1), title: "축소" },
            { label: "⌂", action: reset, title: "작업자 전체 보기" },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              onClick={b.action}
              title={b.title}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/55 text-sm font-semibold text-white backdrop-blur hover:bg-black/75"
            >
              {b.label}
            </button>
          ))}
        </div>

        {/* 출처 + 수신 상태 칩(클릭 시 작업자별 목록 펼침) */}
        <div className="absolute bottom-1.5 left-2 z-20 rounded bg-black/45 px-1.5 py-0.5 text-[9px] text-zinc-300">
          {baseMode === "sat" ? "위성지도 © Esri World Imagery" : "지적도 © 국토교통부 VWorld"}
        </div>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setStatusOpen((v) => !v)}
          title="작업자별 GPS 수신 상태 목록 — 항목 클릭 시 해당 작업자로 이동"
          className="absolute bottom-1.5 right-2 z-20 rounded bg-black/45 px-1.5 py-0.5 text-[10px] text-zinc-200 hover:bg-black/70"
        >
          GPS 수신 {freshPts.length} / 전체 {points.length + excluded.length}
          <span aria-hidden className="ml-1 text-[8px]">{statusOpen ? "▼" : "▲"}</span>
        </button>
        {statusOpen && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="wx-cards-scroll absolute bottom-8 right-2 z-30 max-h-64 w-56 overflow-y-auto rounded-xl border border-white/15 bg-[#0d1117]/95 p-2.5 shadow-xl backdrop-blur"
          >
            <p className="text-[10px] font-semibold text-zinc-400">GPS 수신 중 {freshPts.length}명</p>
            <ul className="mt-1 space-y-0.5">
              {freshPts.map((p) => (
                <li key={p.workerId}>
                  <button
                    type="button"
                    onClick={() => flyTo(p)}
                    title="클릭하면 지도가 이 작업자로 이동합니다"
                    className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left hover:bg-white/10"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[p.tone]}`} />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-100">{p.name}</span>
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">
                      {ageLabel(p.ageSec)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {stalePts.length > 0 && (
              <>
                <p className="mt-2 border-t border-white/10 pt-2 text-[10px] font-semibold text-amber-300/90">
                  연결끊김(마지막 위치) {stalePts.length}명
                </p>
                <ul className="mt-1 space-y-0.5">
                  {stalePts.map((p) => (
                    <li key={p.workerId}>
                      <button
                        type="button"
                        onClick={() => flyTo(p)}
                        title="수신 두절 — 클릭하면 마지막 확인 위치로 이동합니다"
                        className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left hover:bg-white/10"
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full border border-dashed border-white/70 bg-slate-500/60" />
                        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{p.name}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">
                          {ageLabel(p.ageSec)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {excluded.length > 0 && (
              <>
                <p className="mt-2 border-t border-white/10 pt-2 text-[10px] font-semibold text-zinc-400">
                  GPS 미수신 {excluded.length}명
                </p>
                <ul className="mt-1 space-y-0.5">
                  {excluded.map((w) => (
                    <li key={w.workerId} className="px-1.5 py-0.5">
                      <span className="block truncate text-[11px] text-zinc-200">{w.name}</span>
                      <span className="block truncate text-[10px] text-zinc-500">{w.reason}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
