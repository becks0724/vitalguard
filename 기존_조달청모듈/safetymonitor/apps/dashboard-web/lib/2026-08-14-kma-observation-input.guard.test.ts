// 법정 폭염 판정 입력 출처 가드 — 조용히 Open-Meteo 로 되돌아가면 실패한다.
//
// 법령은 폭염작업 기준으로 "**기상청이 측정한** 체감온도"를 지정한다. 여기엔 두 요소가 있고
// 둘 다 지켜야 한다.
//   ① 산출식 — 기상청 여름철 공식(2026-08-14 오전 교체 · lib/apparent-temp.ts)
//   ② 입력   — 기상청 관측(초단기실황). Open-Meteo 는 수치예보 모델 격자 분석값이라 관측이 아니다.
// ②를 빠뜨린 채 ①만 고친 상태가 반나절 지속됐고, 실측에서 기온이 3.6℃ 벌어져 법정 임계 31℃
// 판정이 갈렸다(관측 = 폭염작업 / 우리 = 정상). 그래서 출처를 가드로 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const route = readFileSync(join(ROOT, "app", "api", "weather", "route.ts"), "utf8");
const client = readFileSync(join(ROOT, "app", "lib", "kma-observation.ts"), "utf8");

function section(src: string, marker: string, len = 1600): string {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, `구간 마커 없음: ${marker}`);
  return src.slice(i, i + len);
}

test("① 판정 입력은 기상청 관측을 우선한다 — 업스트림 직결 금지", () => {
  const s = section(route, "const obs = await fetchKmaObservation", 900);
  assert.match(s, /const curTempC = obs\?\.temperatureC \?\? omTempC/, "기온이 관측 우선이 아님");
  assert.match(
    s,
    /const curHumidityPct = obs\?\.humidityPct \?\? omHumidityPct/,
    "습도가 관측 우선이 아님",
  );
  // 체감온도가 관측 기반 값으로 산출되는지.
  assert.match(route, /apparentTempC: apparentTempKma\(curTempC, curHumidityPct, curWindKmh\)/);
});

test("② 출처·관측 시각을 응답에 싣는다 — 값의 나이를 숨기지 않는다", () => {
  assert.match(route, /obsSource: obs \? "kma-ncst" : "open-meteo"/, "출처 표기가 사라짐");
  assert.match(route, /obsAt: obs\?\.observedAt/, "관측 시각이 사라짐");
});

test("③ 실황 실패는 전부 null — 가짜 값이 판정에 들어가면 안 된다", () => {
  // 문자열로 '목업 없음'을 검사하면 자기 주석에 걸린다(실측) — 실패 경로가 전부 null 인지를 본다.
  const fn = section(client, "export async function fetchKmaObservation", 2600);
  assert.match(fn, /if \(!key\) return null;/, "키 없을 때 null 반환이 사라짐");
  assert.match(fn, /if \(!res\.ok\) return null;/, "HTTP 실패 시 null 반환이 사라짐");
  assert.match(fn, /catch \{[^}]*return null;/, "예외 시 null 반환이 사라짐");
  // 필드가 하나라도 비면 섞어 쓰지 않는다(기온만 관측·습도는 모델이면 체감온도가 뒤섞인다).
  assert.match(fn, /humidityPct! > 0 && humidityPct! <= 100/, "습도 유효성 검사가 사라짐");
});

test("④ 격자 변환 상수는 기상청 공개 사양 그대로다", () => {
  for (const c of ["6371.00877", "SLAT1 = 30.0", "SLAT2 = 60.0", "OLON = 126.0", "OLAT = 38.0"]) {
    assert.ok(client.includes(c), `격자 상수 ${c} 가 바뀜 — 다른 지역을 조회하게 된다`);
  }
  assert.match(client, /const XO = 43;/);
  assert.match(client, /const YO = 136;/);
});

test("⑤ 조회 기준은 45분 전 정시 — 실황 제공 시점(정시+40분)을 앞지르지 않는다", () => {
  assert.match(
    client,
    /9 \* 3_600_000 - 45 \* 60_000/,
    "기준 시각 오프셋이 바뀜 — 아직 없는 시각을 조회하면 조용히 폴백된다",
  );
});
