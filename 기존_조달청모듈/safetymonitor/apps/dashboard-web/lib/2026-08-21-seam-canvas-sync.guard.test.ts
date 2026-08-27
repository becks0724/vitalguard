// 이음새 배선도 가드 — 캔버스의 계약 문안이 docs 원본과 갈리면 빨개진다
//
// ★ 왜 필요한가. 캔버스를 만든 첫날 계약 문안을 손으로 옮겼더니 **같은 날 안에 갈렸다** —
//   `seams.md` 의 J 행에 "있어도 읽는 경로가 없으면 같은 결과다" 가 덧붙었는데 캔버스는
//   옛 문장 그대로였고, 사람이 전문 대조를 해서야 드러났다(앞 26자만 보던 첫 비교는 못 잡았다).
//   문서 둘이 같은 사실을 각자 적으면 반드시 갈린다. 그것을 사람 눈에 맡기지 않는다.
//
// ★ 이 가드가 초록일 때 보장하는 것(한 문장) —
//   **`docs/seams.md` 표 6열과 `docs/seams-callsites.md` 코드블록을 지금 다시 뽑으면
//   `index.html` 의 생성 구역과 한 글자도 다르지 않다.**
//   보장하지 않는 것 = 그 문안이 옳은가(그건 `seams.md` 쪽 문제다) · 캔버스가 화면에
//   제대로 그려지는가(그건 렌더로 봐야 한다).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { BEGIN, END, SEAM_IDS, TIERS, buildBlock, readSeamTable, sitesFor, readCallsites } from "../../../docs/seam-canvas/build.mjs";

const CANVAS = join(fileURLToPath(new URL("..", import.meta.url)), "..", "..", "docs", "seam-canvas", "index.html");
const html = readFileSync(CANVAS, "utf8");

/** 파일 안의 생성 구역만 잘라낸다. 못 찾으면 마커가 사라진 것이라 즉시 실패시킨다. */
const seamsMd = readFileSync(join(fileURLToPath(new URL("..", import.meta.url)), "..", "..", "docs", "seams.md"), "utf8");

/** 주석을 걷어낸 본문 — 이름만 찾는 단언은 주석에 이름이 남아도 통과한다([[L-104]]). */
function codeOnly(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
}

function generatedBlock(): string {
  const a = html.indexOf(BEGIN);
  const b = html.indexOf(END);
  assert.ok(a >= 0 && b > a, "생성 구역 마커가 없다 — build.mjs 가 더 이상 주입할 곳을 못 찾는다");
  return html.slice(a, b + END.length);
}

test("★ 캔버스 문안이 docs 원본과 한 글자도 안 갈렸다", () => {
  assert.equal(
    generatedBlock(),
    buildBlock(),
    "생성 구역이 낡았다 — `node docs/seam-canvas/build.mjs` 로 갱신할 것",
  );
});

test("★ 표의 모든 행을 다 읽었다 — 표 형식이 바뀌면 조용히 줄어들 수 있다", () => {
  // 파서가 몇 행을 놓쳐도 위 비교는 통과한다(양쪽 다 같은 파서를 쓰니까).
  // 그래서 개수는 따로 못 박는다 — 같은 파서로 두 번 재는 것의 맹점이다.
  const rows = readSeamTable();
  assert.equal(rows.size, SEAM_IDS.length, `seams.md 표에서 ${rows.size}행만 읽혔다`);
  for (const id of SEAM_IDS) {
    const r = rows.get(id);
    assert.ok(r, `${id} 행이 없다`);
    for (const k of ["name", "rt", "how", "where", "broken"] as const) {
      assert.ok(r[k] && r[k].length > 1, `${id} 행의 ${k} 가 비었다`);
    }
  }
});

test("★ 강도는 seams.md 가 유일한 원본이다 — 손 사본이 남아 있으면 실패한다", () => {
  // ⚠ 종전 가드는 `WIRING` 의 hard 를 리터럴 ["C","D","J"] 와 비교했다. **리터럴끼리의 비교라
  //   원본이 무엇으로 바뀌든 통과했다** — 08-21 에 A·B·H·K 에 가드가 붙었는데 그림은 넷 다
  //   "합의뿐" 으로 남았고 스위트는 4/4 초록이었다. 그래서 사본 자체를 없앴다.
  const code = codeOnly(html);
  assert.doesNotMatch(code, /\bhard\b/, "index.html 에 hard 가 남았다 — 강도 사본을 지우다 말았다");
  assert.doesNotMatch(code, /--hard|--soft|--mid/, "CSS 에 강도 색이 남았다 — 색 원본은 TIER_STYLE 뿐이어야 한다");
  // 색 리터럴은 생성 구역 안에만 있어야 한다(밖에 있으면 그것이 사본이다).
  // ⚠ 원본에서 블록을 먼저 들어내고 그 다음 주석을 걷는다. 순서를 바꾸면 주석이 지워진 본문에서
  //   주석이 든 블록을 찾게 돼 아무것도 안 지워지고, 가드가 자기 자신을 잡는다(실제로 그랬다).
  const outside = codeOnly(html.replace(generatedBlock(), ""));
  for (const hex of Object.values(TIERS).map((t) => t.color)) {
    assert.ok(!outside.includes(hex), `${hex} 가 생성 구역 밖에 있다 — 손 사본이다`);
  }
});

/**
 * 결론문에서 각 단의 이음새 나열을 뽑는 자리. **파생이 아니라 대조용**이다 —
 * 못 찾으면 기본값으로 흘리지 않고 즉시 실패시킨다([[L-104]] 의 반대쪽 안전판).
 */
const TIER_PROSE: Record<string, RegExp> = {
  런타임: /런타임에 값을 검사하는 것은 ([A-M·]+) 만이다/,
  커밋: /층\(값이 아니라 코드 형태를 검사한다\)은 ([A-M·]+) 다/,
  없음: /나머지\(([A-M·]+)\)는/,
};

