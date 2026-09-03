// 감시 공백 판정 — "서버가 N분째 못 받고 있다" 를 정하는 순수 로직(DB·현재시각 의존 없음)
//
// ★ 이 모듈이 존재하는 이유. 관제 경보는 전부 **샘플이 들어올 때** 발화한다(recordAlert 호출부가
//   모두 수신 경로다). 샘플이 안 오면 발화 지점 자체가 없어서, 2026-08-18 19:01 부터 12.9시간
//   수신이 끊겼는데 경보가 0건이었다. 부재는 수신으로 감지할 수 없으므로 서버가 주기로 캐물어야 한다.

import { maskWorkerName } from "./telegram";

/** 이만큼 못 받으면 공백으로 본다. 7일 실측 24건(하루 3.4회) — 30분으로 올리면 08-18 의 20.9분을 놓친다. */
export const ABSENCE_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * ★★ **시계 게이트(07~19)를 걷어냈다 — 2026-09-03 사용자 결정.**
 *
 * 종전 규칙 = 근무시간에만 push, 야간은 원장·화면만. 근거는 "10분 초과 공백 24건 중 7건이
 * 야간 시작 600~920분이라 퇴근으로 보인다" 였고, 밤마다 울리면 일주일이면 무시된다는 것이었다.
 *
 * ⚠ **그 규칙은 야간 작업자를 통째로 버린다.** 밤 11시에 차고 있던 작업자의 심박이 끊겨도
 *   시계가 밤이라는 이유로 조용했다. 안전 알림에서 그것은 받아들일 수 없다(사용자 판단).
 *
 * ★ 그리고 종전 주석이 "그래서 시계로 자를 수밖에 없다" 고 적은 **전제가 오늘 깨졌다.**
 *   그 자리에는 이렇게 적혀 있었다 —
 *     "배터리로 '충전=퇴근' 을 가르는 안은 폐기됐다. **부재 중에는 아무 데이터도 안 오므로**
 *      충전 여부는 복구된 뒤에야 보인다(실시간 판단 불가)."
 *   09-03 에 워치가 **미착용 중에도 10분마다 배터리를 보내기** 시작했다(WornMarker.idleBattery).
 *   이제 부재 중에도 착용·충전 상태가 실시간으로 온다.
 *
 * ⟹ 시각이 아니라 **상태**로 가른다 — [shouldPushAbsence].
 *   · 벗어 둠(충전기 위 포함) → push 안 함. 사람이 안 차고 있으니 감시 대상이 아니다.
 *   · 차고 있는데 심박이 없음 → push. **시각 무관** — 밤 11시든 낮 2시든 같은 사건이다.
 *   · 모름(구 표본·폰) → push. 안전 쪽으로 떨어뜨린다.
 *
 * ⚠ 남는 위험 = 착용 센서가 벗음을 놓치면(오작동) 야간에 울린다. 시계 게이트가 덮어 주던
 *   자리다. 실측으로 시끄러우면 여기서 다시 정한다 — 시계로 되돌리지는 않는다.
 */
/** 충전 중으로 보는 Android `BATTERY_STATUS_*` — 2 CHARGING · 5 FULL(09-03 실기 확인). */
const CHARGING_STATUSES = new Set([2, 5]);

/**
 * 복귀 직후 측정 지연이 이 값을 넘으면 **밀린 것이 몰려 온 것** = 전달 단절.
 *
 * 7일 실측에서 두 모집단이 깨끗이 갈린다 — 수집 정지 ≤ 11초 · 전달 단절 ≥ 332초.
 * (지표는 `ts − heart_rate_measured_at`. 도착 시각 기준(`received_at − ts`)으로는 안 갈린다 —
 *  전 구간 0~4초라 아무것도 구별하지 못한다. 2026-08-19 실측으로 확인.)
 */
export const DELIVERY_STALL_LAG_SEC = 60;

