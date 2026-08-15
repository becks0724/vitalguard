// 관제 화면 열화 가드 — DB 조회 하나가 화면 전체를 죽이거나, 없는 값을 0 으로 그리면 실패한다.
//
// 배경(2026-08-15 DB 장애 3시간 39분 + 11분) — `/api/mock/vital` GET 이 500 을 261건 냈고
// **관제가 열화가 아니라 정지**했다. 실시간 감시에 필요한 `latest` 는 in-memory ring 으로
// 만들어져 멀쩡했는데, 옆의 누적 집계 조회가 던지며 응답 전체가 사라졌다.
//
// ★ 조사에서 내 진단이 두 번 틀렸다 — 기록해 둔다.
//   ① "`latestByWorkerWithSpo2` 가 원인"이라 했으나 그 함수는 **이미 try/catch 로 열화**한다.
//   ② catch 유무를 awk `\b` 로 세다 11개 전부 "없음"이 나왔다 — POSIX awk 는 `\b` 를 모른다.
//      눈으로 catch 를 확인한 함수까지 "없음"으로 나온 것이 측정 실패의 신호였다(대조군).
//   실제 실패 지점은 **5개**다: totalPersisted · dataMockupSamples · totalDataMockupPersisted ·
//   countsByWorker · workerProfiles. 나머지는 자체 catch 로 이미 열화한다.
//
// ★★ 서버만 고치면 의도가 뒤집힌다 — 클라이언트가 `(x ?? 0).toLocaleString()` 이라
//    null 을 보내면 화면에 **"0건 누적"** 이 뜬다. 누적 21만 건인데 0 으로 보이는 것은
//    미수신보다 나쁘다(이 레포 반복 계열: 미수신인데 준수율 100% · 한 번도 안 받았는데 정상 4명).
//    그래서 양쪽을 함께 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const route = readFileSync(join(ROOT, "app", "api", "mock", "vital", "route.ts"), "utf8");
const dash = readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8");

// GET 핸들러 구간만 — 파일 전체를 보면 POST 쪽 코드나 설명 주석이 가드를 만족시킨다.
function getFn(): string {
  const from = route.indexOf("export async function GET");
  assert.ok(from > 0, "GET 핸들러를 찾지 못했다 — 가드 재작성 필요");
  const to = route.indexOf("\nexport async function POST", from);
  return route.slice(from, to > from ? to : undefined);
}

// ── 서버: 실패 격리 ─────────────────────────────────────────────────────

test("실패할 수 있는 DB 조회 5종이 전부 softly 로 감싸져 있다", () => {
  const body = getFn();
  // 이 다섯은 store.ts 에 자체 catch 가 없어 그대로 던진다(2026-08-15 전수 확인).
  for (const fn of [
    "totalPersisted",
    "dataMockupSamples",
    "totalDataMockupPersisted",
    "countsByWorker",
    "workerProfiles",
  ]) {
    assert.match(
      body,
      new RegExp(`softly\\([^)]*?,\\s*(?:\\(\\)\\s*=>\\s*)?${fn}`, "s"),
      `${fn} 이 감싸이지 않았다 — 이 하나가 관제 화면 전체를 500 으로 만든다`,
    );
  }
});

test("softly 는 예외를 삼키고 실패 목록에 기록한다", () => {
  const helper = route.slice(route.indexOf("async function softly"), route.indexOf("export async function GET"));
  assert.ok(helper.length > 0, "softly 헬퍼가 사라졌다");
  assert.match(helper, /catch \(e\)/, "예외를 잡지 않는다");
  assert.match(helper, /failed\.push\(label\)/, "실패를 기록하지 않으면 화면이 열화를 알 수 없다");
  assert.match(helper, /console\.error/, "조용한 열화는 사후 추적이 불가능하다(L-35)");
  assert.match(helper, /return fallback/, "폴백을 안 돌려주면 여전히 던진다");
});

