// 실시간 강수 레이더 영상 — 한국 영역 베이스맵 + RainViewer 레이더 타일 오버레이 애니메이션
// 인라인(캐러셀)은 줌6, 클릭 시 createPortal 확대 팝업(줌7). 재생/일시정지 + 타임라인.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  const base = dark ? "dark_all" : "light_all";
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

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg bg-slate-200 dark:bg-slate-800">
      {/* 베이스맵 — @2x(512px) 레티나 타일. 타일은 % 로 배치하므로 소스 해상도를 올려도
          레이아웃은 그대로이고 선명도만 올라간다. 레이더만 512 로 올리면 배경이 상대적으로 흐려진다. */}
      {cells.map((t) => (
        <img
          key={`b-${t.x}-${t.y}`}
          src={`https://a.basemaps.cartocdn.com/${base}/${zoom}/${t.x}/${t.y}@2x.png`}
          alt=""
          aria-hidden
          draggable={false}
          style={style(t.c, t.r)}
        />
      ))}
      {/* 레이더 오버레이 — 512px.
          ⚠️ URL 끝의 color(7)·snow(_1) 는 **RainViewer 무료 API 가 무시한다**(실측: 색상 0~8 이
          전부 동일 md5, `1_1` 과 `1_0` 도 동일). 색상 스킴을 바꿔 가독성을 높이려는 시도는
          이 API 에서 통하지 않으니 반복하지 말 것 — 실제로 먹는 것은 size 와 smooth 뿐이다.
          근본 개선은 기상청 RadarImgInfoService(500m·5분) 이며 활용신청이 필요하다.
          경위·후보 비교 = docs/radar-visual-upgrade.md */}
      {framePath &&
        cells.map((t) => (
          <img
            key={`r-${t.x}-${t.y}`}
            src={`${host}${framePath}/512/${zoom}/${t.x}/${t.y}/7/1_1.png`}
            alt=""
            aria-hidden
            draggable={false}
            style={{ ...style(t.c, t.r), mixBlendMode: "normal" }}
          />
        ))}
    </div>
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
              <RadarTiles host={host} framePath={cur?.path ?? null} zoom={7} dark={dark} />
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
            기상청·RainViewer · 강수 에코(파랑→초록→노랑→빨강 = 약→강)
          </p>
        </div>
      </div>
    </div>
  );
}
