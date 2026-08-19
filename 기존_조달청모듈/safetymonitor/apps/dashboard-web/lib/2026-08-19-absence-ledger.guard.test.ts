// 감시 공백 알림 원장 가드 — 통지가 원장을 앞지르거나 야간에 기록이 사라지면 실패한다.
//
// 배경 ① — 온열 알림이 `recordAlert` 관문을 우회해 텔레그램만 나갔고, 그래서 **발동 이력을
//   아무도 조회할 수 없었다**(2026-08-18 실측). 부재 알림은 같은 실수를 반복하면 안 된다.
// 배경 ② — 야간은 **push 만** 끄기로 했다(2026-08-19 사용자 결정). 기록까지 끄면 밤에 생겼다
//   아침 전에 풀린 공백이 원장에 한 줄도 안 남아, 나중에 "그날 밤 감시가 있었나" 를 못 따진다.
//
// 둘 다 조용히 되돌아가는 종류다(tsc·기존 테스트 전부 통과). 소스 불변식으로 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(fileURLToPath(new URL(".", import.meta.url)));
const ROUTE = join(here, "..", "app", "api", "cron", "absence-check", "route.ts");
const src = readFileSync(ROUTE, "utf8");

test("★ 원장 기록이 통지보다 먼저 온다", () => {
  const record = src.indexOf("recordAlert(");
  const notify = src.indexOf("sendTelegramMessage(absenceMessage");
  assert.ok(record >= 0, "recordAlert 호출이 사라졌다 — 통지만 나가면 발동 이력이 남지 않는다");
  assert.ok(notify >= 0, "부재 통지가 사라졌다");
  assert.ok(
    record < notify,
    "통지가 기록보다 먼저다 — 기록에 실패해도 알림만 나가는 경로가 생긴다(온열 알림 전례)",
  );
});

test("★ 부재는 공용 포맷으로 중복 통지되지 않는다 — notify:false 로 기록만 한다", () => {
  assert.match(
    src,
    /\{\s*notify:\s*false\s*\}/,
    "notify 를 끄지 않으면 공용 포맷 통지와 전용 문구가 둘 다 나간다",
  );
});

test("★ 야간에도 원장에는 남는다 — 기록 경로에 근무시간 조건이 끼면 안 된다", () => {
  const loop = src.indexOf("for (const d of decisions)");
  const record = src.indexOf("recordAlert(", loop);
  assert.ok(loop >= 0 && record > loop, "공백 감지 루프 구조가 바뀌었다 — 가드를 다시 맞춰야 한다");
  const between = src.slice(loop, record);
  assert.ok(
    !/push/i.test(between),
    `기록이 근무시간 조건 안으로 들어갔다 — 야간 공백이 원장에서 통째로 사라진다\n${between}`,
  );
});

test("★ 복귀 해제를 공백 감지보다 먼저 한다", () => {
  // ⚠ 호출부를 본다 — import 목록은 알파벳 순이라 여기서 쓰면 순서가 거꾸로 잡힌다.
  const resolve = src.indexOf("listOpenAbsenceAlerts()");
  const detect = src.indexOf("lastSeenByWorker()");
  assert.ok(resolve >= 0 && detect >= 0, "두 조회 중 하나가 사라졌다 — 가드를 다시 맞춰야 한다");
  assert.ok(
    resolve < detect,
    "순서가 뒤집히면 방금 돌아온 작업자를 같은 틱에서 다시 공백으로 세고 알림이 한 번 더 나간다",
  );
});

