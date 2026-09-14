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

  // 기존 60초 폴링이 서명 URL을 바꿔도 재생 중인 소리는 끊지 않는다.
  useEffect(() => {
    if (audioRef.current?.paused) setPlaybackSrc(src);
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
    setPlaybackSrc(src);
  };
  const seconds = audioMs !== null && Number.isFinite(audioMs) && audioMs >= 0
    ? Math.floor(audioMs / 1000) : null;
  const duration = seconds === null
    ? null : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="mt-1 min-w-0 text-[11px] text-muted dark:text-on-dark-soft">
      <p>
        음성 댓글{duration !== null && <span> · {duration}</span>}
      </p>
      <audio
        ref={audioRef}
        src={playbackSrc ?? undefined}
        controls
        preload="none"
        aria-label="음성 댓글 재생"
        className="mt-1 h-8 w-full min-w-0"
        onPlay={(event) => {
          const audio = event.currentTarget;
          if (audio.paused) return;
          if (activeAudio && activeAudio !== audio) activeAudio.pause();
          activeAudio = audio;
        }}
        onPause={(event) => stop(event.currentTarget)}
        onEnded={(event) => stop(event.currentTarget)}
        onPlaying={() => setFailedSrc(null)}
        onError={(event) => {
          // 로드 실패 시에도 paused=true를 보장해 새로고침의 새 URL을 받을 수 있게 한다.
          const audio = event.currentTarget;
          audio.pause();
          if (activeAudio === audio) activeAudio = null;
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
