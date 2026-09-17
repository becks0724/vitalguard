// 젯슨 게이트 직결 영상 — 로그인 세션으로 표를 받아 Authorization 헤더로 붙고 canvas 에 그린다.
//
// 왜 <img> 가 아닌가 — <img src=…> 는 요청 헤더를 붙일 수 없다. 표를 URL 쿼리에 실으면
// 접근 로그·브라우저 기록·복사된 링크로 새는 bearer 자격이 되고, 탈취자가 먼저 제시하면 통과한다
// (적대검증 red-2 HIGH). 그래서 fetch 로 multipart 를 직접 읽고 canvas 에 그린다.
// 대가 = <img> 의 자동 재연결을 잃는다 → 표 만료·끊김 재연결을 여기서 직접 한다.
//
// ★ 09-16 서버 중계(docs/cctv-gate-server) — 장시간 MJPEG 대신 **5초 스냅샷 폴링**으로 바꿨다.
//   gateApi 가 서버면 단발 image/jpeg 가 오고, 젯슨 게이트면 multipart 가 온다. 둘 다 받되
//   multipart 는 첫 프레임 하나만 읽고 끊는다(FIRST_FRAME_ONLY). 표는 어차피 1회용이라 요청마다 새로 받는다.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSessionToken } from "./session-token";

// 게이트가 보내는 multipart 경계 — cctv_gate.py 의 boundary=frame 과 같아야 한다.
const BOUNDARY = new TextEncoder().encode("--frame");
const HEADER_END = new TextEncoder().encode("\r\n\r\n");
// 경계를 못 찾은 채 이만큼 쌓이면 형식이 깨진 것이다 — 무한 누적 방지.
const MAX_BUFFER = 8 * 1024 * 1024;
// 스냅샷 폴링 간격 — 설계(docs/cctv-gate-server §5-2) 5초. 장시간 연결을 없애야 요청 단위 과금이 유지된다.
const POLL_MS = 5000;
// 한 번의 스냅샷 요청이 이보다 오래 걸리면 끊는다 — 게이트가 MJPEG 를 계속 흘려도 첫 프레임만 받고 닫는다.
const FETCH_TIMEOUT_MS = 8000;

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

type State = "connecting" | "live" | "denied" | "stale" | "error";

/**
 * 응답에서 JPEG 한 장을 꺼낸다. 단발 image/jpeg 면 그대로, multipart(젯슨 게이트)면 첫 프레임만 읽고 스트림을 닫는다.
 * 프레임을 못 만들면 null.
 */
async function readFirstJpeg(res: Response): Promise<Uint8Array<ArrayBuffer> | null> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.startsWith("image/jpeg")) return new Uint8Array(await res.arrayBuffer());
  if (!res.body) return null;
  // FIRST_FRAME_ONLY — 경계 두 개 사이가 한 프레임이다. 하나 나오면 즉시 취소한다.
  const reader = res.body.getReader();
  let buf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return null;
      if (!value) continue;
      const next = new Uint8Array(buf.length + value.length);
      next.set(buf);
      next.set(value, buf.length);
      buf = next;
      if (buf.length > MAX_BUFFER) return null;
      const b0 = indexOfSeq(buf, BOUNDARY, 0);
      if (b0 < 0) continue;
      const b1 = indexOfSeq(buf, BOUNDARY, b0 + BOUNDARY.length);
      if (b1 < 0) continue;
      const h = indexOfSeq(buf, HEADER_END, b0);
      if (h < 0 || h > b1) { buf = buf.slice(b1); continue; }
      const jpeg = buf.slice(h + HEADER_END.length, Math.max(b1 - 2, h + HEADER_END.length));
      return jpeg.length > 0 ? jpeg : null;
    }
  } finally {
    try { await reader.cancel(); } catch { /* 이미 닫힘 */ }
  }
}

/**
 * 게이트(또는 서버 중계)에서 스냅샷을 폴링해 canvas 에 그린다. 요청마다 새 표를 받는다(1회용).
 * 503 은 「젯슨이 안 올리고 있다」(stale·upstream unreachable) — 옛 그림을 살아 있는 척 두지 않는다.
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
    let failStreak = 0;

    const draw = async (jpeg: Uint8Array<ArrayBuffer>) => {
      const bmp = await createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }));
      const cv = canvasRef.current;
      if (cv) {
        if (cv.width !== bmp.width || cv.height !== bmp.height) {
          cv.width = bmp.width;
          cv.height = bmp.height;
        }
        cv.getContext("2d")?.drawImage(bmp, 0, 0);
      }
      bmp.close();
    };

    const pollLoop = async () => {
      while (!stopped) {
        const t0 = Date.now();
        const t = await getTicket("read");
        if (stopped) return;
        if (!t) {
          // 로그인이 없거나 권한이 없다 — 재시도해도 같으므로 천천히 다시 본다(로그인 복귀 대비).
          setState("denied");
          await new Promise((r) => setTimeout(r, POLL_MS));
          continue;
        }
        abort = new AbortController();
        const killer = setTimeout(() => abort?.abort(), FETCH_TIMEOUT_MS);
        try {
          const res = await fetch(`${gateApi}/cctv/stream${suffix}`, {
            headers: { Authorization: `Bearer ${t.ticket}` },
            signal: abort.signal,
            cache: "no-store",
          });
          if (res.status === 503) {
            setState("stale"); // 젯슨이 안 올리고 있다 — 서버는 살아 있다
            failStreak = 0;
          } else if (!res.ok) {
            throw new Error(String(res.status));
          } else {
            const jpeg = await readFirstJpeg(res);
            if (!jpeg) throw new Error("no frame");
            await draw(jpeg);
            setState("live");
            failStreak = 0;
          }
        } catch {
          failStreak += 1;
          if (!stopped) setState((s) => (s === "denied" ? s : "error"));
        } finally {
          clearTimeout(killer);
          abort = null;
        }
        if (stopped) return;
        // 정상이면 5초 간격을 지키고, 실패가 이어지면 물러선다(상한 30초).
        const elapsed = Date.now() - t0;
        const backoff = failStreak > 1 ? Math.min(POLL_MS * 2 ** (failStreak - 1), 30000) : POLL_MS;
        await new Promise((r) => setTimeout(r, Math.max(backoff - elapsed, 200)));
      }
    };
    void pollLoop();
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
  const label =
    state === "denied" ? "로그인 후 볼 수 있습니다"
    : state === "stale" ? "현장 장비 신호 없음"
    : state === "error" ? "연결 실패 · 재시도 중"
    : "연결 중";
  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-contain" />
      {state !== "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-zinc-500">
          <span className={large ? "text-sm text-zinc-400" : "text-[11px] text-zinc-400"}>{label}</span>
          {state === "denied" && (
            <span className={large ? "text-xs text-zinc-600" : "text-[10px] text-zinc-600"}>
              이 현장 CCTV 권한이 있는 계정으로 로그인하세요
            </span>
          )}
          {state === "stale" && (
            <span className={large ? "text-xs text-zinc-600" : "text-[10px] text-zinc-600"}>
              젯슨이 프레임을 올리지 않고 있습니다
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
