// CAM-03 서버 중계의 순수 헬퍼 — 프레임 인제스트 토큰 비교 · 통계 쿼리 파싱 · 화이트리스트 · 신선도 판정. I/O 없음.
//
// 배경 — 09-16 설계(docs/cctv-gate-server/design-20260916.md). 젯슨 푸셔가 JPEG 를 서버로 POST 하고
// 서버가 DB 한 행에 최신 1장을 두면, 화면은 젯슨이 아니라 서버에서 가져간다. 그러면 Tailscale·DuckDNS·
// 포트포워딩이 시청 경로에서 빠진다. 여기 함수들은 라우트가 쓰는 판정만 모아 테스트 가능하게 둔다.
import crypto from "node:crypto";

/** 인제스트 본문 상한 — 푸셔 640×360 q72 ≈ 40KB 의 여유 6배. 넘으면 413. */
export const MAX_JPEG_BYTES = 256 * 1024;

/**
 * 프레임이 「살아 있다」고 볼 최대 나이(초). 기본 15.
 * ⚠ 설계 문서는 PUSH_FPS=0.2(5초 1장)와 PPE_LIVE_TTL 3초를 같이 적었는데 그러면 늘 stale 이다.
 *   push 간격의 3배를 기본으로 두고 env 로 조정한다. 값은 호출 시점에 읽는다(테스트에서 갈아 끼우기 위해).
 */
export function frameStaleSec(): number {
  const n = Number(process.env.CCTV_FRAME_STALE_SEC ?? "15");
  return Number.isFinite(n) && n > 0 ? n : 15;
}

/** `stream3` → `CAM-03`. 한 자리 숫자만 받는다 — 게이트가 CAMERA=CAM-03 하나만 알듯 여기서도 명시적으로 묶는다. */
export function cameraIdForSuffix(suffix: string): string | null {
  return /^[0-9]$/.test(suffix) ? `CAM-0${suffix}` : null;
}

/** `Authorization: Bearer <값>` 에서 값만. 없거나 형식이 다르면 null. */
export function bearerFromHeader(authorization: string | null): string | null {
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  const v = authorization.slice(7).trim();
  return v.length > 0 ? v : null;
}

/**
 * 젯슨 → 서버 인제스트 토큰 비교. 상수 시간. env 가 비어 있으면 **항상 false** —
 * 가스포드의 soft 모드(무토큰 수용)를 여기서는 따르지 않는다. 영상은 수집 자료가 아니라 화면이고,
 * 토큰이 없다는 이유로 아무나 프레임을 덮어쓰게 두면 관제 화면에 남의 그림이 뜬다.
 */
export function ingestTokenMatches(presented: string | null, expected: string | undefined): boolean {
  if (!presented || !expected) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** 푸셔가 쿼리로 보내는 통계. 젯슨 gopro_ppe_edge.py `_push_worker` 의 urlencode 키와 1:1. */
export type IngestStats = {
  person_count: number;
  violation_count: number;
  compliance_rate: number;
  hardhat_count: number;
  no_hardhat_count: number;
  worker_count?: number;
  unknown_count?: number;
  engine: string;
};

function num(v: string | null, fallback: number): number {
  if (v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 쿼리 → 통계. 푸셔 키 이름(persons·violations·compliance·hardhat·no_hardhat·engine)을 게이트 응답 키로 옮긴다.
 * ⚠ 푸셔는 09-16 현재 worker·unknown 을 **보내지 않는다**. 있으면 받고 없으면 비운다 — 서버가 0 으로 채우면
 *   관제웹이 「작업자 0명」으로 그린다(worker_count ?? person_count 폴백이 0 에는 안 걸린다).
 */
export function parseIngestStats(params: URLSearchParams): IngestStats {
  const s: IngestStats = {
    person_count: num(params.get("persons"), 0),
    violation_count: num(params.get("violations"), 0),
    compliance_rate: num(params.get("compliance"), 100),
    hardhat_count: num(params.get("hardhat"), 0),
    no_hardhat_count: num(params.get("no_hardhat"), 0),
    engine: (params.get("engine") ?? "").slice(0, 24),
  };
  if (params.get("worker") !== null) s.worker_count = num(params.get("worker"), 0);
  if (params.get("unknown") !== null) s.unknown_count = num(params.get("unknown"), 0);
  return s;
}

/**
 * 관제웹이 읽는 이름 그대로만 내보낸다 — 젯슨 게이트 cctv_gate.py stats3 의 화이트리스트와 같은 형태.
 * 숫자 키는 없으면 0, engine 만 "" 이다(게이트와 동일). 그 밖의 키는 어떤 것이 들어와도 나가지 않는다.
 */
export const PUBLIC_STAT_KEYS = [
  "person_count", "violation_count", "compliance_rate",
  "hardhat_count", "no_hardhat_count", "worker_count", "unknown_count",
] as const;

export function publicStats(raw: Record<string, unknown> | null | undefined): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const k of PUBLIC_STAT_KEYS) {
    const v = raw?.[k];
    out[k] = typeof v === "number" && Number.isFinite(v) ? v : 0;
  }
  out.engine = String(raw?.engine ?? "").slice(0, 24);
  return out;
}

/** 프레임 나이(초). 시각이 못 읽히면 Infinity — 「모르면 stale」. */
export function frameAgeSec(capturedAtIso: string, nowMs = Date.now()): number {
  const t = Date.parse(capturedAtIso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (nowMs - t) / 1000);
}

export function isStale(ageSec: number, staleSec = frameStaleSec()): boolean {
  return !(ageSec < staleSec);
}
