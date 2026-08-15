// 아이디 찾기 — 이름 + 이메일이 일치하는 계정의 아이디를 마스킹해 돌려준다(미인증 · 관리자 개입 없음).
import { NextResponse } from "next/server";

import { maskUsername } from "../../../../lib/account-recovery";
import { clientIpFromRequest } from "../../../../lib/client-ip";
import { findUsernamesByNameEmail } from "../../../../lib/db";
import { consumeToken } from "../../../../lib/rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 미인증 조회라 열거 시도를 막는다. 이름+이메일 두 값을 모두 맞춰야 하므로 열거 비용은 이미 높지만,
// 유출된 명단을 그대로 훑는 경우가 남는다.
const IP_MAX = 10;
const IP_WINDOW_MS = 10 * 60 * 1000;
// 버킷이 비었을 때 다음 토큰까지 걸리는 최대 시간 — 회복은 경과에 비례하므로 window/limit 이다.
// "잠시 후"가 얼마인지 알려주지 않으면 사용자는 될 때까지 눌러보고, 그게 다시 제한을 채운다.
const RETRY_AFTER_SEC = Math.ceil(IP_WINDOW_MS / IP_MAX / 1000);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const { name, email } = (body ?? {}) as { name?: unknown; email?: unknown };
  if (typeof name !== "string" || typeof email !== "string") {
    return NextResponse.json(
      { ok: false, error: "이름과 이메일을 입력해주세요." },
      { status: 400 },
    );
  }
  const personName = name.trim();
  const mail = email.trim();
  if (!personName || !EMAIL_RE.test(mail)) {
    return NextResponse.json(
      { ok: false, error: "이름과 이메일을 정확히 입력해주세요." },
      { status: 400 },
    );
  }

  if (!consumeToken(`find-id:${clientIpFromRequest(request)}`, IP_MAX, IP_WINDOW_MS)) {
    return NextResponse.json(
      { ok: false, error: `요청이 많습니다. 약 ${RETRY_AFTER_SEC}초 후 다시 시도해주세요.` },
      { status: 429, headers: { "retry-after": String(RETRY_AFTER_SEC) } },
    );
  }

  const rows = await findUsernamesByNameEmail(personName, mail);
  if (rows.length === 0) {
    // 존재 여부를 숨기지 않는다 — 승인제라 사용자가 "맞게 넣었는데 왜 안 나오지"로 헤매면
    // 그대로 문의가 된다. 열거 방어는 위 rate limit + 두 값 동시 일치로 한다.
    return NextResponse.json(
      { ok: false, error: "입력하신 정보와 일치하는 계정이 없습니다." },
      { status: 404 },
    );
  }

  // 아이디는 마스킹해서 내려준다 — 이름·이메일은 명함에 있는 값이라 전체를 노출하면
  // 그 둘만으로 남의 계정 아이디를 캐낼 수 있다. 가입일은 계정이 여럿일 때의 구분 단서다.
  return NextResponse.json({
    ok: true,
    accounts: rows.map((r) => ({
      username: maskUsername(r.username),
      createdAt: r.created_at,
      status: r.status,
    })),
  });
}
