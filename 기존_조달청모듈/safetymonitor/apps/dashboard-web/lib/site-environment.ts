// 현장 환경 신호 수집(I/O) — GasPod 최신 텔레메트리 + 현장 좌표 기반 기상특보.
// 배치 챗의 보조 입력이므로 전 구간 best-effort: 어떤 실패도 챗을 깨지 않고 '조회 불가'로 강등된다.
import "server-only";

import { warningsForLocation } from "../app/lib/kma";
import { getLatestSiteCoord, listGaspodTelemetry } from "./db";
import type { SiteEnvSignals } from "./site-env-rules";

// 이 시간보다 오래된 가스 텔레메트리는 stale(측정 필요 안내) — 실기기는 5초 주기 송신.
const GASPOD_STALE_MS = 30 * 60_000;

function normalizeState(state: string): "CLEAR" | "WARNING" | "DANGER" {
  const s = state.toUpperCase();
  return s === "DANGER" ? "DANGER" : s === "WARNING" ? "WARNING" : "CLEAR";
}

/** 현장 환경 신호 수집 — 실패 항목은 null/빈 배열(챗 무중단). */
export async function readSiteEnvironment(): Promise<SiteEnvSignals> {
  const signals: SiteEnvSignals = { gaspod: null, warnings: [], sido: null };

  try {
    const rows = await listGaspodTelemetry(1);
    const latest = rows[0];
    if (latest) {
      signals.gaspod = {
        deviceId: latest.device_id,
        state: normalizeState(latest.state),
        o2: latest.o2,
        receivedAt: latest.received_at,
        stale: Date.now() - Date.parse(latest.received_at) > GASPOD_STALE_MS,
      };
    }
  } catch {
    // 가스 조회 실패 — 미수신 취급
  }

  try {
    const coord = await getLatestSiteCoord();
    if (coord) {
      const w = await warningsForLocation(coord.lat, coord.lon);
      signals.sido = w.sido;
      // 목업 폴백 특보(키 미설정/KMA 장애)는 배치 배제 근거로 쓰지 않는다 — 가짜 특보 거짓 배제 방지.
      if (w.source === "live") {
        signals.warnings = w.warnings.map((x) => ({ type: x.type, level: x.level }));
      }
    }
  } catch {
    // 특보 조회 실패 — 특보 없음 취급(안내는 summary 에서 구분하지 않음)
  }

  return signals;
}
