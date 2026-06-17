// 관리자 로그인 — id/password 검증 후 비밀번호와 무관한 세션 토큰 반환 (sessionStorage 저장용)
import { NextResponse } from "next/server";

import {
  createSession,
  loginLockRemainingMs,
  recordLoginResult,
  verifyCredentials,
} from "../../../../lib/admin-auth";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON" },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { ok: false, error: "id / password 필수" },
      { status: 400 },
    );
  }

  const { id, password } = body as { id?: unknown; password?: unknown };
  if (typeof id !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { ok: false, error: "id / password 필수" },
      { status: 400 },
    );
  }

  // 잠금 키 = 요청 IP + id. id 단독으로 키잉하면 임의 id 로 다른 관리자를 잠그는
  // targeted lockout(DoS)이 가능 + Map 무한 증식. IP(프록시 헤더 첫 값) 로 범위를 한정.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const lockKey = `${ip}:${id}`;

  // 무차별 대입 방어 — (ip,id) 별 연속 실패 임계 초과 시 일정 시간 잠금(429).
  const lockMs = loginLockRemainingMs(lockKey);
  if (lockMs > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `로그인 시도 초과 — ${Math.ceil(lockMs / 1000)}초 후 다시 시도하세요.`,
      },
      { status: 429 },
    );
  }

  const ok = verifyCredentials(id, password);
  recordLoginResult(lockKey, ok);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "관리자 ID 또는 비밀번호가 일치하지 않습니다." },
      { status: 401 },
    );
  }

  // 비밀번호와 무관한 랜덤 세션 토큰(서버측 TTL) — sessionStorage 저장 후 Authorization 헤더로 재사용.
  const token = createSession();
  return NextResponse.json({ ok: true, token });
}
