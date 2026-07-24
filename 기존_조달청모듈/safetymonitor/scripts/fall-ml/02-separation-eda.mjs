// P2 분리 검증 EDA — 라벨(labels.csv)과 DB 특징을 fall_candidate_id 로 조인해,
// 회전 각속도(peak_rotation_rad_s)가 실제로 망치질(work_impact)과 넘어짐(trip)을 가르는지 확인한다.
// 산출: ① 클래스별 회전 분포 ② work_impact↔trip 분리 지표(임계 정확도) ③ ASCII 산점도 ④ Excel용 조인 CSV.
// 실행: node scripts/fall-ml/02-separation-eda.mjs
// 라벨 파일이 없으면 → 라벨 없는 탐색 모드(현 데이터 분포만 표시 + 안내).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.resolve(__dirname, '../../apps/dashboard-web')
const PNPM = path.resolve(WEB, '../../node_modules/.pnpm')
const LABELS = path.resolve(__dirname, '../../docs/fall-ml-relabel/labels.csv')
const OUT = path.resolve(__dirname, '../../docs/fall-ml-relabel/eda-joined.csv')

const envDir = fs.readdirSync(PNPM).find((d) => d.startsWith('@next+env@'))
const nextEnv = (await import(pathToFileURL(path.join(PNPM, envDir, 'node_modules/@next/env/dist/index.js')))).default
nextEnv.loadEnvConfig(WEB)
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL 미설정.'); process.exit(1) }

const pgDir = fs.readdirSync(PNPM).find((d) => d.startsWith('pg@') && !d.includes('pg-'))
const pg = (await import(pathToFileURL(path.join(PNPM, pgDir, 'node_modules/pg/lib/index.js')))).default
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 15000 })

// ── 라벨 로드 ──
function loadLabels() {
  if (!fs.existsSync(LABELS)) return null
  const lines = fs.readFileSync(LABELS, 'utf8').trim().split('\n')
  const header = lines[0].split(',').map((s) => s.trim())
  const idx = (k) => header.indexOf(k)
  const rows = lines.slice(1).filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
    const c = l.split(',')
    return {
      id: c[idx('fall_candidate_id')]?.trim(),
      primary: c[idx('primary_label')]?.trim(),
      subtype: c[idx('motion_subtype')]?.trim() ?? '',
      severity: c[idx('severity_label')]?.trim() ?? '',
      subject: c[idx('subject_id')]?.trim() ?? '',
    }
  }).filter((r) => r.id)
  return rows
}

// ── ASCII 산점도: x=accelG, y=rotation, 마커=클래스 ──
function scatter(points) { // points: [{x, y, mark}]
  const W = 56, H = 18
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y)
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys)
  const grid = Array.from({ length: H }, () => Array(W).fill(' '))
  for (const p of points) {
    const cx = Math.round(((p.x - xmin) / (xmax - xmin || 1)) * (W - 1))
    const cy = H - 1 - Math.round(((p.y - ymin) / (ymax - ymin || 1)) * (H - 1))
    grid[cy][cx] = grid[cy][cx] === ' ' ? p.mark : (grid[cy][cx] === p.mark ? p.mark : '*')
  }
  console.log(`  회전(rad/s) ↑  (y: ${ymin.toFixed(1)}~${ymax.toFixed(1)}, x: accelG ${xmin.toFixed(1)}~${xmax.toFixed(1)})`)
  for (const row of grid) console.log('  |' + row.join(''))
  console.log('  +' + '-'.repeat(W) + '→ accelG')
}

function stats(vals) {
  if (!vals.length) return null
  const s = [...vals].sort((a, b) => a - b)
  const q = (p) => s[Math.floor(p * (s.length - 1))]
  return { n: s.length, min: s[0], q1: q(0.25), med: q(0.5), q3: q(0.75), max: s[s.length - 1] }
}

