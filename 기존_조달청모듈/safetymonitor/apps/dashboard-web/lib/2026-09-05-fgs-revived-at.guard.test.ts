// 하트비트 소생 시각 가드 — 워치가 보낸 fgsRevivedAt 이 파싱·저장 끝까지 살아 가고, 판정 어디에도 새지 않는가(L-115 양 끝)
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { VitalSampleSchema, parseResilientVitalSample } from "@safetymonitor/schemas";

// ★ 이 가드의 한 문장 보장 =
//   **`fgsRevivedAt` 이 무음으로 사라지지도, 생체 샘플을 죽이지도, 판정에 끼어들지도 않는다.**
//
// 왜 이 필드가 있는가 — 09-02·09-03 워치8 실측. 수집 서비스가 뒤에서 죽으면(tick 사망 → sticky 재기동 →
// 백그라운드 FGS 거부) `giveUpForeground` 로 물러선 뒤 사람이 앱을 열기까지 **아무것도 되살리지 않았다**.
// 하트비트 알람(10분 · 프로세스 밖)이 그 자리를 잇는데, DB 로는 "죽었다 살아난 것" 과 "안 죽은 것" 이
// 똑같이 *행이 이어진다* 로 보인다. 그래서 소생 시각 하나를 표본에 실어 두 행의 비교만으로 그 사이
// 사망 유무를 내게 한다. docs/wear-fgs-heartbeat R-06.

const TS = "2026-09-05T00:00:00.000Z";
const base = { workerId: "EMP-0000", ts: TS };
const WIRE_KEY = "fgsRevivedAt";

test("스키마가 소생 시각을 통과시킨다", () => {
  const parsed = VitalSampleSchema.parse({ ...base, fgsRevivedAt: "2026-09-05T09:10:00.000Z" });
  assert.equal(parsed.fgsRevivedAt, "2026-09-05T09:10:00.000Z", "Zod 가 소생 시각을 strip 했다");
});

test("없어도 통과한다 - 없음이 곧 '하트비트로 올라온 적 없음' 이다", () => {
  const parsed = VitalSampleSchema.parse({ ...base, heartRate: 88 });
  assert.equal(parsed.fgsRevivedAt, undefined);
  assert.equal(parsed.heartRate, 88, "기존 필드가 함께 죽었다");
});

test("깨진 값은 저 필드만 버리고 생체는 살린다", () => {
  const stripped: string[] = [];
  const r = parseResilientVitalSample(
    { ...base, heartRate: 88, batteryPct: 41, fgsRevivedAt: "소생함" },
    (keys) => stripped.push(...keys),
  );
  assert.equal(r.heartRate, 88, "진단 필드 하나가 심박을 통째로 날렸다");
  assert.equal(r.batteryPct, 41, "같은 행의 다른 값도 함께 죽었다");
  assert.equal(r.fgsRevivedAt, undefined, "깨진 값이 그대로 통과했다");
  assert.ok(stripped.includes(WIRE_KEY), "스트립 통지에 이 키가 없다 — 허용목록 미등재");
});

test("통제군 - 허용목록 밖의 시각 필드는 여전히 샘플을 거부시킨다", () => {
  // 이것이 없으면 위 초록불이 "스트립이 동작한다" 가 아니라 "무엇이든 다 통과한다" 여도 초록이다.
  assert.throws(
    () => parseResilientVitalSample({ ...base, heartRate: 88, sessionStartedAt: "어제" }),
    "허용목록 밖까지 스트립한다 — 등재가 곧 보호라는 계약이 깨졌다",
  );
});

test("배포 순서의 근거 - 서버가 모르는 키는 거부가 아니라 무음 손실이다", () => {
  // z.object 기본은 미등재 키 strip. 워치가 서버보다 먼저 이 키를 보내면 생체는 살고 표식만 사라진다.
  // 그래서 서버를 먼저 배포한다(R-06) — 순서가 뒤바뀌어도 사고는 아니고 관측만 잃는다는 것을 여기 적어 둔다.
  const parsed = VitalSampleSchema.parse({ ...base, heartRate: 88, neverDeclaredKey: "x" });
  assert.equal((parsed as Record<string, unknown>).neverDeclaredKey, undefined);
  assert.equal(parsed.heartRate, 88);
});

test("앱은 깨진 값을 만들 수 없다 - IsoMs 를 거치고, 두 갈래 모두 싣는다", () => {
  const wear = readFileSync(
    "../vitalguard_app/android/wear/src/main/kotlin/com/vitalguard/wear/pipeline/SampleBuilder.kt",
    "utf8",
  );
  const hits = wear.match(/v\["fgsRevivedAt"\]\s*=\s*IsoMs\.format\(it\)/g) ?? [];
  // 측정 있음 / 무동작 단독 — 한 갈래만 실으면 미착용 구간의 소생이 안 보인다.
  assert.equal(hits.length, 2, `워치가 두 갈래에 싣지 않는다 (발견 ${hits.length}곳)`);
});

// ── 저장 끝단 ────────────────────────────────────────────────────────────────
// 전용 열이 없다 — hrLastReviveAt 과 같이 raw_json 경로다. 단언 대상은 열 DDL 이 아니라 직렬화 자리다.
const db = readFileSync("lib/db.ts", "utf8");

test("파싱된 표본이 통째로 raw_json 에 실린다", () => {
  assert.match(db, /raw_json:\s*JSON\.stringify\(sample\)/, "전용 열이 없는 필드는 여기서만 남는다");
});

// ── 무유입 ───────────────────────────────────────────────────────────────────
// "판정·경보·화면 어디에도 쓰지 않는다" 는 주석이 아니라 검사여야 한다. 스키마와 이 가드 밖에서
// 이 키를 읽는 소스가 생기면 그 순간 순수 관측값이 아니다 — 그때는 이 가드를 **의도적으로** 고친다.
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

test("ExportRow 에 없고, 판정·경보·화면 소스 어디에도 없다", () => {
  const exportRow = db.slice(db.indexOf("export type ExportRow = {"), db.indexOf("};", db.indexOf("export type ExportRow = {")));
  assert.ok(exportRow.length > 0, "ExportRow 정의를 못 찾았다");
  assert.doesNotMatch(exportRow, /fgsRevivedAt/, "진단 필드가 내보내기 열에 들어갔다");
  const leaks = [...walk("lib"), ...walk("app")].filter((p) => readFileSync(p, "utf8").includes(WIRE_KEY));
  assert.deepEqual(leaks, [], `순수 관측값이 판정 소스에 새었다: ${leaks.join(", ")}`);
});
