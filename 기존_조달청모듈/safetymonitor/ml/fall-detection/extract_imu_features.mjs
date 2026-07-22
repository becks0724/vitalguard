// imu_collect.imu_window 원시 6축 파형 → 트랙A(optimize_thresholds.py) 입력 CSV 변환.
// FallDetector.swift 의 process() 상태머신을 그대로 이식해 윈도를 재생(replay) — 수식 동일성 보장.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const APP = "~/Documents/vitalguard-jodalcheong/기존_조달청모듈/safetymonitor/apps/dashboard-web";
const OUT_DIR = new URL("./out/", import.meta.url).pathname;
const { Pool } = createRequire(APP + "/package.json")("pg");
const m = readFileSync(APP + "/.env.local", "utf8").match(/^DATABASE_URL=(.+)$/m);
const pool = new Pool({ connectionString: m[1].trim(), max: 1 });

// FallDetector.swift 임계 상수(동일값)
const IMPACT_G = 2.8, FREEFALL_G = 0.6, FREEFALL_LOOKBACK = 0.8;
const STILL_BAND = 0.3, STILL_REQUIRED = 1.2, POST_WINDOW = 4.0, MAX_DT = 0.1;

// FallDetector.process() 포팅 — 샘플열 재생, 첫 해소(fall/rejected 2종) 또는 절단(truncated) 반환.
function replay(totalG, rot, fs) {
  const dtNominal = 1 / fs;
  let impactAt = null, impactPeakG = 0, accum = 0, lastSampleAt = null;
  let peakRotation = 0, freefallPreceded = false, lastFreefallAt = null;
  const features = (decision, i) => ({
    decision,
    peakG: impactPeakG || Math.max(...totalG), // 후보 미개시 윈도는 전체 최대 G(항상 <2.8 → 규칙상 음성)
    stillSec: accum,
    freefallPreceded,
    peakRot: impactAt !== null ? peakRotation : Math.max(...rot),
    resolvedAt: i,
  });
  for (let i = 0; i < totalG.length; i++) {
    const now = i * dtNominal;
    if (totalG[i] <= FREEFALL_G) lastFreefallAt = now;
    if (totalG[i] >= IMPACT_G) {
      impactAt = now;
      impactPeakG = Math.max(impactPeakG, totalG[i]);
      peakRotation = Math.max(peakRotation, rot[i]);
      if (lastFreefallAt !== null && now - lastFreefallAt <= FREEFALL_LOOKBACK) freefallPreceded = true;
      accum = 0;
      lastSampleAt = now;
      continue;
    }
    if (impactAt === null) continue;
    peakRotation = Math.max(peakRotation, rot[i]);
    if (now - impactAt > POST_WINDOW) return features("rejected_timeout", i);
    const dt = Math.min(now - (lastSampleAt ?? now), MAX_DT);
    lastSampleAt = now;
    if (Math.abs(totalG[i] - 1.0) < STILL_BAND) accum += dt;
    if (accum >= STILL_REQUIRED)
      return features(freefallPreceded || peakRotation >= 6.0 ? "fall" : "rejected_no_corroboration", i);
  }
  return features("truncated", totalG.length - 1);
}

// 임계-독립 피처 — 그리드 탐색용. 피벗 = 최대 totalG 샘플(임계 2.8 조건부가 아님).
// 검출기와의 차이(근사): ① 재충격 시 정지 누적 리셋 없음(밴드 밖 샘플만 미누적)
// ② 회전 피크는 피벗 이후 구간(검출기는 임계초과 샘플부터). 기준선 검증은 exact replay 로 별도 수행.
function extractIndependent(totalG, rot, fs) {
  const dt = 1 / fs;
  let pivot = 0;
  for (let i = 1; i < totalG.length; i++) if (totalG[i] > totalG[pivot]) pivot = i;
  let freefall = false;
  for (let j = Math.max(0, pivot - Math.round(FREEFALL_LOOKBACK / dt)); j < pivot; j++)
    if (totalG[j] <= FREEFALL_G) { freefall = true; break; }
  let still = 0, peakRot = 0;
  const postEnd = Math.min(totalG.length, pivot + 1 + Math.round(POST_WINDOW / dt));
  for (let i = pivot; i < postEnd; i++) {
    peakRot = Math.max(peakRot, rot[i]);
    if (i > pivot && Math.abs(totalG[i] - 1.0) < STILL_BAND) still += Math.min(dt, MAX_DT);
  }
  return {
    peakG: totalG[pivot], stillSec: still, freefallPreceded: freefall, peakRot,
    postAvailSec: (totalG.length - 1 - pivot) * dt,
  };
}

