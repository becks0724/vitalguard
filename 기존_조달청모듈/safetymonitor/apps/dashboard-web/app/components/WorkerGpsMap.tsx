// 작업자 GPS 지도 모드 — Esri 위성 타일(키·비용 불필요, 태풍 진로와 동일 소스) 위에 작업자 마커 표시.
// 마커 호버 시 생체 데이터(심박·SpO₂·손목온도·상태·수신) 툴팁. 휠 줌(커서 기준)+드래그 팬+리셋.
// 슬리피맵 수학은 TyphoonTrack 의 검증된 패턴을 따르되 현장 스케일(고줌 z18)에 맞게 독립 구현.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { TRACK_LINE_ACC_MAX_M, type TrackCoarsePoint, type TrackQuality } from "../lib/track";

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
  // 출처별 문턱(애플 60초·갤럭시 150초) 초과 미수신 — 마커를 지우지 않고 고스트(마지막 확인 위치)로 유지한다.
  stale?: boolean;
  // 좌표 자체의 나이(초). `ageSec`(생체 수신 나이)과 **다른 축**이다 — 서버가 좌표를 직전 값에서
  // 이어 주므로 심박이 5초 전이어도 좌표는 40분 전 것일 수 있다. null = 측위 시각 미상.
  fixAgeSec?: number | null;
  /** 측위 수평 정확도(m·기기 보고값). null/미보고 = 원 없이 종전대로 — 없는 것을 정밀로도, 부정확으로도 위장하지 않는다. */
  accM?: number | null;
  /** 마지막 정확 fix 폴백(≤50m 등급 · 30분 창) — 있으면 마커는 이 좌표를 우선하고, 원좌표(lat/lon)는
   *  정확도 원의 닻으로만 남는다("최신 신호는 이 근방" 이라는 사실을 지우지 않는다). */
  goodLat?: number | null;
  goodLon?: number | null;
  goodAccM?: number | null;
  goodAgeSec?: number | null;
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
  /**
   * 선에서 제외된 부정확 점(정확도 > TRACK_LINE_ACC_MAX_M) — 반경=정확도의 흐린 원으로만 그린다(R-33).
   * 없으면 옛 서버다(전부 선으로 그린 채 둔다 — 없는 것을 필터된 것으로 위장하지 않는다).
   */
  coarse?: TrackCoarsePoint[];
  /**
   * 이 구간 좌표의 품질 요약 — 서버가 **솎기 전** 점으로 계산해 보내준다.
   * null = 옛 서버이거나 아직 안 왔다. 없는 것을 0 으로 그리지 않는다.
   */
  quality?: TrackQuality | null;
  /**
   * 근사 동선 — 정확·부정확 점을 시간순으로 병합한 전체 시퀀스(2026-08-31 사용자 지시).
   * 점선으로만 그린다(확정 실선과 시각 구분). 부정확 점이 있을 때만 대시보드가 채운다.
   */
  seq?: { lat: number; lon: number }[];
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

// 현장 스케일 — 베이스맵별 확대 상한. Esri 위성/VWorld 지적도는 국내 z18 안정, VWorld 항공사진은 z19 까지 더 확대.
// 초기 프레이밍은 z17 캡(주변 맥락 확보).
const MIN_Z = 5;
const MODE_MAX_Z = { sat: 18, air: 19, cad: 18 } as const;
const FIT_MAX_Z = 17;
const clampZoom = (z: number, maxZ: number) => Math.max(MIN_Z, Math.min(maxZ, z));

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

// 좌표를 "오래됐다"로 표기하는 경계(초). 앱의 `LocationProvider.maxFixAgeSec` 과 같은 값이다 —
// 앱이 그 나이를 넘긴 좌표를 안 싣기 시작하는 지점이므로, 여기 뜬 값이 그보다 오래됐다면 그것은
// **서버가 이어 준 값**이라는 뜻이다. 두 숫자가 갈리면 화면이 거짓말을 한다.
const FIX_STALE_SEC = 300;

