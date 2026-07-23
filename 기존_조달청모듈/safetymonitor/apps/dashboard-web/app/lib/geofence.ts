// 현장 구획(반경 원) 이탈 판정 — 히스테리시스 상태머신 (순수 로직, I/O 없음)
import { haversineKm } from "./hospital";

// GPS 지터(도심 5~30m) 플리커 방어 상수 — 이탈/복귀 판정의 단일 소스.
export const GEOFENCE_EXIT_MARGIN_M = 10; // 이탈 후보 = 반경 + 10m 초과
export const GEOFENCE_RETURN_MARGIN_M = 10; // 복귀 = 반경 − 10m 이내
export const GEOFENCE_EXIT_STREAK = 3; // 이탈 확정 = 연속 3회(2초 폴링 ≈ 6초) 초과

export type GeofenceState = {
  outside: boolean; // 이탈 확정 상태
  exitStreak: number; // 이탈 후보 연속 관측 횟수(확정 전 카운트)
};

// exit = 이탈 확정 전이(경보 발화·이력 기록 시점) / return = 구획 내 복귀 전이.
export type GeofenceEvent = "exit" | "return" | null;

export const GEOFENCE_INITIAL: GeofenceState = { outside: false, exitStreak: 0 };

// 하버사인 거리(m) — 병원 패널과 동일 유틸 재사용.
export function geofenceDistanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  return haversineKm(lat1, lon1, lat2, lon2) * 1000;
}

// ── 위험구역 진입 판정 — 구획 이탈의 미러 히스테리시스 ──
// 진입 확정 = 반경−10m 미만이 연속 3회 지속 / 이탈 = 반경+10m 초과. 같은 마진·연속횟수 상수 공유.
export type ZoneEntryState = {
  inside: boolean; // 진입 확정 상태(경보 대상)
  entryStreak: number; // 진입 후보 연속 관측 횟수(확정 전 카운트)
};

// enter = 진입 확정 전이(경보 발화·이력 기록 시점) / leave = 구역 밖 복귀 전이.
export type ZoneEntryEvent = "enter" | "leave" | null;

export const ZONE_ENTRY_INITIAL: ZoneEntryState = { inside: false, entryStreak: 0 };

export function stepZoneEntry(
  state: ZoneEntryState,
  distM: number,
  radiusM: number,
): { state: ZoneEntryState; event: ZoneEntryEvent } {
  if (!Number.isFinite(distM) || !Number.isFinite(radiusM) || radiusM <= 0) {
    return { state, event: null };
  }
  if (state.inside) {
    if (distM > radiusM + GEOFENCE_EXIT_MARGIN_M) {
      return { state: { inside: false, entryStreak: 0 }, event: "leave" };
    }
    return { state, event: null };
  }
  if (distM < radiusM - GEOFENCE_RETURN_MARGIN_M) {
    const streak = state.entryStreak + 1;
    if (streak >= GEOFENCE_EXIT_STREAK) {
      return { state: { inside: true, entryStreak: 0 }, event: "enter" };
    }
    return { state: { inside: false, entryStreak: streak }, event: null };
  }
  if (state.entryStreak !== 0) {
    return { state: { inside: false, entryStreak: 0 }, event: null };
  }
  return { state, event: null };
}

// 관측 1회 반영 — 새 상태와 전이 이벤트를 반환한다(입력 상태는 불변).
// 반경±마진 사이 회색지대에서는 현 상태를 유지해 경계 플리커를 흡수한다.
export function stepGeofence(
  state: GeofenceState,
  distM: number,
  radiusM: number,
): { state: GeofenceState; event: GeofenceEvent } {
  if (!Number.isFinite(distM) || !Number.isFinite(radiusM) || radiusM <= 0) {
    return { state, event: null };
  }
  if (state.outside) {
    if (distM <= radiusM - GEOFENCE_RETURN_MARGIN_M) {
      return { state: { outside: false, exitStreak: 0 }, event: "return" };
    }
    return { state, event: null };
  }
  if (distM > radiusM + GEOFENCE_EXIT_MARGIN_M) {
    const streak = state.exitStreak + 1;
    if (streak >= GEOFENCE_EXIT_STREAK) {
      return { state: { outside: true, exitStreak: 0 }, event: "exit" };
    }
    return { state: { outside: false, exitStreak: streak }, event: null };
  }
  if (state.exitStreak !== 0) {
    return { state: { outside: false, exitStreak: 0 }, event: null };
  }
  return { state, event: null };
}
