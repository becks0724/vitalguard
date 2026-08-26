// 조회 라우트 열화 가드 — DB 실패가 **벌거벗은 500** 으로 새거나, **빈 값**으로 위장하면 실패한다.
//
// 배경(2026-08-26 실측). 배포 사후 관찰이 5xx 1건을 물었고, 파 보니 라우트 다섯이 `await getX()`
// 를 맨몸으로 부르고 있었다. D-3 접속 타임아웃(미해명 잔여)이 그대로 500 이 되고 로그에는
// **라벨 없는 ERROR** 만 남았다 — 스택을 찾으려고 로그를 헤집어야 했다.
//   24h 실측  Connection terminated: aed/config 16 · gaspod/config 8 · alerts 4 · inspections 4 · devices 4
//   지연 ~5초(= D-3 접속 타임아웃)이고, 같은 창의 504(300초 · 요청 행)와는 **다른 현상**이다.
//
// ★ 이 가드의 한 문장 보장.
//   "조회 라우트의 DB 실패는 **라벨 있는 로그 + 503 transient** 로 나가고, 결코 **빈 값**이 되지 않는다."
//
// ★★ 왜 빈 값이 금지인가. `configs: {}` · `alerts: []` 를 200 으로 내리면 "설정 없음"·"경보 없음"
//    이라는 **거짓 단언**이 된다. 이 레포가 반복해 고쳐 온 false-OK 계열이다(미수신→준수율 100% ·
//    미착용→정상 · 대기 인원→정상 N명 · 낡은 추정→현재 체온).
// ★★ 왜 200 으로 감추면 안 되는가. 5xx 를 지우면 배포 사후 관찰이 조용해지는데 DB 는 실제로
//    타임아웃 중이다. **운영 층의 false-OK** 다. 상태 코드는 5xx 로 남기고 읽히게만 만든다.
//
// ⚠ 여기 넣지 않은 것 — `app/vital` GET 은 이미 `softly()` 로 열화하고, 그중 다섯 함수는
//   store.ts 에서 자체 catch 한다. 2026-08-15 가드가 **이중 방어를 명시적으로 금지**한다
//   ("실패 지점을 흐린다"). 그 판단을 존중해 건드리지 않았다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/** D-3 타임아웃이 500 으로 새던 라우트 — 24시간 실측으로 고른 목록이다(추측 아님). */
const ROUTES: [label: string, path: string[]][] = [
  ["gaspod/config", ["app", "api", "gaspod", "config", "route.ts"]],
  ["aed/config", ["app", "api", "aed", "config", "route.ts"]],
  ["aed/devices", ["app", "api", "aed", "devices", "route.ts"]],
  ["aed/inspections", ["app", "api", "aed", "inspections", "route.ts"]],
  ["alerts", ["app", "api", "alerts", "route.ts"]],
];

const helper = read("lib", "route-read.ts");

test("① 헬퍼 — 실패를 라벨과 함께 남기고 503 transient 를 낸다", () => {
  assert.match(helper, /console\.error\(`\[\$\{label\}\]/, "로그에 라우트 라벨이 안 박힌다");
  assert.match(helper, /status: 503/, "503(일시 장애)이 아니다");
  assert.match(helper, /transient: true/, "소비부가 '없음' 과 '못 읽음' 을 구별할 표식이 없다");
  assert.match(helper, /ok: false/, "실패인데 ok 를 참으로 낸다");
});

test("② ★ 헬퍼가 빈 값으로 위장하지 않는다", () => {
  // catch 절에 빈 컬렉션이 등장하면 그 순간 "없음" 이라는 거짓 단언이 된다.
  const catchBlock = helper.slice(helper.indexOf("} catch (e) {"));
  assert.doesNotMatch(catchBlock, /\[\]|\{\}/, "실패 응답이 빈 배열·빈 객체를 낸다 — '없음' 으로 읽힌다");
  assert.doesNotMatch(catchBlock, /status: 200/, "실패를 200 으로 감춘다 — 운영 신호가 죽는다");
});

test("③ ★ 대상 라우트 전부가 헬퍼를 거친다 — 맨몸 await 이 남아 있지 않다", () => {
  const bare: string[] = [];
  for (const [label, p] of ROUTES) {
    const src = read(...p);
    const get = src.slice(src.indexOf("export async function GET"));
    const body = get.slice(0, get.indexOf("\n}\n") + 1).replace(/\/\/[^\n]*/g, "");
    if (!/readOr503\(/.test(body)) bare.push(`${label}: 헬퍼 미사용`);
    // 인증 검사 외의 맨몸 await 이 남아 있으면 그 조회가 그대로 500 이 된다.
    for (const m of body.matchAll(/await\s+(\w+)\(/g)) {
      if (m[1] !== "readOr503") bare.push(`${label}: 맨몸 await ${m[1]}()`);
    }
  }
  assert.deepEqual(bare, [], `조회 실패가 벌거벗은 500 으로 샌다 — ${bare.join(" | ")}`);
});

test("④ 라벨이 라우트마다 다르다 — 로그에서 어느 라우트인지 갈린다", () => {
  const labels = ROUTES.map(([, p]) => {
    const src = read(...p);
    return src.match(/readOr503\(\s*"([^"]+)"/)?.[1] ?? "";
  });
  assert.ok(labels.every(Boolean), `라벨이 빈 라우트가 있다 — ${labels.join(",")}`);
  assert.equal(new Set(labels).size, labels.length, `라벨이 중복이다 — ${labels.join(",")}`);
});