test("★ 알림 명부 = 관제 화면 명부(`monitor_slot_config`) · 별칭은 접는다", () => {
  const db = readFileSync(join(here, "db.ts"), "utf8");
  const fn = db.slice(db.indexOf("export async function lastSeenByWorker"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 3);

  assert.match(
    body,
    /monitor_slot_config/,
    "명부를 vital_samples 에서 뽑으면 화면과 알림이 다른 명부를 본다 —"
      + " 배정 안 된 시험 기기가 알림을 내고, 배정된 채 오래 꺼진 작업자는 대상에서 빠진다",
  );
  assert.match(
    body,
    /worker_alias/,
    "별칭을 안 접으면 한 사람이 여럿으로 갈려, 본인은 정상 수신 중인데 옛 ID 로 부재 알림이 난다"
      + "(EMP-admin7276 은 별칭 4개 = 최대 5명)",
  );
});

test("★ 작업자 이름은 최근 라벨이 아니라 최빈 라벨로 고른다", () => {
  const db = readFileSync(join(here, "db.ts"), "utf8");
  const fn = db.slice(db.indexOf("export async function lastSeenByWorker"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 3);

  assert.match(
    body,
    /MODE\(\)\s+WITHIN GROUP/,
    "최근 라벨을 쓰면 마지막 세션이 폴백이었던 워커를 엉뚱한 이름으로 부른다"
      + "(실측 EMP-admin7276 = 최근 `워치PoC` vs 실제 `양지후`)",
  );
  assert.doesNotMatch(
    body,
    /ARRAY_AGG\(v\.worker_name ORDER BY v\.ts DESC\)/,
    "최근 라벨 방식이 되살아났다 — 안전 알림이 사람을 잘못 부른다",
  );
});

test("★ 명부가 비었는지 응답에서 보인다 — 0건이 '정상' 으로 읽히면 안 된다", () => {
  assert.match(src, /rosterSize\(\)/, "배정 수를 조회하지 않으면 명부가 빈 것과 전원 정상이 같은 응답이 된다");
  // ⚠ 소스 전체에서 `roster,` 를 찾으면 구조분해(`const [roster, workers]`)에 걸려 통과한다 —
  //   음성 대조에서 실제로 잡혔다. 응답 객체 안에 있는지만 본다.
  const body = src.slice(src.lastIndexOf("return NextResponse.json({"));
  assert.match(
    body,
    /\broster\b/,
    `배정 수가 응답에 안 실린다 — 명부가 비어도 "checked 0" 으로만 보인다\n${body}`,
  );
});

test("크론 인증 게이트가 붙어 있다", () => {
  assert.match(src, /cronAuth\(/, "무인 엔드포인트가 인증 없이 열리면 안 된다");
  assert.match(src, /unauthorized/);
});

test("★ 알림 이름은 화면과 같은 소스를 쓴다 — 24시간 창 최빈은 폴백 라벨을 부른다", () => {
  // 실측(2026-08-19) — `EMP-admin7276` 의 전수 최빈은 `양지후`(17,513건)인데 **마지막에 쓰인
  // 라벨**은 `워치PoC`(957건·08-01)이고, 그 워커가 마지막으로 수신되던 24시간 안에서는
  // `워치PoC` 가 최빈이었다. 그 상태로 복귀했다가 끊기면 화면은 `양지후`, 텔레그램은
  // `워치PoC` 라 **같은 사람을 다르게 부른다**(화면 쪽에서 고친 결함의 거울상).
  // ⚠ 지금은 마지막 수신이 18일 전이라 `now()-24h` 창이 비어 **잠복 상태**다.
  assert.match(
    src,
    /rosterWorkerNames\(\)/,
    "화면과 같은 이름 소스를 안 쓴다 — 알림이 폴백 라벨로 사람을 부를 수 있다",
  );
  // 두 통지 경로(복귀·부재) 모두에서 그 소스를 **먼저** 본다. 한쪽만 고치면 나머지가 갈린다.
  const uses = src.match(/workerName:\s*names\[[^\]]+\]\s*\?\?/g) ?? [];
  assert.equal(
    uses.length,
    2,
    `이름 폴백이 두 경로(복귀·부재) 모두에 걸려 있지 않다 — 발견 ${uses.length}곳\n${uses.join("\n")}`,
  );
});
