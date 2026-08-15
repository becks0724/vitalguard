// 하트비트 유효기간 가드 — 워치를 벗은 뒤에도 마지막 심박이 영원히 흐르던 결함.
//
// 무엇이 일어났나(2026-08-15 프로덕션 실측). 워치 `flush()` 는 5초마다 돌면서 새 HealthKit
// 샘플이 없으면 `latestBPM`(마지막 값)을 그대로 복사해 보냈다. 전송 경로가 살아 있는지 보려고
// 넣은 심장박동인데 **미착용을 상정하지 않았다.** `latestBPM` 은 한 번 채워지면 비지 않으므로,
// 워치를 벗은 08-14 19:06:10(마지막 실측 101bpm) 다음부터 **12시간 34분·8,531건이 전부 102bpm**
// 이었고 DB 는 그것을 실측과 구분할 근거를 받은 적이 없다.
//
// ★ 진짜 피해는 차트가 아니었다. 하트비트가 5초마다 `ts` 를 갱신하니 관제 신선도 게이트
// (60초 · DemoDashboard STALE_MS)를 계속 통과해 **미착용 12시간 내내 "연결됨·정상"** 으로 보였다.
// 이 레포가 반복해 고쳐 온 false-OK 계열인데, 이번엔 미수신을 정상으로 세는 것이 아니라
// **미착용을 실측으로 세는** 형태다(차트·평균·심부체온 추정·PSI·활동 복합이 함께 오염된다).
//
// 수리 = `latestBPMAt`(마지막 실측 시각)을 두고 `heartbeatMaxAge` 를 넘으면 복사를 멈춘다.
// 값이 오래된 것은 유실이 아니라 **측정이 없었다는 사실**이므로 채우지 않고 비우는 것이 맞다.
//
// ★★ 가장 위험한 회귀는 "유효기간을 지우는 것"이 아니라 **기준점을 엉뚱한 곳에서 갱신하는 것**이다.
// `latestBPMAt` 을 flush 안에서 갱신하면 하트비트가 자기 자신을 되살려 유효기간이 영원히 만료되지
// 않는다 — 조건문은 그대로 남아 있어서 코드를 읽어도 멀쩡해 보인다. 그래서 갱신 지점을 못 박는다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const watch = readFileSync(
  join(ROOT, "..", "vitalguard_app", "ios", "VitalWatch", "WatchStreamer.swift"),
  "utf8",
);
const dashboard = readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8");

function section(src: string, marker: string, len = 2000): string {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, `구간 마커 없음: ${marker}`);
  return src.slice(i, i + len);
}

/** flush() 본문 — 하트비트 분기가 사는 곳. */
function flushBody(): string {
  return section(watch, "private func flush()", 1800);
}

test("① 하트비트 유효기간 상수가 존재한다", () => {
  assert.match(
    watch,
    /private let heartbeatMaxAge: TimeInterval = (\d+)/,
    "heartbeatMaxAge 가 사라졌다 — 없으면 미착용 값이 다시 영원히 흐른다",
  );
});

test("② 유효기간이 flush 주기보다 크고 신선도 게이트보다 작다", () => {
  const m = watch.match(/private let heartbeatMaxAge: TimeInterval = (\d+)/);
  assert.ok(m?.[1], "상수 값을 못 읽었다");
  const maxAge = Number(m[1]);

  // 하한 — flush 주기(5초)보다 커야 한다. 같거나 작으면 정상 착용 중에도 매번 만료돼
  // 하트비트가 사실상 죽는다(실측 간격 중앙 5초·p95 10초·p99 24.6초).
  assert.ok(maxAge > 5, `유효기간 ${maxAge}초 — flush 주기(5초) 이하면 착용 중에도 끊긴다`);
  assert.ok(
    maxAge >= 25,
    `유효기간 ${maxAge}초 — 정상 착용 실측 간격 p99(24.6초)를 못 덮어 차트에 잔 구멍이 생긴다`,
  );

  // ★ 상한 — 신선도 게이트(60초)보다 작아야 "연결끊김"이 실제로 뜬다.
  // 같거나 크면 하트비트가 게이트를 계속 밀어내 미착용이 영영 정상으로 보인다(원래 결함의 형태).
  const g = dashboard.match(/const STALE_MS = (\d+)_?(\d*);/);
  assert.ok(g, "DemoDashboard 의 STALE_MS 를 못 찾았다 — 가드 재작성 필요");
  const staleMs = Number(`${g[1]}${g[2] ?? ""}`);
  assert.equal(staleMs, 60000, "신선도 게이트가 바뀌었다 — 유효기간 상한을 다시 판단할 것");
  assert.ok(
    maxAge * 1000 < staleMs,
    `유효기간 ${maxAge}초 ≥ 신선도 게이트 ${staleMs / 1000}초 — 미착용이 계속 '연결됨'으로 보인다`,
  );
});

