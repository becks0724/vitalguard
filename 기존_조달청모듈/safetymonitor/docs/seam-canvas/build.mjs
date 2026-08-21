// 이음새 배선도의 문안·색인을 docs 두 파일에서 뽑아 index.html 의 생성 구역에 주입한다
//
// ★ 왜 필요한가. 캔버스를 처음 만들 때 계약 문안을 손으로 옮겼더니 **하루 만에 갈렸다** —
//   `seams.md` 의 J 행에 "있어도 읽는 경로가 없으면 같은 결과다" 가 덧붙었는데 캔버스는
//   옛 문장 그대로였다. 사본은 반드시 낡는다. 그래서 문안은 생성물로 바꾼다.
//
// 무엇을 나누는가.
//   생성  계약 문안(seams.md 표 6열) · 호출 지점 색인(seams-callsites.md)
//   수기  노드 좌표 · 포트 · 배선 방향 — 21개뿐이라 자동 배치가 오히려 읽기 나쁘다
//
//   $ node docs/seam-canvas/build.mjs          생성 구역을 다시 씀
//   $ node docs/seam-canvas/build.mjs --check  갈렸으면 1 로 종료(가드가 이걸 쓴다)
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(HERE, "..");
const PAGE = join(HERE, "index.html");

export const BEGIN = "  // <<< 생성 구역 시작 — build.mjs 가 씁니다. 손으로 고치지 마십시오 >>>";
export const END = "  // <<< 생성 구역 끝 >>>";

