import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { VitalSample } from "@safetymonitor/schemas";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { bearerToken, diagnoseAppAuth, verifyAppJwt } from "../../../../lib/app-jwt";
import { clientIpFromRequest } from "../../../../lib/client-ip";
import { consumeToken } from "../../../../lib/rate-limit";
import {
  addSample,
  persistSamples,
  countsByWorker,
  coreTempEstimates,
  heatPatterns,
  workRates,
  heatStages,
  offWristSuspects,
  notifyHeatIfDue,
  latestByWorkerWithSpo2,
  recentSamples,
  totalPersisted,
  totalDataMockupPersisted,
  dataMockupSamples,
  workerAliases,
  workerProfiles,
  rosterWorkerNamesMap,
} from "./store";
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

// DB 조회 하나가 관제 화면 전체를 죽이지 않게 한다(2026-08-15 DB 장애 3시간 39분 대응).
//
// 그날 `/api/mock/vital` GET 이 500 을 261건 냈고 관제가 **열화가 아니라 정지**했다. 실시간 감시에
// 필요한 `latest` 는 in-memory ring 으로 만들어져 멀쩡했는데, 옆의 누적 집계 조회가 던지면서
// 응답 전체가 사라진 것이다. 감시가 멈추는 것이 최악이므로 실패한 항목만 비우고 나머지를 보낸다.
//
// ★ 실패해도 되는 것과 아닌 것을 가른다 — 없는 값을 0 으로 채우지 않는다. 누적 21만 건이
//   "0건"으로 뜨면 미수신보다 나쁘다(신호등 false-OK·"미수신인데 준수율 100%" 와 같은 계열).
//   그래서 집계류는 **null** 로 보내고 화면이 `--` 를 찍는다. 클라이언트도 함께 고쳤다 —
//   서버만 null 로 바꾸면 `(x ?? 0).toLocaleString()` 가 그대로 0 을 그려 의도가 뒤집힌다.
//
// ⚠ 이미 자체 catch 로 열화하는 것은 감싸지 않았다 — `workerAliases`(→{})·
//   `latestByWorkerWithSpo2`(SpO₂ 겹침만 실패·메모리 병합 유지)·`coreTempEstimates`·
//   `heatPatterns`·`workRates`·`heatStages`. 이중 방어는 실패 지점을 흐린다.
async function softly<T>(
  label: string,
  run: () => Promise<T>,
  fallback: T,
  failed: string[],
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    failed.push(label);
    console.error(`[vital] ${label} 조회 실패 — 그 항목만 비우고 응답한다`, e);
    return fallback;
  }
}

