// 신선도 판정 기준 가드 — 미착용을 "연결됨 · 정상" 으로 보여주던 false-OK 차단.
//
// 무엇이 일어났나(2026-08-15 프로덕션 실측). 워치를 벗으면 심박은 멈추는데 **워크아웃 세션이
// 활동에너지를 계속 누적해 5초마다 행이 들어온다**(미착용 구간에도 12건/분 그대로). 신선도가
// 행 ts 를 보고 있어 게이트를 영원히 통과한다.
//
// ⚠ 고치는 대상을 정확히 — 심박이 null 이면 집계는 이미 "대기"로 센다(heartRateStatus → idle).
// "정상" 으로 세던 것은 워치가 값을 무한 복사하던 시절이고 heartbeatMaxAge 로 이미 막았다.
// 여기서 바로잡는 것은 ① "대기"(출근 전)와 "연결끊김"(받다가 끊김)의 구분 ② 생체가 끊겨도
// 4칸 꽉 차 있던 신호 막대 ③ stale 이 아니라 gateStaleVitals 를 통과하던 SpO₂·체온 sticky 값.
//
// ★ 왜 심박 하나로 생체 전체를 판정하나 — 연속으로 오는 생체 신호가 심박뿐이기 때문이다
// (24시간 실측: 심박 99.3% · SpO₂ 4건 · 손목온도·HRV·안정심박·보행심박·호흡수 전부 0건).
// SpO₂ 는 같은 광학 센서라 손목이 떨어지면 함께 멈추고, 심부체온 추정과 PSI 는 심박을 입력으로
// 쓴다. 심박이 끊긴 시점에 독립적으로 살아 있는 생체는 하나도 없다. 활동에너지·걸음은 생체가
// 아니라 움직임 누적이고 **사람이 없어도 나온다** — 연결 판정의 근거가 될 수 없다.
//
// ★★ 가장 위험한 회귀는 "기준을 되돌리는 것"이 아니라 **두 판정이 갈리는 것**이다.
// signalLevel(막대)과 isStale(카드·신호등)이 서로 다른 시각을 보면, 막대는 꽉 찼는데 카드는
// 연결끊김이거나 그 반대가 된다. 그래서 둘이 같은 함수를 쓰도록 묶고 여기서 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const dashboard = readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8");
const store = readFileSync(join(ROOT, "app", "api", "app", "vital", "store.ts"), "utf8");
const age = readFileSync(join(ROOT, "lib", "vital-age.ts"), "utf8");

function fn(src: string, marker: string, len = 700): string {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, `구간 마커 없음: ${marker}`);
  return src.slice(i, i + len);
}

test("① 나이 산출이 심박 측정 시각을 본다", () => {
  assert.match(
    age,
    /const hrAt = sample\.heartRateMeasuredAt;/,
    "심박 측정 시각을 안 본다 — 행 ts 로 되돌아가면 미착용이 다시 정상으로 보인다",
  );
  assert.match(age, /export function vitalAgeMs/, "순수 함수가 사라졌다");
});

test("② ★ isStale 과 signalLevel 이 같은 함수를 쓴다(갈리지 않는다)", () => {
  assert.match(
    fn(dashboard, "function isStale("),
    /return vitalAgeMs\(sample, nowMs\) > staleThresholdMs\(sample\.dataOrigin\);/,
    "isStale 이 나이 산출을 우회한다",
  );
  assert.match(
    fn(dashboard, "function signalLevel("),
    /const ageMs = vitalAgeMs\(sample, nowMs\);/,
    "signalLevel 이 나이 산출을 우회한다 — 막대와 카드가 서로 다른 말을 한다",
  );
});

