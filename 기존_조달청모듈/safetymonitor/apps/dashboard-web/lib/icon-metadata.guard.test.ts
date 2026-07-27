// 구조적 재발 방지(교훈 L-16) — 파비콘/아이콘 메타데이터가 조용히 무효화되는 것을 차단한다.
//
// Next.js App Router 의 두 가지 함정을 실측으로 확인했다(2026-07-27, dev 서버 head grep).
//  ① 같은 base name 이면 하나만 emit 된다 — app/icon.png 와 app/icon.svg 가 같이 있으면
//     png 만 나가고 svg 는 통째로 무시된다(파일을 뒀으니 반영됐다고 착각하게 된다).
//  ② metadata.icons 를 선언하면 파일 컨벤션 app/icon.*·app/apple-icon.* 링크가 **전부** 사라진다.
//     실제로 apple-touch-icon 이 조용히 빠지는 회귀가 났다.
//
// 그래서 아이콘은 "파일만 두는" 방식과 "metadata.icons 로 명시하는" 방식 중 하나로 통일하고,
// 명시 방식일 때는 apple 재명시와 실제 파일 존재를 여기서 강제한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LAYOUT = join(ROOT, "app/layout.tsx");

/** app/ 루트의 파일 컨벤션 아이콘(icon.*, apple-icon.*) 목록. */
function conventionIcons(prefix: "icon" | "apple-icon"): string[] {
  return readdirSync(join(ROOT, "app")).filter((n) =>
    new RegExp(`^${prefix}\\d?\\.(ico|jpg|jpeg|png|svg)$`).test(n),
  );
}

/** layout.tsx 의 metadata.icons 블록 원문. 선언이 없으면 null. */
export function iconsBlock(source: string): string | null {
  const start = source.indexOf("icons:");
  if (start === -1) return null;
  const end = source.indexOf("\n};", start);
  return source.slice(start, end === -1 ? undefined : end);
}

/** 블록 안의 url: "…" 을 전부 뽑는다. */
export function iconUrls(block: string): string[] {
  return [...block.matchAll(/url:\s*["']([^"']+)["']/g)].flatMap((m) => (m[1] ? [m[1]] : []));
}

/** 아이콘 URL 이 실제 파일로 존재하는가. public/ 정적 파일 또는 app/ 파일 컨벤션 라우트. */
function resolves(url: string): boolean {
  const rel = url.replace(/^\//, "").split("?")[0] ?? "";
  return existsSync(join(ROOT, "public", rel)) || existsSync(join(ROOT, "app", rel));
}

const source = readFileSync(LAYOUT, "utf8");
const block = iconsBlock(source);

test("아이콘 선언 방식이 하나로 통일돼 있다 — metadata.icons 와 app/icon.* 혼용 금지", () => {
  const files = conventionIcons("icon");
  if (block) {
    assert.deepEqual(
      files,
      [],
      `metadata.icons 를 선언하면 app/icon.* 은 emit 되지 않는다(죽은 파일). public/ 로 옮기고 metadata 에 명시할 것: ${files.join(", ")}`,
    );
  } else {
    assert.ok(
      files.length <= 1,
      `app/icon.* 이 여럿이면 하나만 emit 된다(png 가 svg 를 가림). 하나만 남길 것: ${files.join(", ")}`,
    );
  }
});

test("metadata.icons 선언 시 apple-touch-icon 을 재명시한다(iOS 홈화면 아이콘 회귀 방지)", () => {
  if (!block) return; // 파일 컨벤션 방식이면 app/apple-icon.png 가 자동 emit 된다.
  assert.match(
    block,
    /\bapple\s*:/,
    "metadata.icons 를 선언하면 app/apple-icon.png 링크가 사라진다. icons.apple 을 함께 명시할 것",
  );
});

test("선언된 아이콘 URL 이 실제 파일로 존재한다", () => {
  if (!block) return;
  const missing = iconUrls(block).filter((u) => !resolves(u));
  assert.deepEqual(missing, [], `참조하는 아이콘 파일이 없다(깨진 파비콘): ${missing.join(", ")}`);
});

// 가드 자체가 동작하는지 고정 — 통과만 확인하면 "아무것도 검사하지 않는 테스트"를 통과로 착각한다(L-12 방식).
test("가드 파서가 icons 블록과 url 을 실제로 잡는다", () => {
  const sample = `export const metadata: Metadata = {\n  title: "t",\n  icons: {\n    icon: [{ url: "/a.png" }, { url: '/b.svg' }],\n    apple: [{ url: "/c.png" }],\n  },\n};\n`;
  const b = iconsBlock(sample);
  assert.ok(b, "icons 블록 미검출");
  assert.deepEqual(iconUrls(b!), ["/a.png", "/b.svg", "/c.png"]);
  assert.match(b!, /\bapple\s*:/);
  assert.equal(iconsBlock(`export const metadata: Metadata = {\n  title: "t",\n};\n`), null);
});

test("가드가 현재 레포 상태를 실제로 검사하고 있다(빈 통과 방지)", () => {
  // 현재는 metadata.icons 방식이다. 방식이 바뀌면 이 단언이 먼저 깨져 위 테스트들의 전제를 다시 보게 한다.
  assert.ok(block, "app/layout.tsx 에 metadata.icons 선언이 없다 — 아이콘 전략이 바뀌었는지 확인할 것");
  assert.ok(iconUrls(block!).length >= 3, "테마별 아이콘(다크·라이트·SVG)이 최소 3개여야 한다");
});
