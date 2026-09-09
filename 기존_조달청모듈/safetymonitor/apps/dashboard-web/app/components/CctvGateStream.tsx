// 젯슨 게이트 직결 영상 — 로그인 세션으로 표를 받아 Authorization 헤더로 붙고 canvas 에 그린다.
//
// 왜 <img> 가 아닌가 — <img src=…> 는 요청 헤더를 붙일 수 없다. 표를 URL 쿼리에 실으면
// 접근 로그·브라우저 기록·복사된 링크로 새는 bearer 자격이 되고, 탈취자가 먼저 제시하면 통과한다
// (적대검증 red-2 HIGH). 그래서 fetch 로 multipart 를 직접 읽고 canvas 에 그린다.
// 대가 = <img> 의 자동 재연결을 잃는다 → 표 만료·끊김 재연결을 여기서 직접 한다.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSessionToken } from "./session-token";

// 게이트가 보내는 multipart 경계 — cctv_gate.py 의 boundary=frame 과 같아야 한다.
const BOUNDARY = new TextEncoder().encode("--frame");
const HEADER_END = new TextEncoder().encode("\r\n\r\n");
// 경계를 못 찾은 채 이만큼 쌓이면 형식이 깨진 것이다 — 무한 누적 방지.
const MAX_BUFFER = 8 * 1024 * 1024;
// 표를 만료 직전에 미리 바꾼다. 0 초에 맞춰 바꾸면 시계 차이만큼 끊긴다.
const RENEW_MARGIN_MS = 8000;

type Ticket = { ticket: string; expiresAt: number };

function indexOfSeq(hay: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i <= hay.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * 카메라·권한별 표 발급기. 같은 표를 두 번 쓰면 게이트가 재사용으로 거절하므로
 * 요청마다 새로 받되, 동시에 여러 개를 받지 않도록 한 번에 하나만 진행한다(single-flight).
 */
export function useGateTicket(cameraId: string) {
  const inflight = useRef<Map<string, Promise<Ticket | null>>>(new Map());

  return useCallback(
    (scope: "read" | "control"): Promise<Ticket | null> => {
      const key = `${cameraId}:${scope}`;
      const running = inflight.current.get(key);
      if (running) return running;
      const p = (async (): Promise<Ticket | null> => {
        const token = getSessionToken();
        if (!token) return null; // 로그인하지 않았으면 표를 받을 수 없다 → 영상도 못 본다
        try {
          const res = await fetch("/api/cctv/ticket", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ cameraId, scope }),
            cache: "no-store",
          });
          if (!res.ok) return null;
          const j = (await res.json()) as { ticket?: string; expiresAt?: number };
          if (!j.ticket || !j.expiresAt) return null;
          return { ticket: j.ticket, expiresAt: j.expiresAt };
        } catch {
          return null;
        } finally {
          inflight.current.delete(key);
        }
      })();
      inflight.current.set(key, p);
      return p;
    },
    [cameraId],
  );
}

type State = "connecting" | "live" | "denied" | "error";

/**
 * 게이트 MJPEG 를 canvas 로 그린다. 표가 만료되면 게이트가 연결을 끊으므로
 * 끊기면 새 표를 받아 다시 붙는다.
 */
