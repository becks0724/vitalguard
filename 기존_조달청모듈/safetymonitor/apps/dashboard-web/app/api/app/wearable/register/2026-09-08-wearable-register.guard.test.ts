// 워치 단말 등록(A-4) 계약 가드 — 팀원에게 준 스펙과 라우트가 갈리지 않게 못 박는다.
//
// 왜 필요한가: 이 계약은 **앱이 먼저 구현하고 서버가 나중에 붙는다**(2026-09-08 — 라이브 서버는
// 아직 구 DB 를 보고, 신 DB 전환 후에야 실제로 동작한다). 그 사이 서버 쪽 문구나 상태 코드가
// 조용히 바뀌면, 앱은 이미 배포된 뒤라 되돌릴 수 없다.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROUTE = readFileSync(join(process.cwd(), "app/api/app/wearable/register/route.ts"), "utf8");
const DB = readFileSync(join(process.cwd(), "lib/db.ts"), "utf8");

test("앵커 — 라우트와 등록 함수가 실재한다", () => {
  assert.match(ROUTE, /export async function POST/, "POST 소실");
  assert.match(DB, /export async function registerWearable/, "registerWearable 소실");
});

test("사용자 특정은 sub(username) 로 한다 — 사번은 회사 안에서만 유일하다", () => {
  // app_user 는 UNIQUE (company_id, employee_no) 라 사번만으로는 사람을 못 고른다.
  assert.match(ROUTE, /claims\?\.sub/, "sub 대신 다른 클레임을 본다");
  assert.match(ROUTE, /username: claims\.sub/, "username 으로 넘기지 않는다");
  assert.match(DB, /SELECT id FROM app_user WHERE username = \$1/, "username 조회가 사라졌다");
});

test("표가 없는 서버는 200 이 아니라 503 을 준다 — 앱이 없는 id 를 저장하면 안 된다", () => {
  assert.match(DB, /code === "42P01"/, "undefined_table 분기가 사라졌다");
  assert.match(ROUTE, /reason === "no_table"[\s\S]{0,400}status: 503/, "no_table 이 503 이 아니다");
  assert.match(ROUTE, /action: "retry_later"/, "앱이 재시도해도 되는지 알려주지 않는다");
});

test("멱등 3규칙이 살아 있다 — 앱은 받은 id 를 저장만 하고 판단은 서버가 한다", () => {
  // ① 주인이 같으면 그대로 ② 주인이 다르면 옛 행을 닫고 새 id ③ 안 쓰인 행 재사용
  assert.match(DB, /row\.user_id === userId && row\.decommissioned_at === null/, "① 규칙 소실");
  assert.match(DB, /UPDATE wearable SET decommissioned_at = now\(\)/, "② 규칙 소실 — 옛 행을 닫지 않는다");
  assert.match(DB, /last_seen_at IS NULL AND decommissioned_at IS NULL/, "③ 규칙 소실 — 고아 행이 쌓인다");
});

test("등록은 last_seen_at 을 찍지 않는다 — 찍으면 ③의 '안 쓰인 행' 식별이 무너진다", () => {
  const body = DB.slice(DB.indexOf("export async function registerWearable"));
  const fn = body.slice(0, body.indexOf("\nexport "));
  assert.doesNotMatch(fn, /SET[^;]*last_seen_at\s*=/, "등록이 last_seen_at 을 갱신한다");
});

test("platform 은 표의 CHECK 와 같은 값만 받는다 — 안 막으면 23514 로 500 이 된다", () => {
  assert.match(ROUTE, /new Set\(\["wearos", "watchos"\]\)/, "허용값 집합이 바뀌었다");
  assert.match(ROUTE, /status: 400/, "오값을 400 으로 막지 않는다");
});

test("uuid 형식이 아니면 조회하지 않는다 — 캐스트 오류가 트랜잭션을 죽인다", () => {
  assert.match(DB, /UUID_RE\.test\(input\.wearableId\)/, "형식 검사가 사라졌다");
});

test("신규는 201, 기존 재사용은 200 — 앱이 둘을 구분할 수 있어야 한다", () => {
  assert.match(ROUTE, /status: result\.created \? 201 : 200/, "생성·재사용 구분이 사라졌다");
  assert.match(ROUTE, /wearableId: result\.wearableId/, "응답에 id 가 없다");
});
