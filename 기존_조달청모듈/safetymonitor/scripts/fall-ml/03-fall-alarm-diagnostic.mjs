// 낙상 오경보 진단 — fall_detected=1(에스컬레이션) 샘플에 심박/생존신호가 실려 있었는지 확인(읽기 전용).
// 가설: 미착용 워치의 취급 아티팩트라면 hr/hr_at_impact 가 비어 있어야 한다 → 착용 게이트가 옳다는 물증.
// 실행: node scripts/fall-ml/03-fall-alarm-diagnostic.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.resolve(__dirname, '../../apps/dashboard-web')
const PNPM = path.resolve(WEB, '../../node_modules/.pnpm')
const envDir = fs.readdirSync(PNPM).find((d) => d.startsWith('@next+env@'))
const nextEnv = (await import(pathToFileURL(path.join(PNPM, envDir, 'node_modules/@next/env/dist/index.js')))).default
nextEnv.loadEnvConfig(WEB)
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL 미설정.'); process.exit(1) }
const pgDir = fs.readdirSync(PNPM).find((d) => d.startsWith('pg@') && !d.includes('pg-'))
const pg = (await import(pathToFileURL(path.join(PNPM, pgDir, 'node_modules/pg/lib/index.js')))).default
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 15000 })
const f = (v) => v === null || v === undefined ? 'null' : (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : v)

try {
  const r = await pool.query(
    `SELECT ts, worker_id, heart_rate, hr_at_impact, hr_pre_mean_10s, spo2,
            accel_magnitude_g, peak_rotation_rad_s, freefall_preceded, motion_still_sec,
            fall_decision, fall_prompt_outcome, battery_pct
       FROM vital_samples
      WHERE fall_detected = 1
      ORDER BY ts DESC LIMIT 30`)
  console.log(`fall_detected=1 (낙상 경보) 샘플: ${r.rows.length}건 (최근 30)\n`)
  console.log('ts | worker | HR | HR@impact | HR_pre | SpO2 | accelG | rot | ff | still | decision | prompt')
  for (const x of r.rows) {
    console.log([
      x.ts?.slice(11, 19), x.worker_id,
      f(x.heart_rate), f(x.hr_at_impact), f(x.hr_pre_mean_10s), f(x.spo2),
      f(x.accel_magnitude_g), f(x.peak_rotation_rad_s), f(x.freefall_preceded), f(x.motion_still_sec),
      x.fall_decision ?? '-', x.fall_prompt_outcome ?? '-',
    ].join(' | '))
  }
  // 생존신호 요약
  const withHr = r.rows.filter((x) => x.heart_rate != null && x.heart_rate > 0).length
  const withHrImpact = r.rows.filter((x) => x.hr_at_impact != null && x.hr_at_impact > 0).length
  console.log(`\n생존신호 판정: heart_rate 있는 경보 ${withHr}/${r.rows.length}, hr_at_impact 있는 경보 ${withHrImpact}/${r.rows.length}`)
  console.log(withHr === 0
    ? '  → 경보 전부 심박 없음 = 미착용 워치 물증. 착용/생존신호 게이트가 이 경보들을 100% 억제했을 것.'
    : '  → 일부 경보에 심박 존재 — 착용 상태 혼재. 게이트 설계 시 경계값 검토 필요.')
} catch (e) {
  console.error('조회 실패:', e.message); process.exitCode = 1
} finally { await pool.end() }