test("③ 행 ts 직접 판정으로 되돌아가지 않았다", () => {
  // 종전 형태. 이게 되살아나면 활동에너지가 신선도를 영원히 지탱한다.
  assert.doesNotMatch(
    fn(dashboard, "function isStale("),
    /nowMs - new Date\(sample\.ts\)\.getTime\(\) > STALE_MS/,
    "isStale 이 행 ts 로 되돌아갔다",
  );
  assert.doesNotMatch(
    fn(dashboard, "function signalLevel("),
    /const ageMs = nowMs - new Date\(sample\.ts\)\.getTime\(\);/,
    "signalLevel 이 행 ts 로 되돌아갔다",
  );
});

test("④ ★ 서버가 심박 측정 시각을 sticky 로 유지한다", () => {
  // 이게 없으면 심박 없는 행이 도착할 때 측정 시각이 지워져 나이를 잴 수 없다.
  // 스프레드(...newer)만으로는 키가 undefined 로 들어올 때 older 를 덮는다.
  assert.match(
    store,
    /heartRateMeasuredAt: newer\.heartRateMeasuredAt \?\? older\?\.heartRateMeasuredAt,/,
    "측정 시각 sticky 가 사라졌다 — 나이 기준을 잃어 판정이 무너진다",
  );
});

test("⑤ 하위 호환 — 측정 시각이 없으면 행 ts 로 폴백한다", () => {
  // 구 앱·이벤트 전용 행에는 측정 시각이 없다. 폴백을 없애면 그 워커가 영구 연결끊김이 된다.
  assert.match(age, /return nowMs - rowMs;/, "행 ts 폴백이 사라졌다");
  assert.match(age, /Number\.isFinite\(hrMs\)/, "파싱 불가 값 방어가 사라졌다(NaN → 영원히 신선)");
});

test("⑥ 애플 임계는 그대로 60초다", () => {
  // 2026-08-25 에 문턱이 **출처별로** 갈렸다(갤럭시 = 120초 배칭이라 150초). 상수는
  // DemoDashboard 에서 lib/vital-age.ts 로 옮겼고, 여기서는 종전 계약 — **애플 60초** — 만
  // 계속 못 박는다. 갤럭시 쪽 문턱과 워치 주기의 대조는 별도 가드가 본다
  // (2026-08-25-stale-threshold-by-origin.guard.test.ts).
  const m = age.match(/STALE_MS_DEFAULT = (\d+)_?(\d*);/);
  assert.ok(m, "STALE_MS_DEFAULT 를 못 찾았다");
  assert.equal(Number(`${m[1]}${m[2] ?? ""}`), 60_000, "임계가 바뀌었다 — 실측 근거를 다시 볼 것");
});

test("⑧ ★ 효능 범위의 한계가 기록돼 있다 — '미착용을 잡는다'로 부풀지 않게", () => {
  // 2026-08-15 20:00 실측으로 확인된 한계 — 워치를 벗어도 상시 워크아웃 세션이 손목 감지를
  // 우회해 심박이 계속 실측으로 생성될 수 있다(70분·891행·고유 11개). 그때는 이 게이트가
  // 발동하지 않고 화면은 "착용 중·정상" 이다. 이 한 문단이 사라지면 다음 사람이(그리고 내가)
  // 다시 "미착용을 잡는다" 고 믿는다 — 실제로 그 주장을 라이브에 내보낸 적이 있다.
  assert.match(age, /미착용" 이 아니라/, "효능 범위 한계 서술이 사라졌다");
  assert.match(age, /68~78/, "벗은 채 심박이 계속 생성된 실측이 사라졌다");
  assert.match(age, /자는 사람도 같은 모양/, "가속도 단독 판정 불가 근거가 사라졌다");
});

test("⑦ 판단 근거가 코드에 남아 있다", () => {
  // 근거가 사라지면 다음 사람이 "행 ts 가 더 자연스럽다" 며 되돌린다.
  assert.match(age, /활동에너지/, "활동에너지가 미착용에도 온다는 근거가 사라졌다");
  assert.match(age, /99\.3%/, "심박이 유일한 연속 생체라는 실측이 사라졌다");
});
