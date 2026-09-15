"use client";

import { useEffect, useRef, useState } from "react";

// 사진/캘린더 인스턴스가 달라도 음성 댓글은 하나만 재생한다.
let activeAudio: HTMLAudioElement | null = null;

export function CalendarVoiceComment({ src, audioMs }: {
  src: string | null;
  audioMs: number | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playbackSrc, setPlaybackSrc] = useState(src);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const waveformRef = useRef<number[] | null>(null);
  if (waveformRef.current === null) {
    waveformRef.current = Array.from({ length: 30 }, () => 4 + Math.random() * 12);
  }
  const waveform = waveformRef.current;

  // 기존 60초 폴링이 서명 URL을 바꿔도 재생 중인 소리는 끊지 않는다.
  useEffect(() => {
    if (audioRef.current?.paused) {
      setPlaybackSrc(src);
      setProgress(0);
    }
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
      if (activeAudio === audio) activeAudio = null;
    };
  }, []);

  const stop = (audio: HTMLAudioElement) => {
    if (!audio.paused) return; // 빠르게 재개한 뒤 도착한 옛 pause/ended 이벤트는 무시한다.
    // 이전 플레이어의 늦은 pause 이벤트가 새 플레이어를 해제하지 않게 한다.
    if (activeAudio === audio) activeAudio = null;
    setIsPlaying(false);
    setPlaybackSrc(src);
  };
  const seconds = audioMs !== null && Number.isFinite(audioMs) && audioMs >= 0
    ? Math.floor(audioMs / 1000) : null;
  const duration = seconds === null
    ? null : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const playableSeconds = (audio: HTMLAudioElement) => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return audioMs !== null && Number.isFinite(audioMs) && audioMs > 0 ? audioMs / 1000 : null;
  };
  const updateProgress = (audio: HTMLAudioElement) => {
    const total = playableSeconds(audio);
    setProgress(total === null ? 0 : Math.min(1, Math.max(0, audio.currentTime / total)));
  };

  return (
    <div className="mt-1 min-w-0 text-[11px] text-muted dark:text-on-dark-soft">
      <div className="flex min-w-0 items-center gap-2 rounded-lg bg-surface-strong/60 px-2 py-1.5">
        <button
          type="button"
          aria-label={isPlaying ? "일시정지" : "음성 재생"}
          disabled={!playbackSrc}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-hairline-strong bg-canvas text-body transition hover:bg-surface-soft hover:text-ink active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={() => {
            const audio = audioRef.current;
            if (!audio || !playbackSrc) return;
            if (audio.paused) void audio.play().catch(() => undefined);
            else audio.pause();
          }}
        >
          {isPlaying ? (
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
              <rect x="4.25" y="3.5" width="2.5" height="9" rx="0.75" />
              <rect x="9.25" y="3.5" width="2.5" height="9" rx="0.75" />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
              <path d="M5.75 3.75a.75.75 0 0 1 1.14-.64l6 3.75a.75.75 0 0 1 0 1.28l-6 3.75a.75.75 0 0 1-1.14-.64v-7.5Z" />
            </svg>
          )}
        </button>

        <div className="relative h-6 min-w-0 flex-1 overflow-hidden rounded-sm focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
          <div aria-hidden="true" className="absolute inset-0 flex items-center justify-between px-0.5">
            {waveform.map((height, index) => (
              <span key={index} className="w-[2px] shrink-0 rounded-sm bg-current" style={{ height }} />
            ))}
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 rounded-sm bg-current opacity-30"
            style={{ width: `${progress * 100}%` }}
          />
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(progress * 100)}
            aria-label="음성 재생 위치"
            aria-valuetext={`${Math.round(progress * 100)}%`}
            disabled={!playbackSrc}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus:outline-none disabled:cursor-not-allowed"
            onChange={(event) => {
              const audio = audioRef.current;
              if (!audio) return;
              const nextProgress = Number(event.currentTarget.value) / 100;
              const total = playableSeconds(audio);
              if (total !== null) audio.currentTime = nextProgress * total;
              setProgress(nextProgress);
            }}
          />
        </div>

        {duration !== null && (
          <span aria-label={`음성 길이 ${duration}`} className="shrink-0 tabular-nums">
            {duration}
          </span>
        )}
      </div>
      <audio
        ref={audioRef}
        src={playbackSrc ?? undefined}
        preload="none"
        aria-label="음성 댓글 재생"
        onPlay={(event) => {
          const audio = event.currentTarget;
          if (audio.paused) return;
          if (activeAudio && activeAudio !== audio) activeAudio.pause();
          activeAudio = audio;
          setIsPlaying(true);
        }}
        onPause={(event) => stop(event.currentTarget)}
        onEnded={(event) => stop(event.currentTarget)}
        onTimeUpdate={(event) => updateProgress(event.currentTarget)}
        onLoadedMetadata={(event) => updateProgress(event.currentTarget)}
        onPlaying={() => setFailedSrc(null)}
        onError={(event) => {
          // 로드 실패 시에도 paused=true를 보장해 새로고침의 새 URL을 받을 수 있게 한다.
          const audio = event.currentTarget;
          audio.pause();
          if (activeAudio === audio) activeAudio = null;
          setIsPlaying(false);
          setProgress(0);
          setFailedSrc(playbackSrc);
        }}
      />
      {(!playbackSrc || failedSrc === playbackSrc) && (
        <p role="alert" className="mt-1">
          음성을 재생할 수 없습니다. 상단의 ‘현장 미디어 새로고침’을 눌러 다시 불러오세요.
        </p>
      )}
    </div>
  );
}
