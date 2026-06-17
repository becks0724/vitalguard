// AED NFC 점검 기록 수신 — 현장 관리자 NFC 태깅 시 호출. 위조 방지: 서명된 태그 URL(?sig=)만 제출 허용.
// 서명 URL 발급(GET)은 관리자 인증 필요 → 무로그인 현장 제출 UX 보존하면서 임의 인터넷 POST 위조 차단.
import { NextResponse } from "next/server";

import { recordAedInspection } from "../../../../lib/db";
import { findAedDevice } from "../../../../lib/aed-devices";
import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { aedInspectSig, verifyAedSig } from "../../../../lib/aed-sign";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청 형식" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const aedId = typeof b.aedId === "string" ? b.aedId.trim() : "";
  const device = findAedDevice(aedId);
  if (!device) {
    return NextResponse.json({ ok: false, error: "알 수 없는 AED 장비" }, { status: 404 });
  }

  // 서명 검증 — 관리자가 발급한 서명 태그 URL(?sig=)에서 온 제출만 허용(임의 인터넷 POST 위조 차단).
  const sig = typeof b.sig === "string" ? b.sig : "";
  if (!verifyAedSig(aedId, sig)) {
    return NextResponse.json(
      { ok: false, error: "서명 검증 실패 — 유효한 NFC 태그가 아닙니다" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const inspector = (typeof b.inspector === "string" ? b.inspector.trim() : "").slice(0, 40);
  if (!inspector) {
    return NextResponse.json({ ok: false, error: "점검자 이름이 필요합니다" }, { status: 400 });
  }

  const allowed = new Set(["battery", "pad"]);
  const items = Array.isArray(b.items)
    ? (b.items.filter((x) => typeof x === "string" && allowed.has(x)) as string[])
    : [];

  const ts =
    typeof b.ts === "string" && !Number.isNaN(Date.parse(b.ts)) ? b.ts : new Date().toISOString();

  recordAedInspection({ aedId, loc: device.loc, inspector, items, ts });

  return NextResponse.json(
    { ok: true, loc: device.loc, inspector, items, ts },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}

// 서명된 점검 URL 발급 — 관리자(대시보드 로그인)만. NFC 모달이 이 sig 를 받아 태그 URL 에 붙인다.
export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json(
      { ok: false, error: "인증 필요" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const aedId = new URL(request.url).searchParams.get("aedId")?.trim() ?? "";
  const device = findAedDevice(aedId);
  if (!device) {
    return NextResponse.json({ ok: false, error: "알 수 없는 AED 장비" }, { status: 404 });
  }
  return NextResponse.json(
    { ok: true, aedId, sig: aedInspectSig(aedId) },
    { headers: { "cache-control": "no-store" } },
  );
}
