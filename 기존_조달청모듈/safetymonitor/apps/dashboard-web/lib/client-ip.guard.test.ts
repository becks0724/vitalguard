// 구조적 재발 방지(교훈 L-12) — X-Forwarded-For 파서가 lib/client-ip.ts 밖에 생기면 실패시킨다.
// 과거 같은 규칙을 3곳이 각자 구현했고 그중 2곳이 틀려 우회 취약점이 됐다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIRS = ["lib", "app"];
const ALLOWED = new Set(["lib/client-ip.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

test("X-Forwarded-For 파싱은 lib/client-ip.ts 에만 존재한다", () => {
  const offenders: string[] = [];
  for (const d of SCAN_DIRS) {
    for (const file of walk(join(ROOT, d))) {
      const rel = file.slice(ROOT.length);
      if (ALLOWED.has(rel) || rel.includes(".test.")) continue;
      if (/["']x-forwarded-for["']/i.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `XFF 를 직접 파싱하는 파일이 있다. lib/client-ip.ts 의 clientIpFromRequest 를 쓸 것: ${offenders.join(", ")}`,
  );
});
