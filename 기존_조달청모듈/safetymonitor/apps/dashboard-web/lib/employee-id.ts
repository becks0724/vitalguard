// 계정 사번(employee_id) 기본값을 만드는 단일 지점.
//
// 왜 이 규칙인가 — 우리가 새로 정하는 게 아니라 **이미 통용되는 규칙을 서버가 인정**하는 것이다.
// iOS 앱이 로그인 시 서버가 사번을 안 주면 `EMP-<로그인ID>` 로 스스로 만들어 쓰고
// (VitAlGuardPreviewApp.swift 의 vitalGuardEmployeeIdentifier), 그 값으로 생체·미디어가
// 수십만 건 쌓였다. 정작 서버의 users.employee_id 는 9명 중 8명이 비어 있었다.
//
// 그 결과 사진 소유권 판정(worker_id 대조)이 항상 실패해, 본인이 올린 사진도 못 지웠다.
// 서버가 같은 규칙으로 값을 채우면 기존 데이터와 즉시 일치한다(감사 BE-AUTHZ-05).
//
// 실제 사번이 따로 있는 계정은 프로필에서 덮어쓴다 — 이 함수는 어디까지나 **기본값**이고,
// 이미 값이 있는 계정은 절대 건드리지 않는다.
export function defaultEmployeeId(username: string): string {
  const normalized = username.trim();
  return normalized ? `EMP-${normalized}` : "";
}
