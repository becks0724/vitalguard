// 배치 내 ts 충돌 유실 가드 — 워치·폰·서버가 모두 "성공"을 보고하는데 값만 사라지던 결함.
//
// 무엇이 일어났나(2026-08-14 실측). 폰이 배치의 **모든 항목에 같은 ts**(전송 시각)를 붙이는데
// 서버에 `UNIQUE (worker_id, ts)` + `ON CONFLICT DO NOTHING` 이 걸려 있다. 그래서 한 배치에
// 항목이 2건 이상이면 **두 번째부터 조용히 버려진다** — 에러도 로그도 없다.
//   · 활동에너지·걸음 = 심박 항목에 병합 → 살아남음(DB 도착 확인)
//   · 이산 측정 6종   = 단독 항목      → 전량 유실(MET·일광·HRV·안정심박·보행심박·호흡수)
// 수리 = 이산 측정도 심박 항목에 병합. 측정 시각은 서버 계약에 필드가 없어 잃는 정보가 없다.
//
// SpO₂ 도 같은 수리를 했되 처리가 다르다 — 서버 계약에 `spo2MeasuredAt` 이 있어 측정 시각을
// 살려야 하는데, 병합하면 항목 ts 는 심박 측정 시각이 된다. 그래서 `spo2Ts` 라는 별도 키로
// 측정 시각을 함께 싣고 폰이 그것을 우선 읽는다(없으면 ts 폴백 = 단독 항목 하위 호환).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP = join(ROOT, "..", "vitalguard_app", "ios");
const watch = readFileSync(join(APP, "VitalWatch", "WatchStreamer.swift"), "utf8");
const phone = readFileSync(join(APP, "Runner", "VitalPipeline.swift"), "utf8");
const db = readFileSync(join(ROOT, "lib", "db.ts"), "utf8");

function section(src: string, marker: string, len = 2000): string {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, `구간 마커 없음: ${marker}`);
  return src.slice(i, i + len);
}

test("① 이산 측정은 단독 항목으로 append 하지 않는다 — 버퍼에 담는다", () => {
  const s = section(watch, "private func ingestDiscrete", 1400);
  assert.match(s, /pendingDiscrete\[input\.key\] =/, "이산 측정 버퍼가 사라짐");
  assert.doesNotMatch(
    s,
    /pendingSamples\.append/,
    "단독 항목으로 되돌아감 — 배치 ts 중복으로 서버가 조용히 버린다",
  );
});

test("② flush 는 이산 측정을 심박 항목에 병합한다", () => {
  const s = section(watch, "if !pendingDiscrete.isEmpty", 600);
  assert.match(
    s,
    /pendingSamples\.lastIndex\(where: \{ \$0\["bpm"\] is Double \}\)/,
    "심박 항목 탐색이 사라짐 — 에너지·걸음과 같은 계약이어야 한다",
  );
  assert.match(s, /pendingDiscrete\.removeAll\(\)/, "병합 후 버퍼를 비우지 않으면 중복 전송된다");
});

test("③ 전제 — 폰은 배치 전체에 같은 ts(전송 시각)를 붙인다", () => {
  // 이 전제가 깨지면(항목별 ts) 병합할 이유가 사라진다. 바뀌면 이 가드부터 다시 읽어야 한다.
  // 창은 넉넉히 — 키 파싱이 늘면 검사 대상이 고정 창 밖으로 밀린다(같은 날 두 번 겪음).
  const s = section(phone, "func ingest(payload:", 2000);
  assert.match(s, /let sentAt = self\.isoMs\.string\(from: Date\(\)\)/, "배치 공통 ts 가 사라짐");
  assert.match(s, /var v: \[String: Any\] = \["ts": sentAt\]/, "항목이 배치 ts 를 쓰지 않음");
});

test("⑤ SpO₂ — 병합하되 측정 시각을 spo2Ts 로 따로 싣는다", () => {
  const w = section(watch, "if let spo2 = pendingSpo2", 500);
  assert.match(w, /pendingSamples\[idx\]\["spo2Ts"\] = spo2\.at/, "측정 시각 별도 키가 사라짐");
  assert.match(w, /pendingSamples\.append\(\["ts": spo2\.at/, "심박 없을 때 단독 항목 폴백이 사라짐");
  // 워치가 단독 항목으로만 보내던 옛 경로가 되살아나면 다시 유실된다.
  const ing = section(watch, "private func ingestSpO2", 900);
  assert.doesNotMatch(ing, /pendingSamples\.append/, "SpO₂ 가 단독 항목으로 되돌아감");

  const p = section(phone, "if let spo2 {", 500);
  assert.match(
    p,
    /\(s\["spo2Ts"\] as\? Double\) \?\? \(s\["ts"\] as\? Double\)/,
    "폰이 spo2Ts 를 우선 읽지 않으면 병합 항목의 SpO₂ 나이가 심박 시각으로 틀어진다",
  );
});

test("④ 전제 — 서버는 (worker_id, ts) 중복을 조용히 버린다", () => {
  assert.match(
    db,
    /ON CONFLICT \(worker_id, ts\) DO NOTHING/,
    "중복 정책이 바뀜 — 유실 조건이 달라졌으니 병합 설계를 재검토할 것",
  );
});
