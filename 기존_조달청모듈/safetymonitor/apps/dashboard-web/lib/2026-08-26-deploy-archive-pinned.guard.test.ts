// 배포 아카이브 고정 가드 — 이미지가 "이름(HEAD)" 이 아니라 "값(커밋 SHA)" 으로 정해지는가.
//
// 무엇이 문제였나. 배포 스크립트는 시작에서 `SHA=$(git rev-parse HEAD)` 로 커밋을 떠서 그것을
// **이미지 라벨(`commit-sha`)** 로 붙이는데, 정작 아카이브는 `git archive "HEAD:..."` 로 만들었다.
// `HEAD` 는 이름이라 읽을 때마다 다른 커밋을 가리킬 수 있다 — 두 지점 사이(상태 검사·배포 범위
// 산출로 수 초~수십 초) 병렬 세션이 커밋하면 **라벨은 옛 커밋인데 이미지는 새 커밋**이 된다.
//
// 왜 치명적인가. `commit-sha` 라벨은 "이 이미지가 무엇이냐" 를 나중에 판정하는 **유일한 근거**다
// ([[L-33]] — 서빙 digest 대조의 상대). 그것이 거짓이면 배포 이력 전체가 거짓이 된다.
//
// 2026-08-26 배포에서는 옆 세션에 **커밋 홀드를 부탁해서** 막았다. 사람의 협조는 구조가 아니다.
// 이 레포는 세 세션이 한 워킹트리에 붙어 있고, 그날 실제로 옆 세션이 미커밋 11건을 들고 작업
// 중이었다. 대조로는 못 닫는다 — 검사와 아카이브 사이가 임계 구간이라 [[L-31]] 과 같은 모양이다.
//
// ★ 이 가드의 한 문장 보장.
//   "빌드에 들어가는 트리는 **라벨과 같은 커밋**에서 나온다 — 이름을 다시 읽지 않는다."
//
// 판별력 실증(2026-08-26 · 같은 레포 두 커밋으로 실측) — ref 선택은 실제로 내용을 가른다.
//   4017259:<subtree>  9,871,360 바이트 · tree 09caa77a…
//   HEAD    :<subtree>  9,984,000 바이트 · tree 3d68c5f0…
// 즉 이 한 줄이 틀리면 112KB 어치 다른 이미지가 같은 라벨을 달고 나간다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)); // apps/dashboard-web
const sh = readFileSync(join(ROOT, "..", "..", "scripts", "deploy-dashboard.sh"), "utf8");

/** 주석을 걷은 실코드 — 근거 서술에 적힌 `HEAD` 가 단언을 오염시키지 않게. */
const code = sh
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

