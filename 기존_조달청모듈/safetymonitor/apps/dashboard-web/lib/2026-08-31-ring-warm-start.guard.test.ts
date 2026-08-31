// 링 웜스타트 가드(2026-08-31 · 사용자 목표 "끊김 없는 연속 표시") — 새 인스턴스의 빈 링을 DB 꼬리로 채운다
//
// ★ 왜. 배포·스케일아웃마다 메모리 링이 비어 관제 화면이 다음 배치(갤럭시 120초)까지 "대기" 로 떨어졌다
//   (08-31 하루 4회 실측 · 사용자 스크린샷). DB 는 멀쩡한데 화면만 비는 구멍이다.
// ★ 되돌아가는 방식 = 조회 SQL 에 `ts::timestamptz >` 창 필터가 들어가거나(Seq Scan 890MB — absence-check
//   5분 행의 원인), GET 경로에서 hydrate 호출이 빠지거나, 병합이 중복·창·예약ID·상한을 잃거나, 실패가 throw 로 새거나.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { VitalSample } from "@safetymonitor/schemas";

import { mergeHydratedSamples } from "../app/api/app/vital/store";

const ROOT = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const db = codeOnly(read("lib", "db.ts"));
const store = codeOnly(read("app", "api", "app", "vital", "store.ts"));

const s = (partial: Partial<VitalSample> & { workerId: string; ts: string }): VitalSample => partial as VitalSample;
const NOW = Date.parse("2026-08-31T06:00:00Z");

test("① 병합 — 창(30분) 안의 새 표본만 얹고, 중복·예약 ID·창 밖은 뺀다 · ts 오름차순", () => {
  const existing = [s({ workerId: "EMP-1", ts: "2026-08-31T05:58:00Z", heartRate: 80 })];
  const tail = [
    s({ workerId: "EMP-1", ts: "2026-08-31T05:20:00Z", heartRate: 70 }), // 창 밖(40분 전)
    s({ workerId: "EMP-1", ts: "2026-08-31T05:40:00Z", heartRate: 72 }), // 창 안
    s({ workerId: "EMP-1", ts: "2026-08-31T05:58:00Z", heartRate: 80 }), // 중복
    s({ workerId: "warmup", ts: "2026-08-31T05:59:00Z", heartRate: 1 }), // 예약 ID
    s({ workerId: "EMP-2", ts: "2026-08-31T05:59:30Z", heartRate: 90 }),
  ];
  const out = mergeHydratedSamples(existing, tail, NOW);
  assert.deepEqual(out.map((x) => `${x.workerId}@${x.ts}`), [
    "EMP-1@2026-08-31T05:40:00Z",
    "EMP-1@2026-08-31T05:58:00Z",
    "EMP-2@2026-08-31T05:59:30Z",
  ]);
});

test("② 병합 — 얹을 것이 없으면 기존 배열을 그대로 돌려준다(불필요한 재정렬 없음)", () => {
  const existing = [s({ workerId: "EMP-1", ts: "2026-08-31T05:58:00Z" })];
  assert.equal(mergeHydratedSamples(existing, [existing[0]!], NOW), existing);
});

test("③ 병합 — 링 상한(500)을 넘기지 않고 최신 쪽을 남긴다", () => {
  const tail: VitalSample[] = [];
  for (let i = 0; i < 700; i++) {
    tail.push(s({ workerId: "EMP-1", ts: new Date(NOW - 29 * 60000 + i * 2000).toISOString() }));
  }
  const out = mergeHydratedSamples([], tail, NOW);
  assert.equal(out.length, 500);
  assert.equal(out[out.length - 1]!.ts, tail[tail.length - 1]!.ts, "최신 표본이 잘렸다");
});

test("④ DB 소스 — 꼬리 조회는 id 역순 LIMIT 만 쓰고 ts 캐스트 창 필터를 쓰지 않는다(Seq Scan 방지)", () => {
  const fn = db.slice(db.indexOf("export async function recentSamplesTail"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 3);
  assert.match(body, /ORDER BY id DESC LIMIT \$1/, "id 역순 LIMIT 이 아니다");
  assert.doesNotMatch(body, /ts::timestamptz/, "ts 캐스트 창 필터가 들어갔다 — 41만 행 Seq Scan");
});

test("⑤ 서버 소스 — GET 의 latest 조립 전에 웜스타트를 await 하고, 실패는 throw 로 새지 않는다", () => {
  assert.match(store, /await hydrateRingOnce\(\);\s*const latest = latestByWorker\(aliasMap\)/, "GET 경로에서 웜스타트가 빠졌다");
  const fn = store.slice(store.indexOf("export function hydrateRingOnce"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 3);
  assert.match(body, /catch \(e\)/, "실패를 잡지 않는다 — 웜스타트 실패가 관제 조회 전체를 죽인다");
  assert.match(body, /ringHydration = null/, "실패 후 재시도 경로가 없다 — 기동 직후 DB 타임아웃이면 영영 빈 링");
});
