// SafeProcure 스키마 정합성 introspection (읽기 전용).
// 라이브 DB의 safeprocure 스키마(컬럼/제약/인덱스/시드/산정로직)를 떠서
// db/integrated/vitalguard_safeprocure_full.sql 정의와 대조하기 위한 검증 도구.
//
//   ⚠ 자격증명은 환경변수 SRC_DSN 으로만 주입(코드/깃에 절대 하드코딩 금지).
//   실행:  SRC_DSN=<campus 접속 URL> node safeprocure-introspect.js   (URL은 env로만 — 코드/깃 금지)
//   동작:  SELECT 전용 — 운영 DB를 변경하지 않음.
const { Client } = require("pg");
if (!process.env.SRC_DSN) { console.error("SRC_DSN 미설정"); process.exit(1); }
const c = new Client({ connectionString: process.env.SRC_DSN });
const tabs = ["notice", "safety_cost_rate", "safety_cost_check", "risk_tag", "risk_profile"];
(async () => {
  await c.connect();
  console.log("=== COLUMNS (safeprocure) ===");
  for (const t of tabs) {
    const cols = (await c.query(
      `SELECT column_name,data_type,is_nullable,column_default
         FROM information_schema.columns
        WHERE table_schema='safeprocure' AND table_name=$1 ORDER BY ordinal_position`, [t])).rows;
    console.log("\n## " + t + " (" + cols.length + " cols)");
    for (const x of cols) {
      const ty = x.data_type.replace("character varying", "varchar")
        .replace("timestamp with time zone", "tstz").replace("ARRAY", "[]");
      console.log("  " + x.column_name + " : " + ty +
        (x.is_nullable === "NO" ? " NOT NULL" : "") +
        (x.column_default ? " DEFAULT " + String(x.column_default).slice(0, 30) : ""));
    }
  }
  console.log("\n=== CONSTRAINTS (PK=p / FK=f / CHECK=c / UNIQUE=u) ===");
  const cons = (await c.query(
    `SELECT con.conrelid::regclass::text tbl, con.conname, con.contype, pg_get_constraintdef(con.oid) def
       FROM pg_constraint con JOIN pg_namespace n ON n.oid=con.connamespace
      WHERE n.nspname='safeprocure' ORDER BY tbl, con.contype`)).rows;
  for (const r of cons) console.log("  [" + r.contype + "] " + r.tbl + " :: " + r.conname + " -> " + r.def);
  console.log("\n=== INDEXES ===");
  const idx = (await c.query(
    `SELECT tablename, indexname FROM pg_indexes WHERE schemaname='safeprocure' ORDER BY tablename,indexname`)).rows;
  for (const r of idx) console.log("  " + r.tablename + " . " + r.indexname);
  console.log("\n=== ROW COUNTS ===");
  for (const t of tabs) {
    const n = (await c.query(`SELECT count(*)::int n FROM safeprocure.${t}`)).rows[0].n;
    console.log("  " + t + " = " + n);
  }
  console.log("\n=== SEED: safety_cost_rate (expect 15) ===");
  const seed = (await c.query(
    `SELECT construction_type,bracket,rate,base_added FROM safeprocure.safety_cost_rate
      ORDER BY construction_type,bracket`)).rows;
  for (const r of seed) console.log("  " + r.construction_type + " | " + r.bracket + " | rate=" + r.rate + " | base_added=" + r.base_added);
  console.log("\n=== CALC CHECK: 일반건설공사(갑) mid, 대상액 1,450,000,000 (expect 32,319,000) ===");
  const calc = (await c.query(
    `SELECT round(1450000000*rate+base_added) v FROM safeprocure.safety_cost_rate
      WHERE construction_type='일반건설공사(갑)' AND bracket='mid'`)).rows[0];
  console.log("  computed required_cost = " + (calc ? calc.v : "(row missing)"));
  await c.end();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
