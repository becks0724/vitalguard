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

import { BEGIN, END, buildBlock, readSeamTable, sitesFor, readCallsites } from "../../../docs/seam-canvas/build.mjs";

const CANVAS = join(fileURLToPath(new URL("..", import.meta.url)), "..", "..", "docs", "seam-canvas", "index.html");
const html = readFileSync(CANVAS, "utf8");

/** 파일 안의 생성 구역만 잘라낸다. 못 찾으면 마커가 사라진 것이라 즉시 실패시킨다. */
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

test("★ 12행을 다 읽었다 — 표 형식이 바뀌면 조용히 줄어들 수 있다", () => {
  // 파서가 몇 행을 놓쳐도 위 비교는 통과한다(양쪽 다 같은 파서를 쓰니까).
  // 그래서 개수는 따로 못 박는다 — 같은 파서로 두 번 재는 것의 맹점이다.
  const rows = readSeamTable();
  assert.equal(rows.size, 12, `seams.md 표에서 ${rows.size}행만 읽혔다`);
  for (const id of "ABCDEFGHIJKL") {
    const r = rows.get(id);
    assert.ok(r, `${id} 행이 없다`);
    for (const k of ["name", "rt", "how", "where", "broken"] as const) {
      assert.ok(r[k] && r[k].length > 1, `${id} 행의 ${k} 가 비었다`);
    }
  }
});

test("★ 코드가 강제하는 셋(C·D·J)만 초록으로 그린다", () => {
  // 선 색이 이 자료의 요지를 나른다. 배선의 `hard` 가 seams.md 의 결론과 갈리면
  // 그림이 사실과 다른 말을 하게 된다 — 그리고 그 어긋남은 화면으로는 안 보인다.
  const wiring = /const WIRING = \[([\s\S]*?)\n {2}\];/.exec(html);
  const body = wiring?.[1];
  assert.ok(body, "WIRING 배열을 못 찾았다 — 배선이 옮겨졌거나 형식이 바뀌었다");
  const hard = [...body.matchAll(/id: "([A-L])", map: "."[^}]*hard: (true|false)/g)]
    .filter((m) => m[2] === "true")
    .map((m) => m[1])
    .sort();
  assert.deepEqual(hard, ["C", "D", "J"], `강제 이음새가 ${hard.join("·")} 로 바뀌었다`);

  const md = readFileSync(join(fileURLToPath(new URL("..", import.meta.url)), "..", "..", "docs", "seams.md"), "utf8");
  assert.match(md, /C·D·J 만/, "seams.md 의 결론 문장이 바뀌었다 — 어느 쪽이 맞는지 사람이 정할 것");
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
});
