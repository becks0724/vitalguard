// 충격 판정 행 표기 가드 — 낙상 섀도 행이 생체 행 표기(`--`·`≈` 추정)로 위장하지 않는가
//
// ★ 왜 필요한가. 워치 낙상 ML 모듈은 1.8G 이상 충격마다 판정 행(fallCandidate)을 남기고,
//   2026-08-31 실측에선 이 행이 생체 행의 3.4배였다(249 vs 74). 이 행이 실시간 수집 표에
//   `--` 넷과 `≈37.6`(워커 단위 추정 폴백)으로 오르면 "측정이 죽었는데 체온만 잡힌다" 로
//   읽힌다. 08-31 결정(문구 A · 색 ③ · 배치 1)은 이 행을 **표가 그릴 때만** 한 줄 요약으로
//   가른다 — 서버·링을 건드리면 낙상 "확인 중" 표시(fallPendingByWorker)와 오탐 실측·
//   fall-export 학습셋이 함께 죽는다(v6.1.1 이 게이트에서 후보를 빠뜨려 54건 유실).
//
// ★ 이 가드가 초록일 때 보장하는 것(한 문장) —
//   **충격 판정 행은 화면 렌더에서만 갈라지고(서버 수신·링 필터 없음), 그 행에 ≈ 추정이
//   그려지지 않으며, 보이는 문구에 내부 어휘·게이트 상수가 없고, 블링크가 붙지 않는다.**
//   보장하지 않는 것 = 문구가 관제자에게 옳게 읽히는가. 그것은 운용에서 본다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { VitalSample } from "@safetymonitor/schemas";

import { impactRowView, isImpactSample } from "./impact-row";
// 주석 제거는 정본 헬퍼로만 — 순진한 정규식은 URL 의 `//` 를 먹어 거짓 초록을 만든다([[L-119]]).
import { stripComments } from "./test-support/strip-comments";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (...p: string[]) => stripComments(readFileSync(join(here, ...p), "utf8"));

const board = read("..", "app", "components", "DemoDashboard.tsx");
const store = read("..", "app", "api", "app", "vital", "store.ts");
const rowSrc = read("impact-row.ts");
const deviceRowSrc = read("device-status-row.ts");

/** 인자 목록의 닫는 소괄호 — 대응으로 찾는다(still-label 가드와 같은 이유 · [[L-104]]). */
function sigEnd(src: string, at: number): number {
  let i = src.indexOf("(", at);
  let paren = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") paren++;
    else if (src[i] === ")" && --paren === 0) return i;
  }
  assert.fail("인자 목록의 끝을 못 찾았다");
}

/** 함수 본문 — 중괄호 대응. */
function bodyOf(src: string, decl: string): string {
  const at = src.indexOf(decl);
  assert.notEqual(at, -1, `${decl} 를 못 찾았다 — 이름이 바뀌었으면 이 가드도 따라가야 한다`);
  const open = src.indexOf("{", sigEnd(src, at));
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(open, j + 1);
  }
  assert.fail(`${decl} 본문의 끝을 못 찾았다`);
}

const s = (partial: Partial<VitalSample>): VitalSample =>
  ({ workerId: "w1", ts: "2026-08-31T00:00:00.000Z", ...partial }) as VitalSample;

// 실측 표본 형태(08-31 DB) — 게이트 미달 · 모듈 기각(고G no_danger) · 게이트 통과 ·
// Apple 확인 중 · 실경보. 값은 당일 실데이터에서 땄다.
const CASES = {
  belowGate: s({ fallCandidate: true, fallUpdatePhase: "candidate", fallPromptOutcome: "not_alerted", accelMagnitudeG: 2.16, fallTrace: { decision: "danger" } }),
  rejectedHighG: s({ fallCandidate: true, fallUpdatePhase: "candidate", fallPromptOutcome: "not_alerted", accelMagnitudeG: 6.73, fallTrace: { decision: "no_danger" } }),
  gatePassed: s({ fallCandidate: true, fallUpdatePhase: "candidate", accelMagnitudeG: 2.89 }),
  applePending: s({ fallCandidate: true, fallDecision: "fall" }),
  alerted: s({ fallDetected: true, accelMagnitudeG: 4.3 }),
};
const vital = s({ heartRate: 88, skinTempC: 36.1 });

// ── ① 분류는 결말·판정 기반 — 숫자 비교가 아니다 ───────────────────────────
test("★★ 미경보 사유를 모듈 결말로 가른다 — 6.7G 기각 행에 '기준 미만' 이라 쓰면 거짓말이 된다", () => {
  const below = impactRowView(CASES.belowGate, "장우진")!;
  assert.equal(below.tone, "neutral");
  assert.match(below.text, /경보 기준 미만 · 미경보/);
  const rejected = impactRowView(CASES.rejectedHighG, "장우진")!;
  assert.equal(rejected.tone, "neutral");
  assert.match(rejected.text, /낙상 패턴 아님 · 미경보/);
  assert.doesNotMatch(rejected.text, /기준 미만/, "6.73G 행에 '기준 미만' — G 옆에서 모순으로 읽힌다");
  const passed = impactRowView(CASES.gatePassed, "장우진")!;
  assert.equal(passed.tone, "caution");
  assert.match(passed.text, /30초 확인 열림/);
  assert.match(passed.hint ?? "", /경보 미발송/, "섀도 단계 표기가 빠졌다 — 경보가 나간 것으로 읽힌다");
  assert.equal(impactRowView(CASES.applePending, "장우진")!.tone, "caution");
  const alerted = impactRowView(CASES.alerted, "장우진")!;
  assert.equal(alerted.tone, "danger");
  assert.match(alerted.text, /경보 발신/);
  assert.equal(impactRowView(vital, "장우진"), null, "생체 행이 충격 행으로 갈라졌다");
});

