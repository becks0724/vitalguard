// 누적 건수 별칭 폴딩 가드 — countsByWorker 가 secondary ID 누적을 주 ID 로 접어 합산하게 유지한다.
//
// 무슨 일이 있었나(2026-08-12). 신원 전환(EMP-admin6861→EMP-6861) 후 관제 카드가 주 ID 로
// 합쳐졌는데 누적 열만 4,942(EMP-6861 원시 행)로 축소됐다 — countsByWorker 가 별칭을 접지
// 않고 원시 worker_id 로만 집계했기 때문. 카드(latestByWorker)는 접고 누적은 안 접으면
// 병합된 작업자마다 같은 축소 표시가 재발한다.
//
// 왜 가드 테스트인가 — countsByWorker 는 listAllWorkers(실 DB) 의존이라 tsx --test 로
// 기능 테스트가 불가하다(mock.module 미지원). 되돌리면 여기서 실패하도록 소스 불변식을 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const storeSource = readFileSync(join(ROOT, "app", "api", "mock", "store.ts"), "utf8");
const routeSource = readFileSync(join(ROOT, "app", "api", "mock", "vital", "route.ts"), "utf8");

// countsByWorker 함수 본문 — 다음 최상위 export 직전까지.
function countsBody(): string {
  const start = storeSource.indexOf("export async function countsByWorker");
  assert.ok(start >= 0, "countsByWorker 를 찾지 못함");
  const end = storeSource.indexOf("export ", start + 1);
  return storeSource.slice(start, end < 0 ? undefined : end);
}

test("countsByWorker — 별칭(secondary→primary)을 주 ID 로 접어 키를 만든다", () => {
  const body = countsBody();
  assert.match(
    body,
    /aliases\[w\.worker_id\]\s*\?\?\s*w\.worker_id/,
    "별칭 폴딩이 없다 — 병합된 작업자의 누적이 원시 ID 로 흩어져 축소 표시된다",
  );
});

test("countsByWorker — 같은 주 ID 로 접힌 누적은 덮어쓰지 않고 합산한다", () => {
  const body = countsBody();
  assert.match(
    body,
    /\(out\[key\]\s*\?\?\s*0\)\s*\+\s*w\.sample_count/,
    "합산이 없다 — secondary 와 primary 중 마지막 행이 이기는 덮어쓰기가 되면 누적이 유실된다",
  );
});

test("vital GET — 이미 로드한 aliasMap 을 countsByWorker 에 전달한다(이중 조회·판정 불일치 방지)", () => {
  assert.match(
    routeSource,
    /countsByWorker\(aliasMap\)/,
    "라우트가 aliasMap 을 넘기지 않는다 — 같은 응답 안에서 카드 폴딩과 누적 폴딩이 서로 다른 맵을 볼 수 있다",
  );
});
