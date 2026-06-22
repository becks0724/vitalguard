// 관리자 — 낙상 ML 후보에 정답 라벨 저장(지도학습 ground truth)
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { setFallLabel } from "../../../../lib/db";

// 허용 라벨 — 실제 낙상 / 오탐(거짓 양성) / 미상. 빈 문자열은 미지정(라벨 해제).
const ALLOWED = new Set(["true_fall", "false_positive", "unsure", ""]);

export async function POST(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json(
      { ok: false, error: "관리자 인증 필요" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON 파싱 실패" }, { status: 400 });
  }

  const { sampleId, label, note } = (body ?? {}) as {
    sampleId?: unknown;
    label?: unknown;
    note?: unknown;
  };

  if (!Number.isInteger(sampleId) || (sampleId as number) <= 0) {
    return NextResponse.json(
      { ok: false, error: "sampleId 는 양의 정수여야 합니다." },
      { status: 400 },
    );
  }
  if (typeof label !== "string" || !ALLOWED.has(label)) {
    return NextResponse.json(
      { ok: false, error: "label 은 true_fall/false_positive/unsure 중 하나입니다." },
      { status: 400 },
    );
  }

  await setFallLabel({
    sampleId: sampleId as number,
    label,
    // note 길이 제한(inspector/ackBy 40자와 일관되게 과대 입력 방지) — 500자 컷.
    note: typeof note === "string" ? note.slice(0, 500) : null,
    labeledBy: "관리자",
  });

  return NextResponse.json({ ok: true });
}
