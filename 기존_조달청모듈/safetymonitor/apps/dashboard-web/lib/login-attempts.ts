// 로그인 시도 제한(무차별 대입 방어) — 잠금 상태를 인스턴스 간 공유한다.
//
// 왜 DB 인가. Cloud Run 이 1~4 인스턴스로 뜨는데 카운터가 프로세스 메모리에만 있으면 인스턴스마다
// 따로 세어, 5회 임계가 실제로는 인스턴스 수만큼(최대 20회) 늘어난다. 잠금이 있다고 믿는데 없는 상태.
//
// 왜 메모리를 남기는가. DB 가 죽었을 때 잠금이 통째로 사라지면 방어가 0 이 된다. 두 곳 모두에
// 기록하고 판정은 **둘 중 긴 쪽**을 쓴다 → DB 장애 시 최악이 종전(프로세스 단위)과 같아진다.
//
// 키는 'ip:id'. id 단독 키잉은 한 공격자가 임의 id 로 남을 잠그는 targeted lockout(DoS)이 된다.
import { clearLoginAttempts, readLoginLockMs, recordLoginFailure } from "./db";

export const MAX_FAILS = 5;
export const LOCKOUT_MS = 5 * 60 * 1000; // 5분
const MAX_ATTEMPT_ENTRIES = 5000; // 로컬 Map 무한 증식 방지 상한

type AttemptRecord = { fails: number; lockedUntil: number };
const globalForAttempts = globalThis as typeof globalThis & {
  __safetyMonitorLoginAttempts?: Map<string, AttemptRecord>;
};
const localAttempts: Map<string, AttemptRecord> =
  globalForAttempts.__safetyMonitorLoginAttempts ??
  (globalForAttempts.__safetyMonitorLoginAttempts = new Map());

// DB 실패는 로그인 시도마다 찍히면 로그를 덮으므로 사유별 1회만 남긴다.
const warned = new Set<string>();
function warnOnce(what: string, error: unknown): void {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`[login-attempts] 공유 잠금 ${what} 실패 — 이 인스턴스 메모리로만 방어합니다`, error);
}

// 만료된(잠금 풀렸고 실패 0) 항목 정리 + 상한 초과 시 오래된 항목부터 제거(Map 은 삽입 순서 유지).
function sweepLocal(): void {
  const now = Date.now();
  for (const [key, rec] of localAttempts) {
    if (rec.lockedUntil <= now && rec.fails === 0) localAttempts.delete(key);
  }
  while (localAttempts.size > MAX_ATTEMPT_ENTRIES) {
    const oldest = localAttempts.keys().next().value;
    if (oldest === undefined) break;
    localAttempts.delete(oldest);
  }
}

function localRemainingMs(key: string): number {
  const rec = localAttempts.get(key);
  if (!rec) return 0;
  const remaining = rec.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

function recordLocal(key: string, ok: boolean): void {
  if (ok) {
    localAttempts.delete(key);
    return;
  }
  const rec = localAttempts.get(key) ?? { fails: 0, lockedUntil: 0 };
  rec.fails += 1;
  if (rec.fails >= MAX_FAILS) {
    rec.lockedUntil = Date.now() + LOCKOUT_MS;
    rec.fails = 0; // 잠금 발동 후 리셋 — 해제되면 다시 MAX_FAILS 기회
  }
  localAttempts.set(key, rec);
  sweepLocal();
}

/** 남은 잠금 시간(ms). 0 이면 잠기지 않음. key = 'ip:id'. */
export async function loginLockRemainingMs(key: string): Promise<number> {
  const local = localRemainingMs(key);
  let shared = 0;
  try {
    shared = await readLoginLockMs(key);
  } catch (error) {
    warnOnce("조회", error);
  }
  return Math.max(local, shared);
}

/** 로그인 결과 기록 — 성공이면 카운터 리셋, 실패면 누적(임계 도달 시 잠금). key = 'ip:id'. */
export async function recordLoginResult(key: string, ok: boolean): Promise<void> {
  recordLocal(key, ok);
  try {
    if (ok) await clearLoginAttempts(key);
    else await recordLoginFailure(key, MAX_FAILS, LOCKOUT_MS);
  } catch (error) {
    warnOnce("기록", error);
  }
}
