// 가드 테스트가 읽는 파일 전수 — "지금 이 파일을 만지면 스위트가 빨개지나" 에 답한다
//
// ★ 왜 필요한가(2026-08-21). 병렬 세션이 "앱만 만지니 대시보드 검증 범위 밖" 이라고 선언했는데
//   **틀렸다.** 이 레포의 가드는 트리를 가로질러 읽는다 — 대시보드 스위트가 앱 Swift·워치
//   Swift·docs 마크다운까지 연다. 그날은 타이밍 덕에 무해했지만 그것은 설계가 아니라 운이었다.
//   순서가 반대였으면 배포 선검증이 남의 반쪽 편집으로 빨개졌을 것이다.
//   ⟹ 보류 범위를 **디렉터리 감으로 잡지 말고 이 목록으로 잡는다.**
//
// ★ 추론하지 않는다. 가드는 경로를 `join(ROOT, "..", …)` 로 조립하고 ROOT 도 계산되므로
//   소스에서 맞히는 것은 추론이다. 실제로 실행시켜 연 파일을 관찰한다(guard-trace.mjs).
//
// ⚠ 산출물을 커밋하지 않는다. 커밋하면 낡고, 낡은 목록은 없느니만 못하다 — 그때그때 낸다.
//
// 사용법
//   scripts/guard-read-paths.mjs                 전체 목록(디렉터리별 묶음)
//   scripts/guard-read-paths.mjs --for <경로>    그 파일을 읽는가(레포 상대경로 또는 일부)
//   scripts/guard-read-paths.mjs --raw           평평한 경로 목록만
//
// 종료코드 0 = 정상. 1 = 통제군 실패(결과를 믿으면 안 된다).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const WEB = join(ROOT, "apps", "dashboard-web");

const args = process.argv.slice(2);
const forArg = args.includes("--for") ? args[args.indexOf("--for") + 1] : null;
const raw = args.includes("--raw");