export type WorkerLastSeen = {
  workerId: string;
  workerName: string | null;
  /**
   * 마지막으로 **심박이 온** 시각. 한 번도 없었으면 null.
   * ⚠ "행이 온 시각" 이 아니다 — 행은 생체 없이도 온다(착용 표식·미착용 배터리 표본).
   */
  lastHeartbeatIso: string | null;
  /** 최근 관측된 착용 상태. `null` = 모름(구 표본·폰). */
  worn: boolean | null;
  /** 최근 관측된 배터리 상태 원시값(Android `BATTERY_STATUS_*`). `null` = 모름. */
  batteryStatus: number | null;
};

/**
 * 이 공백을 push 할 것인가 — **시각이 아니라 상태로** 정한다(2026-09-03).
 *
 * 벗어 둔 워치는 감시 대상이 아니다. 반대로 차고 있는데 심박이 끊긴 것은
 * **밤이든 낮이든 같은 사건**이라 시각으로 막지 않는다.
 * 모르면(둘 다 null) push 한다 — 안전 쪽으로 떨어뜨린다.
 *
 * ★★ **`worn` 이 낡은 채 `true` 로 남는 것은 버그가 아니라 이 규칙의 근거다.**
 *   차고 있는 채 워치가 죽으면(배터리 방전·앱 사망) **새 행이 아예 안 온다.** 그러면
 *   [lastSeenByWorker] 가 읽는 "마지막 행의 worn" 이 `true` 인 채로 굳고, 심박은 없으니
 *   여기서 push 가 난다 — **손목에서 죽은 워치야말로 알아야 할 때**이므로 그것이 옳다.
 *   ⚠ 다음 사람이 이것을 "착용 센서 오작동 오탐" 으로 읽고 worn 을 불신하게 고치기 쉽다.
 *     그렇게 하면 **가장 위험한 경우가 조용해진다.** 시험이 이 시나리오를 못 박고 있다
 *     (absence-watch.test.ts — "차고 있는 채 죽으면 …").
 *   ⚠ 경로를 헷갈리지 말 것 — 알림이 보는 것은 `store.ts` 의 sticky 병합
 *     (`worn: newer.worn ?? older?.worn`)이 **아니라** SQL 이 고른 마지막 행이다.
 *     둘 다 같은 결론에 닿지만 고칠 자리는 다르다(sticky 는 화면 쪽 계약이다).
 */
export function shouldPushAbsence(worn: boolean | null, batteryStatus: number | null): boolean {
  if (worn === false) return false;
  if (batteryStatus !== null && CHARGING_STATUSES.has(batteryStatus)) return false;
  return true;
}

export type AbsenceDecision = {
  workerId: string;
  workerName: string | null;
  /** 공백이 시작된 시각 = 마지막 수신 시각. 원장 dedup 키라 공백이 길어져도 안 바뀐다. */
  gapStartIso: string;
  elapsedMs: number;
  /** 근무시간 안에서 감지됐는가. false 면 원장·화면만. */
  push: boolean;
};

/** 복귀 사후 판정. 가를 재료가 없으면 지어내지 않고 unknown 을 낸다. */
export type RecoveryCause = "collection" | "delivery" | "unknown";

/**
 * 공백 판정. **심박이 한 번도 온 적 없는 작업자는 제외한다** — 등록만 하고 아직 안 찬 슬롯이
 * 매 틱마다 알림을 내면 진짜 공백과 구별되지 않는다(관제 "작업자 대기" 와 같은 자리).
 *
 * ⚠ 판정은 야간에도 그대로 한다(원장·화면). 달라진 것은 **push 조건이 시각에서 상태로**
 *   바뀐 것뿐이다 — 2026-08-19 의 "야간에도 원장은 남긴다" 결정은 그대로 산다.
 */
