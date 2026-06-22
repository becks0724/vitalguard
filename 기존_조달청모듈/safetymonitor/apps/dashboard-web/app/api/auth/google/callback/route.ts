// Google 콜백 — state 검증 → code 교환 → users 분기(신규=추가정보 / 승인=세션 / 대기·거절=안내).
import { NextResponse } from "next/server";

import { createSession } from "../../../../../lib/admin-auth";
import { findUserByGoogleSub } from "../../../../../lib/db";
import {
  exchangeCodeForProfile,
  publicOrigin,
  readCookie,
  signPayload,
} from "../../../../../lib/google-oauth";

const SIGNUP_TICKET_TTL = 10 * 60 * 1000; // 10분

export async function GET(request: Request) {
  const origin = publicOrigin(request);
  const secure = origin.startsWith("https");
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = readCookie(request, "vg_oauth_state");

  const go = (query: string) => {
    const res = NextResponse.redirect(`${origin}/${query}`);
    res.cookies.set("vg_oauth_state", "", { maxAge: 0, path: "/" }); // state 1회용 폐기
    return res;
  };

  // CSRF — state 쿠키와 콜백 state 일치 필수.
  if (!code || !state || !cookieState || state !== cookieState) {
    return go("?gmsg=google_state");
  }

  const profile = await exchangeCodeForProfile(request, code);
  if (!profile) {
    return go("?gmsg=google_failed");
  }

  const existing = await findUserByGoogleSub(profile.sub);

  if (!existing) {
    // 신규 — 회사·연락처 추가정보 입력 단계로. 신원은 HMAC 서명 쿠키로 전달.
    const ticket = signPayload(
      { sub: profile.sub, email: profile.email, name: profile.name },
      SIGNUP_TICKET_TTL,
    );
    const res = go("?gsignup=1");
    res.cookies.set("vg_gsignup", ticket, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    return res;
  }

  if (existing.status === "approved") {
    // 승인됨 — 세션 발급 후 핸드오프 쿠키로 클라이언트에 전달.
    const token = createSession("admin", existing.username);
    const res = go("?gauth=1");
    res.cookies.set("vg_handoff", token, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      maxAge: 60,
      path: "/",
    });
    return res;
  }

  if (existing.status === "pending") return go("?gmsg=pending");
  return go("?gmsg=rejected");
}