export function GateLiveScreen({
  gateApi,
  cameraId,
  suffix,
  enabled,
  visible,
  large,
}: {
  gateApi: string;
  cameraId: string;
  suffix: string;
  enabled?: boolean | null;
  visible: boolean;
  large?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const getTicket = useGateTicket(cameraId);
  const [state, setState] = useState<State>("connecting");

  useEffect(() => {
    if (enabled === false || !visible) return;
    let stopped = false;
    let abort: AbortController | null = null;
    let retry = 0;

    const drawLoop = async () => {
      while (!stopped) {
        const t = await getTicket("read");
        if (stopped) return;
        if (!t) {
          // 로그인이 없거나 권한이 없다 — 재시도해도 같으므로 천천히 다시 본다(로그인 복귀 대비).
          setState("denied");
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        abort = new AbortController();
        // 표 수명이 끝나면 게이트가 끊지만, 혹시 안 끊더라도 우리 쪽에서 먼저 정리한다.
        const stopAt = setTimeout(() => abort?.abort(), Math.max(t.expiresAt - Date.now() - RENEW_MARGIN_MS, 1000));
        try {
          const res = await fetch(`${gateApi}/cctv/stream${suffix}`, {
            headers: { Authorization: `Bearer ${t.ticket}` },
            signal: abort.signal,
            cache: "no-store",
          });
          if (!res.ok || !res.body) throw new Error(String(res.status));
          retry = 0;
          const reader = res.body.getReader();
          let buf = new Uint8Array(0);
          let decoding = false;
          for (;;) {
            const { done, value } = await reader.read();
            if (done || stopped) break;
            if (!value) continue;
            const next = new Uint8Array(buf.length + value.length);
            next.set(buf);
            next.set(value, buf.length);
            buf = next;
            if (buf.length > MAX_BUFFER) throw new Error("malformed stream");

            // 경계 두 개 사이가 한 프레임이다. 다음 경계가 와야 프레임 끝을 안다.
            for (;;) {
              const b0 = indexOfSeq(buf, BOUNDARY, 0);
              if (b0 < 0) break;
              const b1 = indexOfSeq(buf, BOUNDARY, b0 + BOUNDARY.length);
              if (b1 < 0) break;
              const h = indexOfSeq(buf, HEADER_END, b0);
              if (h < 0 || h > b1) { buf = buf.slice(b1); break; }
              const jpeg = buf.slice(h + HEADER_END.length, Math.max(b1 - 2, h + HEADER_END.length));
              buf = buf.slice(b1);
              // 디코드가 도착보다 느리면 그 프레임은 버린다 — 밀리면 지연만 쌓인다.
              if (decoding || jpeg.length === 0) continue;
              decoding = true;
              void createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }))
                .then((bmp) => {
                  const cv = canvasRef.current;
                  if (cv) {
                    if (cv.width !== bmp.width || cv.height !== bmp.height) {
                      cv.width = bmp.width;
                      cv.height = bmp.height;
                    }
                    cv.getContext("2d")?.drawImage(bmp, 0, 0);
                    setState("live");
                  }
                  bmp.close();
                })
                .catch(() => {})
                .finally(() => { decoding = false; });
            }
          }
        } catch {
          if (!stopped) setState((s) => (s === "denied" ? s : "error"));
        } finally {
          clearTimeout(stopAt);
          abort = null;
        }
        if (stopped) return;
        // 정상 만료면 곧바로 새 표로 잇고, 실패가 이어지면 물러선다.
        retry += 1;
        await new Promise((r) => setTimeout(r, retry > 1 ? Math.min(1200 * 2 ** (retry - 1), 30000) : 150));
      }
    };
    void drawLoop();
    return () => {
      stopped = true;
      abort?.abort();
    };
  }, [gateApi, cameraId, suffix, enabled, visible, getTicket]);

  if (enabled === false) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-zinc-500">
        <span className={large ? "text-sm text-zinc-400" : "text-[11px] text-zinc-400"}>연결 꺼짐 · 절약 모드</span>
      </div>
    );
  }
  if (!visible) return null;
  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-contain" />
      {state !== "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-zinc-500">
          <span className={large ? "text-sm text-zinc-400" : "text-[11px] text-zinc-400"}>
            {state === "denied" ? "로그인 후 볼 수 있습니다" : "연결 중"}
          </span>
          {state === "denied" && (
            <span className={large ? "text-xs text-zinc-600" : "text-[10px] text-zinc-600"}>
              이 현장 CCTV 권한이 있는 계정으로 로그인하세요
            </span>
          )}
        </div>
      )}
    </>
  );
}

/** 게이트 연결 토글 — 끄고 켜는 것은 control 표가 있어야 한다(보기 표로는 403). */
export async function gateSetConnection(
  gateApi: string,
  suffix: string,
  getTicket: (scope: "read" | "control") => Promise<Ticket | null>,
  next: boolean,
): Promise<boolean> {
  const t = await getTicket("control");
  if (!t) return false;
  try {
    const res = await fetch(`${gateApi}/cctv/connection${suffix}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t.ticket}` },
      body: JSON.stringify({ enabled: next }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
