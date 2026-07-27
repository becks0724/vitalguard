// 세션 연장 — 현재 유효 세션 JWT 로 새 만료 JWT 재발급(슬라이딩). 만료/무효면 401.
// 은행식 "세션 연장" 팝업의 [연장] 이 호출. 무상태 JWT 라 재배포 후에도 유효 세션이면 연장됨.
import { NextResponse } from "next/server";

import { createSession, getSession } from "../../../../../lib/admin-auth";
import { findUserByUsername } from "../../../../../lib/db";

export async function POST(request: Request) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "session_invalid" },
      { status: 401 },
    );
  }

  // 계정 상태 재확인(감사 BE-AUTHZ-09) — JWT 는 무상태라 서명 검증만으로는 "발급 이후에
  // 거절·삭제된 계정"을 걸러내지 못한다. 여기서 DB 를 다시 보지 않으면 관리자가 계정을
  // 거절해도 그 세션이 연장을 반복하며 무기한 살아남는다(폐기 수단 부재).
  // 재발급은 연장 팝업에서만 호출되는 저빈도 경로라 매번 조회해도 부담이 없다.
  //
  // env owner 는 users 행이 없다(자격이 환경변수) — 조회하면 항상 null 이라 검사에서 제외한다.
  // DB 조회 실패는 잡지 않는다. 500 으로 올려 연장을 거부하는 편이, 상태를 확인하지 못한 채
  // 연장해 주는 것보다 안전하다(기존 토큰은 만료까지 그대로 유효하므로 즉시 로그아웃은 아니다).
  if (session.role !== "owner") {
    const user = await findUserByUsername(session.username);
    if (!user || user.status !== "approved") {
      return NextResponse.json(
        { ok: false, error: "session_revoked" },
        { status: 401 },
      );
    }
  }

  const token = createSession(session.role, session.username);
  return NextResponse.json({ ok: true, token, role: session.role });
}
