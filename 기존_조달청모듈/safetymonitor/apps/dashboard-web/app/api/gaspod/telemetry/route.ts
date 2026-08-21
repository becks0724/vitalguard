// 가스포드(ESP32) 텔레메트리 수신 — 5초 주기 POST. cctv/event와 동일한 soft 토큰 수집 패턴.
// 저장 = PostgreSQL 영속(gaspod_telemetry)에 실시간 누적 + 메모리 링버퍼 폴백(DB 장애 시). GET은 DB에서 최신·누적수 반환(인스턴스 무관).
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { clientIpFromRequest } from "../../../../lib/client-ip";
import { consumeToken } from "../../../../lib/rate-limit";
import { ingestAuthStatus } from "../../../../lib/ingest-auth";
import { countGaspodTelemetry, insertGaspodTelemetry, listGaspodTelemetry } from "../../../../lib/db";

type GaspodTelemetry = {
  device_id: string; o2: number; temp: number; humidity: number; pressure: number;
  mq7_raw: number; mq136_raw: number; vbat: number;
  state: "CLEAR" | "WARNING" | "DANGER"; acked: boolean; ts: string;
};

const recent: GaspodTelemetry[] = []; // DB 장애 폴백용 메모리 링버퍼(최근 720건).
let warned = false;

export async function POST(request: Request) {
  // 빈도 제한 — 무토큰 수용(soft) 상태라 위조 주입 비용이 0 이다(감사 VER-013).
  if (!consumeToken(`gaspod:${clientIpFromRequest(request)}`, 120, 60_000)) {
    console.warn("[gaspod] 수집 빈도 제한 초과 — 요청 거부");
    return NextResponse.json(
      { ok: false, error: "요청이 너무 잦습니다" },
      { status: 429 },
    );
  }
  const auth = ingestAuthStatus(request);
  if (auth === "invalid") return NextResponse.json({ ok: false, error: "유효하지 않은 토큰" }, { status: 401 });
  // 정적 토큰 강제(무중단 롤아웃): 기본은 soft 수용. GASPOD_REQUIRE_TOKEN 설정 시 무토큰(none)도 거부.
  //   → 코드 배포 후 ESP32 펌웨어에 x-app-upload-token 헤더 추가 → env 설정 순으로 켜면 실기기 수신 안 끊김.
  const requireToken = /^(1|true|on)$/i.test(process.env.GASPOD_REQUIRE_TOKEN ?? "");
  if (auth === "none") {
    if (requireToken) return NextResponse.json({ ok: false, error: "토큰 필요" }, { status: 401 });
    if (!warned) { warned = true; console.warn("[gaspod] 무인증 수집 수용 중(soft) — GASPOD_REQUIRE_TOKEN 설정 시 401"); }
  }
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const state = String(b?.state ?? "");
  if (!b?.device_id || !["CLEAR", "WARNING", "DANGER"].includes(state)) {
    return NextResponse.json({ ok: false, error: "device_id/state('CLEAR'|'WARNING'|'DANGER') 필수" }, { status: 400 });
  }
  const row: GaspodTelemetry = {
    device_id: String(b.device_id).slice(0, 40),
    o2: Number(b.o2) || 0, temp: Number(b.temp) || 0, humidity: Number(b.humidity) || 0,
    pressure: Number(b.pressure) || 0, mq7_raw: Number(b.mq7_raw) || 0, mq136_raw: Number(b.mq136_raw) || 0,
    vbat: Number(b.vbat) || 0, state: state as GaspodTelemetry["state"], acked: !!b.acked,
    ts: new Date().toISOString(),
  };
  recent.push(row); if (recent.length > 720) recent.shift(); // 메모리 폴백 유지
  // DB 영속 — 실시간 누적 저장. 실패해도 수집은 계속(메모리 폴백).
  try {
    await insertGaspodTelemetry({
      device_id: row.device_id, o2: row.o2, temp: row.temp, humidity: row.humidity, pressure: row.pressure,
      mq7_raw: row.mq7_raw, mq136_raw: row.mq136_raw, vbat: row.vbat, state: row.state, acked: row.acked,
    });
  } catch (e) {
    console.error("[gaspod] DB 저장 실패(메모리 폴백 유지):", e);
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

// 최근 텔레메트리 조회 (?n=20) + 누적 수집 건수 — 대시보드 실시간 수집 표시/검증용.
export async function GET(request: Request) {
  // 2026-08-21 봉인(안정화 P1-3) — 이 GET 이 무인증 200 이었다(센서 원시값·기기 ID ·
  // 32,228행 · 최대 720행/회 · 통제군 aed/devices 는 401). mock/history(08-13)와 같은 형태 —
  // 경로의 민감도는 데이터가 정한다. 처방도 같다: 관제 세션만.
  // ⚠ POST(기기 수집)는 손대지 않는다 — ESP32 는 soft 토큰 계약이고 세션이 없다(L-11).
  //   GET 소비자는 브라우저뿐임을 실측(7일 요청 로그 표본 500/500 전부 Mozilla).
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }
  const n = Math.min(720, Math.max(1, Number(new URL(request.url).searchParams.get("n") ?? 20)));
  try {
    const [desc, count] = await Promise.all([listGaspodTelemetry(n), countGaspodTelemetry()]);
    // DB=최신 먼저(DESC) → 표시용 오름차순 + received_at을 ts로 매핑(기존 클라이언트 호환).
    const rows = desc
      .slice()
      .reverse()
      .map(({ received_at, ...rest }) => ({ ...rest, ts: received_at }));
    return NextResponse.json(
      { ok: true, latest: rows[rows.length - 1] ?? null, rows, count, persisted: true },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    // DB 장애 — 메모리 폴백.
    return NextResponse.json(
      { ok: true, latest: recent[recent.length - 1] ?? null, rows: recent.slice(-n), count: recent.length, persisted: false },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
