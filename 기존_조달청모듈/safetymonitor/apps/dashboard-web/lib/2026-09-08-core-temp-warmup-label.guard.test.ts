// 워밍업 라벨 가드 — "미수신"(센서가 없다)과 "심박 누적 중"(오는데 아직 모자라다)을 가른다.
//
// 사고 — 워치8(김태곤)은 손목온을 거의 안 보내 체온 칸이 늘 손목온 없는 분기로 떨어지는데,
// 그 분기는 칼만이 없을 때 무조건 `--` / "미수신" 을 적었다. 연결도 살아 있고 심박도 2분마다
// 들어오는 상태였는데 화면은 센서 고장이라고 말한 셈이다. 같은 파일 반대 분기(손목온 있음)에는
// 이미 "심박 누적 중" 처방이 구현돼 있었다 — 처방이 한쪽에만 적용된 채 3주가 지났다.
//
// 지키려는 것 두 문장.
//   ① 값이 없을 때 화면은 **왜 없는지**를 말한다. 빈칸은 고장으로 읽힌다.
//   ② 진행률의 분모·경계는 추정기의 값 경계와 같다. 갈리면 "30/30 인데 값이 없다" 가 된다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CORE_TEMP_MIN_MINUTES, coreTempWarmupBuckets, estimateCoreTemp } from "@safetymonitor/analyzers";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const dash = readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8");
const store = readFileSync(join(ROOT, "app", "api", "app", "vital", "store.ts"), "utf8");
const route = readFileSync(join(ROOT, "app", "api", "app", "vital", "route.ts"), "utf8");

