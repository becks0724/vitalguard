// CCTV 게이트 티켓 서명 — Ed25519. 개인키는 관제웹에만 있고 젯슨에는 공개키만 있다.
// 젯슨이 통째로 털려도 control 티켓을 위조할 수 없게 하려는 것이다(적대검증 red-2 HIGH).
// 검증 쪽 참조 구현 = cctv-ai/edge/cctv_gate.py · 형식 규격 = cctv-ai/edge/gate_ticket.py
import crypto from "node:crypto";

// 32바이트 raw 개인키를 hex 로 받는다. Cloud Run 시크릿에 둔다 — 저장소에 커밋하지 않는다.
const KEY_HEX = process.env.CCTV_TICKET_KEY ?? "";
const KID = process.env.CCTV_TICKET_KID ?? "v1";
// 짧게 유지한다. 스트림은 재연결마다 새 티켓을 받는다.
const TTL_SEC = Math.max(15, Math.min(300, Number(process.env.CCTV_TICKET_TTL_SEC ?? "60")));

export type TicketScope = "read" | "control";

// raw 32바이트를 PKCS#8 DER 로 감싸 KeyObject 를 만든다(Node 가 raw Ed25519 를 직접 안 받는다).
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

let cached: crypto.KeyObject | null | undefined;

function privateKey(): crypto.KeyObject | null {
  if (cached !== undefined) return cached;
  if (!/^[0-9a-fA-F]{64}$/.test(KEY_HEX)) {
    cached = null; // 미설정 — 발급 API 가 503 으로 답한다(조용히 서명 없는 티켓을 내지 않는다)
    return cached;
  }
  try {
    cached = crypto.createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(KEY_HEX, "hex")]),
      format: "der",
      type: "pkcs8",
    });
  } catch {
    cached = null;
  }
  return cached;
}

export function ticketSigningReady(): boolean {
  return privateKey() !== null;
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
  const key = privateKey();
  if (!key) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    kid: KID,
    aud: input.cameraId,
    sid: input.siteId,
    scp: input.scope,
    sub: input.subject,
    nbf: now,
    exp: now + TTL_SEC,
    // jti 는 게이트가 1회 소비한다 — 같은 티켓을 두 번 쓰지 못한다.
    jti: crypto.randomUUID(),
  };
  const raw = Buffer.from(JSON.stringify(payload), "utf8");
  const sig = crypto.sign(null, raw, key);
  return {
    ticket: `${raw.toString("base64url")}.${sig.toString("base64url")}`,
    expiresAt: payload.exp * 1000,
    ttlSec: TTL_SEC,
  };
}
