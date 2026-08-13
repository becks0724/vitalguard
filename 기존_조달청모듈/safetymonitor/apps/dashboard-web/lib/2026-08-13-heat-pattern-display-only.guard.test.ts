// 저활동·고심박 패턴(온열 ②) 가드 — "표시 주석 전용·판정 미주입" 경계가 조용히 풀리면 실패한다.
//
// 왜 가드인가 — 이 패턴은 온열 전조 "신호"이지 판정이 아니다. workerStatus/overallStatus/
// signalLevel 에 넣으면 타입이 맞아 tsc·기능 테스트가 전부 통과한 채, 검증 안 된 임계
// (100bpm·1.5kcal/분)가 경보 기준으로 승격된다.
//
// ★ 2026-08-13 개정 — 온열 ③(사용자 결정)이 통제된 예외 1개를 추가했다: heatStage(패턴 원값이
// 아니라 판정된 "단계")의 warning 만 신호등 톤 합성에 주의로 얹는다. 그 경계는
// 2026-08-13-heat-alert-boundary 가드가 지키고, 이 파일은 원래 경계(패턴 원값의 생체 판정
// 함수 미주입)를 계속 지킨다 — 두 가드는 다른 층이다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const dash = readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8");
const route = readFileSync(join(ROOT, "app", "api", "mock", "vital", "route.ts"), "utf8");
const store = readFileSync(join(ROOT, "app", "api", "mock", "store.ts"), "utf8");
const lib = readFileSync(join(ROOT, "lib", "heat-pattern.ts"), "utf8");

test("vital GET — heatPattern 을 응답에 싣는다(별칭 접기 경유)", () => {
  assert.match(route, /heatPattern: await heatPatterns\(aliasMap\)/);
});

test("패턴은 판정 함수에 들어가지 않는다 — workerStatus/overallStatus/signalLevel 미주입", () => {
  assert.doesNotMatch(dash, /workerStatus\([^)]*heatPattern/, "패턴이 작업자 판정에 주입됨");
  assert.doesNotMatch(dash, /overallStatus\([^)]*heatPattern/, "패턴이 종합 판정에 주입됨");
  assert.doesNotMatch(dash, /signalLevel\([^)]*heatPattern/, "패턴이 신호등에 주입됨");
});

test("서버 집계 — 순수 함수 사용 + 예약 워커 제외 + flagged 만 응답에 싣는다", () => {
  const fn = store.slice(store.indexOf("export async function heatPatterns"));
  assert.match(fn, /detectLowActivityHighHr\(/, "순수 함수를 쓰지 않음");
  assert.match(fn.slice(0, 1500), /isReservedTestWorker/, "예약 워커가 판정 대상에 들어감");
  assert.match(fn, /if \(!res\?\.flagged\) continue;/, "정상·판정불가 워커까지 응답에 실림");
});

test("순수 함수 — '판정 불가(null)'와 '정상(false)'을 구분한다(파이프라인 없는 워커 주석 금지)", () => {
  assert.match(lib, /hasEnergyPipeline/, "에너지 파이프라인 존재 확인이 빠짐");
  assert.match(
    lib,
    /if \(!hasEnergyPipeline\) return null;/,
    "미수집 워커가 '저활동'으로 오독될 수 있음",
  );
});

test("표시 — 주석은 체온 추정 셀의 라벨·툴팁만 바꾼다(별도 상태색·경보 경로 없음)", () => {
  assert.match(dash, /저활동·고심박/, "주석 라벨이 사라짐");
  // recordAlert / 텔레그램 경로에 heatPattern 이 닿으면 ③(정책 결정) 전에 알림이 나간다.
  assert.doesNotMatch(store, /recordAlert\([^)]*heatPattern/i, "패턴이 경보 기록에 주입됨");
});
