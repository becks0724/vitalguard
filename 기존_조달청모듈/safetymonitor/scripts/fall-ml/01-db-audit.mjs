// P1 블로커 검증 — vital_samples 의 낙상 후보(fall_candidate) 데이터 현황을 읽어 보고한다(읽기 전용).
// 핵심 목적: peak_rotation_rad_s 가 실측인지 합성상수(=7 고정)인지 실증 → 수집 착수 가능 여부 판정.
// 실행(dashboard-web 기준): node ../../scripts/fall-ml/01-db-audit.mjs
//   또는 레포 루트에서: node 기존_조달청모듈/safetymonitor/scripts/fall-ml/01-db-audit.mjs
// 인증/접속: .env.local 의 DATABASE_URL 을 @next/env 로 로드(injection-test.mjs 와 동일 패턴). SELECT 만 수행.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.resolve(__dirname, '../../apps/dashboard-web')
const PNPM = path.resolve(WEB, '../../node_modules/.pnpm')

// @next/env 로 .env.local 주입(앱과 동일).
const envDir = fs.readdirSync(PNPM).find((d) => d.startsWith('@next+env@'))
if (!envDir) { console.error('@next/env 를 찾지 못함. pnpm install 확인.'); process.exit(1) }
const nextEnv = (await import(pathToFileURL(path.join(PNPM, envDir, 'node_modules/@next/env/dist/index.js')))).default
nextEnv.loadEnvConfig(WEB)

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL 미설정 — apps/dashboard-web/.env.local 확인.'); process.exit(1) }

// pnpm 스토어에서 pg 로드(버전 무관).
const pgDir = fs.readdirSync(PNPM).find((d) => d.startsWith('pg@') && !d.includes('pg-'))
if (!pgDir) { console.error('pg 모듈을 pnpm 스토어에서 찾지 못함.'); process.exit(1) }
const pg = (await import(pathToFileURL(path.join(PNPM, pgDir, 'node_modules/pg/lib/index.js')))).default
const { Pool } = pg

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 15000 })

function fmt(n) { return n === null || n === undefined ? 'null' : (typeof n === 'number' ? (Number.isInteger(n) ? n : n.toFixed(3)) : n) }

try {
  // 1) 전체 후보 수 + 워커별
  const total = await pool.query(`SELECT COUNT(*)::int AS n FROM vital_samples WHERE fall_candidate = 1`)
  const nCand = total.rows[0].n
  console.log('=== 낙상 후보(fall_candidate=1) 현황 ===')
  console.log(`총 후보 이벤트: ${nCand} 건`)
  if (nCand === 0) {
    console.log('\n후보 데이터 없음. 워치 수집 시작 후 재실행하세요.')
    await pool.end(); process.exit(0)
  }

  const byWorker = await pool.query(
    `SELECT worker_id, COUNT(*)::int AS n FROM vital_samples WHERE fall_candidate = 1 GROUP BY worker_id ORDER BY n DESC`)
  console.log('\n워커별:')
  for (const r of byWorker.rows) console.log(`  ${r.worker_id}: ${r.n}`)

  // 2) ★ 핵심: peak_rotation_rad_s 실측 여부 — distinct 값 개수·목록
  const rot = await pool.query(
    `SELECT peak_rotation_rad_s AS v, COUNT(*)::int AS n
       FROM vital_samples WHERE fall_candidate = 1
      GROUP BY peak_rotation_rad_s ORDER BY n DESC`)
  const distinct = rot.rows.filter((r) => r.v !== null)
  const nullCount = rot.rows.filter((r) => r.v === null).reduce((s, r) => s + r.n, 0)
  console.log('\n=== ★ peak_rotation_rad_s (회전 각속도) 실측 검증 ===')
  console.log(`distinct 값 개수(비-null): ${distinct.length}, null: ${nullCount}`)
  console.log('상위 분포:')
  for (const r of rot.rows.slice(0, 8)) console.log(`  ${fmt(r.v)} rad/s → ${r.n}건`)

  // 판정: distinct 가 1~2개이고 그 값이 7 근처면 합성상수 의심
  const synthetic = distinct.length <= 2 && distinct.some((r) => Math.abs(r.v - 7) < 0.001)
  const allNull = distinct.length === 0
  console.log('\n판정:')
  if (allNull) {
    console.log('  ⚠ 회전값 전부 null — 워치가 peak_rotation 미전송. 펌웨어 gyro 활성화 필요. 수집 무의미.')
  } else if (synthetic) {
    console.log('  ⚠ 합성상수(=7 고정) 확정 — simulateFall 데모값. 실측 gyro 활성화 전까지 학습 불가.')
    console.log('    → 워치 앱이 CMDeviceMotion.rotationRate 실측을 peak_rotation_rad_s 로 채우는지 확인 필요.')
  } else {
    console.log(`  ✓ 실측으로 보임 — distinct ${distinct.length}개, 값이 분산됨. 수집 착수 가능.`)
  }

  // 3) 다른 결정 변수 분포(수집 착수 후 참고)
  const feat = await pool.query(
    `SELECT
        COUNT(accel_magnitude_g)::int AS acc_n, MIN(accel_magnitude_g) AS acc_min, MAX(accel_magnitude_g) AS acc_max, AVG(accel_magnitude_g) AS acc_avg,
        COUNT(motion_still_sec)::int AS still_n, MAX(motion_still_sec) AS still_max,
        SUM(CASE WHEN freefall_preceded = 1 THEN 1 ELSE 0 END)::int AS ff_yes,
        SUM(CASE WHEN freefall_preceded = 0 THEN 1 ELSE 0 END)::int AS ff_no,
        COUNT(hr_delta_peak)::int AS hrdp_n
       FROM vital_samples WHERE fall_candidate = 1`)
  const f = feat.rows[0]
  console.log('\n=== 결정 변수 분포(참고) ===')
  console.log(`  accel_magnitude_g: n=${f.acc_n}, 범위 ${fmt(f.acc_min)}~${fmt(f.acc_max)}, 평균 ${fmt(f.acc_avg)}`)
  console.log(`  freefall_preceded: 있음 ${f.ff_yes} / 없음 ${f.ff_no}`)
  console.log(`  motion_still_sec: n=${f.still_n}, 최대 ${fmt(f.still_max)}`)
  console.log(`  hr_delta_peak(층3용): n=${f.hrdp_n}`)

  // 4) 최근 후보 목록(라벨 기록지 대조용) — fall_candidate_id·ts·주요값
  const recent = await pool.query(
    `SELECT fall_candidate_id, worker_id, ts, accel_magnitude_g, peak_rotation_rad_s, freefall_preceded, motion_still_sec, fall_decision
       FROM vital_samples WHERE fall_candidate = 1 ORDER BY ts DESC LIMIT 15`)
  console.log('\n=== 최근 후보 15건(labels.csv 기록 대조용) ===')
  console.log('  candidate_id | worker | ts | accelG | rot | ff | still | decision')
  for (const r of recent.rows) {
    console.log(`  ${(r.fall_candidate_id ?? '-').slice(0, 8)} | ${r.worker_id} | ${r.ts?.slice(0, 19)} | ${fmt(r.accel_magnitude_g)} | ${fmt(r.peak_rotation_rad_s)} | ${fmt(r.freefall_preceded)} | ${fmt(r.motion_still_sec)} | ${r.fall_decision ?? '-'}`)
  }
} catch (e) {
  console.error('\nDB 조회 실패:', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
