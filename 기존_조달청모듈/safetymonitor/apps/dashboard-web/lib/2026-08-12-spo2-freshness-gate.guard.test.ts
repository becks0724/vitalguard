// SpO₂ 신선도 게이트 가드 — 위험 판정이 낡은 측정값(30분 초과)을 다시 보기 시작하면 실패한다.
//
// 왜 가드 테스트인가 — spo2Status(s.spo2) 와 spo2Status(freshSpo2(s, now)) 는 타입이 같아
// 되돌려도 tsc·lint·기능 테스트가 전부 통과한다(뷰 컴포넌트라 tsx --test 기능 검증 불가).
// SpO₂ 는 기회 측정이라 게이트가 빠지면 "40분 전 저산소"가 위험 경보를 계속 점등한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8");

test("위험 경보·신호등 요약 — SpO₂ 판정은 freshSpo2 게이트를 거친다", () => {
  const gated = src.match(/spo2Status\(freshSpo2\(/g) ?? [];
  assert.ok(
    gated.length >= 2,
    `spo2Status(freshSpo2(...)) 호출이 ${gated.length}건 — 경보 대상(dangerVitalWorkers)과 ` +
      "신호등 요약(issues) 중 게이트가 풀린 곳이 있다",
  );
});

test("낡은 값 직결 패턴 금지 — spo2Status 에 원시 샘플 필드를 바로 넣지 않는다", () => {
  for (const raw of ["spo2Status(s.spo2)", "spo2Status(sample?.spo2)", "spo2Status(sample.spo2)"]) {
    assert.ok(
      !src.includes(raw),
      `${raw} 발견 — 신선도 게이트 없이 낡은 SpO₂ 가 판정에 들어간다`,
    );
  }
});

test("overallStatus — nowMs 를 받아 SpO₂ 를 신선도로 거른다(행 신호등·지도 마커 공용)", () => {
  const fn = src.slice(
    src.indexOf("function overallStatus"),
    src.indexOf("function", src.indexOf("function overallStatus") + 10),
  );
  assert.match(fn, /nowMs\?: number/, "overallStatus 에 nowMs 파라미터가 없다");
  assert.match(fn, /freshSpo2\(sample, nowMs\)/, "overallStatus 가 freshSpo2 를 쓰지 않는다");
});