export function decideAbsences(workers: WorkerLastSeen[], nowMs: number): AbsenceDecision[] {
  const out: AbsenceDecision[] = [];
  for (const w of workers) {
    if (!w.lastHeartbeatIso) continue;
    const last = Date.parse(w.lastHeartbeatIso);
    if (Number.isNaN(last)) continue;
    const elapsedMs = nowMs - last;
    if (elapsedMs < ABSENCE_THRESHOLD_MS) continue;
    out.push({
      workerId: w.workerId,
      workerName: w.workerName,
      gapStartIso: w.lastHeartbeatIso,
      elapsedMs,
      push: shouldPushAbsence(w.worn, w.batteryStatus),
    });
  }
  return out;
}

/**
 * 복귀 직후 1분의 최대 측정 지연으로 원인을 사후 분류한다.
 *
 * ⚠ **실시간으로는 못 가른다.** 공백 중에는 두 원인이 같은 모양이고(옆 세션 실측 — 16분까지
 * 완전히 겹친다), 복귀해서 밀린 것이 오는지 봐야 갈린다. 그래서 알림 문구는 원인을 말하지 않고
 * 해제 문구에서만 말한다.
 */
export function classifyRecovery(maxMeasuredLagSec: number | null): RecoveryCause {
  if (maxMeasuredLagSec === null) return "unknown";
  return maxMeasuredLagSec >= DELIVERY_STALL_LAG_SEC ? "delivery" : "collection";
}

const RECOVERY_LABEL: Record<RecoveryCause, string> = {
  collection: "수집이 멎어 있었음",
  delivery: "전달이 밀렸던 것(워치는 재고 있었음)",
  unknown: "원인 판정 불가 — 복귀 직후 심박이 없었음",
};

/** 원장 `ack_by` 에 남길 해제 사유. 사람이 나중에 읽는 자리라 접두사로 자동 처리임을 밝힌다. */
export function recoveryAckBy(cause: RecoveryCause): string {
  return `자동해제 · ${RECOVERY_LABEL[cause]}`;
}

/** ms → "12시간 54분" · "23분". 초 단위는 이 알림 해상도에서 의미가 없어 버린다. */
export function formatElapsed(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

/** ISO → KST "MM-DD HH:mm". 파싱 실패 시 원본. */
function kstStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

function who(workerId: string, workerName: string | null): string {
  const masked = workerName ? maskWorkerName(workerName) : null;
  return masked ? `${masked} (${workerId})` : workerId;
}

/**
 * 공백 통지 본문.
 *
 * ★ **관측 사실만 적는다.** "수동 재개 필요" 같은 원인·조치 단정은 금지다 — 같은 끊김이
 * 거리 이탈일 수 있고(자동 복구된다는 실기기 확증이 있다) **그 순간에는 서버도 못 가른다.**
 * 마지막 줄은 진단이 아니라 상태의 재진술이다 — 원인이 무엇이든 참이다.
 */
export function absenceMessage(d: Pick<AbsenceDecision, "workerId" | "workerName" | "gapStartIso" | "elapsedMs">): string {
  return [
    "📵 생체 수신 없음",
    `작업자 ${who(d.workerId, d.workerName)}`,
    `${formatElapsed(d.elapsedMs)}째 수신 없음 (마지막 ${kstStamp(d.gapStartIso)})`,
    "이 작업자는 지금 감시되지 않습니다.",
  ].join("\n");
}

/** 해제 통지 본문. 원인은 여기서만 말한다(복귀해야 갈리므로). */
export function recoveryMessage(input: {
  workerId: string;
  workerName: string | null;
  gapStartIso: string;
  gapMs: number;
  cause: RecoveryCause;
}): string {
  return [
    "✅ 생체 수신 재개",
    `작업자 ${who(input.workerId, input.workerName)}`,
    `공백 ${formatElapsed(input.gapMs)} (${kstStamp(input.gapStartIso)}부터)`,
    `사후 판정 — ${RECOVERY_LABEL[input.cause]}`,
  ].join("\n");
}
