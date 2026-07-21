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
  statusLabel: string; // 낙상 감지 / SOS 요청 / 위험 / 주의 / 정상 / 대기
  tone: "danger" | "caution" | "normal" | "idle";
  ageSec: number | null;
};

// 지도에 못 올린 작업자(수신 상태 패널용) — 사유는 표시 문구 그대로 받는다.
export type WorkerMapExcluded = { workerId: string; name: string; reason: string };

// 현장 구획 근사 원 — 현장 좌표(작업자 GPS 평균·서버 캐시) 중심 반경 표시(지적 구획 아님).
export type SiteCircle = { lat: number; lon: number; radiusM: number };

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
}: {
  points: WorkerMapPoint[];
  excluded: WorkerMapExcluded[];
  siteCircle?: SiteCircle;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // 수신 상태 펼침 패널 — 칩 클릭 토글, 지도 드래그 시작 시 닫힘.
  const [statusOpen, setStatusOpen] = useState(false);
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
  if (view && size.w > 0) {
    const z = view.zoom;
    const tlx = lonToWorldX(view.center.lon, z) - size.w / 2;
    const tly = latToWorldY(view.center.lat, z) - size.h / 2;
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

  return (
    <div className="relative h-full w-full">
      <div
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`relative h-full w-full touch-none select-none overflow-hidden rounded-lg bg-[#0b1420] ${
          grabbing ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        {tiles.map((t) => (
          <span key={t.key}>
            <img
              src={`${SAT}/${t.z}/${t.y}/${t.x}`}
              alt=""
              width={TILE}
              height={TILE}
              draggable={false}
              className="absolute"
              style={{ left: t.left, top: t.top, width: TILE, height: TILE, maxWidth: "none" }}
            />
            <img
              src={`${REF}/${t.z}/${t.y}/${t.x}`}
              alt=""
              width={TILE}
              height={TILE}
              draggable={false}
              className="absolute opacity-80"
              style={{ left: t.left, top: t.top, width: TILE, height: TILE, maxWidth: "none" }}
            />
          </span>
        ))}

        {/* 현장 구획 근사 원(레드라인) — 현장 좌표 중심 반경. 마커 아래 레이어·이벤트 통과. */}
        {circle && siteCircle && (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute rounded-full border-2 border-red-500/90 bg-red-500/10"
              style={{
                left: circle.x - circle.r,
                top: circle.y - circle.r,
                width: circle.r * 2,
                height: circle.r * 2,
              }}
            />
            <span
              className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-pill bg-red-600/85 px-1.5 py-0.5 text-[9px] font-semibold text-white"
              style={{ left: circle.x, top: circle.y - circle.r - 16 }}
            >
              현장 구획(근사) · 반경 {siteCircle.radiusM}m
            </span>
          </>
        )}

        {/* 작업자 마커 — 신호등 톤 점 + 이름 칩. 호버 시 생체 툴팁. */}
        {markers.map(({ p, x, y }) => (
          <div
            key={p.workerId}
            className="absolute z-10"
            style={{ left: x, top: y }}
            onMouseEnter={() => setHoveredId(p.workerId)}
            onMouseLeave={() => setHoveredId((cur) => (cur === p.workerId ? null : cur))}
          >
            <span
              className={`absolute block h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white shadow-[0_0_6px_rgba(0,0,0,0.6)] ${TONE_DOT[p.tone]}`}
            />
            <span className="absolute left-0 top-2 -translate-x-1/2 whitespace-nowrap rounded-pill bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {p.name}
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
          위성지도 © Esri World Imagery
        </div>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setStatusOpen((v) => !v)}
          title="작업자별 GPS 수신 상태 목록 — 항목 클릭 시 해당 작업자로 이동"
          className="absolute bottom-1.5 right-2 z-20 rounded bg-black/45 px-1.5 py-0.5 text-[10px] text-zinc-200 hover:bg-black/70"
        >
          GPS 수신 {points.length} / 전체 {points.length + excluded.length}
          <span aria-hidden className="ml-1 text-[8px]">{statusOpen ? "▼" : "▲"}</span>
        </button>
        {statusOpen && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="wx-cards-scroll absolute bottom-8 right-2 z-30 max-h-64 w-56 overflow-y-auto rounded-xl border border-white/15 bg-[#0d1117]/95 p-2.5 shadow-xl backdrop-blur"
          >
            <p className="text-[10px] font-semibold text-zinc-400">GPS 수신 중 {points.length}명</p>
            <ul className="mt-1 space-y-0.5">
              {points.map((p) => (
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
