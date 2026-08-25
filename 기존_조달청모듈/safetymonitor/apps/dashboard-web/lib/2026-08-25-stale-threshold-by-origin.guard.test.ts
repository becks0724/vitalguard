// 연결끊김 문턱 계약 가드 — 관제웹 문턱이 워치의 실제 전송 주기를 따라가는가
//
// ★ 왜 필요한가. 두 숫자가 서로를 모른 채 각자 바뀌었다.
//   워치 `CollectorService.FLUSH_INTERVAL_MS` 와 관제웹 연결끊김 문턱은 **같은 물리량의 양 끝**인데
//   서로 다른 언어·다른 레포 구역에 있어 한쪽만 움직여도 아무 시험이 빨개지지 않는다.
//   2026-08-25 실제로 그렇게 갈렸다 — 발열 조치로 워치가 60→120초가 됐고(`7ef6ca9`), 관제웹
//   문턱은 60초에 남아 갤럭시가 **정상 동작 중에도 상시 "연결끊김"** 으로 표시될 참이었다.
//
// ★ 이 가드가 초록일 때 보장하는 것(한 문장) —
//   **갤럭시 문턱이 워치 전송 주기보다 크되(오탐 차단) 두 배는 넘지 않고(진짜 끊김 은폐 차단),
//   문턱이 갈라지는 기준 문자열이 서버 분류가 실제로 내놓는 출처와 같다.**
//   보장하지 않는 것 = 워치에 그 빌드가 실제로 설치됐는가. 그것은 사람이 확인한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, ...p), "utf8");

/** 주석을 걷어낸 본문에서만 검사한다 — 이름이 주석에 남아도 통과하면 가드가 아니다([[L-104]]). */
const codeOnly = (src: string) => src.replace(/^\s*\/\/.*$/gm, "");

const service = codeOnly(
  read("..", "..", "vitalguard_app", "android", "wear", "src", "main",
    "kotlin", "com", "vitalguard", "wear", "CollectorService.kt"),
);
const age = codeOnly(read("vital-age.ts"));
const board = codeOnly(read("..", "app", "components", "DemoDashboard.tsx"));
const store = codeOnly(read("..", "app", "api", "app", "vital", "store.ts"));

/** `1_234` 꼴 숫자 리터럴을 뽑는다 — 밑줄은 가독성용이라 값에서 걷어낸다. */
function num(src: string, re: RegExp, what: string): number {
  const raw = re.exec(src)?.[1];
  assert.ok(raw !== undefined, `${what} 를 못 찾았다 — 이름이 바뀌었으면 이 가드도 따라가야 한다`);
  const n = Number(raw.replace(/_/g, ""));
  assert.ok(Number.isFinite(n) && n > 0, `${what} 파싱이 깨졌다(읽은 값 "${raw}")`);
  return n;
}

test("★ 갤럭시 문턱이 워치 전송 주기보다 크다 — 작으면 정상 주기가 연결끊김으로 보인다", () => {
  const flush = num(service, /FLUSH_INTERVAL_MS\s*=\s*([0-9_]+)L/, "워치 FLUSH_INTERVAL_MS");
  const wearos = num(age, /STALE_MS_WEAROS\s*=\s*([0-9_]+)/, "관제웹 STALE_MS_WEAROS");

  // 여유 = 업로드 왕복 + 관제웹 폴 주기(5초) + 지터. 20초 아래로 깎으면 경계에서 깜빡인다.
  const MARGIN_MS = 20_000;
  assert.ok(
    wearos >= flush + MARGIN_MS,
    `문턱 ${wearos / 1000}s 가 워치 주기 ${flush / 1000}s + 여유 ${MARGIN_MS / 1000}s 에 못 미친다 — ` +
      `갤럭시가 정상 전송 중에도 매 주기 끝자락에 "연결끊김"으로 뜬다. ` +
      `워치 주기를 늘렸다면 lib/vital-age.ts 의 STALE_MS_WEAROS 도 함께 올릴 것.`,
  );

  // 위쪽 상한 — 문턱으로 문제를 덮는 방향을 막는다. 주기의 2배를 넘으면 진짜 끊김을
  // 한 주기 통째로 놓치고도 화면은 "정상"이다(false-OK 재발).
  assert.ok(
    wearos <= flush * 2,
    `문턱 ${wearos / 1000}s 가 워치 주기 ${flush / 1000}s 의 2배를 넘는다 — ` +
      `끊겨도 한 주기 동안 정상으로 보인다. 문턱을 올리는 대신 워치 주기를 줄일 것.`,
  );
});

