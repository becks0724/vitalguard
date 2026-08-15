// 구조적 재발 방지(교훈 L-12) — 클라이언트 IP 판정이 lib/client-ip.ts 밖에 생기면 실패시킨다.
// 과거 같은 규칙을 3곳이 각자 구현했고 그중 2곳이 틀려 우회 취약점이 됐다.
//
// 2026-07-26 보강(감사 DLT-LIB-005) — 1차 가드에 우회 경로가 여럿 있었다.
//  ① 스캔 범위가 lib/·app/ 뿐이라 **루트 middleware.ts 를 못 봤다**. Next.js 미들웨어는 루트에만
//     놓을 수 있고, 클라이언트 IP 판정이 새로 생길 1순위 위치다.
//  ② 정규식이 따옴표 2종만 봐서 백틱 리터럴을 놓쳤다.
//  ③ **가장 큰 구멍** — x-forwarded-for 만 막고 같은 목적의 다른 헤더는 전부 무방비였다.
//     이 프로젝트는 cloudflared 를 실사용하므로 cf-connecting-ip 가 특히 현실적이다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIRS = ["lib", "app"];
// 루트 단일 파일도 포함한다 — middleware.ts 는 디렉터리가 아니라 루트에 놓인다.
const SCAN_FILES = ["middleware.ts", "middleware.tsx", "instrumentation.ts"];
const ALLOWED = new Set(["lib/client-ip.ts"]);

// 클라이언트 IP 를 담는 헤더 전부 — 하나만 막으면 다른 이름으로 같은 실수가 재현된다.
const CLIENT_IP_HEADERS = [
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "fastly-client-ip",
  "x-client-ip",
  "x-cluster-client-ip",
];
// 따옴표 3종(', ", `) 모두 커버.
const HEADER_RE = new RegExp(`["'\`](${CLIENT_IP_HEADERS.join("|")})["'\`]`, "i");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function collectFiles(): string[] {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
  for (const f of SCAN_FILES) {
    const full = join(ROOT, f);
    if (existsSync(full)) files.push(full);
  }
  return files;
}

test("클라이언트 IP 헤더 파싱은 lib/client-ip.ts 에만 존재한다", () => {
  const files = collectFiles();
  // 앵커 — 이 검사는 '없음'을 단언하므로 스캔이 아무것도 못 읽어도 통과한다.
  // walk() 는 디렉터리가 없으면 existsSync 폴백으로 **조용히 빈 배열**을 돌려주므로,
  // lib/·app/ 이 옮겨가는 순간 이 가드는 0개 파일을 훑고 통과하게 된다.
  // 스캔이 실제로 대상에 닿았는지를 먼저 고정한다(2026-08-15 가드 전수 감사).
  assert.ok(
    files.some((f) => f.endsWith("lib/client-ip.ts")),
    "허용 파일조차 스캔 범위 밖이다 — 스캔 경로가 깨졌고 아래 금지 검사는 공허하다",
  );
  assert.ok(
    files.some((f) => f.endsWith("app/api/mock/vital/route.ts")),
    "알려진 소비처가 스캔 범위 밖이다 — 스캔 경로가 깨졌고 아래 금지 검사는 공허하다",
  );
  const offenders: string[] = [];
  for (const file of files) {
    const rel = file.slice(ROOT.length);
    if (ALLOWED.has(rel) || rel.includes(".test.")) continue;
    if (HEADER_RE.test(readFileSync(file, "utf8"))) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `클라이언트 IP 헤더를 직접 읽는 파일이 있다. lib/client-ip.ts 의 clientIpFromRequest 를 쓸 것: ${offenders.join(", ")}`,
  );
});

// 가드 자체가 동작하는지 고정 — 통과만 확인하면 "아무것도 검사하지 않는 테스트"를 통과로 착각한다.
test("가드 정규식이 헤더 7종과 따옴표 3종을 모두 잡는다", () => {
  for (const h of CLIENT_IP_HEADERS) {
    assert.ok(HEADER_RE.test(`req.headers.get("${h}")`), `${h} 쌍따옴표 미검출`);
    assert.ok(HEADER_RE.test(`req.headers.get('${h}')`), `${h} 홑따옴표 미검출`);
    assert.ok(HEADER_RE.test("req.headers.get(`" + h + "`)"), `${h} 백틱 미검출`);
  }
  assert.ok(HEADER_RE.test('get("X-Forwarded-For")'), "대소문자 무시 실패");
  assert.ok(!HEADER_RE.test('get("x-forwarded-proto")'), "무관 헤더를 오검출");
});

test("루트 단일 파일(middleware 등)도 스캔 대상에 포함된다", () => {
  // 파일이 없더라도 스캔 목록에 이름이 있어야 한다 — 생성 즉시 검사되도록.
  assert.ok(SCAN_FILES.includes("middleware.ts"), "middleware.ts 가 스캔 목록에 없다");
});
