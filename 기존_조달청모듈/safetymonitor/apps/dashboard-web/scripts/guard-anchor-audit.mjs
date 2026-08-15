// 가드 앵커 감사 — 금지형 가드가 "대상이 사라져도 통과"하지 않는지 (가드, 소스) 쌍마다 검사한다.
//
// 왜 필요한가(교훈 L-79) — `assert.doesNotMatch(소스, /금지패턴/)` 은 **참조가 사라진 상황에서도
// 참**이다. 파일이 없어지면 readFileSync 가 던져 걸리지만, 내용이 다른 파일로 옮겨가거나 심볼
// 이름이 바뀌면 가드는 아무것도 못 찾은 채 초록으로 남고 그 사이 금지된 값이 판정에 들어간다.
// 2026-08-15 전수 감사에서 8쌍이 이 상태였고 전부 판정·알림 경로였다(severity·weather-rules·store).
//
// 방법 — fs.readFileSync 를 스택 기반으로 가로채 **그 소스 하나만** 빈 문자열로 돌려준다.
// 파일을 건드리지 않으므로 병렬 세션이 쓰는 공유 워킹트리에서도 안전하다.
// 그 소스를 비웠는데 가드가 전부 통과하면 = 그 소스에는 앵커가 없다.
//
// 실행 — node scripts/guard-anchor-audit.mjs   (앵커 없는 쌍이 있으면 exit 1)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const out = (s) => process.stdout.write(s);

// 트리 전체를 훑는 스캔형 가드는 소스 단위 감사 대상이 아니다 — 스캔 바닥은 가드 자체가 단언한다.
const SCAN_STYLE = new Set(["client-ip.guard.test.ts"]);

// [READ] 를 stdout 으로 낸다 — execFileSync 가 성공 시 stdout 만 돌려주므로 한 경로로 통일된다.
const PRELOAD = `
import fs from "node:fs";
const GUARD = process.env.GUARD_FILE, TARGET = process.env.BLANK_ONLY ?? "", LIST = process.env.LIST_ONLY === "1";
const EXT = /\\.(ts|tsx|swift|sql|mjs|js|jsx)$/;
const real = fs.readFileSync, seen = new Set();
fs.readFileSync = function (t, ...rest) {
  const p = typeof t === "string" ? t : String(t ?? "");
  if ((new Error().stack ?? "").includes(GUARD) && EXT.test(p) && !p.includes("node_modules") && !p.endsWith(GUARD)) {
    seen.add(p);
    if (!LIST && p === TARGET) {
      const e = rest[0];
      return (typeof e === "string" || (e && typeof e === "object" && e.encoding)) ? "" : Buffer.alloc(0);
    }
  }
  return real.call(this, t, ...rest);
};
process.on("exit", () => { if (LIST) for (const p of seen) process.stdout.write("[READ] " + p + "\\n"); });
`;
const preload = join(mkdtempSync(join(tmpdir(), "guard-audit-")), "blank-one.mjs");
writeFileSync(preload, PRELOAD);

// 가드를 한 번 돌리고 stdout 을 돌려준다. 테스트 실패는 비정상 종료로 오므로 그때도 출력을 쓴다.
function runGuard(file, env) {
  try {
    return execFileSync("npx", ["tsx", "--import", preload, "--test", file], {
      encoding: "utf8",
      env: { ...process.env, GUARD_FILE: file.split("/").pop(), LIST_ONLY: "", BLANK_ONLY: "", ...env },
    });
  } catch (e) {
    return e.stdout ?? "";
  }
}

const guards = [
  ...readdirSync(join(ROOT, "lib")).filter((f) => f.endsWith(".guard.test.ts")).map((f) => `lib/${f}`),
  ...readdirSync(join(ROOT, "app/api/mock")).filter((f) => f.endsWith(".guard.test.ts")).map((f) => `app/api/mock/${f}`),
];

let anchored = 0;
const missing = [];
for (const guard of guards) {
  if (SCAN_STYLE.has(guard.split("/").pop())) continue;
  const sources = [...new Set(
    runGuard(guard, { LIST_ONLY: "1" })
      .split("\n")
      .filter((l) => l.startsWith("[READ] "))
      .map((l) => l.slice(7).trim()),
  )];
  for (const src of sources) {
    const fail = /^ℹ fail (\d+)$/m.exec(runGuard(guard, { BLANK_ONLY: src }))?.[1];
    const rel = src.startsWith(ROOT) ? src.slice(ROOT.length + 1) : src;
    if (fail === "0") missing.push([guard.split("/").pop(), rel]);
    else anchored += 1;
  }
}

out(`앵커있음 ${anchored} · 앵커없음 ${missing.length}\n`);
for (const [g, s] of missing) out(`★ ${g.padEnd(50)} ${s}\n`);
if (missing.length > 0) {
  out("\n금지 검사 앞에 그 소스가 검사 대상임을 단언하는 앵커(match)를 같은 테스트에 둘 것 — L-79\n");
  process.exit(1);
}
