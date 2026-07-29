// 일정 캘린더 일정의 수정·삭제 권한 범위를 만드는 단일 지점.
//
// 댓글(lib/comment-scope.ts)·미디어(lib/media-scope.ts)와 모양은 비슷하지만 **대조 대상이 다르다**.
// 셋을 한 함수로 묶으면 한쪽 규칙을 고칠 때 다른 쪽이 조용히 따라 바뀐다.
//  · 댓글   = 관제 세션의 username 을 author_id 와 대조한다.
//  · 미디어 = 작업자 **사번**을 worker_id 와 대조한다(앱이 올리므로 신원 체계가 다르다).
//  · 일정   = 관제 세션의 username 을 created_by 와 대조한다. 일정은 관제 웹에서만 등록되므로
//             사번 환산이 필요 없다 — 올리는 쪽과 지우는 쪽이 같은 신원 체계다.
//
// 권한 범위 — 일정을 등록한 본인이거나, 총괄 관리자(owner)다.
// 유니온 **필수** 인자로 둔다. 선택 인자였다면 호출부가 값을 빠뜨렸을 때 조용히
// "전체 허용"으로 떨어져, 지금 고치는 IDOR 이 타입 검사도 통과하며 그대로 재현된다.
export type CalendarEventScope = { createdBy: string } | "moderator";

// 소유권은 SQL WHERE 에 넣는다 — 먼저 SELECT 해서 비교하면 그 사이 행이 바뀔 수 있고(TOCTOU)
// 왕복도 는다. 대상이 없거나 남의 것이면 rowCount 0 이 되어 호출부가 403 으로 응답한다.
//
// params 를 직접 밀어넣고 자리표시자 번호를 그 길이에서 뽑는다. 번호를 상수로 박으면
// 호출부마다 파라미터 개수가 달라 어긋난다(업서트는 8개를 이미 쓰고 삭제는 $1 만 쓴다).
export function calendarEventScopeClause(
  scope: CalendarEventScope,
  params: unknown[],
): string {
  if (scope === "moderator") return "";
  params.push(scope.createdBy);
  return ` AND calendar_event.created_by = $${params.length}`;
}

// 이 일정이 이 범위로 수정·삭제되는가 — GET 응답의 canEdit 계산용.
// 목록 조회와 실제 쓰기가 **같은 규칙**을 쓰게 해, 화면에 보이는 버튼과 서버 판정이 어긋나지
// 않도록 한다. 버튼만 보이고 눌렀더니 403 이면 사용자는 고장으로 받아들인다.
//
// created_by 가 비어 있으면(옛 마이그레이션분 등) 작성자 본인일 수 없으므로 거부다 — owner 만 다룬다.
export function calendarEventMatchesScope(
  rowCreatedBy: string | null,
  scope: CalendarEventScope,
): boolean {
  if (scope === "moderator") return true;
  if (!rowCreatedBy) return false;
  return rowCreatedBy === scope.createdBy;
}