function ageLabel(ageSec: number | null): string {
  if (ageSec === null) return "--";
  if (ageSec < 60) return `${ageSec}초 전`;
  return `${Math.floor(ageSec / 60)}분 전`;
}

// 길이(지연·지속)를 말한다 — `ageLabel` 과 달리 "전" 을 안 붙인다. 시점이 아니라 구간이다.
function durLabel(sec: number): string {
  if (sec < 60) return `${sec}초`;
  return `${Math.floor(sec / 60)}분`;
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
}: {
  points: WorkerMapPoint[];
  excluded: WorkerMapExcluded[];
  siteCircle?: SiteCircle;
  // 현장 필지 경계(연속지적도) 외곽 링 — 있으면 실선 레드라인, 구획 원은 점선 보조로 강등(판정은 원 유지).
  sitePolygon?: { lat: number; lon: number }[];
  focus?: MapFocus;
  trail?: WorkerTrail;
  onToggleTrail?: (workerId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // 수신 상태 펼침 패널 — 칩 클릭 토글, 지도 드래그 시작 시 닫힘.
  const [statusOpen, setStatusOpen] = useState(false);
  // 베이스맵 모드 — air: VWorld 항공사진(**기본** · 국내 고해상·z19 · 2026-08-31 사용자 결정) /
  // sat: Esri 위성(전세계 — VWORLD_KEY 미설정 환경은 이 버튼으로 수동 전환) / cad: VWorld 베이스 + 연속지적도.
  const [baseMode, setBaseMode] = useState<"sat" | "air" | "cad">("air");
  const fittedRef = useRef(false);
  const drag = useRef<{ px: number; py: number; cwx: number; cwy: number } | null>(null);

  // 최신 view/size 를 native wheel 핸들러에서 읽기 위한 ref 미러.
  const viewRef = useRef<View | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  viewRef.current = view;
  sizeRef.current = size;
  // 현재 베이스맵의 확대 상한 미러 — 휠 줌·commit 이 최신값을 읽어 모드별 상한을 적용한다.
  const maxZRef = useRef<number>(MODE_MAX_Z.sat);
  maxZRef.current = MODE_MAX_Z[baseMode];

  // 베이스맵 전환 시 현재 줌이 새 모드 상한을 넘으면 내린다(Esri 는 z19 타일이 없어 공백 방지).
  useEffect(() => {
    setView((v) => (v && v.zoom > MODE_MAX_Z[baseMode] ? { ...v, zoom: MODE_MAX_Z[baseMode] } : v));
  }, [baseMode]);

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
      zoom: clampZoom(Math.max(viewRef.current?.zoom ?? FIT_MAX_Z, FIT_MAX_Z), maxZRef.current),
    });
  }, [focus, size]);

  const commit = useCallback((center: { lat: number; lon: number }, zoom: number) => {
    setView({ center, zoom: clampZoom(zoom, maxZRef.current) });
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
      const nz = clampZoom(z + (e.deltaY < 0 ? 1 : -1), maxZRef.current);
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
        {/* ⚠ 종전 문구는 권한·로그인만 가리켰다. 2026-08-20 실측에서 주 원인은 둘 다 아니었다 —
            폰이 정지하면 좌표가 5분마다 끊기고(그날 커버리지 25.1%), 서버 재기동은 이어 주던
            좌표를 메모리와 함께 지운다. 흔한 순서대로 적어 멀쩡한 권한을 반복 확인하지 않게 한다. */}
        <p>
          GPS 수신 작업자가 없습니다 — 폰이 정지 중이면 수 분 내 다시 잡힙니다. 방금 관제 서버가
          재시작됐다면 좌표 기억이 비워진 것이니 다음 측위까지 기다리세요. 계속되면 작업자 폰
          위치 권한(항상 허용)과 로그인 세션(GPS 표시 게이트)을 확인하세요.
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
  const markers: { p: WorkerMapPoint; x: number; y: number; accR: number | null; rawX: number; rawY: number }[] = [];
  let circle: { x: number; y: number; r: number } | null = null;
  let focusPt: { x: number; y: number } | null = null;
  let trailPts: { x: number; y: number }[] | null = null;
  let coarsePts: { x: number; y: number; r: number }[] | null = null;
  let seqPts: { x: number; y: number }[] | null = null;
  let polyPts: { x: number; y: number }[] | null = null;
  if (view && size.w > 0) {
    const z = view.zoom;
    const tlx = lonToWorldX(view.center.lon, z) - size.w / 2;
    const tly = latToWorldY(view.center.lat, z) - size.h / 2;
    const metersPerPx = (lat: number) => (156543.03392 * Math.cos(lat * D2R)) / 2 ** z;
    if (focus) {
      focusPt = { x: lonToWorldX(focus.lon, z) - tlx, y: latToWorldY(focus.lat, z) - tly };
    }
    if (trail && trail.points.length >= 2) {
      trailPts = trail.points.map((p) => ({
        x: lonToWorldX(p.lon, z) - tlx,
        y: latToWorldY(p.lat, z) - tly,
      }));
    }
    if (trail && trail.coarse && trail.coarse.length > 0) {
      // 부정확 점 — 선 대신 원. 반경은 보고된 정확도 그대로(픽셀 환산)라 줌을 바꿔도 지리적 크기가 맞다.
      coarsePts = trail.coarse.map((p) => ({
        x: lonToWorldX(p.lon, z) - tlx,
        y: latToWorldY(p.lat, z) - tly,
        r: Math.max(4, p.accM / metersPerPx(p.lat)),
      }));
    }
    if (trail && trail.seq && trail.seq.length >= 2) {
      seqPts = trail.seq.map((p) => ({
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
      // 원좌표(최신 표본) = 정확도 원의 닻. 마커는 정확 fix 폴백이 있으면 그 좌표를 우선한다(08-31 ①).
      const rawX = lonToWorldX(p.lon, z) - tlx;
      const rawY = latToWorldY(p.lat, z) - tly;
      const x = p.goodLat != null && p.goodLon != null ? lonToWorldX(p.goodLon, z) - tlx : rawX;
      const y = p.goodLat != null && p.goodLon != null ? latToWorldY(p.goodLat, z) - tly : rawY;
      if (x < -60 || x > size.w + 60 || y < -60 || y > size.h + 60) continue;
      // 부정확 측위(> R-33 상한)만 반경=정확도 원을 함께 그린다 — 실내 셀/와이파이 폴백(±100m 등급)이
      // 정밀한 점으로 위장하던 것(2026-08-31 실측: 현장 실내인데 양자화 좌표 42~352m 왕복).
      // 양호(≤ 상한)·미보고는 종전과 동일. 반경은 지리값이라 줌과 함께 스케일된다(트레일 coarse 와 동일).
      const accR =
        p.accM != null && p.accM > TRACK_LINE_ACC_MAX_M ? Math.max(4, p.accM / metersPerPx(p.lat)) : null;
      markers.push({ p, x, y, accR, rawX, rawY });
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
        className={`relative h-full w-full touch-none select-none overflow-hidden rounded-lg bg-[#0b1420] ${
          grabbing ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        {tiles.map((t) => {
          const style = { left: t.left, top: t.top, width: TILE, height: TILE, maxWidth: "none" as const };
          if (baseMode === "sat") {
            return (
              <span key={t.key}>
                <img src={`${SAT}/${t.z}/${t.y}/${t.x}`} alt="" width={TILE} height={TILE} draggable={false} className="absolute" style={style} />
                <img src={`${REF}/${t.z}/${t.y}/${t.x}`} alt="" width={TILE} height={TILE} draggable={false} className="absolute opacity-80" style={style} />
              </span>
            );
          }
          if (baseMode === "air") {
            return (
              <span key={t.key}>
                <img src={`/api/vworld-tile?kind=satellite&z=${t.z}&y=${t.y}&x=${t.x}`} alt="" width={TILE} height={TILE} draggable={false} className="absolute" style={style} />
                <img src={`/api/vworld-tile?kind=hybrid&z=${t.z}&y=${t.y}&x=${t.x}`} alt="" width={TILE} height={TILE} draggable={false} className="absolute opacity-90" style={style} />
              </span>
            );
          }
          return (
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

        {/* 근사 동선 점선 — 정확·부정확 점을 시간순으로 이은 한 줄(2026-08-31 사용자 지시).
            부정확 점이 원으로만 남으면 이동 순서를 읽을 수 없어서다. 확정 실선과 구분되게
            **점선**으로만 긋는다 — 기지국 좌표 구간을 "지나간 길" 로 위장하지 않는다. */}
        {seqPts && (
          <svg
            aria-hidden
            data-testid="worker-trail-seq"
            className="pointer-events-none absolute inset-0 z-[6]"
            width={size.w}
            height={size.h}
          >
            <polyline
              points={seqPts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#0b1420"
              strokeWidth={3}
              strokeOpacity={0.35}
              strokeDasharray="6 6"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <polyline
              points={seqPts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#38bdf8"
              strokeWidth={1.5}
              strokeOpacity={0.9}
              strokeDasharray="6 6"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
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

        {/* 부정확 점 — 선에서 뺀 기지국·wifi 좌표. 채운 원 = "이 근방 어딘가". 이어 그리면 없는 길이 된다(R-33). */}
        {coarsePts && (
          <svg
            aria-hidden
            data-testid="worker-trail-coarse"
            className="pointer-events-none absolute inset-0 z-[6]"
            width={size.w}
            height={size.h}
          >
            {coarsePts.map((c, i) => (
              <circle
                key={i}
                cx={c.x}
                cy={c.y}
                r={c.r}
                fill="#38bdf8"
                fillOpacity={0.1}
                stroke="#38bdf8"
                strokeOpacity={0.35}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            ))}
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

        {/* 측위 정확도 원 — 부정확 마커(> TRACK_LINE_ACC_MAX_M)에만 반경=정확도의 흐린 원.
            R-33(트레일 coarse) 처방의 현재 위치 확장. 이벤트 통과·마커(z-10) 아래 레이어. */}
        {markers.some((mk) => mk.accR != null) && (
          <svg
            aria-hidden
            data-testid="worker-marker-accuracy"
            className="pointer-events-none absolute inset-0 z-[7]"
            width={size.w}
            height={size.h}
          >
            {markers.map(({ p, rawX, rawY, accR }) =>
              accR == null ? null : (
                <circle
                  key={p.workerId}
                  cx={rawX}
                  cy={rawY}
                  r={accR}
                  fill="#38bdf8"
                  fillOpacity={0.08}
                  stroke="#38bdf8"
                  strokeOpacity={0.4}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
              ),
            )}
          </svg>
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
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onToggleTrail?.(p.workerId)}
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
                  {/* 좌표 나이 — 수신과 갈릴 수 있으므로 별도 행. 같으면 중복이 아니라 확인이다. */}
                  <div className="flex justify-between">
                    <dt>좌표</dt>
                    <dd
                      className={`tabular-nums ${
                        p.fixAgeSec != null && p.fixAgeSec >= FIX_STALE_SEC ? "text-amber-300" : ""
                      }`}
                    >
                      {p.fixAgeSec == null ? "측위 시각 미상" : ageLabel(p.fixAgeSec)}
                    </dd>
                  </div>
                  {/* 측위 정확도 — 실내 폴백(±100m 등급)이면 이 숫자가 마커 위치의 신뢰 한계다. */}
                  <div className="flex justify-between">
                    <dt>측위</dt>
                    <dd
                      className={`tabular-nums ${
                        p.goodAccM == null && p.accM != null && p.accM > TRACK_LINE_ACC_MAX_M
                          ? "text-amber-300"
                          : ""
                      }`}
                    >
                      {p.goodAccM != null
                        ? `정확 위치 ±${Math.round(p.goodAccM)}m · ${ageLabel(p.goodAgeSec ?? 0)} 전`
                        : p.accM == null
                          ? "정확도 미보고"
                          : `±${Math.round(p.accM)}m`}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        ))}

        {/* 좌상단 컨트롤 컬럼 — 베이스맵 토글 / 트레일 칩. 전파 차단 필수(드래그 캡처). */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute left-2 top-2 z-20 flex flex-col items-start gap-1.5"
        >
          <div className="flex overflow-hidden rounded-lg bg-black/55 text-[11px] font-semibold text-white backdrop-blur">
            {(
              [
                { mode: "sat", label: "위성", title: "Esri 위성지도(전세계)" },
                { mode: "air", label: "항공", title: "국토교통부 VWorld 항공사진 — 국내 고해상·z19 까지 더 확대" },
                { mode: "cad", label: "지적도", title: "VWorld 베이스맵 + 연속지적도(필지 경계)" },
              ] as const
            ).map((b) => (
              <button
                key={b.mode}
                type="button"
                onClick={() => setBaseMode(b.mode)}
                title={b.title}
                className={`px-2.5 py-1 ${baseMode === b.mode ? "bg-primary text-on-primary" : "hover:bg-black/75"}`}
              >
                {b.label}
              </button>
            ))}
          </div>

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

          {/* 좌표 품질 — 이 경로를 얼마나 믿을 수 있는가. 점별이 아니라 구간에 한 줄이다.
              ★ 트레일은 좌표가 같으면 "가만히 서 있었다" 로 그려진다. 그런데 서버가 좌표를
                직전 값에서 이어 주므로(store sticky merge), 실제로는 **측위가 오래된 것**일 수
                있다. 최대 지연이 앱 신선도 상한을 넘으면 그 구간에 이어 붙인 좌표가 있다는 뜻이다. */}
          {trail && trail.quality && trail.quality.points > 0 && (
            <div className="rounded-pill bg-black/45 px-2.5 py-0.5 text-[10px] font-normal text-zinc-300 backdrop-blur">
              좌표 {trail.quality.points}점
              {trail.quality.accuracyMedianM !== null &&
                ` · 정확도 중앙 ±${Math.round(trail.quality.accuracyMedianM)}m`}
              {trail.coarse && trail.coarse.length > 0 &&
                ` · 부정확 ${trail.coarse.length}점 점선 근사(>${TRACK_LINE_ACC_MAX_M}m)`}
              {" · "}
              <span
                title={
                  trail.quality.fixAgeMaxSec !== null && trail.quality.fixAgeMaxSec >= FIX_STALE_SEC
                    ? `앱 신선도 상한 ${FIX_STALE_SEC}초를 넘는 좌표가 있다 — 서버가 이어 붙인 값이다`
                    : "전송 시각과 측위 시각의 최대 차이"
                }
                className={
                  trail.quality.fixAgeMaxSec !== null && trail.quality.fixAgeMaxSec >= FIX_STALE_SEC
                    ? "text-amber-300"
                    : ""
                }
              >
                {trail.quality.fixAgeMaxSec === null
                  ? "측위 시각 미상"
                  : `최대 지연 ${durLabel(trail.quality.fixAgeMaxSec)}`}
              </span>
              {trail.quality.unknownFix > 0 && (
                <span className="text-zinc-400" title="측위 시각을 저장하기 전에 쌓인 구간이다">
                  {` · 미상 ${trail.quality.unknownFix}점`}
                </span>
              )}
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
          {baseMode === "sat"
            ? "위성지도 © Esri World Imagery"
            : baseMode === "air"
              ? "항공사진 © 국토교통부 VWorld"
              : "지적도 © 국토교통부 VWorld"}
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
