// 텔레그램 알림 포맷·미설정 no-op 단위 테스트.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { formatAlertMessage, notifyAlertTelegram, sendTelegramMessage } from "./telegram.js";

test("포맷 — 실명은 싣지 않고 사번만(국외이전 최소화, 감사 SEC-PRIV-01)", () => {
  const msg = formatAlertMessage({
    type: "sos",
    workerId: "EMP-6861",
    workerName: "장우진",
    ts: "2026-07-23T13:15:30Z", // KST 22:15:30
  });
  assert.ok(msg.includes("🆘 SOS 긴급요청"));
  assert.ok(msg.includes("EMP-6861"));
  assert.ok(!msg.includes("장우진")); // 실명 미포함 — 되돌리면 여기서 실패
  assert.ok(msg.includes("07-23 22:15:30"));
});

test("포맷 — 작업자명 미제공이어도 동일하게 사번만", () => {
  const msg = formatAlertMessage({
    type: "fall",
    workerId: "EMP-1024",
    ts: "2026-07-23T00:00:00Z",
  });
  assert.ok(msg.includes("🚨 낙상 감지"));
  assert.ok(msg.includes("EMP-1024"));
});

test("포맷 — 5종 라벨 매핑", () => {
  const labels = {
    sos: "SOS",
    fall: "낙상",
    vital: "생체",
    geofence: "구획 이탈",
    danger_zone: "위험구역 진입",
  } as const;
  for (const [type, needle] of Object.entries(labels)) {
    const msg = formatAlertMessage({
      type: type as keyof typeof labels,
      workerId: "W1",
      ts: "2026-07-23T00:00:00Z",
    });
    assert.ok(msg.includes(needle), `${type} 라벨 누락`);
  }
});

test("포맷 — 잘못된 ts 는 원본 유지", () => {
  const msg = formatAlertMessage({ type: "vital", workerId: "W1", ts: "not-a-date" });
  assert.ok(msg.includes("not-a-date"));
});

test("전송 — 토큰/chat_id 미설정이면 no-op(throw 없이 resolve)", async () => {
  const prevToken = process.env.TELEGRAM_BOT_TOKEN;
  const prevChat = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  try {
    await assert.doesNotReject(
      notifyAlertTelegram({ type: "sos", workerId: "W1", ts: "2026-07-23T00:00:00Z" }),
    );
  } finally {
    if (prevToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = prevToken;
    if (prevChat !== undefined) process.env.TELEGRAM_CHAT_ID = prevChat;
  }
});

// ── 발송 결과 반환(L-35) ─────────────────────────────────────────────────────
// void 였을 때는 호출부가 "보냈다/못 보냈다" 를 구별할 수 없어 알림 로그를 남길 수 없었다.
test("sendTelegramMessage — 미배선이면 skipped 를 돌려준다(조용한 no-op 금지)", async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  try {
    assert.equal(await sendTelegramMessage("테스트"), "skipped");
  } finally {
    if (token !== undefined) process.env.TELEGRAM_BOT_TOKEN = token;
    if (chat !== undefined) process.env.TELEGRAM_CHAT_ID = chat;
  }
});
