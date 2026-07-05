import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { VitalSample } from "@safetymonitor/schemas";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { ingestAuthStatus } from "../../../../lib/ingest-auth";
import {
  addSample,
  countsByWorker,
  latestByWorker,
  recentSamples,
  totalPersisted,
  workerAliases,
  workerProfiles,
} from "../store";
import { recentZoneHazards } from "../../cctv/ingest";

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
  const aliasMap = await workerAliases();
  return NextResponse.json({
    latest: latestByWorker(aliasMap).map((s) => redactPii(s, exposePii)),
    recent: recentSamples().map((s) => redactPii(s, exposePii)),
    totalPersisted: await totalPersisted(),
    countsByWorker: await countsByWorker(),
    workerProfiles: await workerProfiles(),
    workerAliases: aliasMap,
    // 영상 단독 대상 미특정 위험(설계 §9 동봉) — worker 없는 zone 이라 alerts 가 아닌 메모리 경로. PII 없음.
    zoneHazards: recentZoneHazards(),
    piiRedacted: !exposePii,
  });
}

// 무인증 수집 전송 경고(soft 모드) — 프로세스당 1회만(5초 폴 로그 스팸 방지).
let warnedUnauthedVital = false;

export async function POST(request: Request) {
  // 토큰 병행(soft) — 유효 토큰 있으면 인증, 무토큰은 한시 허용(경고), 무효 토큰은 거부.
  const auth = ingestAuthStatus(request);
  if (auth === "invalid") {
    return NextResponse.json({ ok: false, error: "유효하지 않은 토큰" }, { status: 401 });
  }
  if (auth === "none" && !warnedUnauthedVital) {
    warnedUnauthedVital = true;
    console.warn("[vital] 무인증 수집 전송 수용 중(soft) — 발표 후 토큰 필수화 예정");
  }
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
          sample = await addSample(item);
        } catch (itemError: unknown) {
          if (itemError instanceof ZodError) {
            // 심층방어 — 응급 플래그(manualSos/fallDetected) 샘플이 파싱 불가(ts 형식 오류 등
            // 스트립 불가 케이스)로 폐기되면 조용히 사라지지 않게 눈에 띄는 경고를 남긴다.
            // 범위 밖 vital 만의 문제는 리질리언트 파서(store.addSample)가 이미 수용한다.
            const rec =
              typeof item === "object" && item !== null
                ? (item as {
                    manualSos?: unknown;
                    fallDetected?: unknown;
                    workerId?: unknown;
                    ts?: unknown;
                  })
                : null;
            if (rec && (rec.manualSos || rec.fallDetected)) {
              console.warn(
                `[vital] 경고: 응급 신호(manualSos/fallDetected) 샘플이 파싱 불가로 폐기됨 — workerId=${String(rec.workerId)}, ts=${String(rec.ts)}`,
                itemError.issues,
              );
            }
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

    const sample = await addSample(body);
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

    // 서버/DB 오류 — 내부 상세(호스트·스키마·드라이버)는 응답에 노출하지 않고 서버 로그로만(위 console.error).
    return NextResponse.json(
      { ok: false, error: "수집 처리 실패" },
      { status: 500 },
    );
  }
}
