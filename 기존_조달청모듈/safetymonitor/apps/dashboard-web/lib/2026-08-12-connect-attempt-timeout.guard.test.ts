// 구조적 재발 방지 — 아웃바운드 TCP 연결 시도 상한(Node Happy Eyeballs) 가드.
//
// 배경 — 2026-08-10 Cloud NAT 전환으로 RainViewer(독일)까지 connect 가 253~266ms 가 되면서
// Node 기본 상한 250ms 에 매 시도가 걸렸고, 다음 후보인 IPv6 는 IPv4 전용 VPC 라 경로가 없어
// 폴백도 즉시 실패한다 → fetch failed → /api/radar 가 이틀간 502. 같은 자리에서 curl 은 200 이라
// "네트워크는 정상"으로 오판하기 쉽다(하네스 교훈 L-52).
//
// 왜 가드 테스트인가 — 이 결함은 tsc·lint·기존 테스트가 전부 통과하는 상태로 존재했다.
// 재현하려면 250ms 를 넘는 실제 원거리 경로가 필요하므로 소스 불변식 + API 지원 여부로 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  getDefaultAutoSelectFamilyAttemptTimeout,
  setDefaultAutoSelectFamilyAttemptTimeout,
} from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(join(ROOT, "instrumentation.ts"), "utf8");

// Cloud Run → RainViewer connect 최대 266ms(2026-08-12 · VPC 안에서 10회 실측).
const MEASURED_WORST_CONNECT_MS = 266;

test("서버 기동 훅이 연결 시도 상한을 올린다", () => {
  assert.ok(
    source.includes("setDefaultAutoSelectFamilyAttemptTimeout("),
    "기동 훅이 시도 상한을 설정하지 않는다 — 기본 250ms 라 원거리 호스트로 나가는 fetch 가 조용히 죽는다",
  );
});

test("상한 설정이 nodejs 분기 안에서 폴러 기동보다 먼저 일어난다", () => {
  const branch = source.slice(source.indexOf('NEXT_RUNTIME === "nodejs"'));
  const setAt = branch.indexOf("setDefaultAutoSelectFamilyAttemptTimeout(");
  const pollerAt = branch.indexOf("startCctvFallPoller()");
  assert.ok(setAt > 0, "상한 설정이 nodejs 런타임 분기 밖에 있다 — 서버 프로세스에 적용되지 않는다");
  assert.ok(setAt < pollerAt, "폴러가 먼저 뜬다 — 폴러의 첫 fetch 가 옛 상한으로 나간다");
});

test("상한 값이 실측 최악 connect 대비 여유를 갖는다", () => {
  const matched = /CONNECT_ATTEMPT_TIMEOUT_MS\s*=\s*(\d+)/.exec(source);
  assert.ok(matched, "상한을 이름 있는 상수로 두지 않았다 — 리터럴은 근거를 잃는다");
  const ms = Number(matched?.[1]);
  assert.ok(
    ms >= MEASURED_WORST_CONNECT_MS * 2,
    `상한 ${ms}ms 가 실측 최악 ${MEASURED_WORST_CONNECT_MS}ms 대비 여유가 없다 — 경로가 조금만 나빠져도 재발한다`,
  );
});

test("이 Node 런타임이 시도 상한 API 를 실제로 지원한다", () => {
  const before = getDefaultAutoSelectFamilyAttemptTimeout();
  try {
    setDefaultAutoSelectFamilyAttemptTimeout(1234);
    assert.equal(
      getDefaultAutoSelectFamilyAttemptTimeout(),
      1234,
      "설정이 반영되지 않는다 — 런타임이 바뀌었으면 기동 훅도 무효다",
    );
  } finally {
    setDefaultAutoSelectFamilyAttemptTimeout(before);
  }
});
