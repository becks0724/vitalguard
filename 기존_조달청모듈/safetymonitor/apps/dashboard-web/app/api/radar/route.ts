// 실시간 강수 레이더 프레임 — RainViewer 공개 API(weather-maps.json) 프록시 (키 불필요, 2분 캐시)
// 과거+예보 프레임의 {time, path} 목록과 타일 host 를 반환. 타일 자체는 브라우저가 직접 로드.
import { NextResponse } from "next/server";

type Frame = { time: number; path: string };
type RadarPayload = { host: string; frames: Frame[]; fetchedAt: string };

const globalForCache = globalThis as typeof globalThis & {
  __radarCache?: { ts: number; data: RadarPayload };
};
const CACHE_TTL_MS = 2 * 60 * 1000;

export async function GET() {
  const cached = globalForCache.__radarCache;
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json({ ok: true, cached: true, ...cached.data });
  }

  try {
    const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", {
      cache: "no-store",
      // 업스트림 무한 hang 방지 — 6초 타임아웃(초과 시 abort → 아래 catch 가 502 강등)
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const host: string = json?.host ?? "https://tilecache.rainviewer.com";
    const past: Frame[] = json?.radar?.past ?? [];
    const nowcast: Frame[] = json?.radar?.nowcast ?? [];
    const frames = [...past, ...nowcast].filter(
      (f) => typeof f?.time === "number" && typeof f?.path === "string",
    );
    const data: RadarPayload = { host, frames, fetchedAt: new Date().toISOString() };
    globalForCache.__radarCache = { ts: Date.now(), data };
    return NextResponse.json({ ok: true, cached: false, ...data });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "radar upstream failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
