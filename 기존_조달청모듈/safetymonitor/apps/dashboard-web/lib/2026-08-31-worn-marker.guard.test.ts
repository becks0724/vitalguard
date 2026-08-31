// 착용 표식(worn) 가드(2026-08-31 사용자 지시) — 워치가 벗음 순간 알리고, 관제가 "미착용" 으로 즉시·구분해 보인다
//
// ★ 왜. 벗으면 수집이 멈춰 서버는 "표본이 안 온다" 로 150초 뒤에야 알았고(14:22 실측), 그 표시가 고장(연결끊김)과
//   같았다. 표식 1건(worn:false)을 즉시 올리면 갤럭시는 수 초 내 "미착용" 이 뜨고 고장과 갈린다. 애플은 못 한다.
// ★ 되돌아가는 방식 = 스키마에서 필드가 빠지거나(zod strip → 조용히 무시), 병합이 sticky 를 잃거나(표식 뒤 무음
//   구간에 라벨이 사라진다), 화면이 라벨을 안 가르거나, 유지값(회색)이 미착용에도 뜨거나, 워치가 표식/평시 플래그를
//   안 싣거나, 표식이 다음 tick 을 기다리거나(즉시성 상실).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { VitalSample } from "@safetymonitor/schemas";

import { mergeLatestByWorker } from "../app/api/app/vital/store";

const ROOT = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const schema = codeOnly(read("..", "..", "packages", "schemas", "src", "vital-stream.ts"));
const store = codeOnly(read("app", "api", "app", "vital", "store.ts"));
const board = codeOnly(read("app", "components", "DemoDashboard.tsx"));
const WEAR = ["..", "vitalguard_app", "android", "wear", "src", "main", "kotlin", "com", "vitalguard", "wear"];
const collector = codeOnly(read(...WEAR, "CollectorService.kt"));
const builder = codeOnly(read(...WEAR, "pipeline", "SampleBuilder.kt"));
const marker = codeOnly(read(...WEAR, "pipeline", "WornMarker.kt"));

const s = (partial: Partial<VitalSample> & { workerId: string; ts: string }): VitalSample => partial as VitalSample;

test("① 계약 — 스키마 `worn: boolean` 과 워치 표식 키 이름이 같다", () => {
  assert.match(schema, /worn: z\.boolean\(\)\.optional\(\)/, "스키마에 worn 이 없다 — zod 가 조용히 버린다");
  assert.match(marker, /"worn" to worn, "ts" to IsoMs\.format\(nowMs\)/, "표식이 worn+ts 두 키가 아니다");
  assert.match(builder, /v\["worn"\] = true/, "평시 표본이 worn:true 를 안 싣는다 — 다시 차도 미착용이 안 풀린다");
});

test("② 병합 — worn 은 sticky: 표식 뒤 무음이어도 유지되고, 평시 표본이 오면 되돌아온다", () => {
  const [off] = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-08-31T05:00:00Z", heartRate: 80, worn: true }),
    s({ workerId: "EMP-1", ts: "2026-08-31T05:02:00Z", worn: false }),
  ]);
  assert.equal(off!.worn, false);
  assert.equal(off!.heartRate, 80, "생체 sticky 는 그대로(표식은 생체를 지우지 않는다)");
  const [stillOff] = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-08-31T05:02:00Z", worn: false }),
    s({ workerId: "EMP-1", ts: "2026-08-31T05:03:00Z", batteryPct: 50 }), // 키 없음
  ]);
  assert.equal(stillOff!.worn, false, "키 없는 표본이 sticky 를 지웠다");
  const [back] = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-08-31T05:02:00Z", worn: false }),
    s({ workerId: "EMP-1", ts: "2026-08-31T05:10:00Z", heartRate: 75, worn: true }),
  ]);
  assert.equal(back!.worn, true);
  assert.match(store, /worn: newer\.worn \?\? older\?\.worn,/, "병합 소스에서 sticky 줄이 사라졌다");
});

test("③ 화면 — 미착용은 끊김과 같이 게이트·강등되되 라벨은 '미착용' 이고 유지값(회색)은 뜨지 않는다", () => {
  assert.match(board, /const offBody = sample\?\.worn === false;/, "행에서 표식을 안 읽는다");
  assert.match(board, /const stale = sample !== undefined && \(signal === 0 \|\| offBody\);/, "미착용이 값 게이트·톤 강등을 안 탄다");
  assert.match(board, /const staleLabel = offBody \? OFF_BODY_LABEL : kind !== undefined \? STALE_LABEL\[kind\] : "";/, "라벨이 안 갈린다");
  assert.match(board, /stale && !offBody && sample !== undefined/, "미착용에도 '끊김 전 값' 회색이 뜬다");
  assert.match(board, /offBody={offBody}/, "신호등이 미착용을 모른다(점멸=고장 신호)");
  assert.match(board, /statusLabel: offBody \? OFF_BODY_LABEL : stale \? STALE_LABEL\.disconnected : status\.label,/, "지도 라벨이 안 갈린다");
});

test("④ 워치 — 벗음/착용 전이에서 표식을 큐에 넣고 **즉시** 올린다(다음 tick 대기 금지) · tick 은 같은 업로드 함수", () => {
  const fn = collector.slice(collector.indexOf("private fun postWornMarker"));
  const body = fn.slice(0, fn.indexOf("\n    }\n") + 7);
  assert.match(body, /handler\.post \{/, "메인 스레드에서 큐를 만진다 — 큐 계약 위반");
  assert.match(body, /queue\.add\(WornMarker\.build\(wornNow, System\.currentTimeMillis\(\)\)\)/, "표식을 큐에 안 넣는다");
  assert.match(body, /uploadOnce\(System\.currentTimeMillis\(\)\)/, "즉시 업로드가 빠졌다 — 표식이 다음 tick(≤120s)을 기다린다");
  assert.match(collector, /Log\.i\(TAG, "벗음 — 수집 중지 \(큐 \$\{queue\.size\}건 보존\)"\)\s*postWornMarker\(false\)/, "endSensing 이 표식을 안 보낸다");
  assert.match(collector, /postWornMarker\(true\)/, "다시 찼을 때 표식이 없다 — 미착용이 다음 tick 까지 남는다");
  const tick = collector.slice(collector.indexOf("private val tick"), collector.indexOf("private fun uploadOnce"));
  assert.match(tick, /uploadOnce\(now\)/, "tick 이 공용 업로드 함수를 안 쓴다");
  assert.doesNotMatch(tick, /scheduleTick\(\)[\s\S]*scheduleTick\(\)/, "tick 안에 알람 스케줄이 둘 이상");
  assert.doesNotMatch(body, /scheduleTick\(\)/, "표식 전송이 알람을 다시 건다 — 이중 tick");
});
