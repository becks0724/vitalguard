// 감시 공백 판정 — "서버가 N분째 못 받고 있다" 를 정하는 순수 로직(DB·현재시각 의존 없음)
//
// ★ 이 모듈이 존재하는 이유. 관제 경보는 전부 **샘플이 들어올 때** 발화한다(recordAlert 호출부가
//   모두 수신 경로다). 샘플이 안 오면 발화 지점 자체가 없어서, 2026-08-18 19:01 부터 12.9시간
//   수신이 끊겼는데 경보가 0건이었다. 부재는 수신으로 감지할 수 없으므로 서버가 주기로 캐물어야 한다.

import { maskWorkerName } from "./telegram";

/** 이만큼 못 받으면 공백으로 본다. 7일 실측 24건(하루 3.4회) — 30분으로 올리면 08-18 의 20.9분을 놓친다. */
export const ABSENCE_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * push 를 보내는 시간대(KST). 이 밖에서는 원장 기록과 화면 표시만 한다.
 *
 * 근거 — 10분 초과 공백 24건 중 **7건이 야간 시작이고 길이가 600~920분**이라 퇴근으로 보인다.
 * 여기에 push 하면 매일 밤 울려서 일주일이면 무시된다.
 *
 * ★ 무엇이 결정이고 무엇이 우리 기본값인지 구분해 둔다.
 *   · 사용자 결정(2026-08-19) = **"야간은 화면 표시만"** — 즉 push 를 근무시간으로 막는다는 것까지.
 *   · **07~19 라는 숫자는 우리가 고른 기본값이다.** 사용자가 시각을 짚은 적 없다.
 *     현장이 늘면 근거 없이 굳지 않게 여기서 바꾼다.
 *
 * ⚠ 야간 교대 현장에서는 이 규칙이 틀린다 — 교대 정보가 없어 시계로 자를 수밖에 없다.
 *   배터리로 "충전=퇴근" 을 가르는 안은 폐기됐다. **부재 중에는 아무 데이터도 안 오므로
 *   충전 여부는 복구된 뒤에야 보인다**(실시간 판단 불가).
 * ★ 다만 사후 검증 재료는 곧 생긴다 — 세션 계측(`session_auto_resumed`)이 워치에 올라가면
 *   긴 공백 뒤 `false` 인 지점이 "사람이 [시작] 을 누른 시각" = 복귀 시각이라, 며칠 쌓이면
 *   이 07~19 가정이 실제 근무 경계와 맞는지 대조할 수 있다.
 */
export const PUSH_WINDOW_START_HOUR = 7;
export const PUSH_WINDOW_END_HOUR = 19;

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
  /** 마지막으로 받은 샘플의 시각. 한 번도 받은 적 없으면 null. */
  lastSeenIso: string | null;
};

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

/** UTC epoch → KST 시(hour). 서버 타임존에 기대지 않는다. */
function kstHour(nowMs: number): number {
  return new Date(nowMs + 9 * 60 * 60 * 1000).getUTCHours();
}

export function isWithinPushWindow(nowMs: number): boolean {
  const h = kstHour(nowMs);
  return h >= PUSH_WINDOW_START_HOUR && h < PUSH_WINDOW_END_HOUR;
}

/**
 * 공백 판정. **한 번도 받은 적 없는 작업자는 제외한다** — 등록만 하고 아직 안 찬 슬롯이
 * 매 틱마다 알림을 내면 진짜 공백과 구별되지 않는다(관제 "작업자 대기" 와 같은 자리).
 */
export function decideAbsences(workers: WorkerLastSeen[], nowMs: number): AbsenceDecision[] {
  const push = isWithinPushWindow(nowMs);
  const out: AbsenceDecision[] = [];
  for (const w of workers) {
    if (!w.lastSeenIso) continue;
    const last = Date.parse(w.lastSeenIso);
    if (Number.isNaN(last)) continue;
    const elapsedMs = nowMs - last;
    if (elapsedMs < ABSENCE_THRESHOLD_MS) continue;
    out.push({
      workerId: w.workerId,
      workerName: w.workerName,
      gapStartIso: w.lastSeenIso,
      elapsedMs,
      push,
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