test("★ 애플 문턱은 60초 그대로다 — 갤럭시를 맞추다 애플을 함께 늘리면 감지가 늦어진다", () => {
  const def = num(age, /STALE_MS_DEFAULT\s*=\s*([0-9_]+)/, "STALE_MS_DEFAULT");
  assert.equal(
    def, 60_000,
    "애플(watchOS)은 30초 배칭이라 60초가 맞는 값이다. 갤럭시 사정으로 이 값을 움직이지 않는다 — " +
      "출처별로 갈리는 구조이므로 그럴 필요도 없다.",
  );
});

test("★ 신호 막대가 문턱에서 파생된다 — 60초를 다시 박으면 갤럭시가 늘 '약함'에 눌러앉는다", () => {
  const at = board.indexOf("function signalLevel");
  assert.notEqual(at, -1, "signalLevel 이 사라졌다 — 신호 막대 판정 지점이 옮겨졌다");
  const body = board.slice(at, board.indexOf("\n}", at));

  assert.ok(
    body.includes("staleThresholdMs("),
    "signalLevel 이 문턱 함수를 안 쓴다 — 출처와 무관하게 같은 사다리를 타면 " +
      "isStale 은 통과인데 행은 signal===0 으로 연결끊김이 되어 보드와 표가 갈린다",
  );

  // 사다리의 모든 칸이 배율을 타야 한다 — 한 칸이라도 절대 초로 남으면 그 칸에서 갈린다.
  const rungs = [...body.matchAll(/ageMs\s*<\s*([0-9_]+)([^\n]*)/g)]
    .map((m) => ({ ms: m[1] ?? "", rest: m[2] ?? "" }));
  assert.ok(rungs.length >= 4, `사다리 파싱이 깨졌다(추출 ${rungs.length}칸)`);
  for (const { ms, rest } of rungs) {
    assert.ok(
      rest.includes("* scale"),
      `신호 막대 ${Number(ms.replace(/_/g, "")) / 1000}초 칸이 배율을 안 탄다 — ` +
        "출처별 문턱을 넣은 의미가 그 칸에서 사라진다",
    );
  }
});

test("★ 문턱이 갈라지는 출처 문자열이 서버가 실제로 내놓는 값이다 — 어긋나면 조용히 60초로 되돌아간다", () => {
  // [[L-115]] 의 그 실패 형태. `staleThresholdMs` 는 모르는 출처를 기본값으로 돌려주므로,
  // store.ts 가 origin 이름을 바꾸면 **아무도 안 터지고** 갤럭시만 다시 60초를 탄다.
  // 값이 만들어지는 끝(store.ts)과 소비되는 끝(vital-age.ts)을 직접 맞댄다.
  const at = store.indexOf("export function classifyVitalDataOrigin");
  assert.notEqual(at, -1, "classifyVitalDataOrigin 이 사라졌다 — 출처 확정 지점이 옮겨졌다");
  const body = store.slice(at, store.indexOf("\n}", at));

  const galaxyCase = body.indexOf('case "VitAlGuard-GalaxyWatch"');
  assert.notEqual(galaxyCase, -1, "갤럭시 source 분기가 사라졌다");
  const emitted = /return\s+"([a-z_]+)"/.exec(body.slice(galaxyCase))?.[1];
  assert.ok(emitted, "갤럭시 분기가 돌려주는 출처를 못 읽었다");

  const compared = /dataOrigin\s*===\s*"([a-z_]+)"/.exec(age)?.[1];
  assert.ok(compared, "staleThresholdMs 가 출처를 대조하는 자리를 못 찾았다");

  assert.equal(
    compared, emitted,
    `서버는 갤럭시를 "${emitted}" 로 적재하는데 문턱 함수는 "${compared}" 를 본다 — ` +
      "일치하지 않으면 갤럭시가 기본 문턱(60초)으로 떨어져 상시 연결끊김이 된다",
  );
});
