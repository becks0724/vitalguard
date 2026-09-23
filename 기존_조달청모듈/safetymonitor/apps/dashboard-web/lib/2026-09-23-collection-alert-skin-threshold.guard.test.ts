// 수집 시점 경보 체온 가드 — 텔레그램이 우는 온도와 화면이 「위험」이라 칠하는 온도가 같은가.
//
// 무엇이 있었나. 2026-09-18 에 `피부온 + 0.5 = 심부체온` 이라는 근거 없는 변환을 걷어내고
// 판정 경로를 `skinTempStatus`(변환 없이 피부온 임계로 잰다)로 옮겼다. 그런데 **수집 시점
// 경보(`dangerMetrics`) 한 줄이 옛 경로에 남았다.** 그래서 이런 상태가 09-23 까지 이어졌다.
//
//   store.ts        coreTempStatus(피부온)  →  위험 = 피부온 + 0.5 >= 38.5  ⟹ 피부온 38.0
//   화면·집계·내보내기  skinTempStatus(피부온)  →  위험 = 피부온 38.5
//
// ⟹ **텔레그램은 38.0℃ 에 울리는데 관제웹을 열면 그 건이 「주의」로 칠해져 있다.**
//   프로덕션 26일 표본에서 `>=38.0` 145건 대 `>=38.5` 67건 — **78건이 어긋났다**(09-23 실측).
//
// ★ 왜 주석이 이것을 못 막았나. `severity.ts` 의 `coreTempStatus` 머리 주석이 이 자리를
//   **「의도해서 남긴 곳」으로 적고 있었다** — "행 단위 과거 조회·내보내기·수집 시점 경보" 셋을
//   열거하면서. 그런데 그 셋 중 둘(`preview/route.ts` · `export-csv.ts`)은 이미 옮겨져 있었다.
//   주석이 낡은 것을 사람이 읽고 「여기는 원래 이런 곳」이라 믿는다. 그래서 시험으로 못 박는다.
//
// ★ 이 가드의 한 문장 보장.
//   "수집 시점 경보의 체온 판정은 화면·집계와 **같은 함수·같은 임계**를 쓴다."
//
// ⚠ 이 가드는 **임계값이 옳은지는 말하지 않는다.** 38.0/38.5 자체가 잠정값이고
//   (`wear/core/Severity.kt:45` — "실내 정지 실측이 37.4~37.7 이므로" · 정답 귓속 체온 0건),
//   그것을 정하는 일은 별건이다. 여기서 재는 것은 **두 경로가 갈리지 않는가** 하나뿐이다.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { dangerMetrics } from "../app/api/app/vital/store";
import { skinTempStatus } from "./severity";

const TS = "2026-09-23T00:00:00.000Z";
const sample = (skinTempC: number) => ({ workerId: "EMP-1", ts: TS, skinTempC });

// 경계 위아래 · 옛 경로와 새 경로가 갈리는 구간(38.0~38.4)을 반드시 포함한다.
const TEMPS = [35.0, 37.9, 38.0, 38.1, 38.2, 38.4, 38.5, 38.6, 39.5, 40.1];

test("수집 시점 경보의 체온 판정 = 화면·집계와 같은 함수(skinTempStatus)", () => {
  for (const t of TEMPS) {
    const 경보 = dangerMetrics(sample(t)).includes("temp");
    const 화면 = skinTempStatus(t) === "danger";
    assert.equal(
      경보,
      화면,
      `피부온 ${t}℃ — 경보 ${경보 ? "위험" : "위험아님"} 대 화면 ${화면 ? "위험" : "위험아님"}. ` +
        `두 경로가 갈렸다(옛 coreTempStatus 가 남았는지 확인할 것)`,
    );
  }
});

// ★ 양성 통제 — 위 시험이 "전부 위험 아님" 같은 자명한 이유로 통과하지 않는지 본다.
//   이것이 깨지면 위 시험은 무엇도 재지 않고 있다([[output-exists-but-nothing-was-measured]]).
test("양성 통제 — 이 표본 집합은 양쪽 판정을 실제로 만든다", () => {
  const 위험 = TEMPS.filter((t) => skinTempStatus(t) === "danger");
  const 아님 = TEMPS.filter((t) => skinTempStatus(t) !== "danger");
  assert.ok(위험.length >= 3, `위험으로 판정되는 표본이 ${위험.length}개뿐이다`);
  assert.ok(아님.length >= 3, `위험 아님으로 판정되는 표본이 ${아님.length}개뿐이다`);
  // 옛 경로가 남아 있으면 정확히 여기서 갈린다 — 38.0~38.4 는 옛 위험 · 새 위험아님.
  assert.equal(skinTempStatus(38.2), "caution", "38.2 는 주의여야 한다(위험 아님)");
});