test("★ 누적 집계의 폴백은 0 이 아니라 null 이다", () => {
  const body = getFn();
  // 0 으로 채우면 "한 건도 안 쌓였다"로 읽힌다 — 실제로는 조회를 못 한 것이다.
  for (const label of ["누적 건수", "목업 누적", "워커별 누적"]) {
    // ⚠ `[^;]*?\)` 로 끊으면 `countsByWorker(aliasMap)` 의 **안쪽 괄호**에서 멈춘다(가드 작성 시 실제로 걸렸다).
    //    호출 끝은 항상 `degraded)` 이므로 거기까지 잡는다.
    const m = body.match(new RegExp(`softly\\("${label}"[\\s\\S]*?degraded\\)`));
    assert.ok(m, `${label} softly 호출을 찾지 못했다`);
    assert.match(m[0], /,\s*null\s*,\s*degraded\)/, `${label} 폴백이 null 이 아니다 — 화면에 0 이 뜬다`);
  }
});

test("열화 사실을 응답에 싣는다(degraded)", () => {
  const body = getFn();
  assert.match(body, /const degraded: string\[\] = \[\]/, "실패 수집 배열이 없다");
  assert.match(body, /\n\s*degraded,/, "응답에 degraded 를 안 실으면 화면이 열화를 모른다");
});

test("이미 자체 열화하는 함수는 이중으로 감싸지 않는다", () => {
  // 이중 방어는 실패 지점을 흐린다 — 어디서 무엇이 실패했는지 degraded 가 못 가린다.
  const body = getFn();
  for (const fn of ["latestByWorkerWithSpo2", "coreTempEstimates", "heatPatterns", "workRates", "heatStages"]) {
    assert.doesNotMatch(
      body,
      new RegExp(`softly\\([^)]*?${fn}`, "s"),
      `${fn} 은 store.ts 에서 이미 catch 한다 — 여기서 또 감싸면 실패 지점이 흐려진다`,
    );
  }
});

// ── 클라이언트: 없는 값을 0 으로 그리지 않는다 ──────────────────────────

test("★ 화면이 null 을 0 으로 바꾸지 않는다", () => {
  assert.match(
    dash,
    /function formatPersisted\(n: number \| null \| undefined\): string \{\s*return n == null \? "—" : n\.toLocaleString\(\);/,
    "formatPersisted 가 사라지거나 폴백이 바뀌었다",
  );
  // 종전 형태가 되살아나면 서버가 null 을 줘도 화면엔 0 이 뜬다.
  assert.doesNotMatch(
    dash,
    /\(data\.totalPersisted \?\? 0\)/,
    "totalPersisted 를 0 으로 채우는 코드가 되살아났다",
  );
  assert.doesNotMatch(
    dash,
    /\(data\.dataMockupPersisted \?\? 0\)/,
    "dataMockupPersisted 를 0 으로 채우는 코드가 되살아났다",
  );
  assert.doesNotMatch(
    dash,
    /countsByWorker\?\.\[entry\.workerId\] \?\? 0/,
    "워커별 누적을 0 으로 채우면 '수집 0건'으로 읽힌다",
  );
});

test("실제 0 과 조회 실패를 구별한다", () => {
  // formatPersisted(0) 은 "0" 이어야 한다 — 신규 작업자의 진짜 0 건까지 `—` 로 덮으면
  // 반대 방향으로 같은 잘못(사실과 다른 표시)을 저지른다.
  assert.doesNotMatch(
    dash,
    /return !n \? "—"/,
    "falsy 검사로 바뀌면 진짜 0 건도 — 로 표시된다",
  );
});

test("열화 배너가 화면에 뜬다(툴팁만으로 두지 않는다)", () => {
  assert.match(dash, /data\.degraded && data\.degraded\.length > 0 &&/, "열화 배너 조건이 사라졌다");
  assert.match(dash, /DB 조회 실패 — 표시 불완전/, "배너 문구가 사라졌다");
});
