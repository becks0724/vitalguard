// 회원가입 이메일 인증번호 발송 — 6자리 코드 생성 후 Resend 로 메일 전송(승인제 가입의 이메일 검증).
import { NextResponse } from "next/server";

import { sendVerificationEmail } from "../../../../../lib/email";
import { requestCode } from "../../../../../lib/email-verify";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// per-IP 스팸/남용 방지 — 동일 IP 10분당 발송 한도(메일 릴레이 악용 차단).
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX = 10;
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

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const email = (body as { email?: unknown })?.email;
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json(
      { ok: false, error: "이메일 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  if (ipThrottled(clientIp(request))) {
    return NextResponse.json(
      { ok: false, error: "요청이 많습니다. 잠시 후 다시 시도해주세요." },
      { status: 429 },
    );
  }

  const r = requestCode(email.trim());
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: `잠시 후 다시 시도해주세요. (${r.retryAfterSec}초)` },
      { status: 429 },
    );
  }

  const sent = await sendVerificationEmail(email.trim(), r.code);
  if (!sent.ok) {
    return NextResponse.json(
      { ok: false, error: sent.error || "메일 발송에 실패했습니다." },
      { status: 502 },
    );
  }

  // devCode 는 RESEND_API_KEY 미설정 + 개발 환경에서만 존재(로컬/데모 검증용).
  return NextResponse.json({ ok: true, devCode: sent.devCode });
}
