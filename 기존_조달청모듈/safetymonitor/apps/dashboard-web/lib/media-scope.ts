// 캘린더 미디어(현장 사진) 수정·삭제 권한 범위를 만드는 단일 지점.
//
// 댓글(lib/comment-scope.ts)과 모양은 비슷하지만 **다른 규칙**이다. 합치면 안 된다.
//  · 댓글  = 관제 세션의 username 을 author_id 와 대조한다.
//  · 미디어 = 작업자 **사번**을 worker_id 와 대조한다.
// 한 함수로 묶으면 한쪽 규칙을 고칠 때 다른 쪽이 조용히 따라 바뀐다.

// 권한 범위 — 사진을 올린 작업자 본인(사번 그룹)이거나, 모더레이션 권한자(owner)다.
//
// **사번이 하나가 아니라 배열**인 이유 — 같은 사람이 여러 ID 로 들어온다.
// 폰과 워치가 다른 사번을 쓰고(EMP-6861 / EMP-admin6861), 관제 웹의 "작업자 ID 병합"이
// 이를 하나로 합친다. 사번 하나만 비교하면 **병합된 다른 ID 로 올린 자기 사진을 못 지운다**.
// 실제로 그 증상으로 제보가 들어왔다(2026-07-27).
//
// 유니온 **필수** 인자로 둔다. 선택 인자였다면 호출부가 값을 빠뜨렸을 때 조용히
// "전체 허용"으로 떨어져, 지금 고치는 IDOR 이 타입 검사도 통과하며 그대로 재현된다.
export type MediaScope = { workerIds: string[] } | "moderator";

// 소유권은 SQL WHERE 에 넣는다 — 먼저 SELECT 해서 비교하면 그 사이 행이 바뀔 수 있고(TOCTOU)
// 왕복도 는다. 대상이 없거나 남의 것이면 rowCount 0 이 되어 호출부가 404 로 응답한다.
//
// params 를 직접 밀어넣고 자리표시자 번호를 그 길이에서 뽑는다. 번호를 상수로 박으면
// 호출부마다 파라미터 개수가 달라 어긋난다(DELETE 는 [id], PATCH 는 [id, description] 뒤다).
export function mediaScopeClause(
  scope: MediaScope,
  params: unknown[],
): string {
  if (scope === "moderator") return "";
  params.push(scope.workerIds);
  return ` AND worker_id = ANY($${params.length}::text[])`;
}

// 한 사람으로 취급해야 할 사번 전부 — 본인 사번 + 병합으로 이어진 ID 들.
// aliasMap 은 secondary → primary 방향이라 양쪽을 모두 훑는다.
//  · 내가 secondary 면 primary 를 따라가고,
//  · 그 primary 를 가리키는 다른 secondary 들도 같은 사람이므로 함께 넣는다.
// 어느 ID 로 올렸든 본인 사진을 지울 수 있어야 한다.
export function workerIdGroup(
  workerId: string,
  aliasMap: Record<string, string>,
): string[] {
  const primary = aliasMap[workerId] ?? workerId;
  const group = new Set<string>([workerId, primary]);
  for (const [secondary, mapped] of Object.entries(aliasMap)) {
    if (mapped === primary) group.add(secondary);
  }
  return [...group];
}

// 이 사진이 이 범위로 지워지는가 — GET 응답의 canDelete 계산용.
// 목록 조회와 실제 삭제가 **같은 규칙**을 쓰게 해, 화면에 보이는 버튼과 서버 판정이 어긋나지
// 않도록 한다. 버튼만 보이고 눌렀더니 403 이면 사용자는 고장으로 받아들인다.
export function mediaMatchesScope(
  rowWorkerId: string | null,
  scope: MediaScope,
): boolean {
  if (scope === "moderator") return true;
  if (!rowWorkerId) return false;
  return scope.workerIds.includes(rowWorkerId);
}
