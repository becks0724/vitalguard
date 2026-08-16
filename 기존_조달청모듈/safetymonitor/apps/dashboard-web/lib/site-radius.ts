// 관제구역(현장 반경) 정책 — 관제 화면과 iOS 앱이 같은 값을 쓰도록 한 곳에 둔다.
//
// 왜 한 곳인가(2026-08-16 실측). 구 앱은 단말 게이트가 **500m** 였다 —
// `ConnectionSettings.swift:881` 의 `shouldPublishLocation` 이 직전 발행 지점에서 반경 이상
// 움직여야 새 좌표를 올린다. 그런데 관제 구획은 **100m** 였다. 단말이 5배 성겨서
// **100m 원을 벗어나도 500m 를 안 넘으면 좌표가 안 올라와 이탈이 잡히지 않았다.**
// 두 숫자가 서로 다른 파일에 리터럴로 박혀 있으면 이 어긋남은 조용히 재발한다.
//
// 상·하한의 뜻.
//  · 상한 100m — 이보다 넓으면 "현장 안"이 너무 헐거워져 이탈 판정이 늦는다.
//  · 하한  50m — 이보다 좁으면 coarse 측위(±100m 등급)의 오차가 반경을 넘어
//    가만히 있어도 들락날락하는 오탐이 된다. GPS 정확도가 바닥이다.
//
// ⚠ iOS `LocationProvider.swift` 가 같은 값을 갖는다. 여기만 바꾸면 갈린다 —
//   `2026-08-16-site-radius-policy.guard.test.ts` 가 두 숫자를 묶어 고정한다.

/** 관제구역 반경 하한(m). 이보다 좁으면 측위 오차가 반경을 넘어 이탈이 오탐이 된다. */
export const SITE_RADIUS_MIN_M = 50;

/** 관제구역 반경 상한(m). 이보다 넓으면 이탈 판정이 늦는다. */
export const SITE_RADIUS_MAX_M = 100;

/**
 * 반경을 정책 범위로 좁힌다.
 * 비유한 값(NaN·Infinity)은 상한으로 떨어뜨린다 — 판정을 못 하는 것보다 넓게라도 도는 편이 낫고,
 * 하한으로 떨어뜨리면 오탐 이탈 경보가 쏟아진다.
 */
export function clampSiteRadiusM(value: number): number {
  if (!Number.isFinite(value)) return SITE_RADIUS_MAX_M;
  return Math.min(SITE_RADIUS_MAX_M, Math.max(SITE_RADIUS_MIN_M, value));
}
