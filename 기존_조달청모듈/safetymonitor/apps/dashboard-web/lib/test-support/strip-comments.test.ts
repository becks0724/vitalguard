// 주석 제거기 자기 시험 — 특히 **URL 을 먹지 않는가**([[L-119]]).
//
// 이 파일이 지키는 한 문장.
//   "주석만 지우고 문자열 리터럴은 한 글자도 건드리지 않는다 — 그래서 금지형 단언이
//    URL 과 같은 줄에 있는 금지 패턴을 놓치지 않는다."
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { stripComments } from "./strip-comments";

test("① URL 의 `//` 를 주석으로 오인하지 않는다", () => {
  const src = 'const u = "https://tiles.example.com/a/b.png";';
  assert.equal(stripComments(src).trim(), src, "문자열 안의 // 를 먹었다 — 코드가 잘렸다");
});

test("② 진짜 줄 주석은 지운다", () => {
  const out = stripComments('const a = 1; // 설명에 forbiddenToken 이 나온다');
  assert.match(out, /const a = 1;/, "코드까지 지웠다");
  assert.doesNotMatch(out, /forbiddenToken/, "주석이 안 지워졌다 — 설명문이 가드를 잡는다");
});

test("③ ★ 금지 패턴이 URL 뒤 같은 줄에 있어도 살아남는다 — 거짓 초록 방지", () => {
  // 이것이 순진한 정규식이 조용히 틀리던 자리다. 금지 패턴이 URL 과 함께 증발하면
  // `assert.doesNotMatch` 가 통과해 **결함이 규범이 된다**.
  const src = 'const u = "https://x.example.com/"; dangerousCall();';
  assert.match(stripComments(src), /dangerousCall\(\)/, "금지 패턴이 URL 과 함께 증발했다");
});

test("④ 블록 주석과 따옴표 3종·이스케이프", () => {
  assert.doesNotMatch(stripComments("a; /* 지워질 것 */ b;"), /지워질 것/, "블록 주석이 남았다");
  assert.match(stripComments(`const s = '//not-a-comment';`), /not-a-comment/, "홑따옴표 안이 잘렸다");
  assert.match(stripComments("const s = `//not-a-comment`;"), /not-a-comment/, "백틱 안이 잘렸다");
  assert.match(stripComments('const s = "a\\"//b"; keep();'), /keep\(\)/, "이스케이프된 따옴표에서 상태가 꼬였다");
});
