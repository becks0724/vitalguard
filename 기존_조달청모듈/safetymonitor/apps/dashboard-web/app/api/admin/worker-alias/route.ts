// 작업자 ID 병합 별칭 — owner 전용. secondary(별칭) → primary(주 ID) 등록/조회/해제. 수신 시 정규화해 1인 1카드로 합친다.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import {
  deleteWorkerAlias,
  listWorkerAliases,
  setWorkerAlias,
} from "../../../../lib/db";

function field(body: unknown, key: string): string {
  return typeof body === "object" && body !== null && key in body
    ? String((body as Record<string, unknown>)[key] ?? "").trim()
    : "";
}

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const aliases = await listWorkerAliases();
  return NextResponse.json({ ok: true, aliases });
}

export async function POST(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const primaryId = field(body, "primaryId").slice(0, 80);
  const secondaryId = field(body, "secondaryId").slice(0, 80);
  if (!primaryId || !secondaryId) {
    return NextResponse.json(
      { ok: false, error: "주 ID·별칭 ID를 모두 입력해주세요." },
      { status: 400 },
    );
  }
  if (primaryId === secondaryId) {
    return NextResponse.json(
      { ok: false, error: "같은 ID는 병합할 수 없습니다." },
      { status: 400 },
    );
  }
  // 사번 형식 강제 — 저장된 primaryId 는 배치 어시스턴트 LLM 컨텍스트에 workerId 로 전달되므로
  // 임의 문자열(개행·지시문)이 들어가면 간접 프롬프트 인젝션 경로가 된다.
  const ID_RE = /^(?:EMP|VW)-[A-Za-z0-9_-]+$/;
  if (!ID_RE.test(primaryId) || !ID_RE.test(secondaryId)) {
    return NextResponse.json(
      { ok: false, error: "ID 형식이 올바르지 않습니다 (EMP-/VW- 사번만 허용)." },
      { status: 400 },
    );
  }
  await setWorkerAlias(secondaryId, primaryId);
  return NextResponse.json({ ok: true, primaryId, secondaryId });
}

export async function DELETE(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const secondaryId = field(body, "secondaryId");
  if (!secondaryId) {
    return NextResponse.json({ ok: false, error: "secondaryId 필요" }, { status: 400 });
  }
  await deleteWorkerAlias(secondaryId);
  return NextResponse.json({ ok: true, secondaryId });
}
