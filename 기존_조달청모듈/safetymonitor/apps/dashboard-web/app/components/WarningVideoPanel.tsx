// 특보 영상 패널 — 기상특보/예비특보 발생 시 공식 채널 한정 유튜브 영상을 자동 검색해 제공.
// 특보 없으면 placeholder. 안전 제품이라 공식 채널 한정 + 참고용 면책 표기.
"use client";

import { useEffect, useMemo, useState } from "react";

type ActiveWarning = { type: string; level: "경보" | "주의보"; regions: string[] };
type Preliminary = { type: string; when: string; regions: string[] };
type KmaResp = {
  ok: boolean;
  warnings?: ActiveWarning[];
  preliminary?: Preliminary[];
};
type Video = {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail: string | null;
  publishedAt: string | null;
};
type YtResp = {
  ok: boolean;
  configured: boolean;
  channelLimited: boolean;
  query: string;
  videos: Video[];
  note?: string;
};

type Active = {
  type: string;
  kind: "warning" | "preliminary";
  severity: "danger" | "caution";
};

// 발효 특보 우선순위: 경보 > 주의보 > 예비특보. 없으면 null.
function pickActive(kma: KmaResp): Active | null {
  const w = kma.warnings ?? [];
  const danger = w.find((x) => x.level === "경보");
  if (danger) return { type: danger.type, kind: "warning", severity: "danger" };
  const caution = w.find((x) => x.level === "주의보");
  if (caution) return { type: caution.type, kind: "warning", severity: "caution" };
  const p = (kma.preliminary ?? [])[0];
  if (p) return { type: p.type, kind: "preliminary", severity: "caution" };
  return null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

// 특보 대응 영상 모노톤 라인 아이콘 — 다른 대시보드 아이콘과 동일 테마(currentColor 라인 SVG).
// 모니터(화면) + 재생 삼각형 + 받침대 = 방송 특보 영상. 이모지(📺) 대체.
function VideoIcon({ size = 16, className }: { size?: number; className?: string }) {
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
      <rect x="3" y="3.5" width="18" height="13" rx="2" />
      <path d="M10 7.8 14.5 10 10 12.2 Z" />
      <path d="M8.5 20h7" />
      <path d="M12 16.5v3.5" />
    </svg>
  );
}

export function WarningVideoPanel({ lat, lon }: { lat?: number; lon?: number }) {
  const [active, setActive] = useState<Active | null>(null);
  const [yt, setYt] = useState<YtResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Video | null>(null);

  const hasGps = typeof lat === "number" && typeof lon === "number";

  useEffect(() => {
    if (!hasGps) {
      setLoading(false);
      return;
    }
    let alive = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const kmaRes = await fetch(`/api/kma-warning?lat=${lat}&lon=${lon}`, { cache: "no-store" });
        const kma = (await kmaRes.json()) as KmaResp;
        if (!alive) return;
        const act = pickActive(kma);
        setActive(act);
        setPlaying(null);
        if (!act) {
          setYt(null);
          setLoading(false);
          return;
        }
        const params = new URLSearchParams({ type: act.type, kind: act.kind });
        const ytRes = await fetch(`/api/youtube-warning-videos?${params.toString()}`, {
          cache: "no-store",
        });
        const j = (await ytRes.json()) as YtResp;
        if (!alive) return;
        setYt(j);
      } catch {
        if (alive) setError("조회 실패");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 10 * 60 * 1000); // 10분마다 특보 재확인
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [lat, lon, hasGps]);

  const badge = useMemo(() => {
    if (!active) return null;
    const label =
      active.kind === "preliminary"
        ? `${active.type} 예비특보`
        : active.type;
    const cls =
      active.severity === "danger"
        ? "bg-red-500 text-white"
        : "bg-amber-500 text-white";
    return { label, cls };
  }, [active]);

  // ── 상태별 렌더 ──
  const Header = (
    <div className="flex shrink-0 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink dark:text-on-dark">
        <VideoIcon className="shrink-0" />
        <span className="truncate">특보 대응 영상</span>
      </span>
      {badge && (
        <span className={`shrink-0 rounded-pill px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
          {badge.label}
        </span>
      )}
    </div>
  );

  function Centered({ children }: { children: React.ReactNode }) {
    return (
      <div className="flex h-full flex-col gap-1.5 p-2">
        {Header}
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 p-4 text-center text-xs text-muted dark:border-white/10 dark:text-on-dark-soft">
          {children}
        </div>
      </div>
    );
  }

  if (!hasGps) return <Centered>현장 GPS 미등록 — 작업자 등록 시 특보 영상 제공</Centered>;
  if (loading) return <Centered>특보 확인 중…</Centered>;
  if (error) return <Centered>특보 영상 — {error}</Centered>;
  if (!active) return <Centered>현재 발효 중인 특보 없음</Centered>;
  if (yt && !yt.configured)
    return (
      <Centered>
        YouTube API 키 미설정
        <br />
        <span className="text-[10px]">.env.local 에 YOUTUBE_API_KEY 설정</span>
      </Centered>
    );

  const videos = yt?.videos ?? [];

  return (
    <div className="flex h-full flex-col gap-1.5 p-2">
      {Header}

      {playing ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setPlaying(null)}
            className="shrink-0 self-start rounded border border-zinc-300 px-2 py-0.5 text-[11px] text-body hover:bg-zinc-100 dark:border-white/10 dark:text-on-dark-soft dark:hover:bg-white/5"
          >
            ← 목록
          </button>
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg bg-black">
            <iframe
              className="absolute inset-0 h-full w-full"
              src={`https://www.youtube-nocookie.com/embed/${playing.id}`}
              title={playing.title}
              allow="accelerometer; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </div>
          <p className="line-clamp-2 shrink-0 text-[11px] text-body dark:text-on-dark-soft">
            {playing.title}
          </p>
        </div>
      ) : videos.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 p-4 text-center text-xs text-muted dark:border-white/10 dark:text-on-dark-soft">
          관련 공식 영상 없음
          {yt?.query ? <span className="mt-1 block text-[10px]">검색어: {yt.query}</span> : null}
        </div>
      ) : (
        <div className="wx-cards-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
          {videos.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setPlaying(v)}
              className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 p-1.5 text-left transition hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-white/5"
            >
              {v.thumbnail ? (
                <img
                  src={v.thumbnail}
                  alt=""
                  className="h-10 w-16 shrink-0 rounded object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded bg-zinc-200 text-xs dark:bg-white/10">▶</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[11px] font-medium text-ink dark:text-on-dark">{v.title}</p>
                <p className="truncate text-[10px] text-muted dark:text-on-dark-soft">
                  {v.channelTitle}
                  {v.publishedAt ? ` · ${fmtDate(v.publishedAt)}` : ""}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <p className="shrink-0 text-center text-[10px] text-muted dark:text-on-dark-soft">
        {yt?.note ?? "검색"} · 참고용(공식 지침 우선)
      </p>
    </div>
  );
}