export async function GET(request: Request) {
  // 관제 생체 스트림은 URL을 아는 누구에게도 공개하지 않는다. PII opt-in은 추가 노출 범위만
  // 정하며, 원본 생체·목업 데이터 자체의 조회 권한을 대신하지 않는다.
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const exposePii = EXPOSE_PII;
  const degraded: string[] = [];
  const aliasMap = await workerAliases();
  return NextResponse.json({
    latest: (await latestByWorkerWithSpo2(aliasMap)).map((s) => redactPii(s, exposePii)),
    recent: recentSamples().map((s) => redactPii(s, exposePii)),
    // 누적 집계 3종은 DB 없이는 **값 자체가 없다** — 0 이 아니라 null(화면 `--`).
    totalPersisted: await softly("누적 건수", totalPersisted, null, degraded),
    // 목업은 실측 스트림과 별도 data_mockup 섹션으로만 반환한다.
    dataMockup: (
      await softly("목업 샘플", dataMockupSamples, [], degraded)
    ).map((s) => redactPii(s, exposePii)),
    dataMockupPersisted: await softly("목업 누적", totalDataMockupPersisted, null, degraded),
    countsByWorker: await softly("워커별 누적", () => countsByWorker(aliasMap), null, degraded),
    // 심박 기반 심부체온 추정(표시 전용·판정 미주입) — PII 아님(파생 지표).
    coreTempEst: await coreTempEstimates(aliasMap),
    // 저활동·고심박 패턴(온열 ②·표시 주석 전용·판정 미주입) — flagged 워커만 실린다.
    heatPattern: await heatPatterns(aliasMap),
    // 작업대사율(kcal/hr) — KOSHA <표 1> 작업강도 분류 입력. 참고 권고용이라 판정·알림에 안 들어간다.
    workRate: await workRates(aliasMap),
    // 온열 단계(온열 ③) — caution/warning 워커만. warning 은 신호등 주의 점등에 쓰인다(사용자 결정).
    heatStage: await heatStages(aliasMap),
    // 벗음 의심(표시 전용·판정 미주입) — 15분째 평평한 심박 워커만. 화면은 `무동작` 아래 한 줄로만 쓴다.
    offWrist: await offWristSuspects(aliasMap),
    // 직급은 없으면 그 표기만 빠진다 — 빈 맵이 안전한 폴백.
    workerProfiles: await softly("직급", workerProfiles, {}, degraded),
    // 이름 — 링 버퍼(41.7분) 밖 작업자는 sample 이 없어 이름·사번이 통째로 사라지고 사번이 이름
    // 자리에 뜬다. 같은 순간 부재 알림은 사람 이름을 부르므로 화면과 알림이 갈린다(2026-08-19).
    // ★ 표시 전용 — 판정·경보는 이 값을 안 본다(store.ts·db.ts 주석 + 가드).
    workerNames: await softly("이름", rosterWorkerNamesMap, {}, degraded),
    workerAliases: aliasMap,
    // 영상 단독 대상 미특정 위험(설계 §9 동봉) — worker 없는 zone 이라 alerts 가 아닌 메모리 경로. PII 없음.
    zoneHazards: recentZoneHazards(),
    piiRedacted: !exposePii,
    // ★ 열화 사실을 화면이 말하게 한다 — 불완전한 표시를 완전한 것처럼 보이게 하지 않는다.
    //   빈 배열 = 정상. 값이 있으면 화면이 "DB 조회 실패 — 표시 불완전" 을 띄운다.
    // ⚠ 별칭 실패는 이 목록에 안 잡힌다 — `workerAliases` 가 상류에서 삼키고 `{}` 를 준다.
    //   그때 같은 사람이 두 카드로 갈려 "작업자가 늘었다"로 오독될 수 있다. 다만 별칭만 홀로
    //   실패하는 경우는 사실상 없고(DB 가 죽으면 아래 항목들도 함께 실패) 이 배열이 비지 않으므로,
    //   화면 문구를 "표시가 불완전할 수 있음"으로 두어 그 경우까지 덮는다.
    degraded,
  });
}

// 무인증 수집 전송 경고(soft 모드) — 프로세스당 1회만(5초 폴 로그 스팸 방지).
// 배치 항목 수 상한(감사 BE-VALID-01) — 레이트리밋은 "요청 수"만 세므로 한 요청에 수십만 건을
// 담는 단일 폭탄은 막지 못한다. 항목마다 zod 파싱 + DB INSERT 가 돌아 요청 하나로 인스턴스를
// 묶어둘 수 있다.
//
// 값의 근거 — 워치 클라이언트의 자체 상한이 300 이다(VitalTransmitter.maxBacklog).
// 오프라인 후 재전송 시 backlog 전체를 1배열로 보내므로 정상 최대치가 300 이고, 여기에
// 여유를 둬 500 으로 잡는다. 정상 트래픽은 자르지 않고 폭탄만 막는 자리다.
const MAX_BATCH_ITEMS = 500;
// 500건 backlog가 정상 최대치여도, JSON 본문 자체가 수십 MB이면 request.json() 단계에서
// 메모리/CPU가 먼저 소모된다. Content-Length가 없거나 거짓이어도 stream 합계로 다시 제한한다.
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

class PayloadTooLargeError extends Error {}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new PayloadTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("요청 본문이 없습니다");

  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let bodyText = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    bodyText += decoder.decode(value, { stream: true });
  }
  bodyText += decoder.decode();
  return JSON.parse(bodyText);
}

function bodyIsBoundToWorker(body: unknown, workerId: string): boolean {
  const samples = Array.isArray(body) ? body : [body];
  return samples.length > 0 && samples.every(
    (sample) =>
      typeof sample === "object" &&
      sample !== null &&
      (sample as { workerId?: unknown }).workerId === workerId,
  );
}