const LABEL = {
  fall: "true_fall", recovered: "true_fall", nonrecovered: "true_fall",
  hammer: "false_positive", pound: "false_positive", throw: "false_positive",
  walk: "false_positive", sit: "false_positive",
};

const { rows } = await pool.query(
  `SELECT id, worker_id, family, fs, axes FROM imu_collect.imu_window
   WHERE worker_id <> 'DRIFT' AND family IS NOT NULL ORDER BY id`);
await pool.end();

// ── 단위 자동 판별(실측 기반) ──
// 가속: walk 윈도 전체 샘플 |a| 평균 ≈1 이면 G, ≈9.8 이면 m/s². 자이로: fall 윈도 피크 중앙값이 50 넘으면 deg/s.
const mag = (r, o) => Math.hypot(r[o], r[o + 1], r[o + 2]);
const walkMeans = rows.filter(r => r.family === "walk")
  .map(r => r.axes.reduce((s, x) => s + mag(x, 0), 0) / r.axes.length);
const walkMean = walkMeans.reduce((a, b) => a + b, 0) / walkMeans.length;
const accelScale = walkMean > 5 ? 1 / 9.80665 : 1;
const fallRotPeaks = rows.filter(r => LABEL[r.family] === "true_fall")
  .map(r => Math.max(...r.axes.map(x => mag(x, 3)))).sort((a, b) => a - b);
const rotMedian = fallRotPeaks[Math.floor(fallRotPeaks.length / 2)];
const rotScale = rotMedian > 50 ? Math.PI / 180 : 1;
console.log(`단위 판별 — walk 평균 |a|=${walkMean.toFixed(3)} → 가속 스케일 ${accelScale === 1 ? "G(그대로)" : "m/s²→G"}`);
console.log(`           fall 회전 피크 중앙값=${rotMedian.toFixed(1)} → 자이로 스케일 ${rotScale === 1 ? "rad/s(그대로)" : "deg/s→rad/s"}`);

// ── 변환 실행 ──
const out = [["worker_id", "ground_truth_label", "accel_magnitude_g", "motion_still_sec",
  "freefall_preceded", "peak_rotation_rad_s", "family", "replay_decision", "post_avail_sec", "window_id", "n_samples"].join(",")];
const stats = {};
for (const r of rows) {
  const totalG = r.axes.map(x => mag(x, 0) * accelScale);
  const rot = r.axes.map(x => mag(x, 3) * rotScale);
  const exact = replay(totalG, rot, r.fs ?? 50);      // 현행 검출기 충실 재현(기준선 검증용)
  const f = extractIndependent(totalG, rot, r.fs ?? 50); // 임계-독립 피처(그리드 탐색용)
  const label = LABEL[r.family];
  out.push([r.worker_id, label, f.peakG.toFixed(4), f.stillSec.toFixed(4),
    f.freefallPreceded ? 1 : 0, f.peakRot.toFixed(4), r.family, exact.decision,
    f.postAvailSec.toFixed(2), r.id, r.axes.length].join(","));
  const k = r.family;
  stats[k] ??= { n: 0, peakG: [], ff: 0, rot: [], still: [], post: [], dec: {} };
  stats[k].n++; stats[k].peakG.push(f.peakG); stats[k].rot.push(f.peakRot); stats[k].still.push(f.stillSec);
  stats[k].post.push(f.postAvailSec);
  if (f.freefallPreceded) stats[k].ff++;
  stats[k].dec[exact.decision] = (stats[k].dec[exact.decision] ?? 0) + 1;
}
mkdirSync(OUT_DIR, { recursive: true });
const csvPath = OUT_DIR + "imu-features-20260722.csv";
writeFileSync(csvPath, out.join("\n"));
console.log(`\nCSV 저장: ${csvPath} (${out.length - 1}행)`);

// ── 라벨별 피처 분포 sanity ──
const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log("\nfamily | n | 피크G중앙 | 정지초중앙 | 자유낙하% | 회전중앙 | 피벗후여유s | exact판정 분포");
for (const [k, s] of Object.entries(stats))
  console.log(`${k.padEnd(12)} | ${String(s.n).padStart(3)} | ${med(s.peakG).toFixed(2).padStart(6)} | ${med(s.still).toFixed(2).padStart(6)} | ${String(Math.round(100 * s.ff / s.n)).padStart(3)}% | ${med(s.rot).toFixed(1).padStart(5)} | ${med(s.post).toFixed(2).padStart(5)} | ${JSON.stringify(s.dec)}`);
