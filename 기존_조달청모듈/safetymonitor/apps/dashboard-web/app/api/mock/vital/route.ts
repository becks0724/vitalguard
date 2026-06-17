import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { VitalSample } from "@safetymonitor/schemas";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import {
  addSample,
  countsByWorker,
  latestByWorker,
  recentSamples,
  totalPersisted,
  workerProfiles,
} from "../store";

// GET 응답은 공개 cloudflared 터널로 노출될 수 있다(작업자 폰/워치의 POST 와 같은 경로).
// 따라서 민감 PII(보호자 이름·전화, 위·경도)는 기본 비노출(fail-safe). PII 노출은 두 조건 동시 충족 시에만:
//  (1) .env.local MOCK_VITAL_EXPOSE_PII=true (운영자 opt-in 마스터 스위치)
//  (2) 요청에 유효한 로그인 세션 토큰(Authorization) 동봉 → 로그인한 관제 대시보드만 PII 수신.
// 비로그인 익명 호출(URL 만 아는 외부인)은 마스터 스위치가 켜져 있어도 항상 redaction 된다.
const EXPOSE_PII = process.env.MOCK_VITAL_EXPOSE_PII === "true";

function redactPii(sample: VitalSample, exposePii: boolean): VitalSample {
  if (exposePii) return sample;
  const { guardianName, guardianPhone, latitude, longitude, ...rest } = sample;
  void guardianName;
  void guardianPhone;
  void latitude;
  void longitude;
  return rest;
}

export async function GET(request: Request) {
  const exposePii = EXPOSE_PII && verifyBasicAuth(request);
  return NextResponse.json({
    latest: latestByWorker().map((s) => redactPii(s, exposePii)),
    recent: recentSamples().map((s) => redactPii(s, exposePii)),
    totalPersisted: totalPersisted(),
    countsByWorker: countsByWorker(),
    workerProfiles: workerProfiles(),
    piiRedacted: !exposePii,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // 워치 배칭 전송 — 한 요청에 샘플 배열(라디오 기상 1회). 단일 객체도 그대로 허용(폰 호환).
    if (Array.isArray(body)) {
      let accepted = 0;
      let dropped = 0;
      let last = null;
      for (const item of body) {
        // 항목별 격리 — 한 샘플이 검증 실패(ZodError)해도 전체 400 으로 묶지 않는다.
        // 묶으면 앞 정상 샘플은 이미 적재됐는데 클라가 배치 전체를 재전송(중복) + 뒤 샘플 유실.
        // 실패 항목만 dropped 로 세고 건너뛰며 나머지는 계속 처리.
        let sample;
        try {
          sample = addSample(item);
        } catch (itemError: unknown) {
          if (itemError instanceof ZodError) {
            dropped += 1;
            continue;
          }
          throw itemError;
        }
        if (sample === null) dropped += 1;
        else {
          accepted += 1;
          last = sample;
        }
      }
      return NextResponse.json(
        { ok: true, accepted, dropped, last },
        { status: 201 },
      );
    }

    const sample = addSample(body);
    if (sample === null) {
      return NextResponse.json(
        { ok: true, dropped: "reserved_test_worker" },
        { status: 202 },
      );
    }

    return NextResponse.json({ ok: true, sample }, { status: 201 });
  } catch (error: unknown) {
    console.error("POST Error:", error);
    if (error instanceof ZodError) {
      return NextResponse.json(
        { ok: false, error: error.flatten() },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: "invalid mock vital payload",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}
