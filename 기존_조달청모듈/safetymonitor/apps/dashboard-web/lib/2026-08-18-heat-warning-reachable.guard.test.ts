// 온열 경고 도달 가능성 가드(B-1a) — 죽은 확증 조건이 다시 붙지 않게 못 박는다.
//
// 무엇이 있었나. 경고(38.0℃)가 "저활동·고심박 패턴 동시"를 함께 요구했는데, 그 패턴의 저활동
// 임계가 분당 1.5 kcal 인 반면 실측 하한이 **2.40** 이라(08-13 이후 심박 커버 ≥10분인 온전한 분
// 2,067개 · 임계 이하 **0개**) 어떤 창에서도 참이 될 수 없었다. 즉 경고는 **구조적으로 발동 불가**
// 였고, 배포 이래 `[heat-alert]` 발사 로그가 0건이다.
//
// 그게 왜 나쁜가 — 알림 코드가 존재하니 "온열은 감시되고 있다"로 읽히는데 상위 등급으로 격상되는
// 경로 자체가 없었다. 임계값 논쟁 이전의 문제이고, 조용해서 아무도 모른다.
//
// 이 가드가 지키는 것 셋.
//
//  ① 경고 판정에 패턴 플래그가 **다시 결합되지 않는다.** 되돌리기 쉬운 자리다 — "확증이 있어야
//     안전하다"는 직관은 옳지만, 되살릴 축은 활동에너지가 **아니다**(B-1b 로 교체 예정).
//  ② `evaluateHeatStage` 가 궤적과 시각만 받는다(인자 부활 금지).
//  ③ 근거가 소스에 남아 있다 — 지우면 다음 사람이 같은 조건을 "빠진 것"으로 보고 되넣는다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateHeatStage,
  formatHeatMessage,
  HEAT_WARNING_TEMP_C,
  HEAT_SUSTAIN_MINUTES,
} from "./heat-alert";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const alertSrc = readFileSync(join(ROOT, "lib", "heat-alert.ts"), "utf8");
const storeSrc = readFileSync(join(ROOT, "app", "api", "app", "vital", "store.ts"), "utf8");

const NOW = Date.UTC(2026, 7, 18, 3, 0, 0);
const series = (minutes: number, tempC: number) =>
  Array.from({ length: minutes }, (_, i) => ({ tsMs: NOW - i * 60_000, tempC }));

test("★ 앵커 — 경고가 실제로 도달 가능하다(행동으로 확인 · 아래 금지 검사의 전제)", () => {
  // 이 한 줄이 이 트랙의 목적 그 자체다. 종전 구현에서는 어떤 입력으로도 이 값이 나오지 않았다.
  assert.equal(
    evaluateHeatStage(series(12, HEAT_WARNING_TEMP_C + 0.1), NOW),
    "warning",
    "경고가 다시 발동 불가 상태가 됐다",
  );
  // 대조 — 지속 필터는 살아 있어야 한다(단발 스파이크가 경고가 되면 안 된다).
  const spike = series(12, HEAT_WARNING_TEMP_C + 0.1);
  spike[3] = { tsMs: spike[3]!.tsMs, tempC: 36.5 };
  assert.equal(evaluateHeatStage(spike, NOW), null, "지속 필터가 사라졌다");
  assert.ok(HEAT_SUSTAIN_MINUTES >= 10, "지속 창이 10분 미만으로 줄었다");
});

test("① 경고 판정에 패턴 플래그가 결합돼 있지 않다", () => {
  const decide = alertSrc.slice(alertSrc.indexOf("export function evaluateHeatStage"));
  assert.doesNotMatch(
    decide.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""),
    /heatPattern/i,
    "패턴 조건이 경고에 다시 붙었다 — 활동에너지 축은 구조적으로 참이 될 수 없어 경고가 다시 죽는다",
  );
});

test("② 호출부가 패턴을 조회해 넘기지 않는다(불필요한 DB 왕복도 함께 사라진 상태 유지)", () => {
  const fn = storeSrc.slice(storeSrc.indexOf("export async function heatStages"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.doesNotMatch(
    body.replace(/^\s*\/\/.*$/gm, ""),
    /heatPatterns\(/,
    "heatStages 가 다시 heatPatterns 를 조회한다 — 단계 판정은 그 값을 안 쓴다",
  );
});

test("③ 근거가 소스에 남아 있다(지우면 같은 조건이 '빠진 것'으로 보여 되돌아온다)", () => {
  assert.match(alertSrc, /2\.40/, "실측 하한 근거가 사라졌다");
  assert.match(alertSrc, /B-1a/, "조치 식별자가 사라졌다");
  assert.match(alertSrc, /B-1b/, "후속(확증 축 교체) 예고가 사라졌다 — 잠정형이라는 사실이 지워진다");
});

test("④ 문구가 검증하지 않는 것을 단언하지 않는다 — '휴식 중 회복 안 됨' 주장 금지", () => {
  // B-1a 로 저활동·고심박 확증을 제거했으므로 휴식 여부는 판정 대상이 아니다. 제거만 하고 문구를
  // 남기면 알림이 사실보다 강한 주장을 하게 된다(이 레포가 반복해 고쳐 온 형태).
  const msg = formatHeatMessage({ stage: "warning", workerId: "EMP-TEST", workerName: null });
  assert.match(msg, /경고 기준 이상으로 10분 지속/, "무엇을 근거로 발사됐는지가 문구에서 사라졌다");
  assert.doesNotMatch(msg, /휴식 중에도/, "검증하지 않는 '휴식 중 회복 안 됨'을 다시 단언한다");
  assert.match(msg, /활동 여부는 미판정/, "확증이 없다는 사실 고지가 사라졌다");
  assert.match(msg, /추정/, "추정 기반이라는 고지가 사라졌다");
});
