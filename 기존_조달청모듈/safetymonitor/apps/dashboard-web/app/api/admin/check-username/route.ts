// 관리자 ID 중복 확인 — 가입 폼의 '중복 확인' 버튼용. 형식·예약어·중복을 검사해 사용 가능 여부 반환.
import { NextResponse } from "next/server";

import { findUserByUsername } from "../../../../lib/db";

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,40}$/;
const RESERVED = new Set(["admin", "owner", "root", "administrator", "superuser"]);

// per-IP 조회 한도 — 사용자명 열거(enumeration) 남용 완화.
const IP_WINDOW_MS = 60 * 1000;
const IP_MAX = 30;
const ipHits = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "unknown";
}

function ipThrottled(ip: string): boolean {
  const now = Date.now();
  const cur = ipHits.get(ip);
  if (!cur || now > cur.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
    return false;
  }
  cur.count += 1;
  return cur.count > IP_MAX;
}

export async function GET(request: Request) {
  const u = new URL(request.url).searchParams.get("u")?.trim() ?? "";
  if (!USERNAME_RE.test(u)) {
    return NextResponse.json({ ok: true, available: false, reason: "invalid" });
  }
  if (RESERVED.has(u.toLowerCase())) {
    return NextResponse.json({ ok: true, available: false, reason: "reserved" });
  }
  if (ipThrottled(clientIp(request))) {
    return NextResponse.json(
      { ok: false, error: "요청이 많습니다. 잠시 후 다시 시도해주세요." },
      { status: 429 },
    );
  }
  const existing = await findUserByUsername(u);
  return NextResponse.json({
    ok: true,
    available: !existing,
    reason: existing ? "taken" : "ok",
  });
}
