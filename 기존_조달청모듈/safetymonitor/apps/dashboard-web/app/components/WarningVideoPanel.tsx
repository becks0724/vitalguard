// 특보 영상 패널 — 유튜브에서 실시간 특보 생방송(주요 방송사)을 가져와 리스트로 제공, 선택 시 재생.
//   · LIVE 토글(기본 OFF·localStorage) 로 상시 조회/임베드 과금을 제어(꺼두면 유튜브 호출 0).
//   · 토글 OFF 시 기존 동작 유지 = 현장 시·도 발효 특보 관련 공식 영상 검색.
//   · 안전 제품이라 주요 방송사 채널 한정 + 참고용 면책 표기.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSessionToken } from "./LoginGate";

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
// 실시간 특보 생방송 목록 응답(/api/youtube-live-warnings).
type LiveResp = {
  configured: boolean;
  videos?: Video[];
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

const LIVE_STORAGE_KEY = "safetymonitor.warningLive.v1";

// 특보 LIVE 온/오프 스위치(상시 조회/임베드 비용 제어 — 기본 OFF).
function LiveToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      title={
        on
          ? "특보 LIVE 켜짐 — 클릭하면 끄기(실시간 조회·방송 중지)"
          : "특보 LIVE 꺼짐 — 클릭하면 실시간 특보 생방송 켜기"
      }
      className={`flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-semibold transition ${
        on
          ? "bg-red-500 text-white"
          : "bg-zinc-200 text-zinc-500 dark:bg-white/10 dark:text-on-dark-soft"
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${on ? "bg-white" : "bg-zinc-400 dark:bg-white/40"}`}
      />
      LIVE {on ? "ON" : "OFF"}
    </button>
  );
}

// 목록/재생 항목의 LIVE 배지.
function LiveBadge() {
  return (
    <span className="mr-1 rounded-sm bg-red-500 px-1 align-[1px] text-[9px] font-bold text-white">
      LIVE
    </span>
  );
}

