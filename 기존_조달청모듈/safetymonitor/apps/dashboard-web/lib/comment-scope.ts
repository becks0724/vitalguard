// 미디어 댓글 수정·삭제의 소유권 조건을 만드는 단일 지점 (감사 BE-AUTHZ-03).
// 규칙을 호출부마다 각자 구현하면 한 곳만 틀려도 IDOR 이 되살아난다(교훈 L-12).

// 권한 범위 — 작성자 본인이거나, 모더레이션 권한자(owner)다.
// 유니온 **필수** 인자로 둔다. 선택 인자였다면 호출부가 값을 빠뜨렸을 때 조용히
// "전체 허용"으로 떨어져, 지금 고치는 IDOR 이 타입 검사도 통과하며 재현된다.
export type CommentScope = { authorId: string } | "moderator";

// 소유권은 SQL WHERE 에 넣는다 — 먼저 SELECT 해서 비교하면 그 사이 행이 바뀔 수 있고(TOCTOU)
// 왕복도 는다. 대상이 없거나 남의 것이면 rowCount 0 이 되어 호출부가 404 로 응답한다.
//
// params 를 직접 밀어넣고 자리표시자 번호를 그 길이에서 뽑는다. 번호를 상수로 박으면
// 호출부마다 파라미터 개수가 달라 어긋난다(update 는 $1,$2 를 이미 쓰고 delete 는 $1 만 쓴다).
export function commentScopeClause(
  scope: CommentScope,
  params: unknown[],
): string {
  if (scope === "moderator") return "";
  params.push(scope.authorId);
  return ` AND author_id = $${params.length}`;
}
