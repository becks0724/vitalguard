// 구조적 재발 방지 — CCTV 게이트 티켓의 서명·클레임 불변식 가드.
//
// 배경 — 젯슨 직결에서 「로그인한, 그 현장의 인가받은 관리자만 영상을 본다」가 성립하는 지점은
// 티켓 발급 하나뿐이다. 서명이 없거나 클레임이 비면 게이트는 통과시킬 근거를 잃는데,
// 그 실패는 화면에서 "영상이 안 나온다"로만 보여 원인이 티켓인지 회선인지 구별되지 않는다.
//
// 왜 가드 테스트인가 — 검증은 젯슨의 Python 게이트가 하므로 이 저장소의 tsc·lint·기존 테스트가
// 전부 통과하는 채로 서명이 깨질 수 있다(예: raw 키를 PKCS#8 로 감싸는 접두사가 틀려도
// createPrivateKey 가 던지면 null 을 돌려주고 API 는 503 을 낼 뿐이다).
// 여기서는 게이트가 하는 검증을 같은 방식으로 재현해 고정한다.
import { strict as assert } from "node:assert";
import crypto from "node:crypto";
import { test } from "node:test";

// 게이트(cctv_gate.py)가 공개키를 raw 32바이트로 읽으므로 여기서도 raw 로 다룬다.
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function freshKey(): { hex: string; publicRaw: Buffer } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const rawPriv = privateKey
    .export({ format: "der", type: "pkcs8" })
    .subarray(-32);
  const rawPub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { hex: rawPriv.toString("hex"), publicRaw: rawPub };
}

// env 를 읽는 모듈이라 매번 새로 import 해야 키 변경이 반영된다.
async function loadSigner(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    return await import(`./cctv-ticket.ts?k=${crypto.randomUUID()}`);
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// 게이트가 하는 검증과 같은 순서 — payload 원본 바이트에 대한 서명을 공개키로 확인한다.
function verifyLikeGate(ticket: string, publicRaw: Buffer) {
  const [body, sig] = ticket.split(".");
  const raw = Buffer.from(body, "base64url");
  const key = crypto.createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, publicRaw]),
    format: "der",
    type: "spki",
  });
  const ok = crypto.verify(null, raw, key, Buffer.from(sig, "base64url"));
  return { ok, payload: JSON.parse(raw.toString("utf8")) as Record<string, unknown> };
}

test("서명한 티켓을 게이트와 같은 방식으로 검증하면 통과한다", async () => {
  const k = freshKey();
  const { signTicket } = await loadSigner({ CCTV_TICKET_KEY: k.hex, CCTV_TICKET_KID: "v1" });
  const signed = signTicket({
    cameraId: "CAM-03", siteId: "SITE-01", scope: "read", subject: "admin6861",
  });
  assert.ok(signed, "서명키가 있으면 티켓이 나와야 한다");
  const { ok } = verifyLikeGate(signed.ticket, k.publicRaw);
  assert.equal(ok, true, "게이트가 검증할 수 있는 서명이어야 한다");
});

test("클레임에 카메라·현장·권한·주체가 전부 들어간다", async () => {
  const k = freshKey();
  const { signTicket } = await loadSigner({ CCTV_TICKET_KEY: k.hex, CCTV_TICKET_KID: "v2" });
  const signed = signTicket({
    cameraId: "CAM-03", siteId: "SITE-07", scope: "control", subject: "admin6861",
  })!;
  const { payload } = verifyLikeGate(signed.ticket, k.publicRaw);
  // 게이트는 이 이름들을 그대로 읽는다 — 하나라도 바뀌면 조용히 401/403 이 된다.
  assert.equal(payload.aud, "CAM-03");
  assert.equal(payload.sid, "SITE-07");
  assert.equal(payload.scp, "control");
  assert.equal(payload.sub, "admin6861");
  assert.equal(payload.kid, "v2");
  assert.equal(typeof payload.jti, "string", "1회 소비를 위해 jti 가 있어야 한다");
  assert.ok(Number(payload.exp) > Number(payload.nbf), "exp 는 nbf 보다 뒤여야 한다");
});

test("수명은 상한을 넘지 않는다 — 긴 티켓은 탈취 시 그만큼 오래 쓰인다", async () => {
  const k = freshKey();
  const { signTicket } = await loadSigner({
    CCTV_TICKET_KEY: k.hex, CCTV_TICKET_TTL_SEC: "99999",
  });
  const signed = signTicket({
    cameraId: "CAM-03", siteId: "SITE-01", scope: "read", subject: "u",
  })!;
  assert.ok(signed.ttlSec <= 300, `수명 상한 300초를 넘었다: ${signed.ttlSec}`);
});

test("서명키가 없으면 티켓을 만들지 않는다", async () => {
  for (const bad of [undefined, "", "not-hex", "ab".repeat(10)]) {
    const { signTicket, ticketSigningReady } = await loadSigner({ CCTV_TICKET_KEY: bad });
    assert.equal(ticketSigningReady(), false, `키 "${bad}" 는 거부되어야 한다`);
    assert.equal(
      signTicket({ cameraId: "CAM-03", siteId: "SITE-01", scope: "read", subject: "u" }),
      null,
      "서명 없는 티켓을 흘리면 게이트가 통과시킬 근거가 없다",
    );
  }
});

test("jti 는 발급마다 달라야 한다 — 같으면 두 번째가 재사용으로 거부된다", async () => {
  const k = freshKey();
  const { signTicket } = await loadSigner({ CCTV_TICKET_KEY: k.hex });
  const seen = new Set<string>();
  for (let i = 0; i < 20; i += 1) {
    const s = signTicket({
      cameraId: "CAM-03", siteId: "SITE-01", scope: "read", subject: "u",
    })!;
    seen.add(String(verifyLikeGate(s.ticket, k.publicRaw).payload.jti));
  }
  assert.equal(seen.size, 20, "jti 가 겹치면 정상 재연결이 재사용으로 막힌다");
});

test("다른 키로는 검증되지 않는다 — 게이트가 공개키만 갖는 의미", async () => {
  const k = freshKey();
  const other = freshKey();
  const { signTicket } = await loadSigner({ CCTV_TICKET_KEY: k.hex });
  const signed = signTicket({
    cameraId: "CAM-03", siteId: "SITE-01", scope: "read", subject: "u",
  })!;
  assert.equal(verifyLikeGate(signed.ticket, other.publicRaw).ok, false);
});
