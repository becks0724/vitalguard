// 구획 이탈 가드 — 전송이 느린 기기가 조용히 빠지는 것을 막는다.
//
// 배경(2026-08-27 실측 · 프로덕션 하루). 텔레그램에 `📍 현장 구획 이탈` 이 애플 워치 착용자
// 한 명에게만 왔다. DB 로 보니 **갤럭시 워치 착용자도 실제로 이탈**해 있었다.
//   장우진 watchOS  GPS 4,538점 · 707점(15.6%) 반경 밖 · 최대 386m  → 알림 1건
//   김태곤 WearOS   GPS    97점 ·  23점(23.7%) 반경 밖 · 최대 482m  → 알림 **0건**
//                   3연속 이상 이탈 구간이 2개나 있었다.
//
// 원인은 **판정 게이트와 상태 보존이 같은 값(60초)에 묶여 있던 것**이다.
//   전송 간격 중앙값  watchOS 5.0초(60초 이상 0.1%) · WearOS 120.6초(60초 이상 **100.0%**)
//   이탈 확정은 연속 3회(GEOFENCE_EXIT_STREAK)인데, 60초가 지나면 상태가 지워져 streak 이
//   1로 되돌아간다. 실제 타임스탬프로 재현하니 **상태 삭제 96회 / 표본 97개**, 최대 streak 1/3.
//   ⟹ 느린 기기는 **구조적으로** 이탈 알림이 불가능했다.
//
// ★ 이 가드의 한 문장 보장.
//   "이탈 streak 의 수명은 **판정 신선도와 별개의 상수**로 정해지고, 그 상수는 가장 느린 실측
//    전송 주기보다 충분히 길다 — 그래서 느린 기기도 연속 판정을 쌓을 수 있다."
//
// ⚠ 여기서 답하지 못하는 것 — **판정이 브라우저에서만 돈다**(`app/lib/geofence.ts` 소비처가
//   `DemoDashboard.tsx` 하나뿐). 관제웹을 아무도 안 열면 누구에게도 안 간다. 서버 판정은 별건.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "./test-support/strip-comments";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const dash = stripComments(read("app", "components", "DemoDashboard.tsx"));
const geo = stripComments(read("app", "lib", "geofence.ts"));

/** 지오펜스 effect 본문만 잘라낸다 — 다른 effect 의 `keep` 지역변수에 걸리지 않게. */
function geofenceEffect(): string {
  const i = dash.indexOf("const states = geofenceStates.current;");
  assert.ok(i > 0, "지오펜스 effect 를 못 찾았다 — 가드가 앵커를 잃었다");
  const j = dash.indexOf("}, [workerMapData", i);
  assert.ok(j > i, "지오펜스 effect 의 끝을 못 찾았다");
  return dash.slice(i, j);
}

test("① ★ 상태 보존 한계가 판정 게이트와 다른 상수다", () => {
  const m = dash.match(/const GEOFENCE_STATE_KEEP_MS = ([^;]+);/);
  assert.ok(m, "상태 보존 상수가 없다 — 보존이 다시 판정 게이트에 묶였다");
  const keepMs = Function(`"use strict";return (${m![1]})`)() as number;
  // 기준은 손으로 고른 배수가 아니라 **가장 느린 기기의 GPS 간격 p95**(7일 실측 982.1초)다.
  // 이 아래로 내리면 정상 전송이 몇 번 걸러질 때 streak 이 끊긴다 — 종전 결함의 완화판이 된다.
  const WEAROS_GPS_GAP_P95_MS = 982_100;
  assert.ok(
    keepMs >= WEAROS_GPS_GAP_P95_MS,
    `상태 보존 ${keepMs}ms < WearOS GPS 간격 p95 ${WEAROS_GPS_GAP_P95_MS}ms — 느린 기기가 다시 빠진다`,
  );
});

test("② ★ 상태 삭제가 판정 게이트가 아니라 보존 한계를 본다", () => {
  const eff = geofenceEffect();
  // 삭제 루프가 보는 집합이 보존 집합이어야 한다.
  assert.match(
    eff,
    /for \(const id of Array\.from\(states\.keys\(\)\)\) \{\s*if \(!keep\.has\(id\)\) states\.delete\(id\);/,
    "상태 삭제가 보존 집합(keep)을 안 본다 — 게이트에 묶이면 streak 이 매번 초기화된다",
  );
  // 보존 집합에 넣는 조건이 보존 상수여야 한다.
  assert.match(
    eff,
    /if \(ageMs < GEOFENCE_STATE_KEEP_MS\) keep\.add\(/,
    "보존 조건이 GEOFENCE_STATE_KEEP_MS 가 아니다",
  );
});

test("③ ★ 판정 게이트는 남아 있다 — 낡은 좌표로 이탈을 선언하지 않는다", () => {
  const eff = geofenceEffect();
  assert.match(
    eff,
    /if \(pt\.ageSec === null \|\| pt\.ageSec >= 60\) continue;/,
    "판정 신선도 게이트가 사라졌다 — 낡은 좌표가 이탈로 발화한다",
  );
  // 게이트가 보존보다 **먼저** 걸러지면 안 된다(그러면 종전 결함 그대로).
  assert.ok(
    eff.indexOf("keep.add(") < eff.indexOf("pt.ageSec >= 60) continue"),
    "보존 등록이 판정 게이트 뒤에 있다 — 게이트에 걸린 워커의 상태가 지워진다(종전 결함)",
  );
});

test("④ 이탈 확정은 여전히 연속 3회다 — 이 가드가 지키려는 대상", () => {
  assert.match(geo, /GEOFENCE_EXIT_STREAK = 3\b/, "연속 확정 횟수가 3이 아니다");
  assert.match(
    geo,
    /if \(streak >= GEOFENCE_EXIT_STREAK\)/,
    "streak 이 확정 조건에서 빠졌다 — 1회 이탈이 곧 경보가 된다",
  );
});
