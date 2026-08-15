// 비밀번호 재설정 요청 처리 — 목록 조회(GET)와 승인/거절(POST). 사용자 승인 권한이 있는 계정만.
// 승인하면 임시 비밀번호를 생성해 해시만 저장하고, 평문은 이 응답에서 딱 한 번 돌려준다.
import { NextResponse } from "next/server";

import {
  generateTempPassword,
  tempPasswordExpiry,
} from "../../../../../lib/account-recovery";
import { getSession, verifyUserAdmin } from "../../../../../lib/admin-auth";
import {
  approvePasswordReset,
  listPasswordResetRequests,
  rejectPasswordReset,
} from "../../../../../lib/db";
import { hashPassword } from "../../../../../lib/password";

// 가입 승인과 같은 권한 경계를 쓴다 — 재설정 승인은 가입 승인만큼 무거운 행위다(계정 접근을 넘긴다).
async function guard(request: Request): Promise<NextResponse | null> {
  if (!(await verifyUserAdmin(request))) {
    return NextResponse.json(
      { ok: false, error: "사용자 관리 권한이 필요합니다." },
      { status: 401 },
    );
  }
  return null;
}

export async function GET(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;
  return NextResponse.json({ ok: true, requests: await listPasswordResetRequests() });
}

export async function POST(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const { id, action } = (body ?? {}) as { id?: unknown; action?: unknown };
  if (typeof id !== "number" || (action !== "approve" && action !== "reject")) {
    return NextResponse.json(
      { ok: false, error: "id(number) 와 action(approve|reject) 이 필요합니다." },
      { status: 400 },
    );
  }

  // 처리자 기록용 — guard 를 통과했으므로 세션은 반드시 있다.
  const resolvedBy = getSession(request)?.username ?? "unknown";

  if (action === "reject") {
    const rejected = await rejectPasswordReset(id, resolvedBy);
    if (!rejected) {
      return NextResponse.json(
        { ok: false, error: "이미 처리된 요청입니다." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, request: rejected });
  }

  // 승인 — 임시 비밀번호를 만들어 해시만 저장한다. 평문은 DB 에 남기지 않는다.
  const tempPassword = generateTempPassword();
  const expiresAt = tempPasswordExpiry();
  const updated = await approvePasswordReset(
    id,
    await hashPassword(tempPassword),
    expiresAt,
    resolvedBy,
  );
  if (!updated) {
    // 다른 owner 가 먼저 처리했다. 임시 비번은 저장되지 않았다(트랜잭션이 통째로 롤백된다).
    return NextResponse.json(
      { ok: false, error: "이미 처리된 요청입니다." },
      { status: 409 },
    );
  }

  // ★ tempPassword 는 여기서만 노출된다. 화면을 새로 고치면 다시 볼 수 없다(재발급만 가능).
  return NextResponse.json({ ok: true, request: updated, tempPassword, expiresAt });
}
