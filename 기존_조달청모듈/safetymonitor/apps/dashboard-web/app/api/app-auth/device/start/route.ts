// 워치 QR 로그인 ① 시작 — 워치가 코드·secret·QR 행렬을 받는다(무인증 · IP 토큰버킷). 토큰은 여기서 안 나간다.
import { NextResponse } from "next/server";

import { clientIpFromXff } from "../../../../../lib/admin-auth";
import { isAppJwtConfigured } from "../../../../../lib/app-jwt";
import { createDeviceLogin } from "../../../../../lib/db";
import {
  DEVICE_LOGIN_TTL_SEC,
  hashDeviceSecret,
  newDeviceCode,
  newDeviceSecret,
  pairUrl,
  publicOrigin,
  qrMatrix,
} from "../../../../../lib/device-login";
import { consumeToken } from "../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAppJwtConfigured()) {
    return NextResponse.json({ ok: false, error: "app_auth_not_configured" }, { status: 503 });
  }
  // 코드 남발 방지 — 워치 하나는 5분에 한두 번이면 족하다. IP 당 분당 10.
  const ip = clientIpFromXff(request);
  if (!consumeToken(`device-start:${ip}`, 10, 60_000)) {
    return NextResponse.json({ ok: false, error: "too_many_requests" }, { status: 429 });
  }

  const secret = newDeviceSecret();
  const secretHash = hashDeviceSecret(secret);
  let code = newDeviceCode();
  // 충돌은 사실상 없지만(31^8) 있으면 새 코드로 — 남의 코드를 덮어쓰지 않는다(ON CONFLICT DO NOTHING).
  for (let i = 0; i < 3; i++) {
    if (await createDeviceLogin(code, secretHash, DEVICE_LOGIN_TTL_SEC, ip)) {
      const url = pairUrl(publicOrigin(request), code);
      return NextResponse.json(
        { ok: true, code, secret, expiresInSec: DEVICE_LOGIN_TTL_SEC, pairUrl: url, qr: qrMatrix(url) },
        { headers: { "cache-control": "no-store" } },
      );
    }
    code = newDeviceCode();
  }
  return NextResponse.json({ ok: false, error: "code_collision" }, { status: 503 });
}