test("① 서버 — 워밍업 미달 워커도 진행률은 남긴다(값은 여전히 안 낸다)", () => {
  const fn = store.slice(store.indexOf("export async function coreTempEstimates"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  // 앵커 — 값 경로가 여기 실재하는가. 옮겨가면 아래 검사가 빈 문자열을 보게 된다.
  assert.match(body, /const est = estimateCoreTemp\(points\)/, "추정 호출부가 여기가 아니다");
  assert.match(body, /coreTempWarmupBuckets\(points\)/, "진행률을 안 담으면 화면이 사유를 못 적는다");
  // 값은 종전대로 워밍업 미달이면 안 낸다 — 라벨을 살리려고 값을 낮춰 내보내면 안 된다.
  assert.doesNotMatch(body, /tempC:\s*est\?\./, "est 가 없을 때도 tempC 를 담으려 한다");
});

test("② 응답 — coreTempWarmup 이 실리고, 추정과 같은 캐시를 공유한다(DB 조회를 늘리지 않는다)", () => {
  assert.match(route, /coreTempWarmup: await coreTempWarmups\(aliasMap\)/, "응답에 진행률이 없다");
  const fn = store.slice(store.indexOf("export async function coreTempWarmups"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /await coreTempEstimates\(aliasMap\)/, "캐시 공유가 아니다 — 조회가 두 배가 된다");
  assert.doesNotMatch(body, /recentHeartRates/, "진행률이 DB 를 따로 읽는다");
});

test("★ ③ 화면 — 연결이 살아 있는데 '미수신' 이라고 적지 않는다", () => {
  const at = dash.indexOf('{/* 6 체온');
  assert.notEqual(at, -1, "체온 칸을 못 찾았다 — 아래 검사가 공허하다");
  const cell = dash.slice(at, at + 6000);
  // 미수신은 **워밍업 진행률조차 없을 때만** 남는다(그때는 심박이 한 건도 안 온 것이다).
  assert.match(
    cell,
    /coreTempWarmup !== undefined\s*\?\s*`\$\{CORE_TEMP_WARMUP_LABEL\}[^`]*`\s*:\s*"미수신"/,
    "워밍업 중에도 '미수신' 이 뜬다 — 조치를 정반대로 안내한다",
  );
  // 사유 문구는 한 곳(상수)에서 온다 — 두 분기가 다른 말을 하면 같은 상태가 둘로 보인다.
  assert.equal(cell.split('"심박 누적 중"').length - 1, 0, "셀 안에 리터럴 문구가 남아 있다");
  // 두 분기가 각각 그 상수를 쓴다 — 개수가 아니라 **형태**로 본다(주석에 이름이 나와도 안 센다).
  //   손목온 없는 분기 = 템플릿 리터럴(위 정규식) · 손목온 있는 분기 = JSX 자식.
  assert.match(cell, /\{CORE_TEMP_WARMUP_LABEL\}/, "손목온 있는 분기가 같은 상수를 쓰지 않는다");
});

test("④ 화면 — 진행률 분모는 서버가 준 needed 다(화면이 30 을 따로 적지 않는다)", () => {
  const at = dash.indexOf('{/* 6 체온');
  const cell = dash.slice(at, at + 6000);
  assert.match(cell, /coreTempWarmup\.buckets\}\/\$\{coreTempWarmup\.needed\}/, "분모를 화면이 하드코딩했다");
});

test("★ ⑤ 진행률과 값의 경계가 같다 — 30/30 인데 값이 없는 상태가 생기지 않는다", () => {
  const T0 = Date.parse("2026-09-08T00:00:00.000Z");
  const series = (minutes: number) =>
    Array.from({ length: minutes }, (_, m) => ({ tsMs: T0 + m * 60_000, bpm: 83 }));

  const short = series(CORE_TEMP_MIN_MINUTES - 1);
  assert.equal(coreTempWarmupBuckets(short), CORE_TEMP_MIN_MINUTES - 1);
  assert.equal(estimateCoreTemp(short), null, "진행률 미달인데 값이 나온다");

  const exact = series(CORE_TEMP_MIN_MINUTES);
  assert.equal(coreTempWarmupBuckets(exact), CORE_TEMP_MIN_MINUTES);
  assert.ok(estimateCoreTemp(exact), "진행률 도달인데 값이 없다 — 화면에 30/30 이 멈춰 선다");
});

test("⑥ 진행률은 표시 전용 — 판정·경보 경로에 유입되지 않는다", () => {
  const severity = readFileSync(join(ROOT, "lib", "severity.ts"), "utf8");
  const signal = readFileSync(join(ROOT, "lib", "worker-signal.ts"), "utf8");
  // 앵커 — 판정이 이 두 모듈에 실재하는가.
  assert.match(severity, /export function coreTempStatus/, "판정 모듈이 여기가 아니다");
  assert.match(signal, /export function overallStatus/, "신호등 합성이 여기가 아니다");
  for (const [name, src] of [["severity", severity], ["worker-signal", signal]] as const) {
    assert.doesNotMatch(src, /coreTempWarmup|warmupBuckets/, `${name} 에 워밍업 진행률이 유입됨`);
  }
});

// ── 폭 ────────────────────────────────────────────────────────────────────────
// 2026-09-08 라이브 실측 — 부값 줄이 "체온 심박 누적 중 12/30" 으로 두 줄에 접혔다.
// 이 칸은 `minmax(6rem,1fr)`(최소 96px)이고 metricCell 의 px-1 을 빼면 88px 뿐이다.
// 선례 = 75acb81(단말 전원 배지) — **문구 축약 + nowrap + 전문은 title**.

test("★ ⑦ 진행률 줄이 접히지 않는다 — 두 분기 모두 nowrap", () => {
  const at = dash.indexOf('{/* 6 체온');
  const cell = dash.slice(at, at + 6000);
  // 진행률을 그리는 **두 줄만** 겨냥한다 — 같은 셀의 "끊김 전 값" 줄은 이 변경의 범위가 아니다
  //   (그쪽도 길면 접힐 수 있으나 종전 동작이라 여기서 건드리지 않는다).
  //   ① 손목온 없는 분기 = `"미수신"` 폴백을 든 줄 · ② 손목온 있는 분기 = `체온 ` 접두를 든 줄.
  const spanOf = (needle: string) => {
    const at = cell.indexOf(needle);
    assert.notEqual(at, -1, `앵커를 못 찾았다: ${needle} — 셀 구조가 바뀌었다`);
    // 감싸는 **줄 컨테이너**(`<span className="block …">`)를 잡는다 — 바로 앞 `<span>` 을 잡으면
    //   손목온 있는 분기에서 `체온 ` 접두 span(자식)을 집어 부모의 nowrap 을 못 본다.
    const open = cell.lastIndexOf('<span className="block', at);
    assert.notEqual(open, -1, `줄 컨테이너를 못 찾았다: ${needle}`);
    return cell.slice(open, at);
  };
  for (const [name, needle] of [
    // ⚠ 그냥 `"미수신"` 으로 찾으면 **주석 안의 인용**이 먼저 걸린다(같은 title 식 안에 있다).
    //   렌더 폴백 형태(`: "미수신"}`)로 좁힌다.
    ["손목온 없는 분기", ': "미수신"}'],
    ["손목온 있는 분기", '"text-muted">체온 '],
  ] as const) {
    assert.match(
      spanOf(needle),
      /whitespace-nowrap/,
      `${name} 진행률 줄에 nowrap 이 없다 — 좁은 칸에서 두 줄로 접힌다`,
    );
  }
});

test("⑧ 짧은 라벨의 뜻은 title 이 진다 — 축약이 정보를 지우지 않았다", () => {
  // 라벨만 "누적" 으로 줄었으므로, 무엇이 누적되는지는 툴팁이 말해야 한다.
  // ⚠ `;` 로 끊으면 인자 타입(`{ buckets: number; ... }`)의 세미콜론에서 먼저 멈춘다.
  //   템플릿 리터럴 본문을 백틱으로 잡는다.
  const t = dash.match(/const coreTempWarmupTitle[\s\S]*?`([\s\S]*?)`/)?.[1] ?? "";
  assert.match(t, /심부체온/, "툴팁이 무엇을 준비하는지 말하지 않는다");
  assert.match(t, /심박 \$\{w\.buckets\}\/\$\{w\.needed\}분 누적/, "툴팁에 진행률이 없다");
  assert.match(t, /60분/, "툴팁이 세션 리셋 조건을 말하지 않는다");
});
