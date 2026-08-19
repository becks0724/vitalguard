// 감시 공백 판정 테스트 — 임계·근무시간 경계·복귀 사후분류·문구 금지어를 고정한다.
//
// ★ 이 알림의 위험은 "안 울리는 것" 만이 아니다. **틀린 원인을 단정하는 것**이 같은 무게다 —
//   같은 끊김이 거리 이탈일 수 있고 그건 자동 복구된다(실기기 확증). 문구가 "수동 재개 필요" 라
//   말하면 관제자가 매번 현장에 전화하게 되고, 그러면 일주일 만에 알림을 끈다.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  ABSENCE_THRESHOLD_MS,
  absenceMessage,
  classifyRecovery,
  decideAbsences,
  formatElapsed,
  isWithinPushWindow,
  recoveryAckBy,
  recoveryMessage,
} from "./absence-watch";

/** KST 시각 → epoch ms. 테스트가 서버 타임존에 흔들리지 않게 UTC 로 환산해 만든다. */
function kst(y: number, mo: number, d: number, h: number, mi = 0): number {
  return Date.UTC(y, mo - 1, d, h - 9, mi);
}

const NOW = kst(2026, 8, 19, 14, 0); // 근무시간 한복판

test("임계 미만은 공백이 아니다 — 9분 59초는 통과, 10분은 걸린다", () => {
  const at = (ms: number) => [
    { workerId: "EMP-6861", workerName: "장우진", lastSeenIso: new Date(NOW - ms).toISOString() },
  ];
  assert.equal(decideAbsences(at(ABSENCE_THRESHOLD_MS - 1000), NOW).length, 0);
  assert.equal(decideAbsences(at(ABSENCE_THRESHOLD_MS), NOW).length, 1);
});

test("★ 한 번도 받은 적 없는 작업자는 공백으로 세지 않는다", () => {
  const out = decideAbsences(
    [{ workerId: "EMP-0001", workerName: "신규", lastSeenIso: null }],
    NOW,
  );
  assert.equal(out.length, 0, "등록만 된 빈 슬롯이 매 틱 알림을 내면 진짜 공백과 구별되지 않는다");
});

test("잘못된 시각 문자열은 조용히 건너뛴다 — 한 행이 전체 점검을 죽이지 않는다", () => {
  const out = decideAbsences(
    [{ workerId: "EMP-9", workerName: null, lastSeenIso: "not-a-date" }],
    NOW,
  );
  assert.equal(out.length, 0);
});

test("공백 시작 시각은 마지막 수신 시각이다 — 길어져도 안 바뀐다(원장 dedup 키)", () => {
  const last = new Date(NOW - 30 * 60_000).toISOString();
  const w = [{ workerId: "EMP-6861", workerName: "장우진", lastSeenIso: last }];
  const early = decideAbsences(w, NOW)[0]!;
  const later = decideAbsences(w, NOW + 60 * 60_000)[0]!;
  assert.equal(early.gapStartIso, later.gapStartIso, "키가 흔들리면 같은 공백이 반복 발화한다");
  assert.ok(later.elapsedMs > early.elapsedMs);
});

test("★ 근무시간 경계 — 07:00 부터 19:00 직전까지만 push", () => {
  assert.equal(isWithinPushWindow(kst(2026, 8, 19, 6, 59)), false);
  assert.equal(isWithinPushWindow(kst(2026, 8, 19, 7, 0)), true);
  assert.equal(isWithinPushWindow(kst(2026, 8, 19, 18, 59)), true);
  assert.equal(isWithinPushWindow(kst(2026, 8, 19, 19, 0)), false);
  assert.equal(isWithinPushWindow(kst(2026, 8, 19, 2, 0)), false);
});

test("★ 야간 공백도 판정은 되고 push 만 꺼진다 — 화면·원장에서 사라지면 안 된다", () => {
  const night = kst(2026, 8, 19, 2, 0);
  const out = decideAbsences(
    [{
      workerId: "EMP-6861",
      workerName: "장우진",
      lastSeenIso: new Date(night - 30 * 60_000).toISOString(),
    }],
    night,
  );
  assert.equal(out.length, 1, "야간이라고 판정 자체를 건너뛰면 원장이 비어 사후 조회가 불가능해진다");
  assert.equal(out[0]!.push, false);
});

test("★ 복귀 사후분류 — 실측 두 모집단(수집정지 ≤11초 · 전달단절 ≥332초)이 갈린다", () => {
  // 2026-08-19 프로덕션 7일 실측값을 그대로 넣는다.
  for (const lag of [0, 2, 3, 7, 10, 11]) {
    assert.equal(classifyRecovery(lag), "collection", `${lag}초는 수집 정지여야 한다`);
  }
  for (const lag of [332, 333, 427, 504, 653, 968]) {
    assert.equal(classifyRecovery(lag), "delivery", `${lag}초는 전달 단절이어야 한다`);
  }
});

test("복귀 직후 심박이 없으면 원인을 지어내지 않는다", () => {
  assert.equal(classifyRecovery(null), "unknown");
  assert.match(recoveryAckBy("unknown"), /판정 불가/);
});

test("경과 표기", () => {
  assert.equal(formatElapsed(23 * 60_000), "23분");
  assert.equal(formatElapsed(774 * 60_000), "12시간 54분");
});

test("★ 공백 문구가 원인·조치를 단정하지 않는다", () => {
  const text = absenceMessage({
    workerId: "EMP-6861",
    workerName: "장우진",
    gapStartIso: new Date(NOW - 23 * 60_000).toISOString(),
    elapsedMs: 23 * 60_000,
  });
  for (const banned of ["수동", "재개", "장애", "고장", "이탈", "복구하"]) {
    assert.ok(
      !text.includes(banned),
      `"${banned}" 는 그 순간 서버가 알 수 없는 것이다 — 관측 사실만 적어야 한다\n${text}`,
    );
  }
  assert.ok(text.includes("23분째 수신 없음"), text);
  assert.ok(text.includes("감시되지 않습니다"), "상태의 재진술은 남겨야 한다 — 이게 이 알림의 요지다");
});

test("★ 실명 원문을 싣지 않는다(SEC-PRIV-01) — 마스킹 + 사번", () => {
  const common = { workerId: "EMP-6861", workerName: "장우진", gapStartIso: new Date(NOW).toISOString() };
  const a = absenceMessage({ ...common, elapsedMs: 23 * 60_000 });
  const r = recoveryMessage({ ...common, gapMs: 23 * 60_000, cause: "collection" });
  for (const text of [a, r]) {
    assert.ok(!text.includes("장우진"), `텔레그램은 국외 SaaS 라 실명+건강상태 조합을 실으면 안 된다\n${text}`);
    assert.ok(text.includes("장○진"), text);
    assert.ok(text.includes("EMP-6861"), text);
  }
});

test("해제 문구는 원인을 말한다 — 복귀해야 갈리므로 여기서만", () => {
  const base = {
    workerId: "EMP-6861",
    workerName: null,
    gapStartIso: new Date(NOW).toISOString(),
    gapMs: 20.9 * 60_000,
  };
  assert.match(recoveryMessage({ ...base, cause: "collection" }), /수집이 멎어/);
  assert.match(recoveryMessage({ ...base, cause: "delivery" }), /워치는 재고 있었음/);
});
