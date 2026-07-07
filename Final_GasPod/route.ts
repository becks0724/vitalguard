// 가스포드(ESP32) 텔레메트리 수신 — 5초 주기 POST. cctv/event와 동일한 soft 토큰 수집 패턴.
import { NextResponse } from "next/server";
import { ingestAuthStatus } from "../../../../lib/ingest-auth";

type GaspodTelemetry = {
  device_id: string; o2: number; temp: number; humidity: number; pressure: number;
  mq7_raw: number; mq136_raw: number; vbat: number;
  state: "CLEAR" | "WARNING" | "DANGER"; acked: boolean; ts: string;
};

const recent: GaspodTelemetry[] = []; // 메모리 링버퍼(최근 720건 ≈ 1시간). 인스턴스 재시작 시 초기화 — 데모용.
let warned = false;

export async function POST(request: Request) {
  const auth = ingestAuthStatus(request);
  if (auth === "invalid") return NextResponse.json({ ok: false, error: "유효하지 않은 토큰" }, { status: 401 });
  if (auth === "none" && !warned) { warned = true; console.warn("[gaspod] 무인증 수집 수용 중(soft)"); }
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
  recent.push(row); if (recent.length > 720) recent.shift();
  return NextResponse.json({ ok: true }, { status: 201 });
}

// 최근 텔레메트리 조회 (?n=20) — 대시보드/검증용
export async function GET(request: Request) {
  const n = Math.min(720, Math.max(1, Number(new URL(request.url).searchParams.get("n") ?? 20)));
  return NextResponse.json(
    { ok: true, latest: recent[recent.length - 1] ?? null, rows: recent.slice(-n) },
    { headers: { "cache-control": "no-store" } },
  );
}