test("★ 모든 행이 아는 토큰이고, 3단 전부가 seams.md 결론문과 일치한다", () => {
  const rows = readSeamTable(); // 모르는 토큰이면 여기서 이미 throw 다
  const names = Object.keys(TIERS);
  for (const [id, r] of rows) {
    assert.ok(names.includes(r.tier), `${id} 의 강도 "${r.tier}" 가 3단 밖이다`);
  }
  // ⚠ 종전 가드는 **런타임 단만** 결론문과 대조했다. 그 사이 표는 G·H 를 `커밋` 으로 올렸는데
  //   결론문은 둘을 여전히 합의 층에 적고 있었고, 스위트는 초록이었다(08-27 발견). 그래서
  //   3단 전부를 대조한다 — 대조하지 않는 단이 곧 낡는 단이다.
  const flat = seamsMd.replace(/\s+/g, " ");
  for (const [tier, re] of Object.entries(TIER_PROSE)) {
    const table = [...rows].filter(([, r]) => r.tier === tier).map(([id]) => id).sort();
    const listed = re.exec(flat)?.[1];
    // 못 찾으면 빈 목록으로 흘리지 않는다 — 그러면 문구가 바뀐 날 대조가 조용히 사라진다.
    if (!listed) assert.fail(`seams.md 결론문에서 "${tier}" 단 나열을 못 찾았다 — 문구가 바뀌었으면 이 규칙도 함께 고칠 것`);
    const prose = listed.split("·").map((x) => x.trim()).filter(Boolean).sort();
    assert.deepEqual(prose, table, `"${tier}" 단이 표=${table.join("·")} 결론문=${prose.join("·")} 로 갈렸다`);
  }
});

test("★ 3단이 화면 어디에도 빠짐없이 실린다", () => {
  const block = generatedBlock();
  for (const [tier, v] of Object.entries(TIERS)) {
    assert.ok(block.includes(`"${tier}": { short: ${JSON.stringify(v.short)}`), `${tier} 가 TIER_STYLE 에 없다`);
  }
  // 모르는 강도를 조용히 기본값으로 흘리면 그림이 거짓말을 한다.
  // ⚠ `throw new Error` 가 **어딘가 있다** 로는 부족하다 — 변이 시험에서
  //   `if (!t) return TIER_STYLE["없음"]; if (false) throw new Error` 가 그대로 통과했다([[L-104]]).
  //   그래서 본문을 잘라내 ① 던지는 줄의 모양 ② 탈출구가 `return t` 하나뿐임을 따로 못 박는다.
  const code2 = codeOnly(html);
  const at = code2.indexOf("function tierOf(L)");
  assert.ok(at >= 0, "tierOf 가 없다 — 강도 조회가 다른 곳으로 옮겨졌다");
  const fn = code2.slice(at, code2.indexOf("\n  }", at));
  assert.match(fn, /if \(!t\) throw new Error\(/, "모르는 강도에서 던지지 않는다");
  const returns = fn.match(/\breturn\b/g) ?? [];
  assert.deepEqual(returns.length, 1, `tierOf 에 탈출구가 ${returns.length}개다 — 기본값 폴백이 끼었다`);
});

test("호출 지점 색인 — 있는 것은 싣고 없는 것은 0으로 남긴다", () => {
  const sections = readCallsites();
  // 있어야 하는 것: 워치↔폰(WCSession)은 하위 절에 코드블록이 달려 있다.
  // 상위 절 상속이 깨지면 여기서 0 이 되고, 화면에는 "색인에 없음" 이 조용히 뜬다.
  assert.ok(sitesFor("A", sections).length > 0, "A(워치→폰) 색인이 0건 — 상위 절 상속이 깨졌다");
  assert.ok(sitesFor("J", sections).length > 0, "J(서버→DB) 색인이 0건");
  // 없는 것: 텔레그램·Colab 은 실제로 색인에 없다. 0 도 사실이라 지어내지 않는다.
  assert.equal(sitesFor("K", sections).length, 0, "K 에 색인이 생겼다면 규칙을 채울 것");
  assert.equal(sitesFor("L", sections).length, 0, "L 은 사람이 파일을 옮기는 경로다 — 코드가 없다");
  // M(갤럭시워치 → 서버)은 `scripts/scan-seams.sh` 의 1-8 절에서 온다. 그 절 이름이 바뀌거나
  // Kotlin 조회가 눈멀면 여기서 0 이 되고, 화면에는 "색인에 없음" 이 조용히 뜬다([[L-112]]).
  assert.ok(sitesFor("M", sections).length > 0, "M(갤럭시워치→서버) 색인이 0건 — 1-8 절을 확인할 것");
});

test("★ 머리말·요지에 손으로 적은 셈이 없다", () => {
  // 08-21 판은 "런타임 4 · 이음새 12 · 코드로 강제 3/12" 와 "12곳 중 셋뿐 · C·D·J" 를 손으로
  // 들고 있었고, Kotlin 이 늘고 강도가 3단이 된 뒤에도 그대로 남아 그림과 다른 말을 했다.
  const outside = codeOnly(html.replace(generatedBlock(), ""));
  assert.doesNotMatch(outside, /\d+\s*곳 중/, "요지에 이음새 수가 박혀 있다 — LINKS.length 에서 낼 것");
  assert.doesNotMatch(outside, /<dd>\s*\d/, "머리말 tally 에 숫자가 박혀 있다 — 데이터에서 낼 것");
  assert.doesNotMatch(outside, /\b[A-M] · [A-M] · [A-M]\b/, "요지에 이음새 나열이 박혀 있다 — 강도에서 낼 것");
});