export async function POST(request: Request) {
  // 빈도 제한 — 무토큰 수용(soft) 상태라 위조 주입 비용이 0 이었다(감사 BE-RATE-01).
  // 한도는 실제 전송 케이던스보다 넉넉하게 둔다. 워치·폰은 5초 주기(≈12회/분)이고
  // NAT 뒤 다수 기기를 감안해 IP 당 분당 120 — 정상 트래픽은 자르지 않고 폭주만 막는다.
  if (!consumeToken(`vital:${clientIpFromRequest(request)}`, 120, 60_000)) {
    console.warn("[vital] 수집 빈도 제한 초과 — 요청 거부");
    return NextResponse.json(
      { ok: false, error: "요청이 너무 잦습니다" },
      { status: 429 },
    );
  }
  // 생체·낙상·SOS 데이터는 관제 판단을 바꾸므로, Watch/iPhone 앱 JWT의 사번과 본문 사번이
  // 정확히 같을 때만 수용한다. 범용 업로드 토큰은 이 개인 생체 경로에서 허용하지 않는다.
  const token = bearerToken(request);
  const claims = verifyAppJwt(token);
  if (!claims?.workerId) {
    // 사유는 서버 로그로만 남긴다(응답에 넣으면 서명 성공 여부가 외부로 샌다).
    // 응답에는 앱이 스스로 복구 가능한지(action)만 실어, 조용히 실패하는 대신 재로그인을 띄우게 한다.
    const d = diagnoseAppAuth(request, { requireWorkerId: true });
    console.warn(`[vital] ${d.logLine}`);
    return NextResponse.json(
      { ok: false, error: "유효하지 않은 토큰", action: d.action },
      { status: 401 },
    );
  }
  try {
    const body = await readBoundedJson(request);
    if (!bodyIsBoundToWorker(body, claims.workerId)) {
      return NextResponse.json({ ok: false, error: "토큰 사번과 수집 사번이 일치하지 않습니다" }, { status: 403 });
    }

    // 워치 배칭 전송 — 한 요청에 샘플 배열(라디오 기상 1회). 단일 객체도 그대로 허용(폰 호환).
    if (Array.isArray(body)) {
      // 상한 초과는 잘라서 일부만 받지 않는다 — 조용히 자르면 클라는 201 을 보고 전송 성공으로
      // 판단해 재전송하지 않아, 잘린 뒤쪽이 그대로 유실된다(무음 유실). 413 으로 거부해
      // 클라의 재시도 경로를 살린다.
      if (body.length > MAX_BATCH_ITEMS) {
        console.warn(
          `[vital] 배치 항목 수 상한 초과 — ${body.length}건 (상한 ${MAX_BATCH_ITEMS}) 요청 거부`,
        );
        return NextResponse.json(
          { ok: false, error: `배치는 최대 ${MAX_BATCH_ITEMS}건까지 허용됩니다` },
          { status: 413 },
        );
      }
      let accepted = 0;
      let dropped = 0;
      // 폐기 사유 분리 — dropped 는 "검증 실패"와 "예약 ID·빈 샘플 미저장"이 섞여 있어 그대로는
      // 측정에 못 쓴다. 검증 실패만 따로 세어 실제 데이터 유실량을 관측한다(감사 BND-CONTRACT-05).
      let droppedInvalid = 0;
      // DB 저장 실패 건수 — 하나라도 있으면 배치 전체를 503 으로 돌려 폰이 재전송하게 한다.
      let persistFailures = 0;
      let last = null;
      // ★ 저장은 루프 밖에서 한 왕복으로 모아 한다(2026-08-28). 건별 INSERT 는 500건에
      //   16.5초가 걸려 폰 타임아웃 15초를 넘겼고, 폰이 매번 실패로 보고 같은 배치를 영원히
      //   재전송하는 고착 루프를 만들었다(장우진 20분 무수신). 왕복 수가 원인이었다.
      const toPersist: VitalSample[] = [];
      for (const item of body) {
        // 항목별 격리 — 한 샘플이 검증 실패(ZodError)해도 전체 400 으로 묶지 않는다.
        // 묶으면 앞 정상 샘플은 이미 적재됐는데 클라가 배치 전체를 재전송(중복) + 뒤 샘플 유실.
        // 실패 항목만 dropped 로 세고 건너뛰며 나머지는 계속 처리.
        let result;
        try {
          result = await addSample(item, { deferPersist: true });
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
            droppedInvalid += 1;
            continue;
          }
          throw itemError;
        }
        if (result.persistFailed) persistFailures += 1;
        if (result.pendingPersist) toPersist.push(result.pendingPersist);
        if (result.sample === null) dropped += 1;
        else {
          accepted += 1;
          last = result.sample;
        }
      }
      // 모아 둔 샘플을 한 왕복(컬럼 수에 따라 청크)으로 적재한다.
      // 한 문 안에서는 부분 저장이 없으므로, 실패하면 이 배치는 통째로 안 들어간 것이다.
      if (toPersist.length > 0) {
        try {
          await persistSamples(toPersist);
        } catch (error) {
          persistFailures = toPersist.length;
          console.error("[store] DB persist failed(batch):", error);
        }
      }
      // 온열 예방 알림(온열 ③) — 수집이 곧 판정 틱. 60초 스로틀 내장·fire-and-forget
      // (실패·지연이 수집 응답을 막지 않는다). 데이터가 안 오면 판정도 없다 — 의도된 동작.
      void notifyHeatIfDue();
      // 검증 실패는 항상 드러낸다 — 과거에는 응급 플래그 샘플만 경고를 남겨, 평상시 샘플이
      // 통째로 버려지는 상황(감사 BND-LOSS-01)이 201 ok 뒤에 완전히 가려져 있었다.
      if (droppedInvalid > 0) {
        console.warn(
          `[vital] 배치 검증 실패로 폐기 — ${droppedInvalid}/${body.length}건 (accepted=${accepted})`,
        );
      }
      // ★ DB 저장 실패는 201 로 덮지 않는다 — 폰(VitalPipeline)은 2xx 를 받으면 큐에서 원본을
      // 지우므로 그 구간이 영구 유실된다. 503 을 주면 디스크 큐(5,000건 ≈ 6.9시간)에 남기고
      // 30초 뒤 재전송한다. 2026-08-15 DB 장애 3시간 50분치가 201 하나 때문에 사라졌다.
      // ⚠ 경보는 이 응답과 무관하게 이미 나갔다(addSample 안에서 별도 try — DB-POOL-02).
      // ⚠ 부분 저장은 이제 없다(2026-08-28) — 배치가 한 문으로 들어가므로 실패하면 전량 미저장이고,
      //   재전송이 중복 행을 만들 여지도 함께 사라졌다.
      if (persistFailures > 0) {
        console.error(
          `[vital] DB 저장 실패 ${persistFailures}/${body.length}건 — 503 반환(폰 재전송 유도), accepted=${accepted}`,
        );
        return NextResponse.json(
          {
            ok: false,
            error: "일시적으로 저장할 수 없습니다. 잠시 후 다시 보내주세요.",
            accepted,
            persistFailures,
          },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { ok: true, accepted, dropped, droppedInvalid, last },
        { status: 201 },
      );
    }

    const { sample, persistFailed } = await addSample(body);
    if (sample === null) {
      // null = 예약 진단 ID 차단 또는 실측 신호 없는 빈 샘플 → 저장 안 함(수신은 정상 수용).
      // 재전송해도 결과가 같으므로 202 로 수용한다(503 이면 폰이 영원히 재시도한다).
      return NextResponse.json(
        { ok: true, dropped: "not_stored" },
        { status: 202 },
      );
    }
    // 배치 경로와 같은 이유로 503 — 경보는 이미 나갔고, 이 응답은 폰에게 "원본을 들고 있으라"는 뜻이다.
    if (persistFailed) {
      console.error(`[vital] DB 저장 실패(단건) — 503 반환, workerId=${sample.workerId}`);
      return NextResponse.json(
        { ok: false, error: "일시적으로 저장할 수 없습니다. 잠시 후 다시 보내주세요." },
        { status: 503 },
      );
    }

    return NextResponse.json({ ok: true, sample }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json(
        { ok: false, error: `요청 본문은 최대 ${MAX_REQUEST_BYTES / 1024 / 1024}MB까지 허용됩니다` },
        { status: 413 },
      );
    }
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
