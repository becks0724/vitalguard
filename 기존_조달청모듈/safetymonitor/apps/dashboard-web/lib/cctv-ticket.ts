// CCTV 게이트 티켓 서명 — Ed25519. 개인키는 관제웹에만 있고 젯슨에는 공개키만 있다.
// 젯슨이 통째로 털려도 control 티켓을 위조할 수 없게 하려는 것이다(적대검증 red-2 HIGH).
// 검증 쪽 참조 구현 = cctv-ai/edge/cctv_gate.py · 형식 규격 = cctv-ai/edge/gate_ticket.py
import crypto from "node:crypto";

// ★ env 를 모듈 최상단에서 읽지 않는다 — 읽어 두면 첫 로드값에 고정된다.
//   프로덕션에서는 티가 안 나지만(프로세스 수명 동안 env 가 안 바뀐다) 테스트에서는
//   "앞 테스트의 키를 그대로 들고 있는" 상태가 되고, 실행 방식에 따라 모듈 캐시가 살아 있으면
//   그대로 통과해 버린다. 2026-09-09 에 이것이 배포 게이트를 막았다
//   (dashboard-web 단독 실행은 초록, 워크스페이스 전체 실행은 빨강 — 같은 코드).
//   ⇒ 호출 시점에 읽는다. 캐시는 값 자체를 열쇠로 삼는다.
function readConfig() {
  return {
    // 32바이트 raw 개인키를 hex 로 받는다. Cloud Run 시크릿에 둔다 — 저장소에 커밋하지 않는다.
    keyHex: process.env.CCTV_TICKET_KEY ?? "",
    kid: process.env.CCTV_TICKET_KID ?? "v1",
    // 짧게 유지한다. 스트림은 재연결마다 새 티켓을 받는다.
    ttlSec: Math.max(15, Math.min(300, Number(process.env.CCTV_TICKET_TTL_SEC ?? "60"))),
  };
}

export type TicketScope = "read" | "control";

// raw 32바이트를 PKCS#8 DER 로 감싸 KeyObject 를 만든다(Node 가 raw Ed25519 를 직접 안 받는다).
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

// 키 파생은 비싸므로 캐시하되, 캐시 열쇠를 hex 값 자체로 둔다 —
// 값이 바뀌면 캐시가 자동으로 빗나가므로 "낡은 키를 계속 쓰는" 상태가 생기지 않는다.
let keyCache: { hex: string; key: crypto.KeyObject | null } | null = null;

function privateKey(hex: string): crypto.KeyObject | null {
  if (keyCache && keyCache.hex === hex) return keyCache.key;
  let key: crypto.KeyObject | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    try {
      key = crypto.createPrivateKey({
        key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(hex, "hex")]),
        format: "der",
        type: "pkcs8",
      });
    } catch {
      key = null;
    }
  }
  keyCache = { hex, key };
  return key;
}

export function ticketSigningReady(): boolean {
  return privateKey(readConfig().keyHex) !== null;
}

export type SignedTicket = { ticket: string; expiresAt: number; ttlSec: number };

/**
 * 게이트가 검증할 티켓 하나. 클레임은 전부 서버가 채운다 —
 * 카메라·현장·권한은 호출자가 보낸 값이 아니라 DB 판정 결과여야 한다.
 */
export function signTicket(input: {
  cameraId: string;
  siteId: string;
  scope: TicketScope;
  subject: string;
}): SignedTicket | null {
  const { keyHex, kid, ttlSec } = readConfig();
  const key = privateKey(keyHex);
  if (!key) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    kid,
    aud: input.cameraId,
    sid: input.siteId,
    scp: input.scope,
    sub: input.subject,
    nbf: now,
    exp: now + ttlSec,
    // jti 는 게이트가 1회 소비한다 — 같은 티켓을 두 번 쓰지 못한다.
    jti: crypto.randomUUID(),
  };
  const raw = Buffer.from(JSON.stringify(payload), "utf8");
  const sig = crypto.sign(null, raw, key);
  return {
    ticket: `${raw.toString("base64url")}.${sig.toString("base64url")}`,
    expiresAt: payload.exp * 1000,
    ttlSec,
  };
}