// ── 실행 — 스위트를 한 번 돌리며 연 파일을 받아 적는다 ─────────────────────
const tmp = mkdtempSync(join(tmpdir(), "guard-read-"));
const out = join(tmp, "trace.txt");
const res = spawnSync(
  join(WEB, "node_modules", ".bin", "tsx"),
  ["--test", "lib/**/*.test.ts", "app/**/*.test.ts"],
  {
    cwd: WEB,
    env: {
      ...process.env,
      GUARD_TRACE_OUT: out,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${JSON.stringify(join(HERE, "guard-trace.mjs"))}`.trim(),
    },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
);

if (!existsSync(out)) {
  console.error("★ 추적 파일이 없다 — 훅이 안 얹혔다. 결과를 믿지 말 것.");
  console.error((res.stderr ?? "").slice(0, 800));
  rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}

const lines = readFileSync(out, "utf8").trim().split("\n").filter(Boolean);
rmSync(tmp, { recursive: true, force: true });

/**
 * 종류를 가른다 — 셋의 뜻이 다르고, 섞으면 목록이 쓸모없어진다.
 *
 *   readFileSync  **내용을 읽었다** → 그 파일을 고치면 가드 결과가 바뀔 수 있다. 이것이 본론.
 *   readdirSync   디렉터리를 훑었다 → 그 안 **어떤 파일이든** 새로 만들거나 고치면 걸릴 수 있다.
 *                 경로 나열로 안 접히므로 디렉터리 단위로 표기한다(옆 세션 지적).
 *   existsSync·statSync  존재만 봤다 → 순회 중 부산물이 대부분이라 본 목록에서 뺀다.
 *                 (처음엔 이것까지 섞어 608개가 나왔고, 그 목록은 아무 판단도 못 준다.)
 */
const paths = new Set();
const dirs = new Set();
const probed = new Set();
for (const line of lines) {
  const [kind, p] = line.split("\t");
  if (!p || !p.startsWith(ROOT)) continue;
  const rel = relative(ROOT, p);
  if (rel.startsWith("node_modules") || rel.includes("/node_modules/")) continue;
  if (rel.includes("/.next/") || rel.startsWith(".next/")) continue;
  if (kind === "readFileSync" || kind === "openSync") paths.add(rel);
  else if (kind === "readdirSync") dirs.add(rel);
  else probed.add(rel);
}

// ── 통제군 — 알려진 가드가 알려진 파일을 읽었는가 ─────────────────────────
// ⚠ 이것이 없으면 "0건" 이 **아무것도 안 읽는다** 로 조용히 오독된다. 이 레포가 정확히
//   그 형태로 당한 적이 있고(fs 몽키패치 무효), 이 도구도 처음엔 그 상태였다.
const CONTROLS = [
  ["apps/vitalguard_app/ios/Runner/LocationProvider.swift", "앱 Swift — 트리 가로지르기의 증거"],
  ["apps/dashboard-web/lib/db.ts", "대시보드 서버 코드"],
  ["docs/seams.md", "문서 — 마크다운도 읽는다"],
];
const missing = CONTROLS.filter(([p]) => !paths.has(p));
if (missing.length) {
  console.error("★ 통제군 실패 — 아래가 목록에 없다. 훅이 일부만 먹었거나 가드가 옮겨졌다.");
  for (const [p, why] of missing) console.error(`   ${p}   (${why})`);
  console.error("   결과 전체를 믿지 말 것.");
  process.exit(1);
}

// ── 출력 ──────────────────────────────────────────────────────────────────
if (forArg) {
  const hit = [...paths].filter((p) => p.includes(forArg));
  const dirHit = [...dirs].filter((d) => forArg.startsWith(d));
  if (hit.length || dirHit.length) {
    console.log(`⚠ 가드가 읽는다 — 지금 고치면 스위트가 빨개질 수 있다`);
    for (const h of hit) console.log(`   파일  ${h}`);
    for (const d of dirHit) console.log(`   디렉터리 전체  ${d}/`);
  } else {
    console.log(`✓ 가드 읽기 집합에 없다 — ${forArg}`);
  }
  process.exit(0);
}

if (raw) {
  for (const p of [...paths].sort()) console.log(p);
  process.exit(0);
}

// 기본 출력은 **요약**이다. 303개를 다 뿌리면 배포 직전에 읽을 수 없다 — 전체는 `--raw`.
// 놀라는 자리는 대시보드 밖이므로 그쪽만 전부 나열한다.
const OUTSIDE = "apps/dashboard-web/";
const outside = [...paths].filter((p) => !p.startsWith(OUTSIDE)).sort();
const inside = [...paths].filter((p) => p.startsWith(OUTSIDE));

console.log(`내용을 읽는 파일 ${paths.size}개 · 디렉터리 훑기 ${dirs.size}곳 (존재만 확인 ${probed.size}개는 제외)`);
console.log(`테스트 스위트 1회 실행 관찰 · node_modules·.next 제외\n`);

console.log(`── 트리를 가로지르는 것 ${outside.length}개 — 여기가 놀라는 자리다`);
console.log(`   "앱만 만지니 대시보드 검증 밖" 이 틀리는 이유가 이 목록이다.`);
for (const p of outside) console.log(`     ${p}`);

console.log(`\n── 대시보드 안쪽 ${inside.length}개 — 전체는 --raw`);
const tally = new Map();
for (const p of inside) {
  const parts = p.split("/").slice(2);
  // 최상위 파일(tsconfig.json 등)은 그 자체가 항목이다 — 뒤에 `/…` 를 붙이면 없는 폴더가 생긴다.
  const key = parts.length <= 1 ? parts[0] : parts.slice(0, 2).join("/") + "/…";
  tally.set(key, (tally.get(key) ?? 0) + 1);
}
for (const [key, n] of [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
  console.log(`     ${String(n).padStart(4)}  apps/dashboard-web/${key}`);
}

// 디렉터리 훑기는 최상위로 접는다 — 137줄을 그대로 뿌리면 요약이 아니다.
const dirRoots = new Set([...dirs].map((d) => d.split("/").slice(0, 3).join("/")));
console.log(`\n── 디렉터리 단위로 훑는 가드 — 경로 나열로 안 접힌다`);
console.log(`   그 아래 **어떤 파일이든** 새로 만들거나 고치면 걸릴 수 있다(${dirs.size}곳 → 뿌리 ${dirRoots.size}개)`);
for (const d of [...dirRoots].sort()) console.log(`     ${d}/**`);

console.log(`\n판정 = scripts/guard-read-paths.mjs --for <경로>`);
