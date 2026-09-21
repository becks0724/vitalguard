import assert from "node:assert/strict";
import { test } from "node:test";
import { createCalendarInkLoader } from "./calendar-ink";

const sample = { v: 1, strokes: [{ tool: "pen", color: 4278190080, width: 0.004, points: [[0.1, 0.2, 0.5]] }] };
function harness(respond?: (url: string, count: number) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const loader = createCalendarInkLoader(async (url, init) => {
    calls.push({ url: String(url), init });
    return respond?.(String(url), calls.length) ?? Response.json(sample);
  });
  return { loader, calls };
}

test("뒤집기 전 요청 0회, 최초 요청은 같은 오리진 1회, 재열기와 동시 요청은 캐시 공유", async () => {
  const { loader, calls } = harness();
  assert.equal(calls.length, 0);
  const first = loader("ink/id?", "fixture-token");
  assert.equal(loader("ink/id?", "fixture-token"), first);
  assert.deepEqual(await first, sample);
  assert.deepEqual(await loader("ink/id?", "fixture-token"), sample);
  assert.equal(calls.length, 1);
  // 스토리지로 직접 가지 않는다 — 프리사인 응답에는 CORS 헤더가 없어 브라우저가 읽지 못한다.
  assert.equal(calls[0]!.url, "/api/calendar/media/ink?id=ink%2Fid%3F");
  assert.deepEqual(calls[0]!.init?.headers, { Authorization: "Bearer fixture-token" });
});

test("최신 annotation id가 달라지면 새 파일을 읽고, 세션이 바뀌면 캐시를 비운다", async () => {
  const { loader, calls } = harness();
  await loader("ink-1", "session-a");
  await loader("ink-2", "session-a");
  await loader("ink-1", "session-b");
  assert.equal(calls.length, 3);
  await loader("ink-1", null);
  assert.equal(calls.length, 4);
  assert.equal(calls[3]!.init?.headers, undefined);
});

for (const failure of ["status", "json", "network"]) {
  test(`조회 실패(${failure})는 캐시에 남지 않아 다음 클릭으로 재시도한다`, async () => {
    let fail = true;
    const { loader, calls } = harness(() => {
      if (!fail) return Response.json(sample);
      if (failure === "network") throw new Error("offline fixture");
      if (failure === "status") return new Response(null, { status: 502 });
      return new Response("not json");
    });
    await assert.rejects(loader("ink", "fixture"));
    const before = calls.length;
    fail = false;
    assert.deepEqual(await loader("ink", "fixture"), sample);
    assert.equal(calls.length, before + 1);
  });
}

test("옛 세션의 늦은 실패가 현재 세션의 같은 id 캐시를 지우지 않는다", async () => {
  let rejectOld!: (reason: Error) => void;
  const { loader, calls } = harness((_url, count) => count === 1
    ? new Promise<Response>((_resolve, reject) => { rejectOld = reject; })
    : Response.json(sample));
  const old = loader("ink", "old-session");
  const rejected = assert.rejects(old);
  await loader("ink", "new-session");
  rejectOld(new Error("late failure"));
  await rejected;
  await loader("ink", "new-session");
  assert.equal(calls.length, 2);
});
