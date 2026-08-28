// 생체 수신 나이 — 연결끊김 판정 기준의 단위 검증.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { STALE_LABEL, staleKind, vitalAgeMs } from "./vital-age";

const WEAROS = "wearos_data_vitalguard";

const NOW = Date.parse("2026-08-15T10:00:00.000Z");
const at = (sec: number) => new Date(NOW - sec * 1000).toISOString();

test("심박 측정 시각이 있으면 그것으로 잰다(행 ts 아님)", () => {
  // 핵심 회귀 형태 — 행은 방금 왔지만(활동에너지) 심박은 5분 전이 마지막.
  const age = vitalAgeMs({ ts: at(2), heartRateMeasuredAt: at(300) }, NOW);
  assert.equal(age, 300_000, "행 ts 로 재면 2초가 나와 미착용이 '정상'으로 보인다");
});

test("정상 착용 — 둘 다 신선하면 나이도 작다", () => {
  const age = vitalAgeMs({ ts: at(2), heartRateMeasuredAt: at(4) }, NOW);
  assert.equal(age, 4_000);
});

test("측정 시각이 없으면 행 ts 로 폴백한다(구 앱·이벤트 행 하위 호환)", () => {
  assert.equal(vitalAgeMs({ ts: at(45) }, NOW), 45_000);
});

test("★ 파싱 불가한 측정 시각은 행 ts 로 폴백한다", () => {
  // NaN 이 그대로 나가면 비교가 전부 false 가 되어 "영원히 신선"이 된다 — false-OK 의 형태.
  const age = vitalAgeMs({ ts: at(90), heartRateMeasuredAt: "쓰레기값" }, NOW);
  assert.equal(age, 90_000, "NaN 이 새어 나가면 연결끊김을 영영 못 잡는다");
  assert.ok(Number.isFinite(age));
});

test("STALE_MS(60초) 경계 — 미착용 판정이 뒤집히는 지점", () => {
  const STALE_MS = 60_000;
  assert.ok(vitalAgeMs({ ts: at(1), heartRateMeasuredAt: at(59) }, NOW) <= STALE_MS, "59초는 통과");
  assert.ok(vitalAgeMs({ ts: at(1), heartRateMeasuredAt: at(61) }, NOW) > STALE_MS, "61초는 끊김");
});

test("실제 미착용 시나리오 — 하트비트 30초 + 게이트 60초 = 약 90초에 잡힌다", () => {
  // 워치는 마지막 실측 후 30초까지 값을 복사 전송하므로(heartbeatMaxAge) 측정 시각이 그만큼 젊다.
  const 마지막실측 = 150; // 초 전
  const 하트비트마지막 = 마지막실측 - 30; // 120초 전까지는 복사본이 측정 시각을 갱신했다
  const age = vitalAgeMs({ ts: at(2), heartRateMeasuredAt: at(하트비트마지막) }, NOW);
  assert.ok(age > 60_000, "미착용 150초 뒤에는 확실히 끊김으로 잡혀야 한다");
});

test("활동에너지만 계속 와도 나이는 자란다(이 수정의 목적)", () => {
  // 미착용 구간 실측 = 행은 12건/분 그대로, 심박만 없음.
  let hrAt = at(300);
  for (const rowAge of [2, 7, 12, 17]) {
    const age = vitalAgeMs({ ts: at(rowAge), heartRateMeasuredAt: hrAt }, NOW);
    assert.ok(age > 60_000, `행이 ${rowAge}초 전이어도 심박 나이(${age / 1000}초)가 기준이다`);
  }
  hrAt = at(3); // 착용 재개 → 즉시 회복
  assert.ok(vitalAgeMs({ ts: at(2), heartRateMeasuredAt: hrAt }, NOW) < 60_000, "재개 시 바로 정상");
});

// ── staleKind — 같은 stale 이라도 관제자가 할 일이 정반대다 ──────────────────

test("★ 샘플은 오는데 심박만 묵으면 hrSilent — 갤럭시의 상시 형태", () => {
  // 실측 형태(2026-08-28) = 빈 행이 120초마다 도착하는데 마지막 심박은 5분 전.
  const sample = { ts: at(30), heartRateMeasuredAt: at(300) };
  assert.ok(vitalAgeMs(sample, NOW) > 150_000, "전제 — 이 샘플은 stale 이다");
  assert.equal(staleKind(sample, NOW, WEAROS), "hrSilent", "행이 30초 전이면 링크는 살아 있다");
});

test("★ 샘플 자체가 안 오면 disconnected — 사람을 찾아가야 하는 쪽", () => {
  const sample = { ts: at(400), heartRateMeasuredAt: at(400) };
  assert.equal(staleKind(sample, NOW, WEAROS), "disconnected");
});

test("★ 경계는 출처별 문턱을 탄다 — 같은 행 나이가 기기마다 다르게 갈린다", () => {
  // 행 나이 100초. 갤럭시(150초)는 아직 도착 중이고, 애플(60초)은 이미 끊긴 것이다.
  const sample = { ts: at(100), heartRateMeasuredAt: at(900) };
  assert.equal(staleKind(sample, NOW, WEAROS), "hrSilent", "갤럭시 100초는 정상 주기 안");
  assert.equal(staleKind(sample, NOW, undefined), "disconnected", "애플 100초는 이미 끊김");
});

test("★ 문턱 바로 양옆 — 갤럭시 150초", () => {
  const kind = (rowAgeSec: number) =>
    staleKind({ ts: at(rowAgeSec), heartRateMeasuredAt: at(9_999) }, NOW, WEAROS);
  assert.equal(kind(149), "hrSilent", "149초는 아직 도착 중");
  assert.equal(kind(151), "disconnected", "151초는 도착이 끊겼다");
});

test("★ 파싱 불가한 ts 는 disconnected — 안전측(사람이 가 보는 쪽)", () => {
  // 도착을 확인할 수 없는데 "링크는 살아 있다" 고 부르면 아무도 안 간다.
  assert.equal(staleKind({ ts: "쓰레기값" }, NOW, WEAROS), "disconnected");
});

test("★ 라벨은 넉 자로 맞춘다 — 표 상태 칸이 종류마다 출렁이면 목록이 흔들린다", () => {
  assert.equal(STALE_LABEL.disconnected.length, STALE_LABEL.hrSilent.length);
  assert.notEqual(STALE_LABEL.disconnected, STALE_LABEL.hrSilent, "두 상태가 같은 글자면 가른 의미가 없다");
});
