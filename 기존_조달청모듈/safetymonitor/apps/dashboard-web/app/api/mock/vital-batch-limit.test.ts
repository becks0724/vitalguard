// 감사 BE-VALID-01 회귀 — 배치 수집의 항목 수 상한.
// 레이트리밋은 "요청 수"만 세므로, 한 요청에 수십만 건을 담는 단일 폭탄은 막지 못했다.
//
// 상한 판정은 DB 접근 전에 끝나므로(빈도제한 → 토큰 → 파싱 → 길이) 라우트를 직접 호출해
// 실제 응답을 확인할 수 있다. 소스 문자열 검사가 아니라 동작 검증이다.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { POST } from "./vital/route";

const MAX = 500; // 라우트의 MAX_BATCH_ITEMS 와 같은 값(어긋나면 아래 경계 테스트가 깨진다).

// 테스트마다 다른 IP 로 — 같은 키를 쓰면 앞 테스트가 소진한 빈도제한 버킷에 걸려
// 상한이 아니라 429 를 보게 된다(교훈 L-14: 임계 검증은 조건을 분리해야 판정이 선다).
function batchRequest(count: number, ip: string): Request {
  const ts = "2026-07-27T00:00:00.000Z";
  const body = Array.from({ length: count }, (_, i) => ({
    workerId: `smoke_batch${i}`, // 예약 프리픽스 — 파싱만 통과하고 저장되지 않는다(L-04).
    ts,
  }));
  return new Request("https://example.test/api/mock/vital", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

test("상한 초과 배치는 413 으로 거부한다", async () => {
  const res = await POST(batchRequest(MAX + 1, "203.0.113.11"));
  assert.equal(res.status, 413);
  const json = (await res.json()) as { ok: boolean; error?: string };
  assert.equal(json.ok, false);
  assert.match(String(json.error), /최대/);
});

test("상한 초과는 잘라서 일부만 받지 않는다", async () => {
  // 조용히 자르면 클라는 201 을 성공으로 읽고 재전송하지 않아 뒤쪽이 유실된다(무음 유실).
  // 그래서 부분 수용(accepted > 0)이 아니라 거부여야 한다.
  const res = await POST(batchRequest(MAX + 50, "203.0.113.12"));
  assert.equal(res.status, 413);
  const json = (await res.json()) as { accepted?: number };
  assert.equal(json.accepted, undefined, "부분 수용 응답이 나왔다 — 잘라 받고 있다");
});

test("상한 이하 배치는 상한 검사에 걸리지 않는다", async () => {
  // 정상 트래픽을 자르지 않는지 고정. 워치 백로그 상한이 300 이라 이 크기가 실제 최대치다.
  const res = await POST(batchRequest(300, "203.0.113.13"));
  assert.notEqual(res.status, 413);
});
