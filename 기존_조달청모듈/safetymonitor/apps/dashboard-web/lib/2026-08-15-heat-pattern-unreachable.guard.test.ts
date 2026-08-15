// 온열 ② 저활동 조건이 '발동 불가' 라는 사실을 코드에 고정한다 — 2026-08-15 실측.
//
// 왜 가드인가 — 주석만 두면 다음 사람이 "아직 안 뜬 것" 으로 읽고 기다린다. 실제로 문서에
// *"주석 육안은 자연 발생 대기(평시엔 안 뜨는 게 정상)"* 로 적혀 있었고, 그 대기는 영영
// 끝나지 않는다. 재난문자 '대피' 재승격이 한 달간 죽어 있던 것과 같은 형태다.
//
// 무엇을 고정하나 — 두 가지다.
//   ① 사실 : 임계가 실측 하한(분당 2.40)보다 낮아 조건이 구조적으로 거짓이다
//   ② 처방 : 임계를 실측 위로 올려 "고치는" 것을 막는다. 1.5 의 근거는 일반 대사 참고값이라
//            옳고, 축이 안 맞는 쪽은 상시 워크아웃이 부풀린 워치 값이다. 맞추면 근거가 사라진다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { HEAT_PATTERN_LOW_KCAL_PER_MIN, detectLowActivityHighHr } from "./heat-pattern";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = readFileSync(join(ROOT, "lib", "heat-pattern.ts"), "utf8");

/** 2026-08-15 실측 하한 — 08-13 이후 심박 커버 ≥10 인 온전한 분 2,067개 중 최솟값. */
const OBSERVED_MIN_KCAL_PER_MIN = 2.4;

test("① 임계가 실측 하한보다 낮다 — 조건이 구조적으로 거짓이라는 사실 고정", () => {
  // 앵커 — 상수가 이 파일에 실재하는지 먼저 확인한다(금지형이 아니라 값 비교지만 같은 규율).
  assert.match(src, /HEAT_PATTERN_LOW_KCAL_PER_MIN/);
  assert.ok(
    HEAT_PATTERN_LOW_KCAL_PER_MIN < OBSERVED_MIN_KCAL_PER_MIN,
    `임계(${HEAT_PATTERN_LOW_KCAL_PER_MIN})가 실측 하한(${OBSERVED_MIN_KCAL_PER_MIN}) 이상이 됐다. ` +
      "값을 올려 '고친' 것이라면 되돌릴 것 — 근거 없는 숫자가 된다. " +
      "활동에너지가 아닌 신호로 바꿨다면 이 가드를 지우고 새 근거를 남길 것.",
  );
});

test("② 실측 분포로는 flagged 가 서지 않는다", () => {
  // 실측과 같은 조건 — 고심박(≥100)인데 활동에너지는 관측 평균(분당 4.8 = 5초당 0.40).
  const nowMs = Date.UTC(2026, 7, 15, 9, 0, 0);
  const points = Array.from({ length: 15 * 12 }, (_, i) => ({
    tsMs: nowMs - (15 * 60 - i * 5) * 1000,
    hr: 110,
    aeKcal: 0.4,
  }));
  const r = detectLowActivityHighHr(points, nowMs);
  assert.ok(r, "판정 자체가 null 이면 이 가드가 무의미하다 — 입력 구성이 깨졌다");
  assert.ok(r.aeKcalPerMin >= OBSERVED_MIN_KCAL_PER_MIN, `분당 소모율이 실측 하한 미만(${r.aeKcalPerMin})`);
  assert.ok(r.hrAvg >= 100, "고심박 조건이 성립하지 않아 저활동 조건을 시험하지 못한다");
  assert.equal(
    r.flagged,
    false,
    "실측 활동에너지(분당 4.8)에서 flagged 가 섰다 — 판정식이 바뀌었으면 이 가드를 갱신할 것",
  );
});

test("③ 발동 불가 사실과 원인이 소스에 남아 있다", () => {
  // 근거 없이 상수만 있으면 다음 사람이 임계를 임의 조정한다.
  const s = src.slice(src.indexOf("저활동 경계"), src.indexOf("저활동 경계") + 1600);
  assert.match(s, /2,067/, "실측 표본 수가 사라졌다");
  assert.match(s, /2\.40/, "실측 하한(분당 2.40)이 사라졌다");
  assert.match(s, /HKWorkoutSession/, "원인(상시 워크아웃)이 사라졌다");
  assert.match(s, /해법이 아니다/, "임계 상향 금지 처방이 사라졌다");
});
