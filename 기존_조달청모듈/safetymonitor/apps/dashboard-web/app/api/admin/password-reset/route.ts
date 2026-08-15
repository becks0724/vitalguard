// 비밀번호 재설정 신청 — 아이디·이름·이메일이 모두 일치하면 요청을 만든다(미인증). 처리는 owner 가 manage 에서.
// 메일 링크가 아니라 사람 승인인 이유 = EMAIL_FROM 미설정이라 임의 수신자에게 메일이 배달되지 않는다.
// 근거·대안은 docs/account-recovery/context-notes.md 참조.
import { NextResponse } from "next/server";

import { clientIpFromRequest } from "../../../../lib/client-ip";
import { createPasswordResetRequest, findUserByUsername } from "../../../../lib/db";
import { consumeToken } from "../../../../lib/rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 실패한 시도도 토큰을 먹는다 — 이메일을 잘못 기억해 두어 번 고쳐 넣으면 그것만으로 막힌다.
// 처음 5회로 뒀다가 첫 실사용에서 바로 걸렸다(2026-08-15, 오타 재시도 4번). 아이디 찾기와
// 같은 10회로 맞춘다. 세 값(아이디·이름·이메일)을 모두 맞춰야 하므로 열거 비용은 이미 높다.
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

  const { username, name, email } = (body ?? {}) as {
    username?: unknown;
    name?: unknown;
    email?: unknown;
  };
  if (typeof username !== "string" || typeof name !== "string" || typeof email !== "string") {
    return NextResponse.json(
      { ok: false, error: "아이디·이름·이메일을 모두 입력해주세요." },
      { status: 400 },
    );
  }
  const uname = username.trim();
  const personName = name.trim();
  const mail = email.trim();
  if (!uname || !personName || !EMAIL_RE.test(mail)) {
    return NextResponse.json(
      { ok: false, error: "아이디·이름·이메일을 정확히 입력해주세요." },
      { status: 400 },
    );
  }

  if (
    !consumeToken(`pw-reset:${clientIpFromRequest(request)}`, IP_MAX, IP_WINDOW_MS)
  ) {
    return NextResponse.json(
      { ok: false, error: `요청이 많습니다. 약 ${RETRY_AFTER_SEC}초 후 다시 시도해주세요.` },
      { status: 429, headers: { "retry-after": String(RETRY_AFTER_SEC) } },
    );
  }

  const user = await findUserByUsername(uname);
  // 세 값이 모두 맞아야 한다. 이름·이메일 비교는 아이디 찾기와 같은 규칙(이메일은 대소문자 무시).
  const matches =
    !!user &&
    user.name === personName &&
    (user.email ?? "").toLowerCase() === mail.toLowerCase();
  if (!user || !matches) {
    return NextResponse.json(
      { ok: false, error: "입력하신 정보와 일치하는 계정이 없습니다." },
      { status: 404 },
    );
  }

  // 구글 전용 계정은 비밀번호 자체가 없다 — 재설정해 줘도 쓸 데가 없고, 구글로 들어가면 된다.
  if (user.auth_provider !== "password" || !user.password_hash) {
    return NextResponse.json(
      {
        ok: false,
        error: "구글 계정으로 가입한 계정입니다. '구글로 계속하기'로 로그인해주세요.",
      },
      { status: 400 },
    );
  }
  // 작업자 계정은 관제 웹 대상이 아니다(로그인 라우트와 같은 판정).
  if (user.role === "worker") {
    return NextResponse.json(
      {
        ok: false,
        error: "작업자 계정은 관제 웹에 로그인할 수 없습니다. 모바일 앱을 이용하세요.",
      },
      { status: 403 },
    );
  }

  const created = await createPasswordResetRequest(user.id, user.username);
  if (!created) {
    // 부분 유니크 인덱스가 막은 경우 = 이미 미처리 요청이 있다. 조용히 성공으로 처리하지 않는다.
    return NextResponse.json(
      { ok: false, error: "이미 접수된 재설정 요청이 있습니다. 관리자 처리를 기다려주세요." },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      message:
        "재설정 요청이 접수됐습니다. 관리자가 확인 후 임시 비밀번호를 알려드립니다.",
    },
    { status: 201 },
  );
}
