// 구조적 재발 방지 — 새 물리 접속 멎음(5초)에 대한 풀 설정·재시도·계측 불변식.
//
// 배경 — 2026-09-09 두 리비전이 같은 서명으로 죽었다(00365 18건 · 00366 재현 5건).
//   `Connection terminated due to connection timeout` = pg-pool 이 **새 물리 접속**을
//   5초에 끊을 때만 내는 문구다. 풀 슬롯 고갈은 `timeout exceeded when trying to connect` 이고
//   그건 **관측 0건**이었다. 두 문구를 구별하는 불변식이 없어서 "풀이 말랐다"로 오진했고,
//   그 오진 위에 수리안(웜 바닥 상향)을 세웠다가 철회했다.
//
// 왜 가드 테스트인가 — 이 결함은 tsc·lint·기존 테스트가 전부 통과하는 채로 존재했고,
//   재현하려면 캠퍼스 네트워크와 시간이 필요하다. 그래서 소스 불변식으로 고정한다.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");
// 주석에도 같은 문구가 설명으로 들어 있으므로 코드만 본다.
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("유휴 커넥션을 회수하지 않는다 — 회수가 풀을 쪼그라뜨렸다", () => {
  // 90초 회수 + 60초 폴링 조합에서, 만져지지 않은 커넥션이 죽어 풀이 4~5 로 줄었다.
  // 실패 순간의 동시 진행 요청이 4~5건(웜 바닥 8 미만)인데도 새 접속이 필요했던 것이 그 증거다.
  const m = code.match(/idleTimeoutMillis:\s*([0-9_]+)/);
  const raw = m?.[1];
  assert.ok(raw !== undefined, "idleTimeoutMillis 설정이 사라졌다");
  assert.equal(
    Number(raw.replace(/_/g, "")),
    0,
    "0(회수 안 함)이어야 한다 — 되돌리면 풀이 다시 쪼그라든다",
  );
});

test("회수를 끄면 keepAlive 가 필수다 — 짝으로만 성립한다", () => {
  // 영구 유휴 커넥션은 중간 장비(NAT·방화벽)의 매핑 만료로 조용히 끊기면 좀비가 된다.
  assert.ok(/keepAlive:\s*true/.test(code), "idleTimeoutMillis:0 과 keepAlive 는 함께 가야 한다");
  assert.ok(
    /keepAliveInitialDelayMillis:\s*[0-9_]+/.test(code),
    "keepalive 시작 지연을 명시해야 한다(기본 0 은 즉시 전송이라 의도가 불분명하다)",
  );
});

test("재시도는 '새 접속 멎음' 한 문구에만 붙는다", () => {
  assert.ok(
    /Connection terminated due to connection timeout/.test(code),
    "재시도 판별 문구가 사라졌다",
  );
  // ⚠ 풀 고갈 문구에 재시도를 붙이면 고갈을 악화시킨다. 코드에 있으면 안 된다.
  assert.ok(
    !/timeout exceeded when trying to connect/.test(code),
    "풀 고갈 문구로는 재시도하지 않는다 — 고갈을 악화시킨다",
  );
});

test("재시도는 정확히 1회다 — 멎은 경로를 반복해서 밟지 않는다", () => {
  const body = code.slice(code.indexOf("async function q<"));
  const fn = body.slice(0, body.indexOf("\n}\n") + 3);
  const retries = (fn.match(/pool\.query\(/g) ?? []).length;
  assert.equal(retries, 2, `q() 안의 query 호출은 최초 1 + 재시도 1 = 2 여야 한다 (현재 ${retries})`);
});

test("재시도 전에 지연을 둔다 — 곧바로 밀면 같은 순간을 밟는다", () => {
  const body = code.slice(code.indexOf("async function q<"));
  const fn = body.slice(0, body.indexOf("\n}\n") + 3);
  assert.ok(/setTimeout/.test(fn), "지터 없는 즉시 재시도는 같은 실패 창을 다시 밟는다");
});

test("웜풀 로그를 조건 없이 찍는다 — 0 과 '안 돎'을 구별해야 한다", () => {
  // 종전에는 created > 0 일 때만 찍어서, 00366 의 21분 로그 0건이
  // "만들 게 없었다"인지 "타이머가 안 돌았다"인지 구별되지 않았다.
  const i = code.indexOf("async function warmPool");
  assert.ok(i >= 0, "warmPool 이 사라졌다");
  const fn = code.slice(i, code.indexOf("\n}\n", i) + 3);
  assert.ok(
    !/if\s*\(created\s*>\s*0\)/.test(fn),
    "created > 0 조건을 되살리면 '안 돌았다'가 다시 보이지 않는다",
  );
  assert.ok(/console\.log\(/.test(fn), "웜풀 상태 로그가 있어야 한다");
  assert.ok(/waitingCount/.test(fn), "대기 수를 함께 찍어야 풀 고갈과 접속 실패가 갈린다");
});

test("웜풀이 삼킨 실패를 남긴다 — 조용한 catch 가 진단을 막았다", () => {
  const i = code.indexOf("async function warmPool");
  const fn = code.slice(i, code.indexOf("\n}\n", i) + 3);
  assert.ok(
    !/\}\s*catch\s*\{\s*\}/.test(fn),
    "빈 catch 로 되돌리면 워머 실패가 다시 보이지 않는다",
  );
  assert.ok(/console\.(warn|error)\(/.test(fn), "삼킨 예외를 로그로 남겨야 한다");
});

test("풀 상한과 웜 바닥은 그대로 둔다 — 바닥 상향은 기각된 수리안이다", () => {
  // 실패는 슬롯 부족이 아니라 새 접속 생성에서 났다(동시 4~5 · 대기열 문구 0건).
  // 바닥을 올리면 불안정한 접속 생성을 더 자주 하게 되어 노출이 커진다.
  assert.ok(/max:\s*16/.test(code), "풀 상한 16 이 바뀌었다 — 근거 없이 만지지 않는다");
  assert.ok(/WARM_FLOOR\s*=\s*8/.test(code), "웜 바닥 상향은 2026-09-09 적대검증에서 기각됐다");
});
