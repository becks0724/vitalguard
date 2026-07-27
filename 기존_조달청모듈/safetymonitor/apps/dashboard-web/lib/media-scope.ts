// 캘린더 미디어(현장 사진) 삭제 권한 범위를 만드는 단일 지점.
//
// 댓글(lib/comment-scope.ts)과 모양은 같지만 **다른 규칙**이다. 합치면 안 된다.
//  · 댓글  = 관제 세션의 username 을 author_id 와 대조한다.
//  · 미디어 = 앱 JWT 의 사번(workerId)을 worker_id 와 대조한다.
// 올리는 쪽(작업자 앱)과 지우는 쪽(관제 웹)의 신원 체계가 애초에 다르기 때문이다.
// 한 함수로 묶으면 한쪽 규칙을 고칠 때 다른 쪽이 조용히 따라 바뀐다.

// 권한 범위 — 사진을 올린 작업자 본인이거나, 모더레이션 권한자(owner)다.
// 유니온 **필수** 인자로 둔다. 선택 인자였다면 호출부가 값을 빠뜨렸을 때 조용히
// "전체 허용"으로 떨어져, 지금 고치는 IDOR 이 타입 검사도 통과하며 그대로 재현된다.
export type MediaScope = { workerId: string } | "moderator";

// 소유권은 SQL WHERE 에 넣는다 — 먼저 SELECT 해서 비교하면 그 사이 행이 바뀔 수 있고(TOCTOU)
// 왕복도 는다. 대상이 없거나 남의 것이면 rowCount 0 이 되어 호출부가 404 로 응답한다.
//
// params 를 직접 밀어넣고 자리표시자 번호를 그 길이에서 뽑는다. 번호를 상수로 박으면
// 호출부마다 파라미터 개수가 달라 어긋난다.
export function mediaScopeClause(
  scope: MediaScope,
  params: unknown[],
): string {
  if (scope === "moderator") return "";
  params.push(scope.workerId);
  return ` AND worker_id = $${params.length}`;
}
