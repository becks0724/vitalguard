// 내보내기 동시 실행 가드 — 인스턴스당 동시 1건 제한(CSV·XLSX 공유).
// 대용량 내보내기가 겹치면 메모리가 중첩되어 인스턴스 사망(OOM→503) 위험이 커진다.
// maxScale>1 이라 완전 전역 락은 아니지만, 목적(중복 클릭·다중 관리자 동시 클릭 방어)에는 충분.
let inFlight = 0;

export function tryAcquireExportSlot(): boolean {
  if (inFlight >= 1) return false;
  inFlight += 1;
  return true;
}

export function releaseExportSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
}
