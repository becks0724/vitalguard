// CCTV AI 백엔드(localhost:8000) same-origin 스트리밍 프록시 — 팀원 공유 시 :3000 터널 하나로 CCTV 영상까지 전달.
// 브라우저가 /ai-cctv/cctv/stream3 을 요청 → 이 라우트가 발표 PC 의 localhost:8000 으로 프록시(MJPEG 스트림 그대로 전달).
import type { NextRequest } from "next/server";

// 프록시 대상 — 발표 PC 의 CCTV 백엔드. env 로 변경 가능(예: 별도 호스트).
const ORIGIN = process.env.AI_CCTV_ORIGIN ?? "http://localhost:8000";

export const dynamic = "force-dynamic";

// 허용 경로 — CCTV 백엔드의 실제 엔드포인트만(stream/stats/connection + 카메라 번호).
// 그 외 경로·트래버설(..)은 차단 → 무인증 오픈 프록시·SSRF 방지.
const ALLOWED_PATH = /^cctv\/(stream|stats|connection)\d*$/;

async function proxy(req: NextRequest, path: string[]): Promise<Response> {
  const rel = path.join("/");
  if (!ALLOWED_PATH.test(rel)) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden path" }), {
      status: 403,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  const target = `${ORIGIN}/${rel}${req.nextUrl.search}`;
  const init: RequestInit & { duplex?: "half" } = { method: req.method };
  if (req.method !== "GET" && req.method !== "HEAD") {
    const ct = req.headers.get("content-type");
    init.headers = ct ? { "content-type": ct } : undefined;
    init.body = await req.text();
  }
  try {
    const upstream = await fetch(target, init);
    // upstream.body(ReadableStream)를 그대로 반환 → MJPEG 무한 스트림이 버퍼링 없이 통과.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "ai backend unreachable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path);
}