try {
  const labels = loadLabels()

  if (!labels || labels.length === 0) {
    // 라벨 없음 → 탐색 모드: 현 데이터(mock 포함)의 회전 분포만 본다.
    console.log('=== 라벨 없음 → 탐색 모드 ===')
    console.log(`labels.csv 없음/빈 파일 (${LABELS}).`)
    console.log('현재 DB 후보는 라벨(동작 종류)이 없어 분리 검증 불가. scripted 수집으로 라벨을 채운 뒤 재실행하세요.\n')
    const r = await pool.query(
      `SELECT accel_magnitude_g AS x, peak_rotation_rad_s AS y FROM vital_samples
        WHERE fall_candidate = 1 AND accel_magnitude_g IS NOT NULL AND peak_rotation_rad_s IS NOT NULL
        ORDER BY random() LIMIT 400`)
    const pts = r.rows.map((p) => ({ x: p.x, y: p.y, mark: '.' }))
    if (pts.length) {
      console.log(`현재 후보 회전 분포(라벨 무관, 표본 ${pts.length}):`)
      const st = stats(pts.map((p) => p.y))
      console.log(`  peak_rotation_rad_s: min ${st.min.toFixed(1)} / Q1 ${st.q1.toFixed(1)} / 중앙 ${st.med.toFixed(1)} / Q3 ${st.q3.toFixed(1)} / max ${st.max.toFixed(1)}`)
      console.log('  (라벨이 있어야 이 분포가 클래스별로 갈리는지 볼 수 있음)\n')
      scatter(pts)
    }
    await pool.end(); process.exit(0)
  }

  // 라벨 있음 → DB 특징 조인
  const ids = labels.map((l) => l.id)
  const res = await pool.query(
    `SELECT fall_candidate_id AS id, accel_magnitude_g AS acc, peak_rotation_rad_s AS rot,
            freefall_preceded AS ff, motion_still_sec AS still, hr_delta_peak AS hrdp
       FROM vital_samples WHERE fall_candidate = 1 AND fall_candidate_id = ANY($1)`, [ids])
  const feat = new Map(res.rows.map((r) => [r.id, r]))
  const joined = labels.map((l) => ({ ...l, ...(feat.get(l.id) ?? {}) })).filter((r) => r.rot !== undefined && r.rot !== null)

  console.log(`=== 분리 검증 (라벨 ${labels.length}건, 특징 조인 ${joined.length}건) ===`)
  const missing = labels.length - joined.length
  if (missing > 0) console.log(`  ⚠ ${missing}건은 DB 특징 없음(candidate_id 불일치 또는 회전 null) — 제외.`)

  const classes = ['work_impact', 'trip_samelevel', 'fall_height']
  const mark = { work_impact: 'h', trip_samelevel: 't', fall_height: 'F' }
  console.log('\n클래스별 회전(peak_rotation_rad_s) 분포:')
  for (const c of classes) {
    const st = stats(joined.filter((r) => r.primary === c).map((r) => r.rot))
    if (st) console.log(`  ${mark[c]} ${c.padEnd(15)} n=${st.n}  min ${st.min.toFixed(1)} / Q1 ${st.q1.toFixed(1)} / 중앙 ${st.med.toFixed(1)} / Q3 ${st.q3.toFixed(1)} / max ${st.max.toFixed(1)}`)
  }

  // 분리 지표: work_impact vs (trip+fall) 를 회전 임계 하나로 가를 때 최적 정확도
  const neg = joined.filter((r) => r.primary === 'work_impact').map((r) => r.rot)
  const pos = joined.filter((r) => r.primary === 'trip_samelevel' || r.primary === 'fall_height').map((r) => r.rot)
  if (neg.length && pos.length) {
    const cands = [...new Set([...neg, ...pos])].sort((a, b) => a - b)
    let best = { thr: 0, acc: 0 }
    for (const thr of cands) {
      const correct = neg.filter((v) => v < thr).length + pos.filter((v) => v >= thr).length
      const acc = correct / (neg.length + pos.length)
      if (acc > best.acc) best = { thr, acc }
    }
    console.log(`\n★ 회전 단일 임계 분리(work_impact vs 낙상): 최적 임계 ${best.thr.toFixed(2)} rad/s → 정확도 ${(best.acc * 100).toFixed(1)}%`)
    console.log(best.acc >= 0.85
      ? '  ✓ 회전만으로도 잘 갈림 → P3 진행. 규칙 기반으로도 상당 부분 해결 가능.'
      : '  ⚠ 회전 단독 분리 약함 → 변수 추가(방향변화 각도 등) 또는 소형 ML 검토. 저에게 이 출력 가져오세요.')
  }

  // ASCII 산점도
  const pts = joined.map((r) => ({ x: r.acc, y: r.rot, mark: mark[r.primary] ?? '?' }))
  console.log('\n산점도 (h=망치질/작업충격, t=넘어짐, F=추락, *=혼재):')
  scatter(pts)

  // Excel용 조인 CSV
  const csv = ['fall_candidate_id,primary_label,subtype,severity,subject,accelG,rotation_rad_s,freefall,still_sec,hr_delta_peak']
  for (const r of joined) csv.push(`${r.id},${r.primary},${r.subtype},${r.severity},${r.subject},${r.acc ?? ''},${r.rot ?? ''},${r.ff ?? ''},${r.still ?? ''},${r.hrdp ?? ''}`)
  fs.writeFileSync(OUT, csv.join('\n'))
  console.log(`\nExcel용 조인 CSV 저장: ${OUT} (직접 산점도 그려 육안 확인 가능)`)
} catch (e) {
  console.error('EDA 실패:', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