test("③ flush 의 하트비트가 유효기간을 검사한다", () => {
  const s = flushBody();
  assert.match(
    s,
    /if pendingSamples\.isEmpty, let bpm = latestBPM, let at = latestBPMAt,\s*\n?\s*Date\(\)\.timeIntervalSince\(at\) <= heartbeatMaxAge \{/,
    "하트비트가 유효기간 검사 없이 복사한다 — 벗어도 값이 영원히 흐른다",
  );
  // 종전 형태(무조건 복사)로 되돌아가면 결함이 그대로 재발한다.
  assert.doesNotMatch(
    s,
    /if pendingSamples\.isEmpty, let bpm = latestBPM \{/,
    "무조건 복사하던 종전 조건이 되살아났다",
  );
});

test("④ ★ 유효기간 기준점은 실측 콜백에서만 갱신된다", () => {
  // 이 가드가 핵심이다 — flush 안에서 갱신하면 하트비트가 스스로를 되살려 영원히 만료되지 않는다.
  const collect = section(watch, "func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder", 1200);
  assert.match(
    collect,
    /self\.latestBPM = bpm\s*\n[^\n]*\n\s*self\.latestBPMAt = Date\(\)/,
    "실측 콜백이 기준점을 갱신하지 않는다 — 하트비트가 첫 실측 뒤 곧바로 죽는다",
  );
  assert.doesNotMatch(
    flushBody(),
    /latestBPMAt = /,
    "flush 가 기준점을 갱신한다 — 하트비트가 자기 자신을 되살려 유효기간이 무의미해진다",
  );
});

test("⑤ 세션 종료 시 기준점을 버린다", () => {
  const s = section(watch, "private func teardown()", 900);
  assert.match(
    s,
    /latestBPMAt = nil/,
    "teardown 이 기준점을 안 버린다 — 재시작 직후 실측 전에 옛 값이 다시 흐른다",
  );
});

test("⑥ 30초의 근거가 코드에 남아 있다", () => {
  // 근거 없이 숫자만 있으면 다음 사람이 "너무 짧다/길다"로 임의 조정한다.
  const s = section(watch, "/// 하트비트 유효기간(초)", 900);
  assert.match(s, /p99/, "실측 근거(p99 24.6초)가 사라졌다");
  assert.match(s, /90초/, "미착용 감지 시간(30+60=90초) 설명이 사라졌다");
});

test("⑧ ★ 효능 범위의 한계와 근거의 잠정성이 기록돼 있다", () => {
  const s = section(watch, "/// 하트비트 유효기간(초)", 1600);
  // 이 장치는 "측정이 멈춘 뒤의 값 복사"를 막는다. 미착용 자체는 못 잡는다 —
  // 벗어도 측정이 이어지면 pendingSamples 가 안 비어 이 분기가 발동조차 안 한다(20:00 실측).
  assert.match(s, /"미착용" 이 아니라/, "효능 범위 한계 서술이 사라졌다");
  // 30초의 근거가 된 p99 는 복사분이 섞였을 수 있는 표본에서 나왔다 — 잠정임을 밝혀 둔다.
  assert.match(s, /잠정/, "근거가 잠정이라는 표시가 사라졌다 — 확정된 값처럼 읽힌다");
});

test("⑦ 결함 재현 조건이 기록돼 있다", () => {
  // 이 산수가 결함의 정체다 — 사라지면 다음 사람이 같은 함정을 판다.
  const s = flushBody();
  assert.match(s, /12시간 34분/, "실측 피해 규모 기록이 사라졌다");
  assert.match(s, /8,531건/, "실측 건수 기록이 사라졌다");
});