export function WarningVideoPanel({ lat, lon }: { lat?: number; lon?: number }) {
  const [active, setActive] = useState<Active | null>(null);
  const [yt, setYt] = useState<YtResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Video | null>(null);

  // 실시간 특보 생방송(여러 방송사) — LIVE 토글 ON 일 때만 조회.
  const [liveOn, setLiveOn] = useState(false);
  const [liveVideos, setLiveVideos] = useState<Video[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const liveIdsRef = useRef<Set<string>>(new Set());

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
        // 토큰 동봉 — 서버가 세션·크론키가 있을 때만 특보 알림을 발사한다(감사 DLT-FE-2 전수 재조사).
        const kmaToken = getSessionToken();
        const kmaRes = await fetch(`/api/kma-warning?lat=${lat}&lon=${lon}`, {
          cache: "no-store",
          headers: kmaToken ? { Authorization: `Bearer ${kmaToken}` } : undefined,
        });
        const kma = (await kmaRes.json()) as KmaResp;
        if (!alive) return;
        const act = pickActive(kma);
        setActive(act);
        // 검색(VOD) 영상 재생은 특보 변경 시 리셋하되, 재생 중인 라이브 방송은 유지.
        setPlaying((p) => (p && liveIdsRef.current.has(p.id) ? p : null));
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

  // LIVE 온/오프 복원(기본 OFF·비용 절약).
  useEffect(() => {
    try {
      if (localStorage.getItem(LIVE_STORAGE_KEY) === "on") setLiveOn(true);
    } catch {
      /* localStorage 불가 환경 무시 */
    }
  }, []);

  // LIVE ON 이면 실시간 특보 생방송 목록 조회(30분 폴링). OFF 면 조회 안 함 = 과금 0.
  useEffect(() => {
    if (!liveOn) {
      setLiveVideos([]);
      setLiveError(null);
      setLiveLoading(false);
      return;
    }
    let alive = true;
    async function loadLive() {
      setLiveLoading(true);
      setLiveError(null);
      try {
        const r = await fetch("/api/youtube-live-warnings", { cache: "no-store" });
        const j = (await r.json()) as LiveResp;
        if (!alive) return;
        if (!j.configured) {
          setLiveError("YouTube API 키 미설정");
          setLiveVideos([]);
        } else {
          setLiveVideos(j.videos ?? []);
        }
      } catch {
        if (alive) setLiveError("생방송 조회 실패");
      } finally {
        if (alive) setLiveLoading(false);
      }
    }
    loadLive();
    const id = setInterval(loadLive, 30 * 60 * 1000); // 30분마다 라이브 목록 갱신
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [liveOn]);

  // 재생 중 라이브 방송 보존용 id 집합(load 폴링이 라이브 재생을 끊지 않도록).
  useEffect(() => {
    liveIdsRef.current = new Set(liveVideos.map((v) => v.id));
  }, [liveVideos]);

  const toggleLive = () => {
    const next = !liveOn;
    setLiveOn(next);
    try {
      localStorage.setItem(LIVE_STORAGE_KEY, next ? "on" : "off");
    } catch {
      /* 무시 */
    }
    if (!next) setPlaying(null); // 끄면 재생 중지
  };

  const badge = useMemo(() => {
    if (!active) return null;
    const label = active.kind === "preliminary" ? `${active.type} 예비특보` : active.type;
    const cls = active.severity === "danger" ? "bg-red-500 text-white" : "bg-amber-500 text-white";
    return { label, cls };
  }, [active]);

  // ── 상태별 렌더 ──
  // 재생 중에는 아이콘 자리에 '← 목록' 을 둔다 — 헤더 아래 별도 줄을 없애 그만큼 영상 높이를 준다.
  const Header = (
    <div className="flex shrink-0 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink dark:text-on-dark">
        {playing ? (
          <button
            type="button"
            onClick={() => setPlaying(null)}
            className="shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] font-normal text-body hover:bg-zinc-100 dark:border-white/10 dark:text-on-dark-soft dark:hover:bg-white/5"
          >
            ← 목록
          </button>
        ) : (
          <VideoIcon className="shrink-0" />
        )}
        <span className="truncate">특보 대응 영상</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {badge && (
          <span className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
            {badge.label}
          </span>
        )}
        <LiveToggle on={liveOn} onToggle={toggleLive} />
      </span>
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

  // liveOn 이 false 면 아래 조건들이 기존 동작 그대로 조기 반환(라이브 미표시).
  // true 면 조기 반환을 건너뛰고 본문에서 실시간 특보 생방송 목록을 표시.
  if (!hasGps && !liveOn) return <Centered>현장 GPS 미등록 — 작업자 등록 시 특보 영상 제공</Centered>;
  if (loading && !liveOn) return <Centered>특보 확인 중…</Centered>;
  if (error && !liveOn) return <Centered>특보 영상 — {error}</Centered>;
  if (!active && !liveOn) return <Centered>현재 발효 중인 특보 없음</Centered>;
  if (active && yt && !yt.configured && !liveOn)
    return (
      <Centered>
        YouTube API 키 미설정
        <br />
        <span className="text-[10px]">.env.local 에 YOUTUBE_API_KEY 설정</span>
      </Centered>
    );

  // 실시간 특보 생방송(ON) 을 맨 앞에 + 현장 특보 검색 영상(발효 시) 병합, id 중복 제거.
  const searchVideos = active ? (yt?.videos ?? []) : [];
  const liveIds = new Set(liveVideos.map((v) => v.id));
  const seen = new Set<string>();
  const videos: Video[] = (liveOn ? [...liveVideos, ...searchVideos] : searchVideos).filter((v) =>
    seen.has(v.id) ? false : (seen.add(v.id), true),
  );

  return (
    <div className="flex h-full flex-col gap-1.5 p-2">
      {Header}

      {playing ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
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
            {liveIds.has(playing.id) && <LiveBadge />}
            {playing.title}
          </p>
        </div>
      ) : videos.length > 0 ? (
        <div className="wx-cards-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
          {videos.map((v) => {
            const isLive = liveIds.has(v.id);
            return (
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
                  <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded bg-zinc-200 text-xs dark:bg-white/10">
                    ▶
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[11px] font-medium text-ink dark:text-on-dark">
                    {isLive && <LiveBadge />}
                    {v.title}
                  </p>
                  <p className="truncate text-[10px] text-muted dark:text-on-dark-soft">
                    {v.channelTitle}
                    {isLive ? " · 생방송" : v.publishedAt ? ` · ${fmtDate(v.publishedAt)}` : ""}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 p-4 text-center text-xs text-muted dark:border-white/10 dark:text-on-dark-soft">
          {liveOn
            ? liveLoading
              ? "특보 생방송 불러오는 중…"
              : (liveError ?? "현재 진행 중인 특보 생방송 없음")
            : "관련 공식 영상 없음"}
        </div>
      )}
    </div>
  );
}
