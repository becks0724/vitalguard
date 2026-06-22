// 직급/직책 관제 웹 입력 — workerId 별 오버라이드 upsert. 로그인 세션 토큰 필수(폰 POST 와 분리).
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../lib/admin-auth";
import { setWorkerJobTitle } from "../../../lib/db";

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

  const workerId =
    typeof body === "object" && body !== null && "workerId" in body
      ? String((body as { workerId: unknown }).workerId ?? "").trim()
      : "";
  const jobTitleRaw =
    typeof body === "object" && body !== null && "jobTitle" in body
      ? String((body as { jobTitle: unknown }).jobTitle ?? "")
      : "";
  const jobTitle = jobTitleRaw.slice(0, 40); // 스키마와 동일 상한

  if (!workerId) {
    return NextResponse.json({ ok: false, error: "workerId required" }, { status: 400 });
  }

  await setWorkerJobTitle(workerId, jobTitle);
  return NextResponse.json({ ok: true, workerId, jobTitle: jobTitle.trim() });
}