// ── 검증 — 서버 중계(docs/cctv-gate-server)에서는 서버 자신이 젯슨 게이트 역할을 한다 ─────────
//
// 규칙은 cctv-ai/edge/cctv_gate.py `_verify` 와 같다 — kid → 공개키 → 서명 → nbf(+skew) → exp → aud → scp.
// 순서와 상태 코드까지 맞춘다. 게이트와 여기가 다르게 판정하면 같은 표가 한 곳에서는 통하고 한 곳에서는
// 막혀 원인을 못 찾는다. sid 와 jti 는 여기서 돌려주고 호출부가 검사·소비한다(DB 가 필요해서).

export type TicketPayload = {
  kid: string; aud: string; sid: string; scp: TicketScope; sub: string;
  nbf: number; exp: number; jti: string;
};

export type VerifyResult =
  | { ok: true; payload: TicketPayload }
  | { ok: false; status: 401 | 403; error: string };

// 게이트의 SKEW 와 같은 기본값 30초 — 젯슨과 서버 시계가 조금 어긋나도 nbf 에서 튕기지 않게.
function skewSec(): number {
  const n = Number(process.env.CCTV_TICKET_SKEW_SEC ?? "30");
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

// 공개키는 개인키에서 유도한다 — 젯슨엔 공개키 파일을 따로 뒀지만 서버는 개인키를 이미 갖고 있다.
// 캐시 열쇠는 hex 값 자체(privateKey 와 같은 이유 — 값이 바뀌면 자동으로 빗나간다).
let pubCache: { hex: string; key: crypto.KeyObject | null } | null = null;

function publicKey(hex: string): crypto.KeyObject | null {
  if (pubCache && pubCache.hex === hex) return pubCache.key;
  const priv = privateKey(hex);
  const key = priv ? crypto.createPublicKey(priv) : null;
  pubCache = { hex, key };
  return key;
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

/**
 * 표 하나를 검증한다. 통과하면 클레임을 돌려준다 — 호출부는 sid 를 카메라 대장과 대조하고 jti 를 소비해야 한다.
 * `nowSec` 은 시험에서 시계를 옮기기 위한 것이다.
 */
export function verifyTicket(
  ticket: string,
  want: { cameraId: string; scope: TicketScope },
  nowSec: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  const { keyHex, kid } = readConfig();
  const dot = ticket.indexOf(".");
  if (dot <= 0) return { ok: false, status: 401, error: "bad ticket" };
  const body = ticket.slice(0, dot);
  const sigPart = ticket.slice(dot + 1);
  let raw: Buffer;
  let p: Partial<TicketPayload>;
  try {
    raw = b64urlDecode(body);
    p = JSON.parse(raw.toString("utf8")) as Partial<TicketPayload>;
  } catch {
    return { ok: false, status: 401, error: "bad ticket" };
  }
  if (typeof p !== "object" || p === null) return { ok: false, status: 401, error: "bad ticket" };
  if (p.kid !== kid) return { ok: false, status: 401, error: "unknown key" };
  const key = publicKey(keyHex);
  if (!key) return { ok: false, status: 401, error: "unknown key" };
  let sigOk = false;
  try {
    sigOk = crypto.verify(null, raw, key, b64urlDecode(sigPart));
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { ok: false, status: 401, error: "bad ticket" };

  const nbf = Number(p.nbf ?? 0);
  const exp = Number(p.exp ?? 0);
  if (nbf > nowSec + skewSec()) return { ok: false, status: 401, error: "not yet valid" };
  if (!(exp > nowSec)) return { ok: false, status: 401, error: "expired" }; // 여유 없음 — 게이트와 같다
  if (p.aud !== want.cameraId) return { ok: false, status: 403, error: "wrong camera" };
  if (p.scp !== want.scope) return { ok: false, status: 403, error: `scope ${want.scope} required` };
  if (typeof p.jti !== "string" || p.jti.length === 0) return { ok: false, status: 401, error: "bad ticket" };
  if (typeof p.sid !== "string" || typeof p.sub !== "string") return { ok: false, status: 401, error: "bad ticket" };

  return {
    ok: true,
    payload: { kid, aud: p.aud, sid: p.sid, scp: p.scp, sub: p.sub, nbf, exp, jti: p.jti },
  };
}
