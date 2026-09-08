// 워치 단말 등록(A-4) — 서버가 wearableId 를 발급하고, 앱은 그것을 저장해 이후 전송에 싣는다.
//
// 왜 별도 호출인가(팀원 판정 2026-09-08): "poll 응답에 문자열만 넣으면 durable 이 아님."
// 맞다. 폴링 응답은 매번 새로 오고 실패·재시도가 섞여, 거기 얹힌 식별자를 앱이 저장하면
// "서버는 발급했다고 믿는데 앱은 못 받은" 반쪽 상태가 남는다. 그 상태는 나중에 조용한
// 데이터 오귀속으로만 드러난다. 그래서 **명시적 등록 + 확정 응답**으로 좁힌다.
//
// 축 = 앱이 쓰는 것 `/api/app/*`. 관제 화면은 이 경로를 부르지 않는다.
import { NextResponse } from "next/server";

import { bearerToken, diagnoseAppAuth, verifyAppJwt } from "../../../../../lib/app-jwt";
import { clientIpFromRequest } from "../../../../../lib/client-ip";
import { consumeToken } from "../../../../../lib/rate-limit";
import { registerWearable } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

const PLATFORMS = new Set(["wearos", "watchos"]);
// 자유 문자열은 길이를 자른다 — 모델·버전은 표시용이라 길 이유가 없고, 긴 값은 로그만 더럽힌다.
const trim = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

export async function POST(request: Request) {
  // 등록은 기기당 사실상 1회다 — 정상 사용에서 잦을 수 없으므로 한도를 좁게 둔다.
  if (!consumeToken(`wearable-register:${clientIpFromRequest(request)}`, 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "요청이 너무 잦습니다" }, { status: 429 });
  }

  const claims = verifyAppJwt(bearerToken(request));
  // 사용자 특정은 sub(username)으로 한다 — 사번은 UNIQUE (company_id, employee_no) 라
  // 회사를 모르면 유일하지 않지만 username 은 전역 UNIQUE 다.
  if (!claims?.sub) {
    const d = diagnoseAppAuth(request, { requireWorkerId: false });
    console.warn(`[wearable] ${d.logLine}`);
    return NextResponse.json({ ok: false, error: "유효하지 않은 토큰", action: d.action }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "본문을 읽을 수 없습니다" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const platform = typeof b.platform === "string" ? b.platform : "";
  if (!PLATFORMS.has(platform)) {
    // 표의 CHECK 와 같은 값만 받는다 — 여기서 막지 않으면 23514 로 500 이 된다.
    return NextResponse.json({ ok: false, error: "platform 은 wearos 또는 watchos" }, { status: 400 });
  }

  const result = await registerWearable({
    username: claims.sub,
    platform: platform as "wearos" | "watchos",
    model: trim(b.model, 120),
    appVersion: trim(b.appVersion, 40),
    wearableId: trim(b.wearableId, 64),
  });

  if (!result.ok) {
    if (result.reason === "no_table") {
      // 신 스키마가 아직 안 선 서버 — 앱이 "서버 준비 안 됨"으로 알아듣고 나중에 다시 오면 된다.
      // 여기서 200 을 주면 앱이 없는 id 를 저장한다.
      return NextResponse.json({ ok: false, error: "단말 등록은 아직 준비 중입니다", action: "retry_later" }, { status: 503 });
    }
    // 토큰은 유효한데 신 DB 에 그 사용자가 없다 — 이관 누락이다. 앱이 재로그인해도 안 풀린다.
    console.warn(`[wearable] 등록 거부(no_user) — sub=${claims.sub}`);
    return NextResponse.json({ ok: false, error: "등록된 사용자가 아닙니다", action: "none" }, { status: 409 });
  }

  return NextResponse.json(
    { ok: true, wearableId: result.wearableId, created: result.created },
    { status: result.created ? 201 : 200, headers: { "cache-control": "no-store" } },
  );
}
