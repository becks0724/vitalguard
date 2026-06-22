// Google 로그인 시작 — state(CSRF) 발급 후 구글 동의 화면으로 redirect.
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import { buildAuthUrl, googleConfigured, publicOrigin } from "../../../../lib/google-oauth";

export async function GET(request: Request) {
  const origin = publicOrigin(request);
  if (!googleConfigured()) {
    return NextResponse.redirect(`${origin}/?gmsg=google_unconfigured`);
  }
  const state = randomBytes(16).toString("base64url");
  const res = NextResponse.redirect(buildAuthUrl(request, state));
  res.cookies.set("vg_oauth_state", state, {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
