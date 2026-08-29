// 워치 QR 로그인 ③ 폴링 — 워치가 code+secret 으로 묻는다. 승인됐으면 토큰을 **한 번만** 내주고 소비한다.
import { NextResponse } from "next/server";

import { clientIpFromXff } from "../../../../../lib/admin-auth";
import { consumeDeviceLogin, readDeviceLogin } from "../../../../../lib/db";
import { normalizeDeviceCode, secretMatches } from "../../../../../lib/device-login";
import { consumeToken } from "../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = clientIpFromXff(request);
  // 워치 4초 폴링 = 분당 15. IP 당 분당 60 이면 워치 여럿이 한 NAT 뒤에 있어도 넉넉하다.
  if (!consumeToken(`device-poll:${ip}`, 60, 60_000)) {
    return NextResponse.json({ ok: false, error: "too_many_requests" }, { status: 429 });
  }
  const url = new URL(request.url);
  const code = normalizeDeviceCode(url.searchParams.get("code"));
  const secret = url.searchParams.get("secret");
  if (!code) return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });

  const row = await readDeviceLogin(code);
  // 없음과 secret 불일치를 같은 404 로 — 코드 존재 여부·secret 정오를 가르는 신호를 주지 않는다.
  if (!row || !secretMatches(secret, row.secret_hash)) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const noStore = { headers: { "cache-control": "no-store" } };
  if (row.status === "pending") {
    return NextResponse.json({ ok: true, status: row.expired ? "expired" : "pending" }, noStore);
  }
  if (row.status === "approved") {
    const got = await consumeDeviceLogin(code);
    if (got) {
      return NextResponse.json(
        { ok: true, status: "approved", token: got.token, workerId: got.workerId, workerName: got.workerName },
        noStore,
      );
    }
  }
  // consumed(이미 내줌) — 두 번째 요청엔 토큰이 없다. 워치는 새 코드를 발급받는다.
  return NextResponse.json({ ok: true, status: "expired" }, noStore);
}