// ── ② 보이는 문구의 어휘 경계 ───────────────────────────────────────────────
test("★★ 보이는 문구에 내부 어휘·게이트 상수·≈ 가 없다 — 내부 어휘는 툴팁(title)에만", () => {
  for (const [k, sample] of Object.entries(CASES)) {
    const v = impactRowView(sample, "장우진")!;
    const visible = [v.chip, v.text, v.hint ?? ""].join(" ");
    assert.doesNotMatch(visible, /candidate|not_alerted|no_danger|prompt|escalat|섀도|shadow/i, `${k}: 보이는 문구에 내부 어휘`);
    assert.doesNotMatch(visible, /≈/, `${k}: 추정 마크 — 충격 행엔 측정도 추정도 없다`);
  }
  // 게이트 값은 워치 모듈 상수 — 분류기 소스 전체에서 금지(툴팁 포함). 모듈이 바꾸면 표류한다.
  assert.doesNotMatch(rowSrc, /2\.8/, "분류기에 게이트 상수 하드코딩");
});

// ── ③ 헤더 집계와 행 분기가 같은 판별 ───────────────────────────────────────
test("★ isImpactSample 과 impactRowView 가 갈리지 않고, 헤더·표가 둘 다 그것을 쓴다", () => {
  for (const sample of [...Object.values(CASES), vital]) {
    assert.equal(impactRowView(sample, "x") !== null, isImpactSample(sample), "판별 불일치 — 헤더 수와 행 수가 어긋난다");
  }
  // 09-29 — 헤더 집계가 기기 상태(착용 표식·미착용 배터리)와 함께 `recentTableCounts` 로 옮겨 갔다.
  //   뜻은 같다: 헤더의 충격 수는 분류기 판별(isImpactSample)을 거쳐야 한다. 그래서 두 고리를 다 본다.
  assert.match(board, /recentTableCounts\(data\.recent\)/, "헤더 집계가 분류 함수를 안 쓴다");
  // ⚠ bodyOf 는 인자 뒤 첫 `{` 를 본문으로 잡는데 이 함수는 반환 타입이 `{ vital; … }` 다 — 선언부터 다음 export 까지 자른다.
  const countsAt = deviceRowSrc.indexOf("export function recentTableCounts(");
  assert.notEqual(countsAt, -1, "recentTableCounts 를 못 찾았다 — 이름이 바뀌었으면 이 가드도 따라가야 한다");
  const countsEnd = deviceRowSrc.indexOf("\nexport ", countsAt + 1);
  assert.match(
    deviceRowSrc.slice(countsAt, countsEnd === -1 ? undefined : countsEnd),
    /isImpactSample\(sample\)/,
    "헤더 집계 함수가 충격 판별에 분류기를 안 쓴다 — 헤더 수와 행 수가 어긋난다",
  );
  assert.match(board, /impactRowView\(sample/, "표가 분류기를 안 부른다 — 충격 행이 생체 행으로 그려진다");
});

// ── ④ 서버·링 무필터 — 화면에서만 가른다 ────────────────────────────────────
test("★★ 수신 게이트는 후보를 받고 링 조회는 후보를 거르지 않는다 — 54건 유실(v6.1.1) 재발 방지", () => {
  assert.match(bodyOf(store, "function hasMonitorableSignal("), /fallCandidate === true/, "빈 샘플 게이트가 후보를 버린다");
  assert.doesNotMatch(bodyOf(store, "export function recentSamples("), /fallCandidate|fallDetected/, "recentSamples 가 후보를 거른다 — 낙상 '확인 중' 표시가 죽는다");
});

// ── ⑤ 렌더 순서·형태 ────────────────────────────────────────────────────────
test("★ 충격 분기가 ≈ 폴백보다 먼저고, 생체 칸을 병합하며, 블링크가 없다", () => {
  const at = board.indexOf("impactRowView(sample");
  const fallback = board.indexOf('≈${formatTemp(est)}');
  assert.ok(at !== -1 && fallback !== -1, "앵커를 못 찾았다 — 표가 바뀌었으면 가드도 따라간다");
  assert.ok(at < fallback, "충격 분기가 ≈ 폴백 뒤에 있다 — 충격 행에 추정이 그려진다");
  const branch = board.slice(at, fallback);
  assert.match(branch, /colSpan=\{5\}/, "충격 행이 생체 칸(`--` 넷·온도)을 병합하지 않는다");
  assert.doesNotMatch(branch, /vital-blink/, "지나간 판정 기록에 블링크 — 경보 피로");
});