/** 마크다운 강조를 캔버스가 쓰는 인라인 태그로. 그 밖의 마크업은 통과시키지 않는다. */
function md2html(t) {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

/** JS 문자열 리터럴로 안전하게. */
function q(s) {
  return JSON.stringify(s);
}

/**
 * 강도 3단 — `seams.md` 표의 `강도` 열이 유일한 원본이다.
 *
 * ★ 왜 열로 두는가. 종전에는 `index.html` 의 `WIRING` 이 `hard: true/false` 를 손으로 들고
 *   있었고, 가드는 그것을 리터럴 `["C","D","J"]` 와 비교했다. **리터럴끼리의 비교라 원본이
 *   무엇으로 바뀌든 통과했다** — 실제로 08-21 에 A·B·H·K 에 가드가 붙었는데 그림은 넷 다
 *   "합의뿐 — 어긋나도 조용하다" 로 남았고 스위트는 초록이었다. 사본을 없애는 것이 답이다.
 * ★ 왜 산문에서 파생하지 않는가. `계약이 사는 곳` 문안을 정규식으로 가르면 문구가 조금만
 *   바뀌어도 조용히 오분류된다([[L-104]]). 토큰이면 오타가 곧바로 throw 다.
 */
export const TIERS = {
  런타임: { short: "값을 검사", label: "코드가 값을 검사한다", color: "#3fb950" },
  커밋: { short: "게이트만", label: "커밋 게이트는 있다 — 현장 버전 어긋남은 못 본다", color: "#d9a441" },
  없음: { short: "합의뿐", label: "합의뿐 — 어긋나도 조용하다", color: "#d2a022" },
};

/** seams.md 의 A~L 표 — 7열. `강도` 와 6열 문안이 계약의 전부다. */
export function readSeamTable() {
  const md = readFileSync(join(DOCS, "seams.md"), "utf8");
  const rows = new Map();
  for (const line of md.split("\n")) {
    const m = /^\|\s*([A-L])\s*\|(.+)$/.exec(line);
    if (!m) continue;
    const cells = m[2].split("|").map((c) => c.trim());
    if (cells.length < 6) continue;
    const tier = cells[3];
    // 모르는 토큰을 기본값으로 흘려보내지 않는다 — 그러면 오타가 조용히 "없음" 으로 그려진다.
    if (!Object.hasOwn(TIERS, tier)) {
      throw new Error(`${m[1]} 행의 강도 "${tier}" 를 모른다 — 쓸 수 있는 값 = ${Object.keys(TIERS).join(" · ")}`);
    }
    rows.set(m[1], {
      name: cells[0],
      rt: cells[1],
      how: cells[2],
      tier,
      where: cells[4],
      broken: cells[5],
    });
  }
  if (rows.size !== 12) {
    throw new Error(`seams.md 표에서 12행을 못 읽었다 (읽은 수 ${rows.size}) — 표 형식이 바뀌었는지 확인할 것`);
  }
  return rows;
}

/** seams-callsites.md — 절 제목 → 그 아래 코드블록 줄들. */
export function readCallsites() {
  const md = readFileSync(join(DOCS, "seams-callsites.md"), "utf8");
  const sections = new Map();
  let h2 = null;
  let cur = null;
  let inFence = false;
  for (const line of md.split("\n")) {
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    if (h && !inFence) {
      cur = h[2].trim();
      if (h[1] === "##") h2 = cur;
      // ★ 코드블록이 하위 절(`### 현행 앱 …`)에 달려 있어도 상위 절 이름으로 찾을 수 있어야
      //   한다. 안 그러면 `## 2. WCSession` 규칙이 0건을 낸다(작성 중 실제로 그랬다).
      if (!sections.has(cur)) sections.set(cur, { parent: h[1] === "###" ? h2 : null, lines: [] });
      continue;
    }
    if (line.startsWith("```")) { inFence = !inFence; continue; }
    if (inFence && cur && line.trim()) sections.get(cur).lines.push(line.trim());
  }
  return sections;
}

/**
 * 이음새 → 색인 절 대응.
 *
 * ⚠ 색인은 **수단별**(HTTP·WCSession·채널·DB)로 묶여 있어 이음새와 1:1 이 아니다.
 *   그래서 절 이름을 함께 싣는다 — 독자가 "이 이음새 그 자체" 인지 "인접한 조각" 인지 가른다.
 * ⚠ 없는 것은 지어내지 않는다. K·L 은 실제로 색인에 없고, 그 사실이 정보다.
 */
const SITE_RULES = {
  A: [{ sec: /^2\. WCSession/ }],
  B: [{ sec: /^3\. Swift ↔ Dart 채널/ }],
  C: [{ sec: /^1-1\./, has: "api/app/vital" }],
  D: [{ sec: /^1-4\./ }],
  E: [{ sec: /^1-3\./ }],
  F: [{ sec: /^1-6\./ }],
  G: [{ sec: /^1-1\./, has: "api/app-media" }],
  H: [{ sec: /^1-5\./, has: "ncloudstorage" }],
  I: [{ sec: /^1-7\./ }],
  J: [{ sec: /^4\. DB 클라이언트/ }],
  K: [],
  L: [],
};

export function sitesFor(id, sections) {
  const out = [];
  for (const rule of SITE_RULES[id] ?? []) {
    for (const [name, s] of sections) {
      if (!rule.sec.test(name) && !(s.parent && rule.sec.test(s.parent))) continue;
      const picked = rule.has ? s.lines.filter((l) => l.includes(rule.has)) : s.lines;
      if (picked.length) out.push({ sec: s.parent ? `${s.parent} › ${name}` : name, lines: picked });
    }
  }
  return out;
}

export function buildBlock() {
  const table = readSeamTable();
  const sections = readCallsites();
  const parts = [];
  for (const id of "ABCDEFGHIJKL") {
    const r = table.get(id);
    const sites = sitesFor(id, sections);
    const siteJs = sites.length
      ? "[" + sites.map((s) => `{ sec: ${q(s.sec)}, lines: [${s.lines.map(q).join(", ")}] }`).join(", ") + "]"
      : "[]";
    parts.push(
      `    ${id}: { name: ${q(r.name)}, rt: ${q(r.rt)}, tier: ${q(r.tier)}, how: ${q(md2html(r.how))}, ` +
        `where: ${q(md2html(r.where))}, broken: ${q(md2html(r.broken))}, sites: ${siteJs} },`,
    );
  }
  const tierParts = Object.entries(TIERS).map(
    ([k, v]) => `    ${q(k)}: { short: ${q(v.short)}, label: ${q(v.label)}, color: ${q(v.color)} },`,
  );
  return [
    BEGIN,
    "  // 원본 = docs/seams.md 표(강도 포함) + docs/seams-callsites.md 코드블록",
    "  // ⚠ 색·문안도 여기서 나온다 — 손 사본을 두면 반드시 갈린다(그래서 WIRING 의 hard 를 없앴다).",
    "  const TIER_STYLE = {",
    ...tierParts,
    "  };",
    "  const SEAM_TEXT = {",
    ...parts,
    "  };",
    END,
  ].join("\n");
}

function splice(html, block) {
  const a = html.indexOf(BEGIN);
  const b = html.indexOf(END);
  if (a < 0 || b < 0) throw new Error("index.html 에서 생성 구역 마커를 못 찾았다");
  return html.slice(0, a) + block + html.slice(b + END.length);
}

/** 현재 파일의 생성 구역과, 지금 원본으로 만든 구역. 가드가 이 둘을 비교한다. */
export function currentVsBuilt() {
  const html = readFileSync(PAGE, "utf8");
  return { html, next: splice(html, buildBlock()) };
}

// ⚠ CLI 는 직접 실행할 때만 — import 만으로 파일을 쓰면 가드가 자기가 검사할 대상을 고친다.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { html, next } = currentVsBuilt();
  if (next === html) {
    console.log("생성 구역이 원본과 일치합니다 (변경 없음)");
  } else if (process.argv.includes("--check")) {
    console.error("★ 생성 구역이 docs 원본과 갈렸습니다 — `node docs/seam-canvas/build.mjs` 로 갱신하십시오");
    process.exit(1);
  } else {
    writeFileSync(PAGE, next);
    console.log("생성 구역 갱신 완료");
  }
}
