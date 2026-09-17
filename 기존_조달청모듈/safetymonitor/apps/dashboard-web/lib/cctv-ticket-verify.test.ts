// 서버 쪽 표 검증(verifyTicket)이 젯슨 게이트 _verify 와 같은 판정을 내리는지 — 왕복 · 변조 · 시계 · 카메라 · 범위 · 다른 키.
//
// 게이트와 서버가 같은 표를 다르게 판정하면 한 곳에서는 통하고 한 곳에서는 막혀 원인을 못 찾는다.
// 여기서는 발급(signTicket)과 검증(verifyTicket)을 같은 env 로 묶어 돌리고, 깨져야 하는 입력이 실제로 깨지는지 본다.
import { strict as assert } from "node:assert";
import crypto from "node:crypto";
import { test } from "node:test";

import { signTicket, verifyTicket } from "./cctv-ticket";

function freshHex(): string {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  return privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("hex");
}

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const WANT = { cameraId: "CAM-03", scope: "read" as const };
const INPUT = { cameraId: "CAM-03", siteId: "SITE-01", scope: "read" as const, subject: "tester" };

test("왕복 — 같은 키로 발급한 표는 통과하고 클레임을 그대로 돌려준다", () => {
  withEnv({ CCTV_TICKET_KEY: freshHex(), CCTV_TICKET_KID: "v1", CCTV_TICKET_TTL_SEC: "60" }, () => {
    const s = signTicket(INPUT);
    assert.ok(s);
    const v = verifyTicket(s.ticket, WANT);
    assert.equal(v.ok, true);
    if (v.ok) {
      assert.equal(v.payload.aud, "CAM-03");
      assert.equal(v.payload.sid, "SITE-01");
      assert.equal(v.payload.scp, "read");
      assert.equal(v.payload.sub, "tester");
      assert.ok(v.payload.jti.length > 0);
      assert.equal(v.payload.exp * 1000, s.expiresAt);
    }
  });
});

test("변조 — 서명 한 글자를 바꾸면 bad ticket · 본문을 바꿔도 bad ticket", () => {
  withEnv({ CCTV_TICKET_KEY: freshHex(), CCTV_TICKET_KID: "v1" }, () => {
    const s = signTicket(INPUT)!;
    const dot = s.ticket.indexOf(".");
    const body = s.ticket.slice(0, dot);
    const sig = s.ticket.slice(dot + 1);
    // 네 번째 글자 하나만 바꾼다 — 통제군으로 「안 바꾼 표」가 통과함을 먼저 확인해 뒤집기가 실제로 일어났음을 가른다
    assert.equal(verifyTicket(`${body}.${sig}`, WANT).ok, true);
    const tampered = sig.slice(0, 3) + (sig[3] === "A" ? "B" : "A") + sig.slice(4);
    assert.notEqual(tampered, sig);
    const v1 = verifyTicket(`${body}.${tampered}`, WANT);
    assert.deepEqual(v1, { ok: false, status: 401, error: "bad ticket" });
    // 본문의 aud 를 CAM-01 로 바꾸고 서명은 그대로 — 서명이 먼저 깨져야 한다(aud 검사까지 가면 안 된다)
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    p.aud = "CAM-01";
    const body2 = Buffer.from(JSON.stringify(p)).toString("base64url");
    const v2 = verifyTicket(`${body2}.${sig}`, WANT);
    assert.deepEqual(v2, { ok: false, status: 401, error: "bad ticket" });
  });
});

test("다른 키로 검증하면 통과하지 않는다 (통제군 — 검증이 서명을 실제로 보나)", () => {
  const ticket = withEnv({ CCTV_TICKET_KEY: freshHex(), CCTV_TICKET_KID: "v1" }, () => signTicket(INPUT)!.ticket);
  withEnv({ CCTV_TICKET_KEY: freshHex(), CCTV_TICKET_KID: "v1" }, () => {
    const v = verifyTicket(ticket, WANT);
    assert.deepEqual(v, { ok: false, status: 401, error: "bad ticket" });
  });
});

test("kid 가 다르면 unknown key — 회전 중 옛 표는 서명을 보기 전에 걸린다", () => {
  const ticket = withEnv({ CCTV_TICKET_KEY: freshHex(), CCTV_TICKET_KID: "v1" }, () => signTicket(INPUT)!.ticket);
  withEnv({ CCTV_TICKET_KEY: freshHex(), CCTV_TICKET_KID: "v2" }, () => {
    assert.deepEqual(verifyTicket(ticket, WANT), { ok: false, status: 401, error: "unknown key" });
  });
});

test("시계 — 만료는 여유 없이 · nbf 는 skew 30초까지 봐 준다", () => {
  withEnv({ CCTV_TICKET_KEY: freshHex(), CCTV_TICKET_KID: "v1", CCTV_TICKET_TTL_SEC: "60", CCTV_TICKET_SKEW_SEC: undefined }, () => {
    const s = signTicket(INPUT)!;
    const now = Math.floor(Date.now() / 1000);
    assert.equal(verifyTicket(s.ticket, WANT, now).ok, true);
    assert.equal(verifyTicket(s.ticket, WANT, now + 59).ok, true, "만료 1초 전은 산다");
    assert.deepEqual(verifyTicket(s.ticket, WANT, now + 60), { ok: false, status: 401, error: "expired" }, "exp 그 초에 죽는다 — 게이트와 같다");
    assert.equal(verifyTicket(s.ticket, WANT, now - 30).ok, true, "30초 빠른 시계는 skew 안");
    assert.deepEqual(verifyTicket(s.ticket, WANT, now - 31), { ok: false, status: 401, error: "not yet valid" });
  });
});

test("카메라·범위 — 다른 카메라는 403 wrong camera · read 표로 control 을 열면 403", () => {
  withEnv({ CCTV_TICKET_KEY: freshHex(), CCTV_TICKET_KID: "v1" }, () => {
    const s = signTicket(INPUT)!;
    assert.deepEqual(verifyTicket(s.ticket, { cameraId: "CAM-01", scope: "read" }), { ok: false, status: 403, error: "wrong camera" });
    assert.deepEqual(verifyTicket(s.ticket, { cameraId: "CAM-03", scope: "control" }), { ok: false, status: 403, error: "scope control required" });
    const c = signTicket({ ...INPUT, scope: "control" })!;
    assert.equal(verifyTicket(c.ticket, { cameraId: "CAM-03", scope: "control" }).ok, true);
  });
});

test("형식 — 점이 없거나 base64 가 아니거나 JSON 이 아니면 bad ticket · 키가 없으면 unknown key", () => {
  withEnv({ CCTV_TICKET_KEY: freshHex(), CCTV_TICKET_KID: "v1" }, () => {
    assert.equal(verifyTicket("", WANT).ok, false);
    assert.equal(verifyTicket("nodot", WANT).ok, false);
    assert.equal(verifyTicket("!!!.!!!", WANT).ok, false);
    assert.equal(verifyTicket(`${Buffer.from("[1,2]").toString("base64url")}.AAAA`, WANT).ok, false);
  });
  withEnv({ CCTV_TICKET_KEY: "", CCTV_TICKET_KID: "v1" }, () => {
    const t = `${Buffer.from(JSON.stringify({ kid: "v1" })).toString("base64url")}.AAAA`;
    assert.deepEqual(verifyTicket(t, WANT), { ok: false, status: 401, error: "unknown key" });
  });
});
