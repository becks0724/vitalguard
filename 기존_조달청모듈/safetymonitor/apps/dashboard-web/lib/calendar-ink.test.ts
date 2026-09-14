import assert from "node:assert/strict";
import { test } from "node:test";
import { createCalendarInkLoader } from "./calendar-ink";

const sample = { v: 1, strokes: [{ tool: "pen", color: 4278190080, width: 0.004, points: [[0.1, 0.2, 0.5]] }] };
const storageUrl = "https://storage.fixture.test/ink.json?signature=fixture";
function harness(respond?: (url: string, count: number) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const loader = createCalendarInkLoader(async (url, init) => {
    calls.push({ url: String(url), init });
    return respond?.(String(url), calls.length) ?? Response.json(String(url) === storageUrl ? sample : { ok: true, url: storageUrl });
  });
  return { loader, calls };
}

test("뒤집기 전 요청 0회, 최초 요청은 URL+JSON 2회, 재열기와 동시 요청은 캐시 공유", async () => {
  const { loader, calls } = harness();
  assert.equal(calls.length, 0);
  const first = loader("ink/id?", "fixture-token");
  assert.equal(loader("ink/id?", "fixture-token"), first);
  assert.deepEqual(await first, sample);
  assert.deepEqual(await loader("ink/id?", "fixture-token"), sample);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.url, "/api/calendar/media/download-url?id=ink%2Fid%3F");
  assert.deepEqual(calls[0]!.init?.headers, { Authorization: "Bearer fixture-token" });
  assert.equal(calls[1]!.init?.headers, undefined);
  assert.equal(calls[1]!.init?.credentials, "omit");
});

test("최신 annotation id가 달라지면 새 파일을 읽고, 세션이 바뀌면 캐시를 비운다", async () => {
  const { loader, calls } = harness();
  await loader("ink-1", "session-a");
  await loader("ink-2", "session-a");
  await loader("ink-1", "session-b");
  assert.equal(calls.length, 6);
  await loader("ink-1", null);
  assert.equal(calls.length, 8);
  assert.equal(calls[6]!.init?.headers, undefined);
});

for (const failure of ["url", "file", "json", "missing-url", "network"]) {
  test(`조회 실패(${failure})는 캐시에 남지 않아 다음 클릭으로 재시도한다`, async () => {
    let fail = true;
    const { loader, calls } = harness((url) => {
      if (!fail) return Response.json(url === storageUrl ? sample : { ok: true, url: storageUrl });
      if (failure === "network") throw new Error("offline fixture");
      if (url !== storageUrl) {
        if (failure === "url") return new Response(null, { status: 401 });
        if (failure === "missing-url") return Response.json({ ok: true });
        return Response.json({ ok: true, url: storageUrl });
      }
      return failure === "file" ? new Response(null, { status: 403 }) : new Response("not json");
    });
    await assert.rejects(loader("ink", "fixture"));
    const before = calls.length;
    fail = false;
    assert.deepEqual(await loader("ink", "fixture"), sample);
    assert.equal(calls.length, before + 2);
  });
}

test("옛 세션의 늦은 실패가 현재 세션의 같은 id 캐시를 지우지 않는다", async () => {
  let rejectOld!: (reason: Error) => void;
  const { loader, calls } = harness((url, count) => count === 1
    ? new Promise<Response>((_resolve, reject) => { rejectOld = reject; })
    : Response.json(url === storageUrl ? sample : { ok: true, url: storageUrl }));
  const old = loader("ink", "old-session");
  const rejected = assert.rejects(old);
  await loader("ink", "new-session");
  rejectOld(new Error("late failure"));
  await rejected;
  await loader("ink", "new-session");
  assert.equal(calls.length, 3);
});
