// CCTV 현장·카메라 최초 등록 — 한 번만 돌린다. 기본은 시험(ROLLBACK)이고, 커밋은 --commit 일 때만.
//
// 왜 스크립트인가 — 카메라 목록은 지금까지 프런트 상수였고 서버는 카메라를 몰랐다. 티켓 발급이
// "어느 현장의 어느 카메라인가"를 서버에서 판정하려면 대장이 있어야 한다. 스키마 초기화에
// 데이터를 넣지 않는 이유는, 스키마는 멱등이어도 데이터 시드는 운영 판단이기 때문이다.
//
// 사용
//   node scripts/seed-cctv-site.mjs                 # BEGIN → 실행 → ROLLBACK (확인만)
//   node scripts/seed-cctv-site.mjs --commit        # 실제로 기록
//
// ⚠ SITE-01 은 시험 현장이라 open_to_approved=true 다 — 가입 승인된 사용자면 볼 수 있다.
//    실 현장을 추가할 때는 반드시 false 로 두고 cctv_site_role 에 사람을 명시한다.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// pg 는 워크스페이스 패키지(apps/dashboard-web)에 있다 — 저장소 루트에서 실행해도 찾도록 한다.
const pg = createRequire(
  path.join(process.cwd(), "apps", "dashboard-web", "package.json"),
)("pg");

const COMMIT = process.argv.includes("--commit");

const SITES = [
  { siteId: "SITE-01", label: "시험 현장", openToApproved: true },
];
const CAMERAS = [
  { cameraId: "CAM-03", siteId: "SITE-01", label: "현장 작업구역(GoPro)" },
];

// ★ 표를 만드는 코드(ensureSchema)가 아직 배포되지 않았을 수 있다. 그래서 여기서 먼저 만든다.
//   문장을 손으로 옮겨 적지 않고 lib/db.ts 에서 그대로 뽑는다 — 두 벌이 되면 반드시 어긋난다.
//   전부 CREATE TABLE IF NOT EXISTS 라 배포 뒤 ensureSchema 가 다시 돌아도 아무 일도 하지 않는다.
const CCTV_TABLES = ["cctv_site", "cctv_camera", "cctv_site_role", "cctv_ticket_audit"];

function cctvDdl() {
  const src = fs.readFileSync(
    path.join(process.cwd(), "apps", "dashboard-web", "lib", "db.ts"), "utf8");
  const nowIso = `to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  const out = CCTV_TABLES.map((t) => {
    const m = src.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\([\\s\\S]*?\\n    \\);`));
    if (!m) throw new Error(`${t} 의 DDL 을 lib/db.ts 에서 찾지 못했다 — 형식이 바뀌었는지 확인할 것`);
    return m[0].replaceAll("${NOW_ISO}", nowIso);
  });
  const idx = src.match(/CREATE INDEX IF NOT EXISTS idx_cctv_audit_user[^;]*;/);
  if (!idx) throw new Error("감사 인덱스 DDL 을 찾지 못했다");
  out.push(idx[0]);
  return out;
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.join(process.cwd(), "apps", "dashboard-web", ".env.local");
  const line = fs.existsSync(envFile)
    ? fs.readFileSync(envFile, "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="))
    : null;
  if (!line) throw new Error("DATABASE_URL 을 찾지 못했다 (환경변수 또는 .env.local)");
  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

const client = new pg.Client({ connectionString: databaseUrl(), statement_timeout: 15000 });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '3s'");

  const before = await client.query(
    `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1)`,
    [CCTV_TABLES],
  );
  const ddl = cctvDdl();
  for (const s of ddl) await client.query(s);
  console.log(`표 ${before.rows[0].n}/${CCTV_TABLES.length}개가 이미 있었고, DDL ${ddl.length}문장을 적용했다`);

  for (const s of SITES) {
    await client.query(
      `INSERT INTO cctv_site (site_id, label, open_to_approved) VALUES ($1,$2,$3)
       ON CONFLICT (site_id) DO UPDATE
         SET label = EXCLUDED.label, open_to_approved = EXCLUDED.open_to_approved`,
      [s.siteId, s.label, s.openToApproved],
    );
  }
  for (const c of CAMERAS) {
    await client.query(
      `INSERT INTO cctv_camera (camera_id, site_id, label) VALUES ($1,$2,$3)
       ON CONFLICT (camera_id) DO UPDATE
         SET site_id = EXCLUDED.site_id, label = EXCLUDED.label`,
      [c.cameraId, c.siteId, c.label],
    );
  }

  const rows = await client.query(
    `SELECT c.camera_id, c.site_id, s.label AS site_label, s.open_to_approved
       FROM cctv_camera c JOIN cctv_site s ON s.site_id = c.site_id
      ORDER BY c.camera_id`,
  );
  console.log("등록 결과");
  for (const r of rows.rows) {
    console.log(
      `  ${r.camera_id} → ${r.site_id} (${r.site_label}) · 승인자 공개 ${r.open_to_approved}`,
    );
  }

  // 이 설정에서 실제로 몇 명이 보게 되는지 — 숫자를 보고 커밋한다.
  const who = await client.query(
    `SELECT count(*)::int AS n FROM users WHERE status = 'approved'`,
  );
  console.log(`\n이 설정에서 볼 수 있는 사람 = 가입 승인자 ${who.rows[0].n}명 (+ owner)`);
  console.log("  ⚠ 연결 ON/OFF 는 아무도 못 한다 — control 은 cctv_site_role 에 명시해야 나온다");

  if (COMMIT) {
    await client.query("COMMIT");
    console.log("\n✅ 기록했다 (COMMIT)");
  } else {
    await client.query("ROLLBACK");
    console.log("\n↩︎ 되돌렸다 (ROLLBACK) — 실제로 넣으려면 --commit");
  }
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("실패 — 되돌렸다:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