test("① ★ 아카이브가 이름이 아니라 값을 쓴다", () => {
  const line = code.match(/^git .*archive .*\| tar -x/m)?.[0] ?? "";
  assert.ok(line, "아카이브 줄을 못 찾았다 — 가드 재작성 필요");
  assert.match(line, /archive "\$SHA:/, `아카이브가 고정 SHA 를 안 쓴다 — ${line}`);
  assert.doesNotMatch(
    line,
    /archive "HEAD:/,
    "아카이브가 HEAD 로 되돌아갔다 — 라벨과 이미지가 어긋날 수 있다",
  );
});

test("② SHA 는 아카이브보다 먼저 떠 둔 값이다", () => {
  // 순서가 뒤집히면 "먼저 뜬 값" 이라는 전제가 깨진다(같은 줄에서 다시 읽는 것과 같아진다).
  //
  // ⚠ 2026-08-28 에 단언을 **리터럴에서 계약으로** 되돌렸다. 원래는 `SHA=$(git rev-parse HEAD)` 를
  //   글자 그대로 찾았는데, APPROVED_AT 고정이 들어오며 대입 형태가 갈라져 빨간불이 났다.
  //   [[L-123]]③ 대로 "왜 빨개졌나" 를 물었고 답은 **부순 것이 아니라 고친 것** 이었다 —
  //   이 시험의 계약은 위 한 줄("먼저 떠 둔 값")이지 특정 표현이 아니다. 그래서 대입이 몇 개로
  //   갈리든 **전부** 아카이브 앞에 있는지로 단언한다(하나라도 뒤에 있으면 고정이 깨진다).
  const iArc = code.search(/^git .*archive "\$SHA:/m);
  assert.ok(iArc >= 0, "고정 아카이브가 사라졌다");
  const assigns = [...code.matchAll(/^\s*SHA=/gm)].map((m) => m.index ?? -1);
  assert.ok(assigns.length > 0, "SHA 캡처가 사라졌다");
  for (const i of assigns) {
    assert.ok(i < iArc, "SHA 를 아카이브 뒤에서 대입한다 — 고정의 의미가 없다");
  }
});

test("③ ★ 라벨과 아카이브가 같은 변수에서 나온다", () => {
  // 둘이 다른 출처면 이 가드가 초록인 채로도 어긋날 수 있다 — 양 끝을 함께 묶는다([[L-115]]③).
  //
  // ⚠ 2026-08-28 변이 시험이 이 단언의 결함을 잡았다. 원래 정규식은 따옴표 없는
  //   `commit-sha=$SHA` 만 찾았는데 **실제 배포 줄은 `commit-sha="$SHA"` 로 따옴표가 있다** —
  //   그래서 매칭된 것은 DRY_RUN 안내 출력 줄이었고, 진짜 배포 줄의 변수를 바꿔도 초록이었다.
  //   [[L-101]] 계열(단언이 엉뚱한 대상을 가리킨다)이고, **전수로 바꿔** 두 자리를 다 묶는다.
  const labels = [...code.matchAll(/--update-labels commit-sha="?\$\{?(\w+)/g)].map((m) => m[1]);
  assert.ok(labels.length > 0, "commit-sha 라벨 부착이 사라졌다");
  // 실배포 줄과 DRY_RUN 안내 줄 둘 다 — 안내가 실제와 다르면 그것도 거짓말이다.
  assert.ok(labels.length >= 2, `라벨 부착 자리가 ${labels.length}곳 — 실배포·DRY_RUN 둘을 다 못 찾았다`);
  for (const l of labels) {
    assert.equal(l, "SHA", `라벨이 SHA 가 아닌 ${l} 에서 나온다`);
  }
});

test("④ 근거가 코드에 남아 있다 — 다음 사람이 HEAD 로 되돌리지 않게", () => {
  // 이유 없이 `$SHA` 만 있으면 "HEAD 가 더 읽기 쉽다" 며 되돌린다. 실제로 그렇게 되돌아간 자리다.
  //
  // ⚠ 창을 **그 아카이브 줄에 붙은 주석 블록으로** 좁힌다. 처음엔 "앞 1200자" 로 잡았는데
  //   `병렬 세션` 이 이 파일에 6번 나와서(5·60·86·91·93·108행) 주석을 지워도 위쪽 것을 주워
  //   초록이 됐다 — 변이 시험에서 실측으로 잡혔다([[L-104]] 약한 단언). 창이 넓으면 단언이
  //   가리키는 대상이 바뀐다.
  const iArc = sh.indexOf('archive "$SHA:');
  const iSay = sh.lastIndexOf('say "1/5', iArc);
  assert.ok(iSay >= 0 && iSay < iArc, "1/5 구간 머리를 못 찾았다 — 가드 재작성 필요");
  const block = sh.slice(iSay, iArc);

  assert.match(block, /L-116/, "L-116⑥ 참조가 사라졌다");
  // 유일 문구로 앵커한다 — 이 파일 전체에서 한 번만 나오는 표현이라 창이 새도 오검출되지 않는다.
  assert.match(block, /이름이라/, "왜 위험한지(HEAD 는 이름이라 다시 읽힌다)가 사라졌다");
  assert.match(block, /라벨은 \$SHA 인데/, "어긋남의 구체적 형태(라벨≠이미지) 서술이 사라졌다");
});
