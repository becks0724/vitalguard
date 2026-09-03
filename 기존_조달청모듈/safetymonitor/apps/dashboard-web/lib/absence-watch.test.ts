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
  shouldPushAbsence,
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
    { workerId: "EMP-6861", workerName: "장우진", lastHeartbeatIso: new Date(NOW - ms).toISOString(), worn: true, batteryStatus: null },
  ];
  assert.equal(decideAbsences(at(ABSENCE_THRESHOLD_MS - 1000), NOW).length, 0);
  assert.equal(decideAbsences(at(ABSENCE_THRESHOLD_MS), NOW).length, 1);
});

test("★ 한 번도 받은 적 없는 작업자는 공백으로 세지 않는다", () => {
  const out = decideAbsences(
    [{ workerId: "EMP-0001", workerName: "신규", lastHeartbeatIso: null, worn: true, batteryStatus: null }],
    NOW,
  );
  assert.equal(out.length, 0, "등록만 된 빈 슬롯이 매 틱 알림을 내면 진짜 공백과 구별되지 않는다");
});

test("잘못된 시각 문자열은 조용히 건너뛴다 — 한 행이 전체 점검을 죽이지 않는다", () => {
  const out = decideAbsences(
    [{ workerId: "EMP-9", workerName: null, lastHeartbeatIso: "not-a-date", worn: true, batteryStatus: null }],
    NOW,
  );
  assert.equal(out.length, 0);
});

test("공백 시작 시각은 마지막 수신 시각이다 — 길어져도 안 바뀐다(원장 dedup 키)", () => {
  const last = new Date(NOW - 30 * 60_000).toISOString();
  const w = [{ workerId: "EMP-6861", workerName: "장우진", lastHeartbeatIso: last, worn: true, batteryStatus: null }];
  const early = decideAbsences(w, NOW)[0]!;
  const later = decideAbsences(w, NOW + 60 * 60_000)[0]!;
  assert.equal(early.gapStartIso, later.gapStartIso, "키가 흔들리면 같은 공백이 반복 발화한다");
  assert.ok(later.elapsedMs > early.elapsedMs);
});

test("★ push 는 시각이 아니라 착용 상태로 갈린다 (2026-09-03)", () => {
  // 벗어 둔 워치는 감시 대상이 아니다 — 충전기 위든 책상 위든.
  assert.equal(shouldPushAbsence(false, null), false, "벗었는데 알렸다");
  assert.equal(shouldPushAbsence(null, 2), false, "충전 중(CHARGING)인데 알렸다");
  assert.equal(shouldPushAbsence(null, 5), false, "충전 중(FULL)인데 알렸다");
  // 차고 있는데 심박이 끊긴 것은 시각과 무관하게 사건이다.
  assert.equal(shouldPushAbsence(true, 3), true, "차고 있는데 안 알렸다");
  // 모르면 알린다 — 구 표본·폰은 착용을 안 싣는다. 안전 쪽으로 떨어뜨린다.
  assert.equal(shouldPushAbsence(null, null), true, "모름을 조용히 처리했다");
  assert.equal(shouldPushAbsence(true, null), true);
});

test("★★ 야간 근무자를 버리지 않는다 — 밤 2시라도 차고 있으면 push", () => {
  // 종전 규칙(07~19 시계 게이트)이 정확히 여기서 틀렸다. 밤에 차고 있던 작업자의 심박이
  // 끊겨도 시계가 밤이라는 이유로 조용했다 — 2026-09-03 사용자 판단으로 걷어냈다.
  const night = kst(2026, 8, 19, 2, 0);
  const out = decideAbsences(
    [{
      workerId: "EMP-6861",
      workerName: "장우진",
      lastHeartbeatIso: new Date(night - 30 * 60_000).toISOString(),
      worn: true,
      batteryStatus: 3,
    }],
    night,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.push, true, "밤이라는 이유로 야간 작업자의 생체 알림이 막혔다");
});

test("★★ 차고 있는 채 죽으면 낡은 worn=true 로 알린다 — 그것이 규칙의 근거다", () => {
  // 배터리 방전·앱 사망이면 **새 행이 아예 안 온다.** 그러면 마지막 행의 worn 이 true 인 채
  // 굳고 심박은 없으니 push 가 난다 — 손목에서 죽은 워치야말로 알아야 할 때다.
  //
  // ⚠ 이 시험이 지키는 것은 값이 아니라 **의도**다. 다음 사람이 낡은 worn 을
  //   "착용 센서 오작동 오탐" 으로 읽고 불신하게 고치면 **가장 위험한 경우가 조용해진다.**
  //   그 변경은 여기서 빨갛게 걸린다.
  const now = kst(2026, 8, 19, 3, 0); // 새벽 — 종전 시계 게이트가 덮어 버리던 시각
  const out = decideAbsences(
    [{
      workerId: "EMP-6861",
      workerName: "장우진",
      // 세 값 모두 **죽기 직전에 멈춘 것**이다. 그 뒤로 갱신이 없다.
      lastHeartbeatIso: new Date(now - 3 * 60 * 60_000).toISOString(),
      worn: true,
      batteryStatus: 3,
    }],
    now,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]!.push, true, "손목에서 죽은 워치를 조용히 넘겼다 — worn 을 불신하게 고쳤나?");
});

test("★ 벗어 두면 판정은 되고 push 만 꺼진다 — 원장·화면에서 사라지면 안 된다", () => {
  const noon = kst(2026, 8, 19, 14, 0);
  const out = decideAbsences(
    [{
      workerId: "EMP-6861",
      workerName: "장우진",
      lastHeartbeatIso: new Date(noon - 30 * 60_000).toISOString(),
      worn: false,
      batteryStatus: 5,
    }],
    noon,
  );
  assert.equal(out.length, 1, "판정 자체를 건너뛰면 원장이 비어 사후 조회가 불가능해진다");
  assert.equal(out[0]!.push, false, "충전기 위인데 낮이라고 알렸다");
});

test("★ 공백 기준은 '행이 왔나' 가 아니라 '심박이 왔나' 다", () => {
  // 09-03 오발동의 뿌리. 미착용 배터리 표본·착용 표식은 행은 만들지만 생체가 아니다.
  // 심박이 한 번도 없으면(=lastHeartbeatIso null) 대상에서 빠진다 — 대기 슬롯과 같은 취급.
  const out = decideAbsences(
    [{ workerId: "EMP-6861", workerName: "장우진", lastHeartbeatIso: null, worn: true, batteryStatus: 3 }],
    NOW,
  );
  assert.equal(out.length, 0, "심박이 없는데 공백으로 셌다 — 기준이 행 도착으로 되돌아갔다");
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
