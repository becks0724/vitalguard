// 가스포드(ESP32) 텔레메트리 수신 — 5초 주기 POST. cctv/event와 동일한 soft 토큰 수집 패턴.
// 저장 = PostgreSQL 영속(gaspod_telemetry)에 실시간 누적 + 메모리 링버퍼 폴백(DB 장애 시). GET은 DB에서 최신·누적수 반환(인스턴스 무관).
import { NextResponse } from "next/server";

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
